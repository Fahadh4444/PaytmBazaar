"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import SceneDialog from "@/components/bazaar/SceneDialog";
import { contextQuery, intelligenceContext, type CityContext } from "@/components/city/context";
import { shops, type Shop } from "@/data/shops";
import { GrowthBars } from "@/components/intelligence/Charts";
import ist from "@/components/intelligence/intelligence.module.css";
import DialogTools from "@/components/intelligence/inspect/DialogTools";
import { describeTopSignal, followUpQuestions, formatGrowth, merchantForBuilding, starterQuestions } from "@/components/intelligence/present";
import RichText, { inline } from "@/components/intelligence/RichText";
import { LANGUAGE_NAMES, type LanguageCode } from "@/lib/speech/types";
import type {
  ActionExecutionOutcome,
  AskAction,
  AskResult,
  MeasuredOutcome,
  MeasuredOutcomeResult,
  MerchantBasics,
  MerchantExplanation,
} from "@/merchant-intelligence";
import type { SelectedContextEvidence } from "@/m2m-engine";

import styles from "./bazaar-screen.module.css";
import { useVoiceRecorder } from "./useVoiceRecorder";

type MerchantDialogProps = {
  shop: Shop | null;
  bazaarId: string;
  bazaarName: string;
  open: boolean;
  onClose: () => void;
  context: CityContext;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Assistant turns: what Ask Bazaar returned alongside the text. */
  language?: LanguageCode;
  action?: AskAction | null;
  evidence?: AskResult["evidence"];
  provider?: string;
  model?: string;
  /** User turns: asked by voice (the text is the transcript). */
  voice?: boolean;
  /** Spoken answer, once fetched. */
  audio?: string;
};

type VoiceReply = AskResult & {
  conversationId: string;
  transcript: string;
  audio: { base64: string; mimeType: string } | null;
  audioError: string | null;
};

const newConversationId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/** Only the text of earlier turns goes back to the server, never the extras. */
const turns = (messages: ChatMessage[]) => messages.slice(-7).map(({ role, content }) => ({ role, content }));

const factValue = (fact: AskResult["evidence"][number]) =>
  fact.unit === "inr"
    ? `₹${fact.value.toLocaleString("en-IN")}`
    : fact.unit === "percent"
      ? fact.id.endsWith("_share") ? `${fact.value}%` : `${fact.value > 0 ? "+" : ""}${fact.value}%`
      : fact.unit === "points"
        ? `${fact.value > 0 ? "+" : ""}${fact.value} pts`
        : fact.value.toLocaleString("en-IN");

