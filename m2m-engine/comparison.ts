/**
 * M2M Comparison: the merchant against its cohort, its Bazaar and its city,
 * on GMV growth and AOV. Values are kept as structured numbers; nothing is
 * worded here.
 */

import { M2M_THRESHOLDS } from "./config";
import { roundPercent } from "./metrics";
import type { Comparison, Direction, GroupMetrics, MerchantMetrics } from "./types";

export function direction(growth: number | null): Direction {
  if (growth === null) return "unknown";
  if (growth > M2M_THRESHOLDS.flatGrowthPct) return "up";
  if (growth < -M2M_THRESHOLDS.flatGrowthPct) return "down";
  return "flat";
}

export function compare(
  merchant: MerchantMetrics,
  group: GroupMetrics,
  against: Comparison["against"],
): Comparison {
  const merchantGrowth = merchant.current.growth;
  const groupGrowth = group.current?.growth ?? null;
  const groupAov = group.current?.aov ?? null;
  const merchantAov = merchant.current.aov;

  return {
    against,
    available: group.reportable,
    merchantGrowth,
    groupGrowth,
    growthGap: merchantGrowth !== null && groupGrowth !== null ? roundPercent(merchantGrowth - groupGrowth) : null,
    merchantDirection: direction(merchantGrowth),
    groupDirection: direction(groupGrowth),
    aovGap:
      merchantAov !== null && groupAov !== null && groupAov !== 0
        ? roundPercent(((merchantAov - groupAov) / groupAov) * 100)
        : null,
  };
}

export function compareWithNetwork(
  merchant: MerchantMetrics,
  groups: { cohort: GroupMetrics; bazaar: GroupMetrics; city: GroupMetrics },
): Comparison[] {
  return [
    compare(merchant, groups.cohort, "cohort"),
    compare(merchant, groups.bazaar, "bazaar"),
    compare(merchant, groups.city, "city"),
  ];
}

export function findComparison(comparisons: Comparison[], against: Comparison["against"]): Comparison {
  const found = comparisons.find((c) => c.against === against);
  if (!found) throw new Error(`No ${against} comparison.`);
  return found;
}
