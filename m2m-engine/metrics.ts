/**
 * Merchant Metrics: the five M2M figures (GMV, transactions, AOV, growth,
 * refunds) for a merchant or a group, over a comparison period.
 *
 * Input is the database's daily rollup (`MerchantDailyMetric`), so the
 * definition of a successful sale and a refund is the database's, not
 * re-derived here:
 *   GMV          = sum of `grossSalesInr`          (successful ACQUIRING amounts)
 *   transactions = sum of `successfulTransactions`
 *   refunds      = sum of `refundsInr`             (successful refunds)
 *   AOV          = GMV / transactions, null when there are none
 *   growth       = GMV growth vs the previous period, null when previous GMV is 0
 *
 * Pure functions: no I/O.
 */

import { isWithin } from "./period";
import type {
  ComparisonPeriod,
  CurrentPeriodMetrics,
  DateRange,
  MerchantDailyMetric,
  MerchantMetrics,
  PeriodMetrics,
} from "./types";

export const roundMoney = (value: number) => Math.round(value * 100) / 100;
export const roundPercent = (value: number) => Math.round(value * 10) / 10;

/**
 * Percentage change from `previous` to `current`, one decimal. Null when
 * `previous` is zero: growth from nothing is undefined, not infinite.
 */
export function growthPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundPercent(((current - previous) / previous) * 100);
}

export function averageOrderValue(gmv: number, transactions: number): number | null {
  return transactions === 0 ? null : roundMoney(gmv / transactions);
}

/** Sums daily rows that fall inside `range`, for the given merchants. */
export function sumPeriod(
  rows: MerchantDailyMetric[],
  range: DateRange,
  mids: ReadonlySet<string>,
): PeriodMetrics {
  let gmv = 0;
  let transactions = 0;
  let refunds = 0;
  for (const row of rows) {
    if (!mids.has(row.mid) || !isWithin(row.businessDate, range)) continue;
    gmv += row.grossSalesInr;
    transactions += row.successfulTransactions;
    refunds += row.refundsInr;
  }
  gmv = roundMoney(gmv);
  return { gmv, transactions, aov: averageOrderValue(gmv, transactions), refunds: roundMoney(refunds) };
}

/** Current and previous figures for a set of merchants, aggregated as one. */
export function periodMetrics(
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
  mids: Iterable<string>,
): { current: CurrentPeriodMetrics; previous: PeriodMetrics } {
  const set = new Set(mids);
  const previous = sumPeriod(rows, period.previous, set);
  const current = sumPeriod(rows, period.current, set);
  return { current: { ...current, growth: growthPercent(current.gmv, previous.gmv) }, previous };
}

/** Step 1: one merchant's own figures. */
export function calculateMerchantMetrics(
  merchantId: string,
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): MerchantMetrics {
  return { merchantId, ...periodMetrics(rows, period, [merchantId]) };
}
