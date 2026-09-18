/**
 * Bazaar Impact: how the network around a merchant is moving, and how far the
 * merchant sits from it. "The network" is the cohort when it is reportable,
 * otherwise the Bazaar.
 */

import { direction } from "./comparison";
import { growthPercent, roundPercent } from "./metrics";
import type { BazaarImpact, GroupMetrics, MerchantMetrics } from "./types";

export function calculateBazaarImpact(input: {
  merchant: MerchantMetrics;
  cohort: GroupMetrics;
  category: GroupMetrics;
  bazaar: GroupMetrics;
  city: GroupMetrics;
}): BazaarImpact {
  const { merchant, cohort, category, bazaar, city } = input;

  const networkBasis = cohort.reportable ? "cohort" : "bazaar";
  const networkGrowth = (networkBasis === "cohort" ? cohort : bazaar).current?.growth ?? null;
  const merchantGrowth = merchant.current.growth;

  const demandGrowth =
    bazaar.current && bazaar.previous
      ? growthPercent(bazaar.current.transactions, bazaar.previous.transactions)
      : null;

  return {
    bazaarGrowth: bazaar.current?.growth ?? null,
    cohortGrowth: cohort.current?.growth ?? null,
    categoryGrowth: category.current?.growth ?? null,
    cityGrowth: city.current?.growth ?? null,
    demandTrend: { growth: demandGrowth, direction: direction(demandGrowth) },
    networkBasis,
    networkDirection: direction(networkGrowth),
    merchantVsNetworkGap:
      merchantGrowth !== null && networkGrowth !== null ? roundPercent(merchantGrowth - networkGrowth) : null,
  };
}
