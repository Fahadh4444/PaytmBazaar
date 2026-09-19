/**
 * Production wiring: the real Data Adapter, LLM, Cognee, n8n and action store,
 * plus caching and background warm-up. Server-only (the Data Adapter uses the
 * Supabase secret key). Everything else in this module takes these
 * dependencies as arguments.
 */

import "server-only";

import { after } from "next/server";

import { getMemoryProvider } from "@/lib/cognee";
import { getLlmProvider, getLlmStatus } from "@/lib/llm";
import { getActionExecutor } from "@/lib/n8n";
import { getMerchantActionStore, getPaytmDataSource } from "@/lib/paytm";

import { getBazaarIntelligence, getCityIntelligence, loadNetwork, type NetworkSnapshot } from "./area";
import { cached, invalidateMerchant } from "./cache";
import { recallHistory } from "./memory";
import { withRetry } from "./retry";
import { explainMerchant, getMerchantBasics } from "./service";
import type { AreaIntelligence, SelectedContext } from "@/m2m-engine";

import type { HistoryResult, IntelligenceDeps, MerchantBasics, MerchantExplanation } from "./types";

const BASICS_TTL_MS = 10 * 60_000;
const EXPLANATION_TTL_MS = 30 * 60_000;
const WARM_CONCURRENCY = 2;

export function getIntelligenceDeps(): IntelligenceDeps {
  let actions: IntelligenceDeps["actions"] = null;
  try {
    actions = getMerchantActionStore();
  } catch {
    actions = null;
  }
  return {
    dataSource: getPaytmDataSource(),
    llm: getLlmProvider(),
    llmModel: getLlmStatus().model,
    memory: getMemoryProvider(),
    executor: getActionExecutor(),
    actions,
    now: () => new Date(),
    defer: (task) => after(task),
  };
}

/** Numbers for the latest period, cached. */
const contextKey = (context?: SelectedContext) => context
  ? [context.dayOfWeek, context.timeOfDay, context.weather, context.event].join(":") : "baseline";

export function getCachedBasics(deps: IntelligenceDeps, merchantId: string, context?: SelectedContext): Promise<MerchantBasics> {
  return cached(`basics:${merchantId}:latest:${contextKey(context)}`, BASICS_TTL_MS, () => withRetry(() => getMerchantBasics(deps, { merchantId, context })));
}

/** AI summary for the latest period, cached only when it actually generated. */
export async function getCachedExplanation(deps: IntelligenceDeps, merchantId: string, context?: SelectedContext): Promise<MerchantExplanation> {
  const basics = await getCachedBasics(deps, merchantId, context);
  return cached(
    `explanation:${merchantId}:${basics.period.current.to}:${contextKey(context)}`,
    EXPLANATION_TTL_MS,
    () => explainMerchant(deps, basics),
    // Keep only AI-written summaries; a fallback is retried on the next open.
    (result) => result.insight.status === "generated" && result.insight.source === "ai",
  );
}

const HISTORY_TTL_MS = 10 * 60_000;
/** Ask Bazaar answers without history rather than wait on a slow memory service. */
const CHAT_RECALL_TIMEOUT_MS = 4_000;

/**
 * Remembered history for Ask Bazaar, recalled once per merchant and period
 * and reused by every follow-up. The recall keeps running in the background
 * when it is slow, so a later question picks up its result; the answer in
 * hand never waits longer than the timeout. A failure is not cached.
 */
export function getCachedHistory(deps: IntelligenceDeps, basics: MerchantBasics): Promise<HistoryResult> {
  const recall = cached(
    `history:${basics.merchant.mid}:${basics.period.current.to}`,
    HISTORY_TTL_MS,
    () => recallHistory(deps.memory, basics.relevance),
    (result) => result.status === "recalled",
  );
  return Promise.race<HistoryResult>([
    recall,
    new Promise((resolve) => setTimeout(() => resolve({ status: "failed", reason: "MEMORY_ERROR" }), CHAT_RECALL_TIMEOUT_MS)),
  ]);
}

const NETWORK_TTL_MS = 10 * 60_000;

/** The whole network's daily rollup, loaded once and shared by City and Bazaar views. */
function getCachedNetwork(deps: IntelligenceDeps): Promise<NetworkSnapshot> {
  return cached("network:all", NETWORK_TTL_MS, () => withRetry(() => loadNetwork(deps)));
}

export async function getCachedCityIntelligence(deps: IntelligenceDeps): Promise<AreaIntelligence> {
  return getCityIntelligence(await getCachedNetwork(deps));
}

export async function getCachedBazaarIntelligence(deps: IntelligenceDeps, bazaarId: string): Promise<AreaIntelligence> {
  const network = await getCachedNetwork(deps);
  return withRetry(() => getBazaarIntelligence(deps, network, bazaarId));
}

/** After an action changes, the merchant's cached view is stale. */
export function onMerchantActionChanged(merchantId: string): void {
  invalidateMerchant(merchantId);
}

/**
 * Prepares numbers and AI summaries for every merchant in a Bazaar in the
 * background, a couple at a time, so opening a shop is near-instant.
 */
export async function warmBazaar(deps: IntelligenceDeps, bazaarId: string): Promise<number> {
  const merchants = await deps.dataSource.getMerchantsByBazaar(bazaarId);
  const queue = merchants.map((m) => m.mid);
  const worker = async () => {
    for (let mid = queue.shift(); mid; mid = queue.shift()) {
      try {
        await getCachedExplanation(deps, mid);
      } catch {
        // Warm-up is best effort; a real request will surface the error.
      }
    }
  };
  deps.defer?.(() => Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker)));
  return merchants.length;
}