const providerLabel = (provider?: string, model?: string) =>
  !provider ? null : provider === "rules" ? "Summary mode" : provider === "sarvam" ? `Sarvam · ${model ?? "105B"}` : model ?? provider;

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
  const [chatPhase, setChatPhase] = useState<"text" | "voice">("text");
  const [conversationId, setConversationId] = useState(newConversationId);
  const [lastAsk, setLastAsk] = useState<(AskResult & { question: string }) | null>(null);
  const [confirming, setConfirming] = useState<AskAction | null>(null);
  const [speaking, setSpeaking] = useState<{ index: number; state: "loading" | "playing" } | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
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
      // A conversation belongs to one merchant: start fresh for each shop.
      setMessages([]);
      setLastAsk(null);
      setConfirming(null);
      setChatError(null);
      setConversationId(newConversationId());
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

  /** Adds Ask Bazaar's answer to the conversation, keeping what came with it. */
  const addAnswer = (question: string, result: AskResult, audio?: string) => {
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: result.answer,
        language: result.language,
        action: result.action,
        evidence: result.evidence,
        provider: result.provider,
        model: result.model,
        audio,
      },
    ]);
    setLastAsk({ ...result, question });
  };

  const sendQuestion = async (question: string) => {
    if (!mid || !question || chatLoading) return;

    const history = turns(messages);
    setMessages((current) => [...current, { role: "user", content: question }]);
    setDraft("");
    setChatError(null);
    setConfirming(null);
    setChatPhase("text");
    setChatLoading(true);

    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A bounded conversation: recent turns only, text only.
        body: JSON.stringify({ message: question, history, conversationId }),
      });
      const body = await response.json();
      if (!response.ok || body.status !== "answered") {
        throw new Error(body?.error?.message ?? "Couldn't reach Bazaar just now. Please send your question again.");
      }
      addAnswer(question, body as AskResult);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Couldn't reach Bazaar just now. Please send your question again.");
    } finally {
      setChatLoading(false);
    }
  };

  const stopAudio = () => {
    player.current?.pause();
    player.current = null;
    setSpeaking(null);
  };

  const playAudio = (index: number, source: string) => {
    stopAudio();
    const audio = new Audio(source);
    player.current = audio;
    audio.onended = () => setSpeaking((current) => (current?.index === index ? null : current));
    setSpeaking({ index, state: "playing" });
    return audio.play().catch(() => {
      // Autoplay can be blocked; the Listen button still works.
      setSpeaking(null);
    });
  };

  const listen = async (index: number) => {
    const message = messages[index];
    if (!mid || !message || message.role !== "assistant") return;
    if (speaking?.index === index) return stopAudio();
    if (message.audio) return void playAudio(index, message.audio);
    stopAudio();
    setSpeaking({ index, state: "loading" });
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/chat/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message.content, language: message.language ?? "en-IN" }),
      });
      if (!response.ok) throw new Error(await readError(response, "Listening isn't available right now."));
      const { audio } = (await response.json()) as { audio: { base64: string; mimeType: string } };
      const source = `data:${audio.mimeType};base64,${audio.base64}`;
      setMessages((current) => current.map((m, i) => (i === index ? { ...m, audio: source } : m)));
      await playAudio(index, source);
    } catch (error) {
      setSpeaking(null);
      setChatError(error instanceof Error ? error.message : "Listening isn't available right now.");
    }
  };

  const sendVoice = useCallback(
    async (audio: Blob, filename: string) => {
      if (!mid) return;
      setChatError(null);
      setConfirming(null);
      setChatPhase("voice");
      setChatLoading(true);
      const form = new FormData();
      form.append("audio", audio, filename);
      form.append("history", JSON.stringify(turns(messages)));
      form.append("conversationId", conversationId);
      try {
        const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/chat/voice`, { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok || body.status !== "answered") {
          throw new Error(body?.error?.message ?? "Voice input couldn't be processed. You can type your question instead.");
        }
        const reply = body as VoiceReply;
        const source = reply.audio ? `data:${reply.audio.mimeType};base64,${reply.audio.base64}` : undefined;
        setMessages((current) => [...current, { role: "user", content: reply.transcript, voice: true }]);
        addAnswer(reply.transcript, reply, source);
        if (reply.audioError) setChatError(reply.audioError);
        // Asked by voice, answered by voice: the index is where the answer just landed.
        if (source) void playAudio(messages.length + 1, source);
      } catch (error) {
        setChatError(error instanceof Error ? error.message : "Voice input couldn't be processed. You can type your question instead.");
      } finally {
        setChatLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mid, messages, conversationId],
  );
  const recorder = useVoiceRecorder(sendVoice);

  // Closing the dialog stops any answer being read aloud.
  useEffect(() => {
    if (!open) {
      player.current?.pause();
      player.current = null;
    }
  }, [open]);

  const recommendation = basics?.recommendation;
  /** Runs the saved proposal, only after the merchant's explicit approval. */
  const approveAction = async (actionId = recommendation?.status === "proposed" ? recommendation.actionId : null) => {
    if (!mid || !actionId) return;
    setActionState("running");
    setActionResult(null);
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(mid)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId, approved: true }),
      });
      if (!response.ok && response.status !== 502) throw new Error(await readError(response, "The offer could not be started."));
      const outcome = (await response.json()) as ActionExecutionOutcome;
      setApproval(outcome);
      const started = outcome.execution?.status === "executed" || outcome.execution === null;
      setActionResult(
        outcome.execution?.status === "executed"
          ? "Done! Your offer is live."
          : outcome.execution?.status === "failed"
            ? "Sorry, the offer could not be started. Your recommendation is saved; please try again."
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
  const latest = messages.at(-1);
  const chatAction = !chatLoading && latest?.role === "assistant" && !running && actionState !== "done" ? latest.action ?? null : null;
  const badge = providerLabel(lastAsk?.provider, lastAsk?.model) ?? providerLabel(basics?.services.llm.provider, basics?.services.llm.model);

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
              live: { approval, measured, ask: lastAsk },
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
                {simulation.contextAction?.supported ? (
                  <button type="button" className={styles.rerunButton} onClick={notifyFromSimulation} disabled={simulationActionState !== "idle"}>
                    {simulationActionState === "running" ? "Sending…" : simulationActionState === "done" ? "Email sent" : "Approve and email customers"}
                  </button>
                ) : (
                  <small>No offer email is suggested for this scenario.</small>
                )}
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
              <p className={styles.sectionKicker}>What the merchant sees</p>
              <h3 id="merchant-view-heading" className={styles.workspaceHeading}>Ask Bazaar</h3>
              <p className={styles.askTagline}>Your business, understood.</p>
            </div>
            {badge && <span className={styles.liveBadge} title="Who is answering"><i /> {badge}</span>}
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
                  <button type="button" className={styles.offerButton} onClick={() => approveAction()} disabled={actionState === "running"}>
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
                <p>Type or speak in English, Hindi, Kannada, Tamil or any Indian language.</p>
                <div className={styles.suggestions}>
                  {starterQuestions(basics).map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => ask(suggestion)} disabled={!mid || chatLoading}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={`user-${index}`} className={styles.userMessage}>
                  {message.voice && <span className={styles.voiceTag} aria-label="Asked by voice">🎙 </span>}
                  {message.content}
                </div>
              ) : (
                <div key={`assistant-${index}`} className={`${styles.assistantMessage} ${styles.askAnswer}`}>
                  <RichText text={message.content} />
                  {message.evidence && message.evidence.length > 0 && (
                    <ul className={styles.evidenceList} aria-label="Based on">
                      {message.evidence.slice(0, 3).map((fact) => (
                        <li key={fact.id}>
                          <span>{fact.label.replace(/ \((?:%|₹)\)$/, "")}</span>
                          <strong>{factValue(fact)}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={styles.answerTools}>
                    <button
                      type="button"
                      className={styles.listenButton}
                      onClick={() => listen(index)}
                      aria-pressed={speaking?.index === index}
                      disabled={speaking?.index === index && speaking.state === "loading"}
                    >
                      {speaking?.index === index ? (speaking.state === "loading" ? "Preparing…" : "■ Stop") : "🔊 Listen"}
                    </button>
                    {message.language && message.language !== "en-IN" && <span>{LANGUAGE_NAMES[message.language]}</span>}
                    {message.provider === "rules" && <span>From your numbers</span>}
                  </div>
                </div>
              ),
            )}
            {!chatLoading && latest?.role === "assistant" && (
              <>
                {chatAction && !confirming && (
                  <div className={styles.chatAction}>
                    <span>Bazaar recommends</span>
                    <strong>{chatAction.description}</strong>
                    <button type="button" className={styles.offerButton} onClick={() => setConfirming(chatAction)}>
                      Take action
                    </button>
                  </div>
                )}
                {confirming && (
                  <div className={styles.confirmCard} role="alertdialog" aria-labelledby="confirm-title">
                    <span id="confirm-title">Confirm this action</span>
                    <strong>{confirming.description}</strong>
                    <p>
                      It starts only when you approve. Paytm Bazaar sends this exact offer to its action workflow, then measures
                      the result against similar shops.
                    </p>
                    <div className={styles.confirmButtons}>
                      <button type="button" className={styles.cancelButton} onClick={() => setConfirming(null)} disabled={actionState === "running"}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.offerButton}
                        disabled={actionState === "running"}
                        onClick={async () => {
                          await approveAction(confirming.actionId);
                          setConfirming(null);
                        }}
                      >
                        {actionState === "running" ? "Starting…" : "Approve"}
                      </button>
                    </div>
                  </div>
                )}
                {actionResult && lastAsk?.action && <p className={styles.actionNote}>{actionResult}</p>}
                <div className={styles.suggestions}>
                  {followUpQuestions(messages.filter((m) => m.role === "user").map((m) => m.content), recommendation?.status === "proposed" && !running).map((q) => (
                    <button key={q} type="button" onClick={() => ask(q)}>{q}</button>
                  ))}
                </div>
              </>
            )}
            {chatLoading && (
              <div className={`${styles.assistantMessage} ${styles.thinking}`} role="status">
                <i /><i /><i />
                <span>{chatPhase === "voice" ? "Understanding your question…" : "Looking at your Bazaar…"}</span>
              </div>
            )}
          </div>

          {(chatError || recorder.error) && <p className={styles.chatError}>{recorder.error ?? chatError}</p>}

          {recorder.state === "recording" ? (
            <div className={styles.recordingBar} role="status" aria-live="polite">
              <span className={styles.recordingDot} aria-hidden="true" />
              <span>
                Listening… {`0:${String(recorder.seconds).padStart(2, "0")}`}
                <small> / 0:{recorder.maxSeconds}</small>
              </span>
              <button type="button" className={styles.cancelButton} onClick={recorder.cancel}>Cancel</button>
              <button type="button" className={styles.offerButton} onClick={recorder.stop}>Stop &amp; ask</button>
            </div>
          ) : (
            <form className={`${styles.chatComposer} ${styles.askComposer}`} onSubmit={sendMessage}>
              <button
                type="button"
                className={styles.micButton}
                onClick={() => {
                  recorder.clearError();
                  stopAudio();
                  void recorder.start();
                }}
                disabled={!mid || chatLoading || recorder.state === "requesting"}
                aria-label="Ask by voice"
                title="Ask by voice"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={800}
                placeholder={mid ? "Ask Bazaar anything…" : "Getting your numbers…"}
                aria-label="Ask Bazaar a question"
                disabled={!mid || chatLoading}
              />
              <button type="submit" disabled={!mid || !draft.trim() || chatLoading} aria-label="Send question">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="m5 12 14-7-4 14-3-6-7-1Z" />
                </svg>
              </button>
            </form>
          )}
          <p className={styles.chatFootnote}>Answers come from your own sales data. Nothing runs without your approval.</p>
        </section>
      </div>
    </SceneDialog>
  );
}
