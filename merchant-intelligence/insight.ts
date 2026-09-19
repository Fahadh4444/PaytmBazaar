/**
 * LLM insight: explanation and recommendation wording, generated from
 * structured intelligence only.
 *
 * The model receives the merchant's profile, a fact table (facts.ts), the
 * relevance signals, M2M's opportunities, the deterministic proposed action
 * and remembered history. It never sees transactions.
 *
 * Its reply must be JSON matching `insightSchema`, cite only known fact IDs,
 * and use no business figure that is not in the fact table. Anything else is
 * rejected; the caller then shows structured intelligence without wording and
 * no action is executed on the model's say-so.
 */

import { z } from "zod";

import type { MerchantMemory } from "@/lib/cognee";
import type { LlmMessage, LlmProvider } from "@/lib/llm";
import type { M2MIntelligence } from "@/m2m-engine";
import type { RelevantIntelligence } from "@/relevance-engine";

import { fallbackInsight } from "./fallback";
import type { Fact, InsightInvalidReason, InsightResult, MerchantInsight, MerchantProfile, ProposedAction } from "./types";

/** Limits the prompt states and the schema enforces, with a little slack. */
export const INSIGHT_LIMITS = { text: 800, title: 120, note: 300, evidence: 10 } as const;

const Text = z.string().trim().min(1).max(INSIGHT_LIMITS.text);

export const insightSchema = z
  .object({
    summary: Text,
    whatIsHappening: Text,
    whyItMatters: Text,
    opportunity: z.object({ title: z.string().trim().min(1).max(INSIGHT_LIMITS.title), reason: Text }).strict().nullable(),
    recommendation: z
      .object({ action: Text, expectedOutcome: Text, confidence: z.enum(["high", "medium", "low"]) })
      .strict(),
    evidence: z
      .array(z.object({ factId: z.string().min(1), note: z.string().trim().min(1).max(INSIGHT_LIMITS.note) }).strict())
      .min(1)
      .max(INSIGHT_LIMITS.evidence),
    historicalContext: z.string().trim().max(400).nullable(),
  })
  .strict();

export class InsightValidationError extends Error {
  constructor(
    readonly reason: InsightInvalidReason,
    message: string,
  ) {
    super(message);
    this.name = "InsightValidationError";
  }
}

/** How to talk to a shopkeeper. Shared by the summary and the chat. */
export const PLAIN_LANGUAGE_RULES = [
  "Write for a small shop owner with no business training, like a friendly neighbour who understands shops.",
  "Use simple everyday words and short sentences (under 15 words). Talk directly to them: 'your sales', 'your shop'.",
  "Never use jargon. Do not say GMV, AOV, cohort, metric, percentage points, benchmark, basis, segment or KPI.",
  "Say 'sales' (not GMV), 'average bill' (not AOV), 'similar shops near you' (not comparable merchants),",
  "'your market' or the Bazaar's name (not bazaar-level), and 'orders' (not transactions).",
  "Use at most two or three numbers per field, and prefer simple comparisons: 'your sales fell 29.5% while similar shops grew 17.6%'.",
].join("\n");

const SYSTEM_PROMPT = [
  "You are Paytm Bazaar's helper for small Indian shop owners.",
  "You explain numbers that have already been calculated. You never calculate.",
  PLAIN_LANGUAGE_RULES,
  "Rules:",
  "1. Use only the figures in `facts`. Copy each figure exactly as given; do not round, convert, add, subtract or estimate.",
  "2. Every evidence item must cite a `factId` from `facts`.",
  "3. Describe associations, never causes: say 'sales fell during evenings', not 'evenings caused the fall'.",
  "4. Never mention or guess at any other individual merchant. Comparable merchants are an anonymous group.",
  "5. The recommendation must describe `proposedAction` if one is given; do not invent a different action.",
  "6. If `history` is empty, set historicalContext to null. Otherwise say briefly how the past situation relates.",
  "If selectedContext says insufficient_evidence, say that plainly and do not claim the selected combination changed demand.",
  "Selected dimensions may be evaluated separately. Never describe them as a proven combined effect unless the payload says so.",
  "Keep it short: each text field one or two short sentences (under 300 characters), the title under 60 characters,",
  "3 to 5 evidence items, each note under 100 characters in the same plain words. Focus on what matters most, not every fact.",
  "summary: one line on how the shop is doing. whatIsHappening: what the numbers show. whyItMatters: why the owner should care.",
  "recommendation.action: one concrete thing to do this week, specific to a fact (a day, a time slot, the average bill),",
  "such as a Paytm cashback in the weakest slot, a combo to raise the average bill, or a reward for regulars.",
  "Never generic advice like 'keep extra stock' or 'keep staff ready'. expectedOutcome: what should improve, in plain words.",
  "7. Reply with one JSON object and nothing else, with exactly these keys:",
  '{"summary":string,"whatIsHappening":string,"whyItMatters":string,"opportunity":{"title":string,"reason":string}|null,',
  '"recommendation":{"action":string,"expectedOutcome":string,"confidence":"high"|"medium"|"low"},',
  '"evidence":[{"factId":string,"note":string}],"historicalContext":string|null}',
].join("\n");

