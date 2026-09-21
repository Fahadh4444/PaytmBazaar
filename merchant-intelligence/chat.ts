/**
 * Ask Bazaar: the merchant's conversation with their own intelligence.
 *
 *   question (typed, or transcribed from voice)
 *     → cached M2M + Relevance for this merchant (never recomputed per message)
 *     → fact table (facts.ts) + recalled memory
 *     → LLM (Sarvam 105B by default) asked for a structured JSON reply
 *     → validation: schema, known facts, every figure checked against the facts
 *     → answer + language + intent + cited evidence + (deterministic) action
 *
 * The model words; it never calculates, never chooses the action and never
 * runs it. The action offered next to an answer is the Relevance-derived
 * proposal (actions.ts), and it still needs the merchant's explicit approval.
 * Any reply containing a figure outside the fact table is corrected once,
 * trimmed, or replaced by an answer built from the facts.
 */

import { z } from "zod";

import type { LlmMessage } from "@/lib/llm";
import { isLanguageCode, type LanguageCode } from "@/lib/speech/types";
import { analyzeMerchant, lastNDays, type M2MIntelligence, type SelectedContext } from "@/m2m-engine";
import { analyzeRelevance, type RelevantIntelligence } from "@/relevance-engine";

import { cached } from "./cache";
import { noMerchantData } from "./errors";
import { answerFromFacts } from "./answers";
import { keepSupported } from "./fallback";
import { buildFacts } from "./facts";
import { PLAIN_LANGUAGE_RULES, stripFence, unsupportedFigures } from "./insight";
import { rememberSafely, situationOf } from "./memory";
import type { Fact, HistoryResult, IntelligenceDeps, MerchantBasics, MerchantProfile, ProposedAction } from "./types";

const MAX_TURNS = 8;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Today's date and weekday in India Standard Time. */
export function istToday(now: Date): { date: string; weekday: (typeof WEEKDAYS)[number] } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), weekday: WEEKDAYS[ist.getUTCDay()] };
}
export const MAX_MESSAGE_LENGTH = 800;
/** Earlier assistant replies are shortened to this when sent back as context. */
const MAX_REPLY_CONTEXT = 1200;
const MAX_ANSWER_LENGTH = 2400;
/** How long one conversation's memory write is de-duplicated for. */
const CONVERSATION_MEMORY_TTL_MS = 60 * 60_000;

/**
 * The bounded conversation the model sees: the last few turns, the merchant's
 * own messages length-limited, earlier answers shortened. Must end with a question.
 */
export function validChatMessages(value: unknown): LlmMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const messages = value.slice(-MAX_TURNS);
  const ok = messages.every(
    (m) =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0 &&
      (m.role === "assistant" || m.content.length <= MAX_MESSAGE_LENGTH),
  );
  if (!ok || messages.at(-1)?.role !== "user") return null;
  return messages.map((m) => ({
    role: m.role,
    content: m.role === "assistant" ? m.content.slice(0, MAX_REPLY_CONTEXT) : m.content,
  }));
}

// --- Result -------------------------------------------------------------------

export type AskIntent = "EXPLANATION" | "COMPARISON" | "RECOMMENDATION" | "OUTLOOK" | "OTHER";
const INTENTS = ["EXPLANATION", "COMPARISON", "RECOMMENDATION", "OUTLOOK", "OTHER"] as const;

/** The approvable action shown next to an answer. Always the deterministic proposal, never model text. */
export interface AskAction {
  actionId: string;
  type: ProposedAction["type"];
  description: string;
  targetSegment: ProposedAction["parameters"]["targetSegment"];
  durationDays: number;
  requiresApproval: true;
}

/** What Ask Bazaar did for one answer, for the Intelligence Trace. Aggregates and labels only. */
export interface AskTrace {
  input: "text" | "voice";
  period: { from: string; to: string };
  factsSent: number;
  turnsSent: number;
  signals: { kind: string; direction: string; priority: string; magnitudePp: number }[];
  patterns: string[];
  opportunity: string | null;
  memory: { status: HistoryResult["status"] | "not_requested"; used: number };
  provider: string;
  model: string;
  /** Why the model's reply was not used as-is, if it was not. */
  aiIssue: "LLM_NOT_CONFIGURED" | "LLM_ERROR" | "INVALID_RESPONSE" | "UNSUPPORTED_FIGURE" | null;
}

