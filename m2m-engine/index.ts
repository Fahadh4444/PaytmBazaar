/**
 * Paytm Bazaar M2M (merchant-to-merchant) intelligence engine.
 *
 * Responsibility: deterministic answers to "what is true?" — cohorting,
 * aggregation, comparison, pattern detection, relevance.
 *
 * Constraints (see docs/m2m-engine.md):
 *   - no React, no browser APIs, no Next.js
 *   - no Supabase, OpenRouter, Sarvam, Cognee, or n8n
 *   - no LLM involvement in numerical or business calculations
 *
 * The engine receives structured data and returns structured results. Wording
 * is somebody else's job.
 *
 * Cohorting, aggregation and pattern detection are intentionally not
 * implemented yet; they arrive with the first vertical slice, which also
 * defines the engine's output contract.
 */

export type {
  Area,
  Merchant,
  MerchantCategory,
  TimeOfDay,
  Transaction,
  Weather,
} from "./types";

/**
 * Smallest number of merchants a cohort may contain before any aggregate
 * derived from it may be shown to a merchant.
 *
 * Below this size an "aggregate" can be reverse-engineered into a single
 * merchant's private figures, which is exactly what Bazaar must never do.
 */
export const MIN_COHORT_SIZE = 5;

/** Whether an aggregate over a cohort of this size may be surfaced at all. */
export function isCohortReportable(cohortSize: number): boolean {
  return cohortSize >= MIN_COHORT_SIZE;
}
