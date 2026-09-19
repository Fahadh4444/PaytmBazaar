/**
 * The memory boundary: what Bazaar remembers about a merchant's past
 * situations, recommendations, actions and outcomes.
 *
 * Memories are structured records, never raw transactions. Supabase stays the
 * source of truth for business data; memory holds the history of what Bazaar
 * noticed, suggested, did, and what came of it.
 *
 * Each merchant's memories live in their own space and are only ever recalled
 * for that merchant.
 */

export type MemoryKind = "insight" | "action_outcome" | "measured_outcome";

/** A compact description of a situation: the leading relevance signals. */
export interface MemorySignal {
  id: string;
  kind: string;
  direction: string;
  priority: string;
  magnitudePp: number;
}

export interface MerchantMemory {
  merchantId: string;
  kind: MemoryKind;
  /** ISO 8601. */
  recordedAt: string;
  situation: {
    period: { from: string; to: string };
    topPriority: string | null;
    cohortBasis: string;
    signals: MemorySignal[];
    patterns: string[];
    context?: Record<string, string>;
    contextStatus?: string;
  };
  recommendation?: { action: string; expectedOutcome: string };
  action?: { actionId: string; type: string; parameters: Record<string, unknown>; status: string };
  outcome?: {
    status: string;
    detail?: string;
    /** Merchant GMV growth measured after the action, in percent, from M2M. */
    merchantGrowth?: number | null;
    cohortGrowth?: number | null;
  };
}

export interface MemoryProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** Stores one memory in the merchant's own memory space. */
  remember(memory: MerchantMemory): Promise<void>;
  /** Recalls this merchant's memories relevant to `query`. Never another merchant's. */
  recall(merchantId: string, query: string): Promise<MerchantMemory[]>;
}

/** Any memory failure, so callers never unwrap provider-shaped errors. */
export class MemoryError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MemoryError";
  }
}