/**
 * Always an answer. `source` says how it was produced:
 *   ai           the model's reply, every figure checked
 *   ai_trimmed   the model's reply with sentences using unchecked figures removed
 *   summary      built from the facts, because the model could not be used
 */
export interface AskResult {
  status: "answered";
  /** The answer text (short markdown: bullets and bold). `message` is the same text, kept for older clients. */
  answer: string;
  message: string;
  language: LanguageCode;
  intent: AskIntent;
  /** Facts the answer cites, resolved from the fact table (never from the model). */
  evidence: Fact[];
  /** The model's wording of a recommendation, only when the intelligence has an opportunity to ground it. */
  recommendation: { title: string; reason: string; requiresApproval: boolean } | null;
  action: AskAction | null;
  source: "ai" | "ai_trimmed" | "summary";
  provider: string;
  model: string;
  trace: AskTrace;
}

/** Kept for existing callers. */
export type ChatResult = AskResult;

// --- Language -------------------------------------------------------------------

const SCRIPTS: [RegExp, LanguageCode][] = [
  [/[ऀ-ॿ]/g, "hi-IN"],
  [/[ঀ-৿]/g, "bn-IN"],
  [/[਀-੿]/g, "pa-IN"],
  [/[઀-૿]/g, "gu-IN"],
  [/[଀-୿]/g, "od-IN"],
  [/[஀-௿]/g, "ta-IN"],
  [/[ఀ-౿]/g, "te-IN"],
  [/[ಀ-೿]/g, "kn-IN"],
  [/[ഀ-ൿ]/g, "ml-IN"],
  [/[؀-ۿ]/g, "ur-IN"],
];
/** Languages written in the same script as the one `SCRIPTS` maps it to. */
const SHARED_SCRIPT: Partial<Record<LanguageCode, LanguageCode[]>> = {
  "hi-IN": ["mr-IN", "ne-IN", "kok-IN", "mai-IN", "doi-IN", "sa-IN", "brx-IN"],
  "bn-IN": ["as-IN", "mni-IN"],
  "ur-IN": ["ks-IN", "sd-IN"],
};

/** The language a text is written in, from its script. Latin script reads as English (including Hinglish). */
export function scriptLanguage(text: string): LanguageCode {
  let best: LanguageCode = "en-IN";
  let most = 0;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  for (const [pattern, code] of SCRIPTS) {
    const count = (text.match(pattern) ?? []).length;
    if (count > most) [best, most] = [code, count];
  }
  return most > 0 && most * 2 >= Math.min(letters, 40) ? best : "en-IN";
}

/** The script decides; the model's claim only picks between languages that share a script. */
export function resolveLanguage(answer: string, claimed: unknown): LanguageCode {
  const script = scriptLanguage(answer);
  if (isLanguageCode(claimed) && SHARED_SCRIPT[script]?.includes(claimed)) return claimed;
  return script;
}

// --- Intent ------------------------------------------------------------------------

const ASKS_FOR_ACTION =
  /what (?:can|should) i do|what to do|recommend|suggest|advice|offer|campaign|improve|increase|grow|boost|fix|kya kar|क्या कर|उपाय|सुझाव|ಏನು ಮಾಡ|என்ன செய்|ఏం చేయ|എന്ത് ചെയ്|काय कर|কী কর|શું કર|ਕੀ ਕਰ/i;

/** Deterministic intent for answers the model did not classify. */
export function classifyQuestion(question: string): AskIntent {
  if (ASKS_FOR_ACTION.test(question)) return "RECOMMENDATION";
  if (/compare|similar|other shops|nearby|market|bazaar|city|बाज़ार|बाजार/i.test(question)) return "COMPARISON";
  if (/today|tomorrow|next week|will |forecast|expect|आज|कल/i.test(question)) return "OUTLOOK";
  return "EXPLANATION";
}

// --- Model reply ---------------------------------------------------------------------

const replySchema = z.object({
  answer: z.string().trim().min(1).max(MAX_ANSWER_LENGTH),
  language: z.string().optional(),
  intent: z.enum(INTENTS).catch("OTHER").optional(),
  evidence: z.array(z.string()).max(12).catch([]).optional(),
  recommendation: z
    .object({ title: z.string().trim().min(1).max(160), reason: z.string().trim().min(1).max(600) })
    .nullable()
    .catch(null)
    .optional(),
  suggestAction: z.boolean().catch(false).optional(),
});
type ModelReply = z.infer<typeof replySchema>;

