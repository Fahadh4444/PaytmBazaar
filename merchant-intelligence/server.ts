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
import { withRetry } from "./retry";
import { explainMerchant, getMerchantBasics } from "./service";
import type { AreaIntelligence } from "@/m2m-engine";

import type { IntelligenceDeps, MerchantBasics, MerchantExplanation } from "./types";

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
export function getCachedBasics(deps: IntelligenceDeps, merchantId: string): Promise<MerchantBasics> {
  return cached(`basics:${merchantId}:latest`, BASICS_TTL_MS, () => withRetry(() => getMerchantBasics(deps, { merchantId })));
}

/** AI summary for the latest period, cached only when it actually generated. */
export async function getCachedExplanation(deps: IntelligenceDeps, merchantId: string): Promise<MerchantExplanation> {
  const basics = await getCachedBasics(deps, merchantId);
  return cached(
    `explanation:${merchantId}:${basics.period.current.to}`,
    EXPLANATION_TTL_MS,
    () => explainMerchant(deps, basics),
    // Keep only AI-written summaries; a fallback is retried on the next open.
    (result) => result.insight.status === "generated" && result.insight.source === "ai",
  );
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
