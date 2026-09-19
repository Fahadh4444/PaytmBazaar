/**
 * Merchant Q&A, grounded in the same fact table as the insight: the model
 * answers a merchant's questions using only M2M and Relevance figures, and any
 * reply containing a figure outside the fact table is withheld.
 */

import type { LlmMessage } from "@/lib/llm";
import { analyzeMerchant, lastNDays, type SelectedContext } from "@/m2m-engine";
import { analyzeRelevance } from "@/relevance-engine";

import { noMerchantData } from "./errors";
import { fallbackAnswer, keepSupported } from "./fallback";
import { buildFacts } from "./facts";
import { PLAIN_LANGUAGE_RULES, unsupportedFigures } from "./insight";
import type { IntelligenceDeps } from "./types";

const MAX_TURNS = 8;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Today's date and weekday in India Standard Time. */
export function istToday(now: Date): { date: string; weekday: (typeof WEEKDAYS)[number] } {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return { date: ist.toISOString().slice(0, 10), weekday: WEEKDAYS[ist.getUTCDay()] };
}
const MAX_MESSAGE_LENGTH = 800;
/** Earlier assistant replies are shortened to this when sent back as context. */
const MAX_REPLY_CONTEXT = 1200;

/**
 * Always an answer. `source` says how it was produced:
 *   ai           the model's reply, every figure checked
 *   ai_trimmed   the model's reply with sentences using unchecked figures removed
 *   summary      built from the facts, because the model could not be used
 */
export type ChatResult = { status: "answered"; message: string; provider: string; source: "ai" | "ai_trimmed" | "summary" };

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

export async function answerMerchantQuestion(
  deps: IntelligenceDeps,
  input: { merchantId: string; messages: LlmMessage[]; context?: SelectedContext },
): Promise<ChatResult> {
  const merchant = await deps.dataSource.getMerchantWithBazaar(input.merchantId);
  const latest = (await deps.dataSource.getMerchantDailyMetrics(merchant.mid)).map((d) => d.businessDate).sort().at(-1);
  if (!latest) throw noMerchantData();
  const m2m = await analyzeMerchant(deps.dataSource, { merchantId: merchant.mid, current: lastNDays(latest, 7), context: input.context });
  const relevance = analyzeRelevance(m2m);
  const facts = buildFacts(m2m, relevance, [], null);
  const summary = (): ChatResult => ({ status: "answered", message: fallbackAnswer(facts), provider: "rules", source: "summary" });
  if (!deps.llm.isConfigured()) return summary();

  const today = istToday(deps.now());
  const system = [
    "You are the Paytm Bazaar helper for one small Indian shop owner.",
    PLAIN_LANGUAGE_RULES,
    "Answer in 3 to 5 short sentences, using only the figures in `facts`, copied exactly.",
    "Never calculate new figures: no forecasts, projections, sums or percentages that are not in `facts`.",
    "Describe associations, not causes. Never mention or guess at other individual merchants.",
    "Questions about today or the future: do not refuse. Give a grounded outlook from the data you have:",
    `  - the recent trend (merchant.gmv.growth), today's weekday pattern (pattern.dayOfWeek.${today.weekday}.*),`,
    "  - the time-of-day pattern (pattern.timeOfDay.*), and how comparable merchants and the Bazaar are moving.",
    "  Say it is an expectation based on recent patterns, not a guarantee.",
    "Advice must be specific and varied, never generic. Do not say 'keep extra stock' or 'keep staff ready'.",
    "Pick ONE concrete move tied to a fact above, such as: a Paytm cashback or discount in the weakest time slot or day,",
    "  a combo or add-on to raise the average bill, a weekend or evening special, a reward for repeat customers,",
    "  or an email to opted-in regular customers. Name the day or time it targets and why, using the fact.",
    "Never repeat advice already given earlier in this conversation; offer a different angle instead.",
    "Use short bullet lines with '- ' when listing, and **bold** only for the key number or action.",
    "If you suggest an offer amount, keep it modest (for example 5-10% cashback or ₹20 off) and present it as a suggestion.",
    "End with one short question offering a next step you can answer from these facts: days, times of day, weather, events,",
    "  similar shops, your market or the city. Never offer item-level, product or customer-level details: that data is not available.",
    "If the facts truly cannot address the question, say what data would help, and still share what the facts do show.",
    `Today is ${today.weekday}, ${today.date} (India time).`,
    `Merchant: ${merchant.name} (${merchant.category}) in ${merchant.bazaar.name}, ${merchant.bazaar.city}.`,
    `Latest data: ${m2m.period.current.from} to ${m2m.period.current.to}, compared with ${m2m.period.previous.from} to ${m2m.period.previous.to}.`,
    `Leading signals: ${JSON.stringify(relevance.prioritySignals.map((s) => ({ kind: s.kind, direction: s.direction, priority: s.priority })))}`,
    `Selected context evidence: ${JSON.stringify(m2m.contextImpact ?? null)}`,
    `facts: ${JSON.stringify(facts)}`,
  ].join("\n");

  const ask = (extra: LlmMessage[] = []) =>
    deps.llm.complete({
      messages: [{ role: "system", content: system }, ...input.messages, ...extra],
      temperature: 0.2,
      maxTokens: 600,
      reasoning: false,
      timeoutMs: 45_000,
    });

  let text: string;
  let provider: string;
  try {
    // One retry for a network blip or timeout.
    let reply = await ask().catch(() => ask());
    // One correction round: point out the unsupported figures and ask for a rewrite.
    const bad = unsupportedFigures(reply.text, facts);
    if (bad.length > 0) {
      reply = await ask([
        { role: "assistant", content: reply.text },
        {
          role: "user",
          content: `Please rewrite your last answer. These figures are not in the facts: ${bad.join(", ")}. Use only figures from the facts, copied exactly, and keep the same helpful advice.`,
        },
      ]);
    }
    text = reply.text.trim();
    provider = reply.provider;
  } catch {
    return summary();
  }

  if (unsupportedFigures(text, facts).length === 0) return { status: "answered", message: text, provider, source: "ai" };
  // Still unsupported after the correction: keep only the checked sentences, or fall back.
  const trimmed = keepSupported(text, facts);
  return trimmed ? { status: "answered", message: trimmed, provider, source: "ai_trimmed" } : summary();
}