type Parsed = { kind: "json"; reply: ModelReply } | { kind: "text"; reply: ModelReply } | { kind: "invalid" };

/** A JSON reply is validated against the schema. Plain prose is accepted as the answer; broken JSON is not. */
export function parseAskReply(text: string): Parsed {
  const body = stripFence(text);
  if (body.startsWith("{")) {
    try {
      const parsed = replySchema.safeParse(JSON.parse(body));
      return parsed.success ? { kind: "json", reply: parsed.data } : { kind: "invalid" };
    } catch {
      return { kind: "invalid" };
    }
  }
  const answer = body.trim().slice(0, MAX_ANSWER_LENGTH);
  return answer ? { kind: "text", reply: { answer } } : { kind: "invalid" };
}

function replyFigures(reply: ModelReply, facts: Fact[]): string[] {
  return [reply.answer, reply.recommendation?.title ?? "", reply.recommendation?.reason ?? ""].flatMap((t) => unsupportedFigures(t, facts));
}

// --- Prompt --------------------------------------------------------------------------

const REPLY_FORMAT = [
  "Reply with ONE JSON object and nothing else:",
  '{"answer": string, "language": BCP-47 code such as "en-IN" or "hi-IN", "intent": "EXPLANATION"|"COMPARISON"|"RECOMMENDATION"|"OUTLOOK"|"OTHER",',
  ' "evidence": [fact ids you used], "recommendation": {"title": string, "reason": string} | null, "suggestAction": boolean}',
  "answer: 3 to 5 short sentences; short '- ' bullet lines when listing; **bold** only for the key number or action.",
  "recommendation: only when the merchant asks what to do, and only if it follows from `opportunities` or `proposedAction`; otherwise null.",
  "suggestAction: true only when `proposedAction` is not null and your answer recommends it.",
].join("\n");

