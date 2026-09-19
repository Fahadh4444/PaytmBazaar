"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import SceneDialog from "@/components/bazaar/SceneDialog";
import { contextQuery, intelligenceContext, type CityContext } from "@/components/city/context";
import { shops, type Shop } from "@/data/shops";
import { GrowthBars } from "@/components/intelligence/Charts";
import ist from "@/components/intelligence/intelligence.module.css";
import DialogTools from "@/components/intelligence/inspect/DialogTools";
import { describeTopSignal, followUpQuestions, formatGrowth, merchantForBuilding } from "@/components/intelligence/present";
import RichText, { inline } from "@/components/intelligence/RichText";
import type {
  ActionExecutionOutcome,
  MeasuredOutcome,
  MeasuredOutcomeResult,
  MerchantBasics,
  MerchantExplanation,
} from "@/merchant-intelligence";
import type { SelectedContextEvidence } from "@/m2m-engine";

import styles from "./bazaar-screen.module.css";

type MerchantDialogProps = {
  shop: Shop | null;
  bazaarId: string;
  bazaarName: string;
  open: boolean;
  onClose: () => void;
  context: CityContext;
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type BazaarMerchant = { mid: string; name: string; category: string };

const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const signed = (value: number | null | undefined) =>
  value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const ATTENTION: Record<string, string> = { high: "Needs attention", medium: "Worth a look", low: "All steady" };

/** Each Bazaar's merchant list, fetched once per page visit. */
const merchantLists = new Map<string, Promise<BazaarMerchant[]>>();

function bazaarMerchants(bazaarId: string): Promise<BazaarMerchant[]> {
  let list = merchantLists.get(bazaarId);
  if (!list) {
    list = fetch(`/api/bazaars/${encodeURIComponent(bazaarId)}/merchants`).then(async (response) => {
      if (!response.ok) throw new Error(await readError(response, "Shops could not be loaded."));
      return ((await response.json()) as { merchants: BazaarMerchant[] }).merchants;
    });
    list.catch(() => merchantLists.delete(bazaarId));
    merchantLists.set(bazaarId, list);
  }
  return list;
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body?.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export default function MerchantDialog({
  shop,
  bazaarId,
  bazaarName,
  open,
  onClose,
  context,
}: MerchantDialogProps) {
  const [basics, setBasics] = useState<MerchantBasics | null>(null);
  const [explanation, setExplanation] = useState<MerchantExplanation | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<"idle" | "running" | "done">("idle");
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [measured, setMeasured] = useState<MeasuredOutcome | null>(null);
  const [approval, setApproval] = useState<ActionExecutionOutcome | null>(null);
  const [resultNote, setResultNote] = useState<string | null>(null);
  const [view, setView] = useState<"intelligence" | "simulation">("intelligence");
  const [simulation, setSimulation] = useState<MerchantBasics | null>(null);
  const [simulationContext, setSimulationContext] = useState<CityContext | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationActionState, setSimulationActionState] = useState<"idle" | "running" | "done">("idle");
  const [simulationActionResult, setSimulationActionResult] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);

  const mid = basics?.merchant.mid;

  useEffect(() => {
    if (!open || !shop) return;
    const controller = new AbortController();
    const aborted = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

    (async () => {
      setAnalysisLoading(true);
      setSummaryLoading(true);
      setAnalysisError(null);
      setExplanation(null);
      setActionState("idle");
      setActionResult(null);
      // Every Bazaar shares one street render: building N opens the Bazaar's Nth merchant.
      const merchants = await bazaarMerchants(bazaarId);
      if (merchants.length === 0) throw new Error("This Bazaar has no shops yet.");
      const building = merchantForBuilding(merchants, shops.findIndex((s) => s.id === shop.id));
      if (!building) throw new Error("This Bazaar has no shops yet.");
      const merchantId = encodeURIComponent(building.mid);

      // Numbers first: they are ready in seconds.
      const response = await fetch(`/api/merchants/${merchantId}/intelligence?view=basic`, { signal: controller.signal });
      if (!response.ok) throw new Error(await readError(response, "Your numbers could not be loaded."));
      setBasics((await response.json()) as MerchantBasics);
      setAnalysisLoading(false);

      // Then the AI summary, which takes longer the first time.
      try {
        const summary = await fetch(`/api/merchants/${merchantId}/insight`, { signal: controller.signal });
        if (summary.ok) setExplanation((await summary.json()) as MerchantExplanation);
      } catch (error) {
        if (aborted(error)) return;
      }
      setSummaryLoading(false);
    })().catch((error: unknown) => {
      if (aborted(error)) return;
      setAnalysisError(error instanceof Error ? error.message : "Your numbers could not be loaded.");
      setAnalysisLoading(false);
      setSummaryLoading(false);
    });

    return () => controller.abort();
  }, [bazaarId, open, shop]);

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chatLoading, summaryLoading]);

  const ask = (question: string) => void sendQuestion(question);
  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    await sendQuestion(draft.trim());
  };
  const sendQuestion = async (question: string) => {
    if (!mid || !question || chatLoading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }];
    setMessages(nextMessages);
    setDraft("");
    setChatError(null);
    setChatLoading(true);

    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Recent turns are enough context, and keep the request small.
        body: JSON.stringify({ messages: nextMessages.slice(-8) }),
      });
      const body = await response.json();
      if (!response.ok || body.status !== "answered") {
        throw new Error(body?.error?.message ?? "Couldn't reach Bazaar just now. Please send your question again.");
      }
      setMessages((current) => [...current, { role: "assistant", content: body.message }]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Couldn't reach Bazaar just now. Please send your question again.");
    } finally {
      setChatLoading(false);
    }
  };

  const recommendation = basics?.recommendation;
  const approveAction = async () => {
    if (!mid || recommendation?.status !== "proposed" || !recommendation.actionId) return;
    setActionState("running");
    setActionResult(null);
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: recommendation.actionId, approved: true }),
      });
      if (!response.ok && response.status !== 502) throw new Error(await readError(response, "The offer could not be started."));
      const outcome = (await response.json()) as ActionExecutionOutcome;
      setApproval(outcome);
      const started = outcome.execution?.status === "executed" || outcome.execution === null;
      setActionResult(
        outcome.execution?.status === "executed"
          ? "Done! Your offer is live."
          : outcome.execution?.status === "failed"
            ? "Sorry, the offer could not be started. Please try again."
            : "Approved. It will start once the offer service is connected.",
      );
      if (started) setActionState("done");
    } catch (error) {
      setActionResult(error instanceof Error ? error.message : "The offer could not be started.");
    } finally {
      setActionState((state) => (state === "done" ? state : "idle"));
    }
  };

  const checkResult = async () => {
    if (!mid || recommendation?.status !== "proposed" || !recommendation.actionId) return;
    setResultNote("Checking…");
    try {
      const response = await fetch(
        `/api/merchants/${encodeURIComponent(mid)}/actions/${encodeURIComponent(recommendation.actionId)}/outcome`,
        { method: "POST" },
      );
      if (!response.ok && response.status !== 202) throw new Error(await readError(response, "The result could not be checked."));
      const result = (await response.json()) as MeasuredOutcomeResult;
      if (result.status === "measured") {
        setMeasured(result.outcome);
        setResultNote(null);
      } else {
        setResultNote(`Not enough days yet: ${result.availableDays} of ${result.requiredDays} days since the offer started.`);
      }
    } catch (error) {
      setResultNote(error instanceof Error ? error.message : "The result could not be checked.");
    }
  };

  const metrics = basics?.m2m.merchantMetrics;
  const change = metrics?.current.growth;
  const impact = basics?.m2m.bazaarImpact;
  const insight = explanation?.insight.status === "generated" ? explanation.insight.insight : null;
  const weekly = basics?.period.days === 7;
  const topSignal = basics ? describeTopSignal(basics) : null;
  const outcome = measured ?? (recommendation?.status === "proposed" ? recommendation.outcome : null);
  const executedAt =
    recommendation?.status === "proposed" ? recommendation.execution?.executedAt ?? null : null;
  const running = recommendation?.status === "proposed" && (recommendation.actionStatus === "executed" || actionState === "done");
  const title = basics?.merchant.name ?? (shop ? shop.name : "Merchant");

  const behaviour = (item: SelectedContextEvidence, label: string) => {
    if (!item.supported || item.merchantGrowth === null || item.cohortGrowth === null || item.gapPp === null) {
      return `Not enough historical evidence for ${label}.`;
    }
    const merchantMove = item.merchantGrowth >= 0 ? `grew ${item.merchantGrowth.toFixed(1)}%` : `fell ${Math.abs(item.merchantGrowth).toFixed(1)}%`;
    const peerMove = item.cohortGrowth >= 0 ? `grew ${item.cohortGrowth.toFixed(1)}%` : `fell ${Math.abs(item.cohortGrowth).toFixed(1)}%`;
    const relative = item.gapPp < 0
      ? `That is ${Math.abs(item.gapPp).toFixed(1)} points behind similar shops.`
      : item.gapPp > 0
        ? `That is ${item.gapPp.toFixed(1)} points ahead of similar shops.`
        : "That is in line with similar shops.";
    return `Historically under ${label}, your sales ${merchantMove}, while similar shops ${peerMove}. ${relative}`;
  };

  const runSimulation = async () => {
    if (!mid || simulationLoading) return;
    const snapshot = { ...context };
    setView("simulation");
    setSimulationLoading(true);
    setSimulationError(null);
    setSimulation(null);
    setSimulationContext(snapshot);
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/intelligence?view=basic&${contextQuery(snapshot)}`);
      if (!response.ok) throw new Error(await readError(response, "The simulation could not be completed."));
      setSimulation((await response.json()) as MerchantBasics);
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "The simulation could not be completed.");
    } finally {
      setSimulationLoading(false);
    }
  };

  const simulationLabels = simulationContext ? {
    dayOfWeek: simulationContext.day,
    timeOfDay: `${simulationContext.hour.toString().padStart(2, "0")}:00`,
    weather: simulationContext.weather,
    event: simulationContext.event,
  } : null;
  const baselineGrowth = basics?.m2m.merchantMetrics.current.growth ?? null;
  const scenarioGrowth = simulation?.m2m.contextImpact?.forecast.expectedChangePercent ?? null;
  const scenarioDelta = baselineGrowth !== null && scenarioGrowth !== null
    ? Math.round((scenarioGrowth - baselineGrowth) * 10) / 10 : null;
  const simulationAction = (() => {
    const forecast = simulation?.m2m.contextImpact?.forecast;
    if (!forecast || forecast.confidence === "insufficient") return "Collect more observations before changing your plan.";
    if ((forecast.relativeToPeersPp ?? 0) < -5) return `Test a targeted Paytm offer for the selected ${simulationContext?.hour.toString().padStart(2, "0")}:00 window, then measure the result.`;
    if (forecast.direction === "increase") return "Email opted-in customers before this window to capture the stronger expected demand.";
    return "No context-specific promotion is indicated; keep the normal merchant plan and monitor the result.";
  })();
  const lastQuestion = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const asksForAction = /what (?:can|should) i do|increase|grow|improve|offer|recommend|notify|campaign/i.test(lastQuestion);

  const notifyFromSimulation = async () => {
    if (!mid || !simulationContext || simulationActionState === "running") return;
    setSimulationActionState("running");
    setSimulationActionResult(null);
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, context: intelligenceContext(simulationContext) }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 502) throw new Error(body?.error?.message ?? "The email could not be sent.");
      if (body.execution?.status === "executed") {
        setSimulationActionState("done");
        setSimulationActionResult("The approved email was sent by the n8n workflow.");
      } else if (body.execution?.status === "failed") {
        setSimulationActionState("idle");
        setSimulationActionResult("The email workflow failed. Please try again.");
      } else {
        setSimulationActionState("done");
        setSimulationActionResult("Approved and queued. Connect the n8n executor to deliver it.");
      }
    } catch (error) {
      setSimulationActionState("idle");
      setSimulationActionResult(error instanceof Error ? error.message : "The email could not be sent.");
    }
  };

  return (
    <SceneDialog
      open={open}
      onClose={onClose}
      eyebrow="Merchant intelligence"
      title={title}
      workspace
      tools={
        open ? (
          <DialogTools
            subject={title}
            scene={context}
            source={{
              scope: "merchant",
              basics,
              explanation,
              basicsLoading: analysisLoading,
              explanationLoading: summaryLoading,
              error: analysisError,
              live: { approval, measured },
            }}
          />
        ) : null
      }
    >
      <p className={styles.dialogLede}>{bazaarName}</p>

      <div className={styles.viewTabs} role="tablist" aria-label="Merchant views">
        <button type="button" role="tab" aria-selected={view === "intelligence"} onClick={() => setView("intelligence")}>Merchant intelligence</button>
        <button type="button" role="tab" aria-selected={view === "simulation"} onClick={runSimulation} disabled={!mid || simulationLoading}>
          {simulationLoading ? "Running simulation…" : "Run context simulation"}
        </button>
      </div>

      {view === "simulation" && (
        <section className={styles.simulationWorkspace} role="tabpanel" aria-live="polite">
          <div className={styles.sectionHeadingRow}>
            <div>
              <p className={styles.sectionKicker}>Context simulation</p>
              <h3 className={styles.workspaceHeading}>How behavior may differ</h3>
            </div>
            {simulationContext && <span className={styles.dataStamp}>{simulationContext.day} · {simulationContext.hour.toString().padStart(2, "0")}:00 · {simulationContext.weather} · {simulationContext.event}</span>}
          </div>
          {simulationLoading && <div className={styles.analysisState}>Analyzing Bazaar signals…</div>}
          {simulationError && <div className={styles.analysisState}>{simulationError}</div>}
          {simulation?.m2m.contextImpact && simulationLabels && (
            <>
              <div className={styles.forecastHero} data-confidence={simulation.m2m.contextImpact.forecast.confidence}>
                <span>Combined behavior forecast</span>
                <strong>{simulation.m2m.contextImpact.forecast.direction === "unknown" ? "Not enough evidence" : `Sales may ${simulation.m2m.contextImpact.forecast.direction}`}</strong>
                <p>{simulation.m2m.contextImpact.forecast.insight}</p>
                {scenarioDelta !== null && (
                  <p>
                    Compared with your normal Merchant Intelligence outlook ({signed(baselineGrowth)}), this scenario is {Math.abs(scenarioDelta).toFixed(1)} points {scenarioDelta >= 0 ? "stronger" : "weaker"}.
                  </p>
                )}
                <small>
                  {simulation.m2m.contextImpact.combined.basis === "exact_combination"
                    ? `Based on ${simulation.m2m.contextImpact.combined.merchantTransactions} historical orders matching all four conditions.`
                    : simulation.m2m.contextImpact.combined.basis === "dimension_model"
                      ? "Built by conservatively combining the supported day, time, weather and event signals because the exact intersection is sparse."
                      : "No reliable combined model could be produced for this selection."}
                  {` Confidence: ${simulation.m2m.contextImpact.forecast.confidence}.`}
                </small>
              </div>
              <section className={styles.simulationRecommendation}>
                <span>Simulation insight</span>
                <strong>{simulationAction}</strong>
                <small>This is a suggested response only. The workflow runs only after you explicitly approve below.</small>
                <button type="button" className={styles.rerunButton} onClick={notifyFromSimulation} disabled={simulationActionState !== "idle" || simulation.m2m.contextImpact.forecast.confidence === "insufficient"}>
                  {simulationActionState === "running" ? "Sending…" : simulationActionState === "done" ? "Email sent" : "Approve and email customers"}
                </button>
                {simulationActionResult && <p>{simulationActionResult}</p>}
              </section>
              <p className={styles.simulationSummary}>Why the model reached this result</p>
              <div className={styles.simulationGrid}>
                {simulation.m2m.contextImpact.evidence.map((item) => (
                  <article key={item.dimension} className={styles.simulationCard} data-supported={item.supported || undefined}>
                    <span>{item.dimension === "dayOfWeek" ? "Day" : item.dimension === "timeOfDay" ? "Time" : item.dimension}</span>
                    <strong>{simulationLabels[item.dimension]}</strong>
                    <p>{behaviour(item, simulationLabels[item.dimension])}</p>
                    <small>{item.merchantTransactions} of your paid orders in the current comparison period.</small>
                  </article>
                ))}
              </div>
              <p className={styles.simulationNote}>This is a data-driven scenario estimate, not a guarantee or proof that the selected conditions cause the change.</p>
              <button type="button" className={styles.rerunButton} onClick={runSimulation}>Run again with current controls</button>
            </>
          )}
        </section>
      )}

      <div className={styles.merchantWorkspace} hidden={view !== "intelligence"}>
        <section className={styles.analysisPanel} aria-labelledby="analysis-heading">
          <div className={styles.sectionHeadingRow}>
            <div>
              <p className={styles.sectionKicker}>Business pulse</p>
              <h3 id="analysis-heading" className={styles.workspaceHeading}>Your shop this week</h3>
            </div>
            {basics && (
              <span className={styles.dataStamp}>
                {basics.period.current.from} → {basics.period.current.to}
              </span>
            )}
          </div>

          {analysisLoading && <div className={styles.analysisState}>Getting your numbers…</div>}
          {analysisError && <div className={styles.analysisState}>{analysisError}</div>}

          {basics && metrics && impact && (
            <>
              <div className={styles.metricGrid}>
                <article className={styles.metricHero}>
                  <span>Sales {weekly ? "this week" : "this period"}</span>
                  <strong>{rupees.format(metrics.current.gmv)}</strong>
                  <small>
                    {metrics.current.transactions.toLocaleString("en-IN")} paid orders · {rupees.format(metrics.current.refunds)} refunded
                  </small>
                </article>
                <article className={styles.metricCard}>
                  <span>Average bill</span>
                  <strong>{metrics.current.aov == null ? "—" : rupees.format(metrics.current.aov)}</strong>
                </article>
                <article className={styles.metricCard}>
                  <span>vs {weekly ? "last week" : "before"}</span>
                  <strong className={change == null ? undefined : change >= 0 ? styles.positive : styles.negative}>
                    {signed(change)}
                  </strong>
                  <small>Similar shops nearby: {signed(impact.cohortGrowth)}</small>
                </article>
              </div>

              <div className={ist.panel}>
                <div className={ist.compare}>
                  <GrowthBars
                    caption="You vs the businesses around you"
                    highlight="You"
                    bars={[
                      { label: "You", growth: change ?? null },
                      {
                        label: basics.relevance.cohortConfidence === "fallback" ? "Similar shops (city)" : "Similar shops nearby",
                        growth: impact.cohortGrowth,
                      },
                      { label: `${basics.merchant.bazaar.name}`, growth: impact.bazaarGrowth },
                      { label: basics.merchant.bazaar.city, growth: impact.cityGrowth },
                    ]}
                    footnote="Groups are shown as a whole; no single shop's numbers are shared."
                  />
                </div>

                {topSignal ? (
                  <section className={ist.whyCard} data-priority={topSignal.priority}>
                    <p className={ist.kicker}>
                      Why this matters
                      <span className={ist.priority}>{ATTENTION[topSignal.priority]}</span>
                    </p>
                    <p className={ist.whyTitle}>{topSignal.title}</p>
                    <p className={ist.whyText}>{topSignal.sentence}</p>
                    <p className={ist.note}>{topSignal.basis}</p>
                  </section>
                ) : (
                  <section className={ist.whyCard} data-priority="low">
                    <p className={ist.kicker}>Why this matters</p>
                    <p className={ist.whyText}>Nothing stands out this week: your shop is moving with the businesses around you.</p>
                  </section>
                )}
              </div>
            </>
          )}
        </section>

        <section className={styles.chatPanel} aria-labelledby="merchant-view-heading">
          <div className={styles.chatHeading}>
            <div>
              <p className={styles.sectionKicker}>AI-guided view</p>
              <h3 id="merchant-view-heading" className={styles.workspaceHeading}>What Merchant Sees</h3>
            </div>
            <span className={styles.liveBadge}><i /> {basics?.services.llm.model ?? "AI"}</span>
          </div>

          {/* Pinned above the chat so the suggested offer is always in view. */}
          {recommendation?.status === "proposed" && (
            <div className={`${styles.assistantMessage} ${styles.offerCard}`} role="region" aria-label="Suggested offer">
              <strong>Suggested offer: {recommendation.action.description}</strong>
              {running ? (
                <>
                  <p>
                    <strong>Offer live</strong>
                    {executedAt ? ` since ${new Date(executedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}.
                  </p>
                  {outcome ? (
                    <p>
                      <strong>Result after {weekly ? "a week" : "the offer"}:</strong> your sales {formatGrowth(outcome.merchantGrowth)}, similar
                      shops {formatGrowth(outcome.cohortGrowth)}.{" "}
                      <em>Simulated outcome from demo data, not proof the offer caused it.</em>
                    </p>
                  ) : (
                    <p>
                      <button type="button" className={styles.offerButton} onClick={checkResult}>
                        Check result
                      </button>
                    </p>
                  )}
                  {resultNote && <p>{resultNote}</p>}
                </>
              ) : recommendation.actionId && actionState !== "done" ? (
                <p>
                  <button type="button" className={styles.offerButton} onClick={approveAction} disabled={actionState === "running"}>
                    {actionState === "running" ? "Starting…" : "Yes, start this offer"}
                  </button>
                </p>
              ) : !recommendation.actionId ? (
                <p>This offer can be started once offer storage is set up.</p>
              ) : null}
              {actionResult && !running && <p>{actionResult}</p>}
            </div>
          )}
          {recommendation?.status === "none" && (
            <div className={styles.assistantMessage}>No offer needed this week: your shop is keeping up with similar shops nearby.</div>
          )}

          <div className={styles.conversation} ref={conversationRef} aria-live="polite">
            {basics && summaryLoading && (
              <div className={styles.assistantMessage}>Writing a simple summary of your week…</div>
            )}
            {insight && (
              <div className={styles.assistantMessage}>
                <strong>{insight.summary}</strong>
                <p><strong>What&apos;s happening?</strong> {inline(insight.whatIsHappening)}</p>
                <p><strong>Why it matters:</strong> {insight.whyItMatters}</p>
                {insight.opportunity && (
                  <p><strong>Opportunity:</strong> {insight.opportunity.reason}</p>
                )}
                <p><strong>Recommended action:</strong> {insight.recommendation.action}</p>
              </div>
            )}
            {basics && !summaryLoading && !insight && (
              <div className={styles.assistantMessage}>
                {explanation?.insight.status === "unavailable"
                  ? "The AI summary is not set up yet. Your numbers are on the left."
                  : "The summary isn't ready right now. Your numbers are on the left — try again in a moment."}
              </div>
            )}

            {messages.length === 0 && (
              <div className={styles.chatWelcome}>
                <span className={styles.spark}>✦</span>
                <strong>Ask about your business</strong>
                <p>Ask anything about your sales, in your own words.</p>
                <div className={styles.suggestions}>
                  {["How are my sales doing?", "What should I do this week?", "Am I doing better than shops nearby?"].map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => setDraft(suggestion)} disabled={!mid}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={message.role === "user" ? styles.userMessage : styles.assistantMessage}>
                {message.role === "assistant" ? <RichText text={message.content} /> : message.content}
              </div>
            ))}
            {!chatLoading && messages.at(-1)?.role === "assistant" && (
              <>
                {asksForAction && recommendation?.status === "proposed" && recommendation.actionId && !running && (
                  <div className={styles.chatAction}>
                    <span>Act on this answer</span>
                    <button type="button" className={styles.offerButton} onClick={approveAction} disabled={actionState === "running"}>
                      {actionState === "running" ? "Sending…" : "Approve and email customers"}
                    </button>
                    <small>The assistant text is never executed. n8n receives the validated merchant action only.</small>
                  </div>
                )}
                <div className={styles.suggestions}>
                  {followUpQuestions(messages.map((m) => m.content), recommendation?.status === "proposed" && !running).map((q) => (
                    <button key={q} type="button" onClick={() => ask(q)}>{q}</button>
                  ))}
                </div>
              </>
            )}
            {chatLoading && <div className={styles.assistantMessage}>Looking at your sales…</div>}
          </div>

          {chatError && <p className={styles.chatError}>{chatError}</p>}

          <form className={styles.chatComposer} onSubmit={sendMessage}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={800}
              placeholder={mid ? "Ask about your sales…" : "Getting your numbers…"}
              aria-label="Ask about your sales"
              disabled={!mid || chatLoading}
            />
            <button type="submit" disabled={!mid || !draft.trim() || chatLoading} aria-label="Send message">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m5 12 14-7-4 14-3-6-7-1Z" />
              </svg>
            </button>
          </form>
          <p className={styles.chatFootnote}>Answers use your real sales data—never made-up numbers.</p>
        </section>
      </div>
    </SceneDialog>
  );
}