export function buildInsightPrompt(input: {
  merchant: MerchantProfile;
  m2m: M2MIntelligence;
  relevance: RelevantIntelligence;
  facts: Fact[];
  memories: MerchantMemory[];
  action: ProposedAction | null;
}) {
  const { merchant, m2m, relevance, facts, memories, action } = input;
  const payload = {
    merchant: { name: merchant.name, category: merchant.category, bazaar: merchant.bazaar.name, city: merchant.bazaar.city },
    period: m2m.period,
    cohort: { basis: m2m.cohort.basis, confidence: relevance.cohortConfidence },
    facts,
    prioritySignals: relevance.prioritySignals.map((s) => ({
      id: s.id,
      kind: s.kind,
      direction: s.direction,
      priority: s.priority,
      reasons: s.reasons,
      context: s.evidence.context ? { dimension: s.evidence.context.dimension, segment: s.evidence.context.segment } : null,
    })),
    opportunities: relevance.relevantOpportunities.map((o) => ({
      type: o.opportunity.type,
      title: o.opportunity.title,
      priority: o.priority,
    })),
    proposedAction: action ? { type: action.type, parameters: action.parameters } : null,
    selectedContext: m2m.contextImpact ?? null,
    history: memories.map((m, i) => ({
      ref: `history.${i}`,
      kind: m.kind,
      recordedAt: m.recordedAt,
      topPriority: m.situation.topPriority,
      patterns: m.situation.patterns,
      recommendation: m.recommendation?.action ?? null,
      action: m.action ? { type: m.action.type, status: m.action.status } : null,
      outcomeStatus: m.outcome?.status ?? null,
    })),
    limitations: m2m.limitations,
  };
  return [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: JSON.stringify(payload) },
  ];
}

// --- Figure checking ------------------------------------------------------------

const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
/** An offer amount the model suggests ("10% cashback", "₹20 off") is advice, not a reported figure. */
const OFFER_AFTER = /^\s*(?:%\s*)?(?:instant\s+)?(?:cashback|off\b|discount|कैशबैक|छूट|डिस्काउंट)/i;
/** Zero of each Indian script's own digits; answers in Indian languages may use them. */
const DIGIT_ZEROS = [0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66];
/** "percent" in Indian languages, so "29.5 प्रतिशत" is checked like "29.5%". */
const PERCENT_WORDS = /\s*(?:प्रतिशत|फ़ीसदी|फीसदी|फीसद|टक्के|टक्का|শতাংশ|சதவீதம்|சதவிகிதம்|శాతం|ಶೇಕಡಾ|ശതമാനം|ટકા|ਪ੍ਰਤੀਸ਼ਤ|ପ୍ରତିଶତ)/g;

/** Rewrites Indian-script digits and percent words to ASCII so every language gets the same check. */
export function normalizeFigures(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const zero = DIGIT_ZEROS.find((z) => code >= z && code <= z + 9);
    out += zero === undefined ? ch : String(code - zero);
  }
  return out.replace(PERCENT_WORDS, "%");
}
/** ...and so is an offer threshold ("on orders above ₹250"). */
const OFFER_BEFORE = /(?:above|over|at least|minimum|min\.?|worth|upto|up to)\s*$/i;
const NUMBER = /(₹|rs\.?|inr)?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(%|pp\b|percentage points?|points?|k\b|lakh|crore)?/gi;
/** Small bare integers ("7 days", "5 comparable merchants") are wording, not business figures. */
const MAX_BARE_INTEGER = 99;

function allowedValues(facts: Fact[]): number[] {
  return facts.flatMap((f) => {
    const v = Math.abs(f.value);
    return [v, Math.round(v * 10) / 10, Math.round(v)];
  });
}

/** Business figures in `text` that do not match any fact. */
export function unsupportedFigures(text: string, facts: Fact[]): string[] {
  const allowed = allowedValues(facts);
  const bad: string[] = [];
  const clean = normalizeFigures(text).replace(ISO_DATE, " ");
  for (const match of clean.matchAll(NUMBER)) {
    const [raw, currency, digits, unit] = match;
    if (OFFER_AFTER.test(clean.slice((match.index ?? 0) + raw.length))) continue;
    if (OFFER_BEFORE.test(clean.slice(0, match.index ?? 0))) continue;
    const value = Math.abs(Number(digits.replace(/,/g, "")));
    if (!Number.isFinite(value)) continue;
    const isYear = !currency && !unit && /^(19|20)\d{2}$/.test(digits);
    const isFigure = Boolean(currency || unit) || digits.includes(".") || value > MAX_BARE_INTEGER;
    if (!isFigure || isYear) continue;
    // Scaled amounts ("83k", "1.2 lakh") are conversions the model must not make.
    if (unit && /^(k|lakh|crore)$/i.test(unit)) {
      bad.push(raw.trim());
      continue;
    }
    if (!allowed.some((a) => Math.abs(a - value) <= 0.051)) bad.push(raw.trim());
  }
  return bad;
}

