/**
 * Merchant Intelligence service: the one place the whole intelligence path is
 * wired together for a merchant. It runs in two steps so the merchant sees
 * numbers immediately and the AI summary follows:
 *
 *   getMerchantBasics   Data Adapter → M2M → Relevance → proposed action   (seconds)
 *   explainMerchant     memory recall → LLM insight (+ remember)           (slower)
 *
 * `analyzeMerchantIntelligence` runs both.
 *
 * It computes nothing itself: metrics come from M2M, priorities from
 * Relevance, wording from the LLM. It degrades instead of failing: without
 * memory it explains without history; without an LLM it returns structured
 * intelligence only; without an executor the proposal is shown as pending.
 */

import { analyzeMerchant, lastNDays, type DateRange } from "@/m2m-engine";
import { analyzeRelevance } from "@/relevance-engine";

import { findReusable, proposeAction } from "./actions";
import { noMerchantData } from "./errors";
import { buildFacts } from "./facts";
import { generateInsight } from "./insight";
import { recallHistory, rememberSafely, situationOf } from "./memory";
import type {
  IntelligenceDeps,
  MerchantBasics,
  MerchantExplanation,
  MerchantIntelligenceResult,
  MeasuredOutcome,
  MerchantProfile,
  RecommendationResult,
} from "./types";

export const DEFAULT_PERIOD_DAYS = 7;

/** The latest complete week of this merchant's data. */
async function latestPeriod(deps: IntelligenceDeps, merchantId: string): Promise<DateRange> {
  const days = await deps.dataSource.getMerchantDailyMetrics(merchantId);
  const latest = days.map((d) => d.businessDate).sort().at(-1);
  if (!latest) throw noMerchantData();
  return lastNDays(latest, DEFAULT_PERIOD_DAYS);
}

/** Step 1: the numbers, priorities and proposed action. No AI, no memory. */
export async function getMerchantBasics(
  deps: IntelligenceDeps,
  input: { merchantId: string; current?: DateRange },
): Promise<MerchantBasics> {
  const [merchantRecord, current] = await Promise.all([
    deps.dataSource.getMerchantWithBazaar(input.merchantId),
    input.current ?? latestPeriod(deps, input.merchantId),
  ]);
  const merchant: MerchantProfile = {
    mid: merchantRecord.mid,
    name: merchantRecord.name,
    category: merchantRecord.category,
    bazaar: { id: merchantRecord.bazaar.id, name: merchantRecord.bazaar.name, city: merchantRecord.bazaar.city },
  };

  const m2m = await analyzeMerchant(deps.dataSource, { merchantId: merchant.mid, current });
  const relevance = analyzeRelevance(m2m);
  const action = proposeAction(relevance);

  let recommendation: RecommendationResult = { status: "none", reason: "NO_ACTIONABLE_OPPORTUNITY" };
  if (action) {
    let actionId: string | null = null;
    let persistence: "saved" | "reused" | "unavailable" = "unavailable";
    let actionStatus: "proposed" | "approved" | "executed" | null = null;
    let execution: { executedAt: string; detail: string | null } | null = null;
    let outcome: MeasuredOutcome | null = null;
    if (deps.actions) {
      try {
        const existing = findReusable(await deps.actions.listForMerchant(merchant.mid), action);
        if (existing) {
          actionId = existing.id;
          persistence = "reused";
          actionStatus = existing.status === "failed" ? null : existing.status;
          if (existing.executedAt) execution = { executedAt: existing.executedAt, detail: existing.executionDetail };
          outcome = (existing.outcome as MeasuredOutcome | null) ?? null;
        } else {
          const saved = await deps.actions.create({
            merchantId: merchant.mid,
            type: action.type,
            parameters: { ...action.parameters },
            description: action.description,
            basis: { ...action.basis, situation: situationOf(relevance) },
          });
          actionId = saved.id;
          persistence = "saved";
          actionStatus = "proposed";
        }
      } catch {
        // Persistence is unavailable (e.g. V5 not applied): the proposal is still shown, but cannot be approved.
      }
    }
    recommendation = {
      status: "proposed",
      action,
      actionId,
      persistence,
      actionStatus,
      execution,
      outcome,
      executorConfigured: deps.executor.isConfigured(),
    };
  }

  return {
    merchant,
    period: m2m.period,
    m2m,
    relevance,
    recommendation,
    services: {
      llm: { configured: deps.llm.isConfigured(), provider: deps.llm.name, model: deps.llmModel },
      memory: { configured: deps.memory.isConfigured(), provider: deps.memory.name },
      executor: { configured: deps.executor.isConfigured(), provider: deps.executor.name },
    },
  };
}

/** Step 2: remembered history and the plain-language AI summary. */
export async function explainMerchant(deps: IntelligenceDeps, basics: MerchantBasics): Promise<MerchantExplanation> {
  const { merchant, m2m, relevance, recommendation } = basics;
  const action = recommendation.status === "proposed" ? recommendation.action : null;

  const history = await recallHistory(deps.memory, relevance);
  const memories = history.status === "recalled" ? history.memories : [];
  const facts = buildFacts(m2m, relevance, memories, action);
  const insight = await generateInsight(deps.llm, deps.llmModel, { merchant, m2m, relevance, facts, memories, action });

  // Remember a newly proposed action together with how it was explained.
  if (recommendation.status === "proposed" && recommendation.persistence === "saved" && recommendation.actionId) {
    const actionId = recommendation.actionId;
    const remember = () =>
      rememberSafely(deps.memory, {
        merchantId: merchant.mid,
        kind: "insight",
        recordedAt: deps.now().toISOString(),
        situation: situationOf(relevance),
        recommendation:
          insight.status === "generated"
            ? { action: insight.insight.recommendation.action, expectedOutcome: insight.insight.recommendation.expectedOutcome }
            : undefined,
        action: { actionId, type: recommendation.action.type, parameters: { ...recommendation.action.parameters }, status: "proposed" },
      });
    // Storing memory takes Cognee ~10s; never make the merchant wait for it.
    if (deps.defer) deps.defer(remember);
    else await remember();
  }

  return { history, insight };
}

export async function analyzeMerchantIntelligence(
  deps: IntelligenceDeps,
  input: { merchantId: string; current?: DateRange },
): Promise<MerchantIntelligenceResult> {
  const basics = await getMerchantBasics(deps, input);
  return { ...basics, ...(await explainMerchant(deps, basics)) };
}
