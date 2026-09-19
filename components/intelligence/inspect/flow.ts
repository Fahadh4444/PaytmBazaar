/**
 * System Flow: how Paytm Bazaar is built, stage by stage, as it is actually
 * implemented (see docs/intelligence-pipeline.md), plus what each stage did
 * for the analysis open underneath.
 *
 * Stage status comes only from what the response reports: which requests have
 * returned, which services are configured, whether memory was recalled, how
 * the explanation was written, and where the proposed action stands. A stage
 * the request never reached is shown as not used, never as having run.
 */

import type { InspectSource } from "./source";

export type FlowStageId =
  | "data"
  | "adapter"
  | "m2m"
  | "relevance"
  | "recommendation"
  | "cognee"
  | "llm"
  | "approval"
  | "n8n"
  | "outcome";

export interface FlowStage {
  id: FlowStageId;
  name: string;
  /** What kind of component it is, in a few words. */
  kind: string;
  /** Product language: what it is for. */
  tagline: string;
  uses: string[];
  does: string[];
  doesNot: string[];
}

/** In the order a merchant analysis flows through them. */
export const FLOW_STAGES: FlowStage[] = [
  {
    id: "data",
    name: "Payment data",
    kind: "Data store",
    tagline: "Synthetic Paytm-like payments, refunds and daily totals, kept in Supabase.",
    uses: ["Payments and refunds", "Daily totals per shop", "Shop and Bazaar profiles", "Proposed and approved actions"],
    does: ["Holds the facts every figure is calculated from"],
    doesNot: ["Contain real Paytm merchant data: the prototype is synthetic", "Talk to the browser"],
  },
  {
    id: "adapter",
    name: "Data Adapter",
    kind: "Data access",
    tagline: "The only part of Bazaar allowed to read merchant data.",
    uses: ["Payment data, on the server only"],
    does: ["Reads and validates rows", "Hands clean records to the engines", "Saves proposed and approved actions"],
    doesNot: ["Calculate anything", "Return contact details"],
  },
  {
    id: "m2m",
    name: "M2M Engine",
    kind: "Deterministic intelligence",
    tagline: "Finds meaningful patterns across similar businesses.",
    uses: [
      "The shop's own sales, orders, refunds",
      "Similar shops: same Bazaar and category, or the same category city-wide",
      "Bazaar and city totals",
      "When sales happened: time of day, weekday, weather, event",
    ],
    does: [
      "Metrics: sales, orders, average bill, growth, refunds",
      "Comparisons with similar shops, the Bazaar and the city",
      "Pattern detection and the evidence behind each pattern",
      "Bazaar impact and opportunities",
      "The City and Bazaar views, from the same metrics",
    ],
    doesNot: ["Use an LLM for any figure", "Show a group too small to stay anonymous", "Expose any other shop's figures or identity"],
  },
  {
    id: "relevance",
    name: "Relevance Engine",
    kind: "Deterministic ranking",
    tagline: "Decides which findings matter to this shop right now.",
    uses: ["M2M output only"],
    does: [
      "Turns comparisons into signals",
      "Scores each: size × specificity × confidence × pattern support, plus an opportunity bonus",
      "Ranks them and drops noise, with a reason for each drop",
    ],
    doesNot: ["Read data", "Call AI", "Add new figures"],
  },
  {
    id: "recommendation",
    name: "Recommendation",
    kind: "Deterministic rule",
    tagline: "Proposes one concrete action when a gap is worth acting on.",
    uses: ["The ranked opportunities and signals"],
    does: [
      "Proposes a Paytm promotion when the shop is behind a growing network at medium or high priority",
      "Targets the weakest time of day if one stands out, otherwise all day",
      "Saves the proposal so it can be approved",
    ],
    doesNot: ["Come from the LLM", "Run without the merchant's approval"],
  },
  {
    id: "cognee",
    name: "Cognee memory",
    kind: "Memory",
    tagline: "Remembers this shop's past situations, actions and outcomes.",
    uses: ["The leading signals and patterns, as a search"],
    does: ["Recalls similar past situations for this shop", "Stores new insights, executed actions and measured outcomes"],
    doesNot: ["Store transactions", "Share one shop's memory with another", "Calculate figures"],
  },
  {
    id: "llm",
    name: "LLM explanation",
    kind: "Language model",
    tagline: "Explains already-calculated facts in plain words.",
    uses: ["A fact table of figures from M2M, Relevance and memory", "The ranked signals and the proposed action"],
    does: [
      "Writes the summary, why it matters and the recommendation wording",
      "Cites a fact for each piece of evidence",
      "Is checked: any figure not in the fact table rejects the reply, and rule-based wording is used instead",
    ],
    doesNot: ["Calculate", "See transactions or other shops", "Choose the action"],
  },
  {
    id: "approval",
    name: "Merchant approval",
    kind: "Person",
    tagline: "Nothing runs until the merchant says yes.",
    uses: ["The proposed action"],
    does: ["Approves the action explicitly"],
    doesNot: ["Happen automatically"],
  },
  {
    id: "n8n",
    name: "n8n workflow",
    kind: "Automation",
    tagline: "Executes the approved action.",
    uses: ["The structured action only, never LLM text"],
    does: ["Schedules the promotion", "Confirms with an execution reference"],
    doesNot: ["Decide what to run", "Run anything unapproved"],
  },
  {
    id: "outcome",
    name: "Outcome",
    kind: "Deterministic measurement",
    tagline: "Measures the days after the action against the days before, with M2M.",
    uses: ["The shop and similar shops, after the action"],
    does: ["Compares the shop with similar shops after the action", "Saves the result to Supabase and Cognee for the next analysis"],
    doesNot: ["Claim the action caused the change: the demo data does not react to actions"],
  },
];