function insightTexts(insight: MerchantInsight): string[] {
  return [
    insight.summary,
    insight.whatIsHappening,
    insight.whyItMatters,
    insight.opportunity?.title ?? "",
    insight.opportunity?.reason ?? "",
    insight.recommendation.action,
    insight.recommendation.expectedOutcome,
    insight.historicalContext ?? "",
    ...insight.evidence.map((e) => e.note),
  ];
}

export function stripFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}

/** Parses and validates a model reply. Throws `InsightValidationError`. */
export function parseInsight(text: string, facts: Fact[]): MerchantInsight {
  let json: unknown;
  try {
    json = JSON.parse(stripFence(text));
  } catch {
    throw new InsightValidationError("INVALID_JSON", "The model did not reply with JSON.");
  }

  const parsed = insightSchema.safeParse(json);
  if (!parsed.success) {
    throw new InsightValidationError("SCHEMA_MISMATCH", parsed.error.issues.map((i) => i.path.join(".") || "root").join(", "));
  }
  const insight = parsed.data as MerchantInsight;

  const known = new Set(facts.map((f) => f.id));
  const unknown = insight.evidence.filter((e) => !known.has(e.factId)).map((e) => e.factId);
  if (unknown.length) throw new InsightValidationError("UNKNOWN_FACT", unknown.join(", "));

  const figures = insightTexts(insight).flatMap((t) => unsupportedFigures(t, facts));
  if (figures.length) throw new InsightValidationError("UNSUPPORTED_FIGURE", figures.join(", "));

  return insight;
}

/** The model's confidence may not exceed what the cohort can support. */
export function capConfidence(
  confidence: MerchantInsight["recommendation"]["confidence"],
  cohort: RelevantIntelligence["cohortConfidence"],
): MerchantInsight["recommendation"]["confidence"] {
  const max = cohort === "primary" ? "high" : cohort === "fallback" ? "medium" : "low";
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[confidence] <= rank[max] ? confidence : max;
}

export async function generateInsight(
  llm: LlmProvider,
  model: string,
  input: Parameters<typeof buildInsightPrompt>[0],
): Promise<InsightResult> {
  // Never leave the merchant without a summary: fall back to one built from the facts.
  const rules = (aiIssue: NonNullable<Extract<InsightResult, { status: "generated" }>["aiIssue"]>): InsightResult => ({
    status: "generated",
    source: "rules",
    aiIssue,
    provider: "rules",
    model: "none",
    insight: fallbackInsight(input.facts, input.relevance, input.action),
    facts: input.facts,
  });
  if (!llm.isConfigured()) return rules("LLM_NOT_CONFIGURED");

  const messages: LlmMessage[] = buildInsightPrompt(input);
  const ask = (extra: LlmMessage[] = []) =>
    llm.complete({
      messages: [...messages, ...extra],
      temperature: 0.2,
      maxTokens: 1500,
      responseFormat: "json_object",
      // The facts are already computed; hidden reasoning only eats the token budget.
      reasoning: false,
      timeoutMs: 60_000,
    });

  let text: string;
  let provider: string;
  let answeredBy: string;
  try {
    // One retry for a network blip or timeout.
    let response = await ask().catch(() => ask());
    // One correction round when the reply cites unknown facts or figures.
    try {
      parseInsight(response.text, input.facts);
    } catch (error) {
      if (error instanceof InsightValidationError && (error.reason === "UNSUPPORTED_FIGURE" || error.reason === "UNKNOWN_FACT")) {
        response = await ask([
          { role: "assistant", content: response.text },
          {
            role: "user",
            content: `Please return the same JSON again, corrected. Problem: ${error.reason === "UNKNOWN_FACT" ? "unknown fact IDs" : "figures not in the facts"}: ${error.message}. Use only fact IDs and figures from the facts, copied exactly.`,
          },
        ]);
      }
    }
    text = response.text;
    provider = response.provider;
    answeredBy = response.model ?? model;
  } catch {
    return rules("LLM_ERROR");
  }

  try {
    const insight = parseInsight(text, input.facts);
    insight.recommendation.confidence = capConfidence(insight.recommendation.confidence, input.relevance.cohortConfidence);
    return { status: "generated", source: "ai", provider, model: answeredBy, insight, facts: input.facts };
  } catch (error) {
    if (error instanceof InsightValidationError) return rules(error.reason);
    throw error;
  }
}
