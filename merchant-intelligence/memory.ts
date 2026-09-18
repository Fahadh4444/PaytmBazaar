/**
 * Building and reading merchant memories. Memories hold the situation
 * (relevance signals, not transactions), the recommendation, the action and
 * its outcome, always keyed to the merchant they belong to.
 */

import type { MemoryProvider, MerchantMemory } from "@/lib/cognee";
import type { RelevantIntelligence } from "@/relevance-engine";

import type { HistoryResult, MemoryWriteStatus } from "./types";

export function situationOf(relevance: RelevantIntelligence): MerchantMemory["situation"] {
  return {
    period: relevance.period.current,
    topPriority: relevance.topPriority,
    cohortBasis: relevance.cohort.basis,
    signals: relevance.prioritySignals.map((s) => ({
      id: s.id,
      kind: s.kind,
      direction: s.direction,
      priority: s.priority,
      magnitudePp: s.magnitudePp,
    })),
    patterns: relevance.relevantPatterns.map((p) => p.type),
  };
}

/** What to ask memory: similar past situations for this merchant. */
export function recallQuery(relevance: RelevantIntelligence): string {
  const signals = relevance.prioritySignals.map((s) => `${s.kind} ${s.direction}`).join(", ") || "no strong signal";
  const patterns = relevance.relevantPatterns.map((p) => p.type).join(", ") || "none";
  return `Past situations, recommendations, actions and outcomes for merchant ${relevance.merchantId} with signals: ${signals}; patterns: ${patterns}.`;
}

export async function recallHistory(memory: MemoryProvider, relevance: RelevantIntelligence): Promise<HistoryResult> {
  if (!memory.isConfigured()) return { status: "unavailable", reason: "MEMORY_NOT_CONFIGURED" };
  try {
    const memories = await memory.recall(relevance.merchantId, recallQuery(relevance));
    // Defence in depth: the provider already scopes by merchant.
    return { status: "recalled", memories: memories.filter((m) => m.merchantId === relevance.merchantId) };
  } catch {
    return { status: "failed", reason: "MEMORY_ERROR" };
  }
}

/** Best effort: a memory failure never undoes the business result it describes. */
export async function rememberSafely(memory: MemoryProvider, record: MerchantMemory): Promise<MemoryWriteStatus> {
  if (!memory.isConfigured()) return "unavailable";
  try {
    await memory.remember(record);
    return "remembered";
  } catch {
    return "failed";
  }
}
