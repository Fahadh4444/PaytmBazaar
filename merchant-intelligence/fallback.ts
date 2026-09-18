/**
 * The safety net under the LLM: plain-language wording built directly from
 * the fact table, so a merchant always gets a useful, correct answer even
 * when the model is down, slow, or keeps using figures it was not given.
 *
 * Every number here is copied from a fact, so it passes the same figure
 * check as the model's replies.
 */

import type { RelevantIntelligence } from "@/relevance-engine";

import { unsupportedFigures } from "./insight";
import type { Fact, MerchantInsight, ProposedAction } from "./types";

const value = (facts: Fact[], id: string) => facts.find((f) => f.id === id)?.value ?? null;
const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const change = (n: number) => (n >= 0 ? `rose ${n}%` : `fell ${Math.abs(n)}%`);

/** The time of day with the weakest (lowest) sales change, from the pattern facts. */
function weakestSlot(facts: Fact[]): { slot: string; growth: number } | null {
  const slots = facts
    .map((f) => f.id.match(/^pattern\.timeOfDay\.(\w+)\.merchant_growth$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ slot: m[1], growth: value(facts, m[0])! }));
  return slots.sort((a, b) => a.growth - b.growth)[0] ?? null;
}

interface Pieces {
  summary: string;
  happening: string;
  why: string;
  opportunity: string | null;
  action: string;
  evidence: string[];
}

function pieces(facts: Fact[], action: ProposedAction | null): Pieces {
  const growth = value(facts, "merchant.gmv.growth");
  const cohort = value(facts, "cohort.gmv.growth");
  const gmv = value(facts, "merchant.gmv.current");
  const orders = value(facts, "merchant.transactions.current");
  const aov = value(facts, "merchant.aov.current");
  const gap = value(facts, "gap.cohort");
  const weak = weakestSlot(facts);
  const evidence = ["merchant.gmv.growth", "cohort.gmv.growth", "merchant.aov.current"].filter((id) => value(facts, id) !== null);

  const summary =
    growth !== null && cohort !== null
      ? `Your sales ${change(growth)} this week, while similar shops near you ${change(cohort)}.`
      : growth !== null
        ? `Your sales ${change(growth)} this week.`
        : "Here is how your shop did this week.";
  const happening = [
    gmv !== null && orders !== null ? `You sold ${money(gmv)} from ${orders} paid orders.` : "",
    aov !== null ? `Your average bill was ${money(aov)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const why =
    gap === null
      ? "There are not enough similar shops nearby to compare with this week."
      : gap <= -5
        ? "You are behind similar shops near you, so some customers may be choosing them."
        : gap >= 5
          ? "You are ahead of similar shops near you. Keep doing what is working."
          : "You are moving in step with similar shops near you.";
  const opportunity = weak && weak.growth < 0 ? `The ${weak.slot} is your weakest time: sales there ${change(weak.growth)}.` : null;
  const suggestion = action
    ? action.description
    : weak
      ? `Try a small Paytm cashback in the ${weak.slot} to bring more customers in.`
      : "Try a small Paytm cashback on your quietest day to bring more customers in.";
  return { summary, happening: happening || summary, why, opportunity, action: suggestion, evidence };
}

export function fallbackInsight(
  facts: Fact[],
  relevance: RelevantIntelligence,
  action: ProposedAction | null,
): MerchantInsight {
  const p = pieces(facts, action);
  return {
    summary: p.summary,
    whatIsHappening: p.happening,
    whyItMatters: p.why,
    opportunity: p.opportunity ? { title: "Your quietest time", reason: p.opportunity } : null,
    recommendation: {
      action: p.action,
      expectedOutcome: "More orders in your quieter hours.",
      confidence: relevance.cohortConfidence === "primary" ? "medium" : "low",
    },
    evidence: p.evidence.length ? p.evidence.map((factId) => ({ factId, note: "From your sales data" })) : [{ factId: facts[0]?.id ?? "period.days", note: "From your sales data" }],
    historicalContext: null,
  };
}

export function fallbackAnswer(facts: Fact[]): string {
  const p = pieces(facts, null);
  return [
    "Here is what your numbers show:",
    `- ${p.summary}`,
    `- ${p.happening}`,
    p.opportunity ? `- ${p.opportunity}` : "",
    "",
    `**Try this:** ${p.action}`,
    "",
    "Want me to compare your days or times of day with similar shops nearby?",
  ]
    .filter((line, i, all) => line !== "" || (all[i - 1] ?? "") !== "")
    .join("\n");
}

/**
 * Keeps only the sentences of `text` whose figures are all in the facts.
 * Returns null when too little is left to be a real answer.
 */
export function keepSupported(text: string, facts: Fact[]): string | null {
  const lines = text.split("\n").map((line) =>
    line
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => unsupportedFigures(sentence, facts).length === 0)
      .join(" "),
  );
  const kept = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const substance = kept.replace(/[^A-Za-z]/g, "").length;
  return substance >= 60 ? kept : null;
}
