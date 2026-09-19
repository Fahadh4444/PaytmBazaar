/**
 * Cognee provider, over Cognee's documented REST API
 * (https://docs.cognee.ai/api-reference/introduction):
 *
 *   POST /api/v1/add       multipart/form-data: `data` (files), `datasetName`
 *   POST /api/v1/cognify   JSON: { datasets, run_in_background }
 *   POST /api/v1/search    JSON: { query, search_type, datasets, top_k }
 *
 * Cognee Cloud authenticates with `X-Api-Key` and identifies the tenant with
 * `X-Tenant-Id` (same configuration as `checkCogneeConnection` in index.ts).
 * The base URL defaults to https://api.cognee.ai.
 *
 * Each merchant gets its own dataset, and searches are always restricted to
 * it, so one merchant's memories cannot surface for another. Recalled records
 * are also checked for the merchant ID before they are returned.
 */

import { MemoryError, type MemoryProvider, type MerchantMemory } from "./types";

const DEFAULT_BASE_URL = "https://api.cognee.ai";
// Saves run in the background after the response, and Cognee can be slow to
// accept them; a short timeout would silently lose memories.
const REQUEST_TIMEOUT_MS = 45_000;
const MEMORY_MARKER = "PAYTM_BAZAAR_MEMORY ";
const RECALL_LIMIT = 5;

function config() {
  const baseUrl = (process.env.COGNEE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = process.env.COGNEE_API_KEY;
  const tenantId = process.env.COGNEE_TENANT_ID;
  if (!apiKey || !tenantId) throw new MemoryError("COGNEE_API_KEY and COGNEE_TENANT_ID must both be set.", "cognee");
  return { baseUrl, apiKey, tenantId };
}

/** One dataset per merchant. Only characters Cognee dataset names safely allow. */
export function merchantDataset(merchantId: string): string {
  return `bazaar_merchant_${merchantId.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/**
 * The group a memory appears under in Cognee's graph. One group per memory,
 * so groups never overlap; the dataset already says whose memory it is.
 */
export function memoryNodeSets(memory: MerchantMemory): string[] {
  return [memory.kind];
}

/** Keeps Cognee's graph to the business story instead of IDs and raw fields. */
export const COGNIFY_PROMPT = [
  "These are memories of one small shop on Paytm Bazaar.",
  "Extract only these kinds of entities: the shop, the week (period), the situation",
  "(for example 'sales behind similar shops'), the suggestion, the action taken, and the outcome.",
  "Connect them as: shop -> had situation -> in week; situation -> led to suggestion -> action -> outcome.",
  "Ignore identifiers, UUIDs, timestamps, JSON field names and technical codes.",
].join(" ");

/** One readable sentence per memory, so Cognee's graph captures meaning, not just IDs. */
export function describeMemory(memory: MerchantMemory): string {
  const { situation } = memory;
  const lead = situation.signals[0];
  const parts = [
    `Merchant ${memory.merchantId}, period ${situation.period.from} to ${situation.period.to}.`,
    lead
      ? `Main signal: ${lead.kind.toLowerCase().replace(/_/g, " ")} (${lead.direction}, ${lead.priority} priority).`
      : "No strong signal.",
    situation.patterns.length ? `Patterns: ${situation.patterns.map((p) => p.toLowerCase().replace(/_/g, " ")).join(", ")}.` : "",
    memory.question ? `Merchant asked: "${memory.question}"` : "",
    memory.recommendation ? `Recommended: ${memory.recommendation.action}` : "",
    memory.action ? `Action ${memory.action.type.toLowerCase().replace(/_/g, " ")}: ${memory.action.status}.` : "",
    memory.outcome
      ? `Outcome: ${memory.outcome.status}${memory.outcome.merchantGrowth != null ? `, sales change afterwards ${memory.outcome.merchantGrowth}%` : ""}.`
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/**
 * Memories are stored as a readable sentence, then a marker line plus JSON so
 * they can be recovered exactly from search results.
 */
export function serializeMemory(memory: MerchantMemory): string {
  return `${describeMemory(memory)}\n${MEMORY_MARKER}${JSON.stringify(memory)}`;
}

/** Pulls every memory record for `merchantId` out of an arbitrary search response. */
export function extractMemories(payload: unknown, merchantId: string): MerchantMemory[] {
  const texts: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(payload);

  const found = new Map<string, MerchantMemory>();
  for (const text of texts) {
    let index = text.indexOf(MEMORY_MARKER);
    while (index !== -1) {
      const start = index + MEMORY_MARKER.length;
      // The JSON is a single line (JSON.stringify never emits newlines).
      const end = text.indexOf("\n", start);
      const json = text.slice(start, end === -1 ? undefined : end).trim();
      try {
        const memory = JSON.parse(json) as MerchantMemory;
        // Privacy: never return a record that is not this merchant's.
        if (memory?.merchantId === merchantId && memory.situation) {
          found.set(`${memory.kind}:${memory.recordedAt}`, memory);
        }
      } catch {
        // A truncated chunk; skip it.
      }
      index = end === -1 ? -1 : text.indexOf(MEMORY_MARKER, end);
    }
  }
  return [...found.values()].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).slice(0, RECALL_LIMIT);
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const { baseUrl, apiKey, tenantId } = config();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "X-Api-Key": apiKey, "X-Tenant-Id": tenantId, ...(init.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new MemoryError("Could not reach Cognee.", "cognee", { cause });
  }
  return response;
}

export const cogneeProvider: MemoryProvider = {
  name: "cognee",

  isConfigured() {
    return Boolean(process.env.COGNEE_API_KEY && process.env.COGNEE_TENANT_ID);
  },

  async remember(memory) {
    const dataset = merchantDataset(memory.merchantId);
    const form = new FormData();
    form.append("datasetName", dataset);
    for (const set of memoryNodeSets(memory)) form.append("node_set", set);
    form.append(
      "data",
      new Blob([serializeMemory(memory)], { type: "text/plain" }),
      `${memory.kind}-${memory.recordedAt.replace(/[^0-9]/g, "")}.txt`,
    );

    const added = await call("/api/v1/add", { method: "POST", body: form });
    if (!added.ok) throw new MemoryError(`Cognee add returned ${added.status}.`, "cognee");

    const cognified = await call("/api/v1/cognify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ datasets: [dataset], run_in_background: true, custom_prompt: COGNIFY_PROMPT }),
    });
    if (!cognified.ok) throw new MemoryError(`Cognee cognify returned ${cognified.status}.`, "cognee");
  },

  async recall(merchantId, query) {
    const response = await call("/api/v1/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        search_type: "CHUNKS",
        datasets: [merchantDataset(merchantId)],
        top_k: RECALL_LIMIT * 2,
      }),
    });
    // No memory yet: the dataset or its graph does not exist until the first remember().
    if (response.status === 404 || response.status === 422) return [];
    if (!response.ok) throw new MemoryError(`Cognee search returned ${response.status}.`, "cognee");
    return extractMemories(await response.json(), merchantId);
  },
};
