/**
 * Builds `M2MIntelligence` fixtures from a few growth figures by running the
 * real M2M functions (comparison, patterns, evidence, Bazaar Impact,
 * opportunities), so every fixture is output M2M could actually produce.
 */

import {
  buildEvidence,
  calculateBazaarImpact,
  compareWithNetwork,
  comparisonPeriod,
  detectOpportunities,
  detectPatterns,
  type CohortBasis,
  type ContextDimension,
  type ContextSegment,
  type ContextSegmentAnalysis,
  type DataLimitation,
  type GroupMetrics,
  type GroupScope,
  type M2MIntelligence,
  type MerchantCohort,
  type MerchantMetrics,
} from "@/m2m-engine";

export const PERIOD = comparisonPeriod({ from: "2026-09-24", to: "2026-09-30" });

export interface Scenario {
  /** GMV growth in percent; null means no previous-period sales. */
  merchant: number | null;
  cohort?: number | null;
  bazaar?: number | null;
  city?: number | null;
  category?: number | null;
  /** Bazaar transaction-count growth; defaults to the Bazaar's GMV growth. */
  bazaarDemand?: number | null;
  basis?: CohortBasis;
  cohortReportable?: boolean;
  bazaarReportable?: boolean;
  segments?: ContextSegmentAnalysis[];
}

function figures(growth: number | null, demand: number | null = growth) {
  const previousGmv = growth === null ? 0 : 1000;
  const currentGmv = growth === null ? 500 : 1000 * (1 + growth / 100);
  const previousTxns = demand === null ? 0 : 100;
  const currentTxns = demand === null ? 50 : Math.round(100 * (1 + demand / 100));
  return {
    current: { gmv: currentGmv, transactions: currentTxns, aov: currentGmv / currentTxns, refunds: 0, growth },
    previous: { gmv: previousGmv, transactions: previousTxns, aov: previousTxns ? previousGmv / previousTxns : null, refunds: 0 },
  };
}

function group(scope: GroupScope, growth: number | null, reportable = true, demand?: number | null): GroupMetrics {
  const f = figures(growth, demand === undefined ? growth : demand);
  return {
    scope,
    merchantCount: reportable ? 8 : 2,
    reportable,
    current: reportable ? f.current : null,
    previous: reportable ? f.previous : null,
  };
}

/** A context segment as M2M's context analysis reports it. */
export function segment(
  dimension: ContextDimension,
  name: ContextSegment,
  merchantGrowth: number,
  cohortGrowth: number,
  merchantTransactions: number,
): ContextSegmentAnalysis {
  const side = (growth: number, txns: number) => ({
    currentGmv: 1000 * (1 + growth / 100),
    previousGmv: 1000,
    currentTransactions: txns,
    previousTransactions: txns,
    growth,
    currentShare: 30,
  });
  return {
    dimension,
    segment: name,
    merchant: side(merchantGrowth, merchantTransactions),
    cohort: side(cohortGrowth, merchantTransactions * 5),
    cohortContributors: 5,
  };
}

export function intelligence(s: Scenario): M2MIntelligence {
  const basis = s.basis ?? "bazaar_category";
  const cohortReportable = s.cohortReportable ?? true;
  const peerIds = cohortReportable ? ["PEER-1", "PEER-2", "PEER-3", "PEER-4", "PEER-5"] : ["PEER-1"];

  const merchantMetrics: MerchantMetrics = { merchantId: "TARGET", ...figures(s.merchant) };
  const cohort: MerchantCohort = {
    merchantId: "TARGET",
    basis,
    category: "restaurant",
    bazaarId: "B1",
    city: "Bengaluru",
    cohortMerchantIds: peerIds,
    cohortSize: peerIds.length,
    reportable: cohortReportable,
  };
  const cohortMetrics = group("cohort", s.cohort ?? null, cohortReportable);
  const categoryMetrics = group("category", s.category ?? s.cohort ?? null, cohortReportable);
  const bazaarMetrics = group("bazaar", s.bazaar ?? null, s.bazaarReportable ?? true, s.bazaarDemand);
  const cityMetrics = group("city", s.city ?? null);

  const comparisons = compareWithNetwork(merchantMetrics, { cohort: cohortMetrics, bazaar: bazaarMetrics, city: cityMetrics });
  const evidence = buildEvidence({ merchant: merchantMetrics, cohort, cohortMetrics, bazaarMetrics, cityMetrics, period: PERIOD });
  const context = { segments: cohortReportable ? (s.segments ?? []) : [] };
  const patterns = detectPatterns({ comparisons, context, evidence });
  const bazaarImpact = calculateBazaarImpact({
    merchant: merchantMetrics,
    cohort: cohortMetrics,
    category: categoryMetrics,
    bazaar: bazaarMetrics,
    city: cityMetrics,
  });
  const opportunities = detectOpportunities({ patterns, impact: bazaarImpact, evidence });

  const limitations: DataLimitation[] = [];
  if (basis === "city_category") limitations.push("COHORT_FALLBACK_TO_CITY_CATEGORY");
  if (!cohortReportable) limitations.push("COHORT_TOO_SMALL");
  if (s.merchant === null) limitations.push("NO_PREVIOUS_PERIOD_GMV");

  return {
    merchantId: "TARGET",
    bazaarId: "B1",
    city: "Bengaluru",
    category: "restaurant",
    period: PERIOD,
    cohort: { basis, category: "restaurant", size: cohort.cohortSize, reportable: cohortReportable },
    merchantMetrics,
    cohortMetrics,
    categoryMetrics,
    bazaarMetrics,
    cityMetrics,
    comparisons,
    context,
    patterns,
    evidence,
    bazaarImpact,
    opportunities,
    limitations,
  };
}