/** The learning loop that closes the flow. */
export const FLOW_LOOP = "Outcomes are saved to Supabase and Cognee, and recalled by the next analysis.";

/**
 * `ran`: returned for this analysis. `running`: its request is still out.
 * `waiting`: next in line, blocked on a person or a later step.
 * `not_used`: not part of this analysis. `unavailable`: skipped or failed.
 */
export type FlowStatus = "ran" | "running" | "waiting" | "not_used" | "unavailable";

export interface FlowStageState {
  status: FlowStatus;
  /** What happened, for this analysis. */
  detail: string;
}

export type FlowState = Record<FlowStageId, FlowStageState>;

const AREA_ONLY = new Set<FlowStageId>(["data", "adapter", "m2m"]);

export function flowState(source: InspectSource): FlowState {
  const state = {} as FlowState;

  if (source.scope !== "merchant") {
    const noun = source.scope === "city" ? "city" : "Bazaar";
    for (const stage of FLOW_STAGES) {
      if (!AREA_ONLY.has(stage.id)) {
        state[stage.id] = { status: "not_used", detail: `Not used for this analysis: the ${noun} view is aggregate-only.` };
      } else if (source.state === "loading") {
        state[stage.id] = { status: "running", detail: "Request in progress." };
      } else if (source.state === "error" || !source.data) {
        state[stage.id] = { status: "unavailable", detail: "The request failed, so this stage's result is unknown." };
      } else {
        state[stage.id] = {
          status: "ran",
          detail:
            stage.id === "m2m"
              ? `Aggregated ${source.data.metrics.merchantCount.toLocaleString("en-IN")} shops; groups too small to stay anonymous were left out.`
              : stage.id === "adapter"
                ? "Read the daily totals for the whole network."
                : "Daily totals for the latest week and the week before.",
        };
      }
    }
    return state;
  }

  const { basics, explanation } = source;
  const basicsState = (ran: string): FlowStageState =>
    basics
      ? { status: "ran", detail: ran }
      : source.error
        ? { status: "unavailable", detail: "The request failed, so this stage's result is unknown." }
        : { status: "running", detail: "Request in progress." };

  state.data = basicsState("This shop's daily totals, and those of the network around it.");
  state.adapter = basicsState("Read this shop, its Bazaar and its network.");
  state.m2m = basicsState(
    basics
      ? `${basics.m2m.patterns.length} pattern${basics.m2m.patterns.length === 1 ? "" : "s"} and ${basics.m2m.opportunities.length} opportunit${basics.m2m.opportunities.length === 1 ? "y" : "ies"} found.`
      : "",
  );
  state.relevance = basicsState(
    basics
      ? basics.relevance.topPriority
        ? `${basics.relevance.prioritySignals.length} leading signal${basics.relevance.prioritySignals.length === 1 ? "" : "s"}, top priority ${basics.relevance.topPriority}.`
        : "No signal strong enough to lead."
      : "",
  );

  const rec = basics?.recommendation;
  state.recommendation = !basics
    ? basicsState("")
    : rec?.status === "proposed"
      ? { status: "ran", detail: `Proposed: ${rec.action.description}` }
      : { status: "ran", detail: "No action proposed: nothing worth acting on." };

  // Memory and explanation arrive with the second request.
  const history = explanation?.history;
  state.cognee = !basics
    ? { status: "waiting", detail: "Runs after the numbers are ready." }
    : !history
      ? source.explanationLoading
        ? { status: "running", detail: "Recalling this shop's history." }
        : { status: "unavailable", detail: "History was not returned." }
      : history.status === "recalled"
        ? {
            status: "ran",
            detail: history.memories.length
              ? `Recalled ${history.memories.length} record${history.memories.length === 1 ? "" : "s"} for this shop.`
              : "Searched this shop's memory; nothing recorded yet.",
          }
        : {
            status: "unavailable",
            detail: history.status === "unavailable" ? "Not configured: explained without history." : "Could not be reached: explained without history.",
          };

  const insight = explanation?.insight;
  state.llm = !basics
    ? { status: "waiting", detail: "Runs after the numbers are ready." }
    : !insight
      ? source.explanationLoading
        ? { status: "running", detail: "Generating explanation from structured intelligence." }
        : { status: "unavailable", detail: "The explanation was not returned." }
      : insight.status === "generated"
        ? insight.source === "ai"
          ? { status: "ran", detail: `${insight.model} explained ${insight.facts.length} facts; the reply passed the figure check.` }
          : { status: "unavailable", detail: "Not used this time: rule-based wording was shown instead." }
        : { status: "unavailable", detail: insight.status === "unavailable" ? "Not configured." : "Reply failed or was rejected; nothing was made up." };

  const approval = source.live?.approval ?? null;
  const proposed = rec?.status === "proposed" ? rec : null;
  const executed = proposed !== null && (proposed.actionStatus === "executed" || approval?.execution?.status === "executed");
  const failed = approval?.execution?.status === "failed";
  const approved = executed || failed || proposed?.actionStatus === "approved" || approval !== null;
  const noAction = { status: "not_used" as const, detail: "Not used for this analysis: no action was proposed." };
  if (!basics) {
    state.approval = { status: "waiting", detail: "Needs a proposed action first." };
    state.n8n = { status: "waiting", detail: "Needs an approved action first." };
    state.outcome = { status: "waiting", detail: "Needs an executed action first." };
  } else if (!proposed) {
    state.approval = noAction;
    state.n8n = noAction;
    state.outcome = noAction;
  } else {
    state.approval = approved
      ? { status: "ran", detail: "The merchant approved the action." }
      : proposed.actionId
        ? { status: "waiting", detail: "Waiting for the merchant to approve." }
        : { status: "unavailable", detail: "Cannot be approved: action storage is unavailable." };
    state.n8n = executed
      ? { status: "ran", detail: "Executed the approved promotion." }
      : failed
        ? { status: "unavailable", detail: "The run was attempted and n8n reported a failure." }
        : !proposed.executorConfigured
          ? { status: "unavailable", detail: approved ? "Not configured: the approval is saved as pending." : "Not configured: an approved action would be saved as pending." }
          : { status: "waiting", detail: "Waiting for approval." };
    const outcome = source.live?.measured ?? proposed.outcome;
    state.outcome = outcome
      ? { status: "ran", detail: "Measured after the action." }
      : executed
        ? { status: "waiting", detail: "Not measured yet." }
        : { status: "waiting", detail: "Waiting for the action to run." };
  }

  return state;
}