/** A merchant question worth remembering, with anything contact-like removed. */
export function sanitizeQuestion(question: string): string {
  return question
    .replace(/\S+@\S+/g, "[removed]")
    .replace(/\+?\d[\d\s-]{5,}\d/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

interface AskContext {
  merchant: MerchantProfile;
  m2m: M2MIntelligence;
  relevance: RelevantIntelligence;
  facts: Fact[];
  action: ProposedAction | null;
  /** Where the proposal stands: an executed one is already live and must not be suggested again. */
  actionStatus: "proposed" | "approved" | "executed" | null;
  history: HistoryResult | null;
}

export function buildAskSystemPrompt(ctx: AskContext, now: Date): string {
  const { merchant, m2m, relevance, facts, action } = ctx;
  const today = istToday(now);
  const memories = ctx.history?.status === "recalled" ? ctx.history.memories : [];
  return [
    "You are Ask Bazaar, the business assistant inside Paytm Bazaar, talking with one small Indian shop owner about their own shop.",
    "You explain intelligence that Paytm Bazaar's deterministic systems already calculated. You never calculate.",
    PLAIN_LANGUAGE_RULES,
    "Rules:",
    "1. The `facts` below are the only source of truth. Use only figures from them, copied exactly: no rounding, sums, forecasts or new percentages.",
    "2. If a figure you would need is not in `facts`, say you do not have that number. Never guess one.",
    "3. Describe associations, not causes: 'sales fell in the evenings', not 'evenings caused the fall'. Say what is observed, what it may mean, and what you suggest, as separate things.",
    "4. Similar shops, the market and the city are anonymous groups. Never name, guess at or describe any individual other shop.",
    "5. Never reveal customer, payment or contact details; you do not have any.",
    "6. Recommendations must come from `opportunities` or `proposedAction`. Never say an action has been started: any action needs the owner's approval first, and you cannot run it.",
    "   If proposedAction.status is \"executed\", that offer is already live: say so, do not suggest starting it again, and suggest a different angle.",
    "7. If the evidence is thin (see `limitations`), say so plainly.",
    "Language: reply in the language and script of the owner's latest message. If they write Hinglish, reply in natural Hinglish.",
    "  If they ask for a language ('tell me in Hindi'), switch to it and keep using it until they ask otherwise.",
    "  Always write numbers with digits 0-9 exactly as in `facts`, keep ₹ and %, and keep Paytm and the market name as they are.",
    "  For a negative change use a falling word without the minus sign ('fell 4.1%', '4.1% गिरी'), never 'grew -4.1%' or '-4.1% गिरी'.",
    "Questions about today or the future: do not refuse. Give a grounded outlook from the data you have:",
    `  - the recent trend (merchant.gmv.growth), today's weekday pattern (pattern.dayOfWeek.${today.weekday}.*),`,
    "  - the time-of-day pattern (pattern.timeOfDay.*), and how similar shops and the market are moving.",
    "  Say it is an expectation based on recent patterns, not a guarantee.",
    "Advice must be specific and varied, never generic. Do not say 'keep extra stock' or 'keep staff ready'.",
    "Pick ONE concrete move tied to a fact, such as: a Paytm cashback or discount in the weakest time slot or day,",
    "  a combo to raise the average bill, a reward for repeat customers, or an email to opted-in regular customers.",
    "If you suggest an offer amount, keep it modest (for example 5-10% cashback or ₹20 off) and present it as a suggestion.",
    "Never repeat advice already given earlier in this conversation; offer a different angle instead.",
    "You may end with one short question offering a next step answerable from these facts. Never offer item-level or customer-level details: that data does not exist here.",
    REPLY_FORMAT,
    `Today is ${today.weekday}, ${today.date} (India time).`,
    `Merchant: ${merchant.name} (${merchant.category}) in ${merchant.bazaar.name}, ${merchant.bazaar.city}.`,
    `Latest data: ${m2m.period.current.from} to ${m2m.period.current.to}, compared with ${m2m.period.previous.from} to ${m2m.period.previous.to}.`,
    `signals: ${JSON.stringify(relevance.prioritySignals.map((s) => ({ kind: s.kind, direction: s.direction, priority: s.priority, context: s.evidence.context ? `${s.evidence.context.dimension}:${s.evidence.context.segment}` : undefined })))}`,
    `patterns: ${JSON.stringify(relevance.relevantPatterns.map((p) => p.type))}`,
    `opportunities: ${JSON.stringify(relevance.relevantOpportunities.map((o) => ({ type: o.opportunity.type, title: o.opportunity.title, priority: o.priority })))}`,
    `proposedAction: ${JSON.stringify(action ? { description: action.description, targetSegment: action.parameters.targetSegment, days: action.parameters.durationDays, status: ctx.actionStatus ?? "proposed", needsApproval: ctx.actionStatus !== "executed" } : null)}`,
    `selectedContext: ${JSON.stringify(m2m.contextImpact ?? null)}`,
    `history: ${JSON.stringify(memories.map((m, i) => ({ ref: `history.${i}`, kind: m.kind, period: m.situation.period, recommendation: m.recommendation?.action ?? null, action: m.action?.status ?? null, outcome: m.outcome?.status ?? null })))}`,
    `limitations: ${JSON.stringify(m2m.limitations)}`,
    // Compact [id, label, value, unit] rows keep the prompt small and predictable.
    `facts (id, label, value, unit): ${JSON.stringify(facts.map((f) => [f.id, f.label, f.value, f.unit]))}`,
  ].join("\n");
}

// --- Pipeline --------------------------------------------------------------------------

export interface AskInput {
  merchantId: string;
  /** Bounded conversation ending with the merchant's question (see validChatMessages). */
  messages: LlmMessage[];
  context?: SelectedContext;
  /** The merchant's cached intelligence. Without it, M2M and Relevance run once for this answer. */
  basics?: MerchantBasics;
  /** Recalled memory. Without it, the answer is given without history. */
  history?: HistoryResult;
  input?: "text" | "voice";
  /** Groups one conversation, so it is remembered at most once. */
  conversationId?: string;
}

async function loadContext(deps: IntelligenceDeps, input: AskInput): Promise<AskContext & { basics: MerchantBasics | null }> {
  const memories = input.history?.status === "recalled" ? input.history.memories : [];
  if (input.basics) {
    const { merchant, m2m, relevance, recommendation } = input.basics;
    const action = recommendation.status === "proposed" ? recommendation.action : null;
    const actionStatus = recommendation.status === "proposed" ? recommendation.actionStatus : null;
    return { merchant, m2m, relevance, action, actionStatus, facts: buildFacts(m2m, relevance, memories, action), history: input.history ?? null, basics: input.basics };
  }
  const record = await deps.dataSource.getMerchantWithBazaar(input.merchantId);
  const latest = (await deps.dataSource.getMerchantDailyMetrics(record.mid)).map((d) => d.businessDate).sort().at(-1);
  if (!latest) throw noMerchantData();
  const m2m = await analyzeMerchant(deps.dataSource, { merchantId: record.mid, current: lastNDays(latest, 7), context: input.context });
  const relevance = analyzeRelevance(m2m);
  const merchant: MerchantProfile = {
    mid: record.mid,
    name: record.name,
    category: record.category,
    bazaar: { id: record.bazaar.id, name: record.bazaar.name, city: record.bazaar.city },
  };
  return { merchant, m2m, relevance, action: null, actionStatus: null, facts: buildFacts(m2m, relevance, memories, null), history: input.history ?? null, basics: null };
}

/** The proposal the merchant can approve from the chat: saved, not yet run. */
function approvableAction(basics: MerchantBasics | null): AskAction | null {
  const rec = basics?.recommendation;
  if (rec?.status !== "proposed" || !rec.actionId || rec.actionStatus === "executed") return null;
  return {
    actionId: rec.actionId,
    type: rec.action.type,
    description: rec.action.description,
    targetSegment: rec.action.parameters.targetSegment,
    durationDays: rec.action.parameters.durationDays,
    requiresApproval: true,
  };
}

const UNAVAILABLE_NOTE = "Your business numbers are ready, but conversation is unavailable for a moment. Here is the short version.";

export async function askBazaar(deps: IntelligenceDeps, input: AskInput): Promise<AskResult> {
  const ctx = await loadContext(deps, input);
  const { facts, relevance, m2m } = ctx;
  const question = input.messages.at(-1)?.content ?? "";
  const offer = approvableAction(ctx.basics);
  const memoriesUsed = ctx.history?.status === "recalled" ? ctx.history.memories.length : 0;

  const trace = (provider: string, model: string, aiIssue: AskTrace["aiIssue"]): AskTrace => ({
    input: input.input ?? "text",
    period: m2m.period.current,
    factsSent: facts.length,
    turnsSent: input.messages.length,
    signals: relevance.prioritySignals.slice(0, 3).map((s) => ({ kind: s.kind, direction: s.direction, priority: s.priority, magnitudePp: s.magnitudePp })),
    patterns: relevance.relevantPatterns.slice(0, 3).map((p) => p.type),
    opportunity: relevance.relevantOpportunities[0]?.opportunity.title ?? null,
    memory: { status: ctx.history?.status ?? "not_requested", used: memoriesUsed },
    provider,
    model,
    aiIssue,
  });

  // Deterministic mode is the product, not a degraded model: no apology, and
  // the answer is written for the question that was actually asked.
  const deterministic = (deps.mode ?? "full") === "deterministic";
  const summary = (aiIssue: NonNullable<AskTrace["aiIssue"]>): AskResult => {
    const written = answerFromFacts(question, facts, ctx.action);
    const intent = written.topic === "OFFER" ? "RECOMMENDATION" : classifyQuestion(question);
    const stumbled = !deterministic && (aiIssue === "LLM_ERROR" || aiIssue === "LLM_NOT_CONFIGURED");
    const answer = `${stumbled ? `${UNAVAILABLE_NOTE}\n\n` : ""}${written.answer}`;
    const cited = new Set(written.factIds);
    const model = deterministic ? "deterministic" : "none";
    return {
      status: "answered",
      answer,
      message: answer,
      language: "en-IN",
      intent,
      evidence: facts.filter((f) => cited.has(f.id)),
      recommendation: null,
      action: intent === "RECOMMENDATION" ? offer : null,
      source: "summary",
      provider: "rules",
      model,
      trace: trace("rules", model, aiIssue),
    };
  };
  if (!deps.llm.isConfigured()) return summary("LLM_NOT_CONFIGURED");

  const system = buildAskSystemPrompt(ctx, deps.now());
  const ask = (extra: LlmMessage[] = []) =>
    deps.llm.complete({
      messages: [{ role: "system", content: system }, ...input.messages, ...extra],
      temperature: 0.2,
      maxTokens: 1200,
      responseFormat: "json_object",
      reasoning: false,
      timeoutMs: 45_000,
    });

  let parsed: Parsed;
  let provider: string;
  let model: string;
  try {
    // One retry for a network blip or timeout.
    let reply = await ask().catch(() => ask());
    parsed = parseAskReply(reply.text);
    // One correction round: broken JSON, or figures that are not in the facts.
    const bad = parsed.kind === "invalid" ? [] : replyFigures(parsed.reply, facts);
    if (parsed.kind === "invalid" || bad.length > 0) {
      const correction =
        parsed.kind === "invalid"
          ? "Please reply again as one valid JSON object in the exact format described, with the same answer."
          : `Please rewrite your last answer. These figures are not in the facts: ${bad.join(", ")}. Use only figures from the facts, copied exactly, and keep the same helpful advice.`;
      const retry = await ask([{ role: "assistant", content: reply.text }, { role: "user", content: correction }]);
      const reparsed = parseAskReply(retry.text);
      if (reparsed.kind !== "invalid") {
        parsed = reparsed;
        reply = retry;
      }
    }
    provider = reply.provider;
    model = reply.model ?? deps.llmModel;
  } catch {
    return summary("LLM_ERROR");
  }
  if (parsed.kind === "invalid") return summary("INVALID_RESPONSE");

  const reply = parsed.reply;
  let answer = reply.answer;
  let source: AskResult["source"] = "ai";
  let aiIssue: AskTrace["aiIssue"] = null;
  if (unsupportedFigures(answer, facts).length > 0) {
    // Still unsupported after the correction: keep only the checked sentences, or fall back.
    const trimmed = keepSupported(answer, facts);
    if (!trimmed) return summary("UNSUPPORTED_FIGURE");
    answer = trimmed;
    source = "ai_trimmed";
    aiIssue = "UNSUPPORTED_FIGURE";
  }

  const intent: AskIntent = reply.intent && reply.intent !== "OTHER" ? reply.intent : classifyQuestion(question);
  const grounded = relevance.relevantOpportunities.length > 0 || ctx.action !== null;
  const recommendation =
    reply.recommendation && grounded && replyFigures({ answer: "", recommendation: reply.recommendation }, facts).length === 0
      ? { ...reply.recommendation, requiresApproval: offer !== null }
      : null;
  const action = offer && (intent === "RECOMMENDATION" || reply.suggestAction === true) ? offer : null;
  const known = new Map(facts.map((f) => [f.id, f]));
  const evidence = [...new Set(reply.evidence ?? [])].map((id) => known.get(id)).filter((f): f is Fact => f !== undefined);

  const result: AskResult = {
    status: "answered",
    answer,
    message: answer,
    language: resolveLanguage(answer, reply.language),
    intent,
    evidence,
    recommendation,
    action,
    source,
    provider,
    model,
    trace: trace(provider, model, aiIssue),
  };

  if (intent === "RECOMMENDATION" && input.conversationId) await rememberConversation(deps, ctx, input.conversationId, question, result);
  return result;
}

/**
 * Remembers a conversation that reached a recommendation: the situation, the
 * question and what was recommended. Once per conversation, after the
 * response, and never the transcript or any transaction.
 */
async function rememberConversation(deps: IntelligenceDeps, ctx: AskContext, conversationId: string, question: string, result: AskResult) {
  if (!deps.memory.isConfigured()) return;
  const merchantId = ctx.merchant.mid;
  const write = () =>
    cached(`askmemory:${merchantId}:${conversationId}`, CONVERSATION_MEMORY_TTL_MS, () =>
      rememberSafely(deps.memory, {
        merchantId,
        kind: "conversation",
        recordedAt: deps.now().toISOString(),
        situation: situationOf(ctx.relevance),
        question: sanitizeQuestion(question),
        recommendation: result.recommendation
          ? { action: result.recommendation.title, expectedOutcome: result.recommendation.reason }
          : result.action
            ? { action: result.action.description, expectedOutcome: "Suggested in Ask Bazaar" }
            : undefined,
        action: result.action
          ? { actionId: result.action.actionId, type: result.action.type, parameters: { targetSegment: result.action.targetSegment, durationDays: result.action.durationDays }, status: "proposed" }
          : undefined,
      }),
    );
  // Cognee takes seconds to store; never make the merchant wait for it.
  if (deps.defer) deps.defer(write);
  else await write();
}

/** Kept for existing callers: Ask Bazaar without cached intelligence or memory. */
export const answerMerchantQuestion = askBazaar;
