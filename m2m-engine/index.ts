/**
 * Paytm Bazaar M2M (merchant-to-merchant) intelligence engine.
 *
 * Responsibility: deterministic answers to "how is this merchant doing
 * against comparable merchants, its Bazaar and its city, and what network
 * pattern stands out?" Metrics, cohorting, aggregation, comparison, context
 * analysis, pattern detection, evidence, Bazaar Impact and opportunities.
 *
 * Constraints (see docs/m2m-engine.md):
 *   - no React, no browser APIs, no Next.js
 *   - no Supabase, OpenRouter, Sarvam, Cognee, or n8n
 *   - no LLM involvement in numerical or business calculations
 *   - data arrives only through the `PaytmDataSource` interface
 *
 * The engine returns structured results. Wording is somebody else's job.
 */

import { MIN_COHORT_SIZE } from "./config";

export * from "./types";
export { MIN_COHORT_SIZE, M2M_THRESHOLDS } from "./config";
export { M2MInputError, comparisonPeriod, lastNDays } from "./period";
export { calculateMerchantMetrics, growthPercent, averageOrderValue } from "./metrics";
export { getRelevantCohort } from "./cohort";
export {
  calculateBazaarMetrics,
  calculateCategoryMetrics,
  calculateCityMetrics,
  calculateCohortMetrics,
} from "./groups";
export { analyzeContext } from "./context";
export { compare, compareWithNetwork, direction } from "./comparison";
export { detectPatterns } from "./patterns";
export { buildEvidence } from "./evidence";
export { calculateBazaarImpact } from "./impact";
export { detectOpportunities } from "./opportunities";
export { analyzeMerchant, buildM2MIntelligence, type AnalyzeMerchantInput, type M2MSnapshot } from "./analyze";
export {
  bazaarIntelligence,
  cityIntelligence,
  dailyTrend,
  growthBreakdown,
  performanceCounts,
  weekPattern,
  type AreaImpact,
  type AreaIntelligence,
  type AreaMetrics,
  type GrowthBar,
  type GrowthBreakdown,
  type PerformanceBand,
  type PerformanceCount,
  type TrendPoint,
  type WeekPattern,
} from "./network";

/** Whether an aggregate over this many merchants (excluding the viewer) may be surfaced at all. */
export function isCohortReportable(cohortSize: number): boolean {
  return cohortSize >= MIN_COHORT_SIZE;
}
