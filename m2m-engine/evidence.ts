/**
 * Evidence: the figures behind every finding, so a later layer can answer
 * "why did Bazaar detect this?" without recomputing anything.
 */

import type {
  ComparisonPeriod,
  ContextSegmentAnalysis,
  Evidence,
  GroupMetrics,
  MerchantCohort,
  MerchantMetrics,
} from "./types";

export function buildEvidence(input: {
  merchant: MerchantMetrics;
  cohort: MerchantCohort;
  cohortMetrics: GroupMetrics;
  bazaarMetrics: GroupMetrics;
  cityMetrics: GroupMetrics;
  period: ComparisonPeriod;
}): Evidence {
  const { merchant, cohort, cohortMetrics, bazaarMetrics, cityMetrics, period } = input;
  return {
    metric: "gmv_growth",
    merchantChange: merchant.current.growth,
    cohortChange: cohortMetrics.current?.growth ?? null,
    bazaarChange: bazaarMetrics.current?.growth ?? null,
    cityChange: cityMetrics.current?.growth ?? null,
    cohortSize: cohort.cohortSize,
    cohortBasis: cohort.basis,
    observationWindow: { days: period.days, current: period.current, previous: period.previous },
  };
}

export function withContext(base: Evidence, segment: ContextSegmentAnalysis): Evidence {
  return {
    ...base,
    context: {
      dimension: segment.dimension,
      segment: segment.segment,
      merchantChange: segment.merchant.growth,
      cohortChange: segment.cohort?.growth ?? null,
      merchantTransactions: segment.merchant.currentTransactions,
      cohortContributors: segment.cohortContributors,
    },
  };
}
