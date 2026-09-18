/**
 * Cohort, category, Bazaar and City metrics: the same five figures as
 * Merchant Metrics, aggregated over a group. Group AOV is group GMV over group
 * transactions, not an average of merchant AOVs.
 *
 * Privacy: a group's figures are only returned when it holds at least
 * MIN_COHORT_SIZE merchants *other than the viewing merchant*. Bazaar and City
 * include the viewer, so they need one more member than a peer cohort does.
 * Otherwise the figures are null and `reportable` is false.
 */

import { MIN_COHORT_SIZE } from "./config";
import { cityCategoryPeers, cityMerchants, cityOf, type Network } from "./cohort";
import { periodMetrics } from "./metrics";
import type {
  ComparisonPeriod,
  GroupMetrics,
  GroupScope,
  Merchant,
  MerchantCohort,
  MerchantDailyMetric,
} from "./types";

export function calculateGroupMetrics(
  scope: GroupScope,
  mids: string[],
  viewerId: string,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GroupMetrics {
  const members = [...new Set(mids)];
  const others = members.filter((mid) => mid !== viewerId).length;
  const reportable = others >= MIN_COHORT_SIZE;
  const figures = reportable ? periodMetrics(rows, period, members) : null;

  return {
    scope,
    merchantCount: members.length,
    reportable,
    current: figures?.current ?? null,
    previous: figures?.previous ?? null,
  };
}

export function calculateCohortMetrics(
  cohort: MerchantCohort,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GroupMetrics {
  return calculateGroupMetrics("cohort", cohort.cohortMerchantIds, cohort.merchantId, rows, period);
}

/** Same category across the city, excluding the merchant. Feeds Bazaar Impact's `categoryGrowth`. */
export function calculateCategoryMetrics(
  merchant: Merchant,
  network: Network,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GroupMetrics {
  return calculateGroupMetrics("category", cityCategoryPeers(merchant, network), merchant.mid, rows, period);
}

export function calculateBazaarMetrics(
  merchant: Merchant,
  network: Network,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GroupMetrics {
  const mids = network.merchants.filter((m) => m.bazaarId === merchant.bazaarId).map((m) => m.mid);
  return calculateGroupMetrics("bazaar", mids, merchant.mid, rows, period);
}

/** Every merchant in every Bazaar of the merchant's city. */
export function calculateCityMetrics(
  merchant: Merchant,
  network: Network,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GroupMetrics {
  const city = cityOf(merchant.bazaarId, network.bazaars);
  const mids = cityMerchants(city, network).map((m) => m.mid);
  return calculateGroupMetrics("city", mids, merchant.mid, rows, period);
}
