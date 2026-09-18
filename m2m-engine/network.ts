/**
 * Area intelligence: what is happening across the city, or across one Bazaar.
 *
 * Built from the same daily rollup and the same metric functions as merchant
 * intelligence, so a number here means exactly what it means everywhere else.
 * Pure functions: no I/O.
 *
 * Privacy follows the M2M model: a breakdown group (a Bazaar, a category) is
 * only shown when it holds at least MIN_COHORT_SIZE merchants, and merchant
 * performance is only ever reported as counts per band. No merchant's
 * identity, sales or orders leave this module.
 */

import { MIN_COHORT_SIZE, M2M_THRESHOLDS } from "./config";
import { periodMetrics, roundMoney, roundPercent } from "./metrics";
import { addDays, isWithin, istParts } from "./period";
import type {
  Bazaar,
  ComparisonPeriod,
  CurrentPeriodMetrics,
  Direction,
  Merchant,
  MerchantCategory,
  MerchantDailyMetric,
  PeriodMetrics,
} from "./types";
import { direction } from "./comparison";

export const TREND_DAYS = 28;
/** Growth at or above this counts as "growing strongly": M2M's opportunity gap. */
export const STRONG_GROWTH_PCT = M2M_THRESHOLDS.opportunityGapPp;
/** Weekend and weekday sales per day must differ by this much to be worth saying. */
export const WEEK_PATTERN_MIN_PCT = 10;
/** Bazaars or categories this far apart are worth pointing out. */
export const SPREAD_MIN_PP = 10;

export interface AreaMetrics {
  current: CurrentPeriodMetrics;
  previous: PeriodMetrics;
  merchantCount: number;
  /** Merchants with at least one successful sale in the current period. */
  activeMerchants: number;
}

export interface TrendPoint {
  date: string;
  gmv: number;
}

export interface GrowthBar {
  id: string;
  label: string;
  growth: number | null;
  merchantCount: number;
}

export interface GrowthBreakdown {
  dimension: "bazaar" | "category";
  bars: GrowthBar[];
  /** Groups left out because they have too few merchants to stay anonymous. */
  hiddenGroups: number;
}

export type PerformanceBand = "growing_strongly" | "growing" | "stable" | "declining";

export interface PerformanceCount {
  band: PerformanceBand;
  count: number;
}

export interface AreaImpact {
  bazaarGrowth: number | null;
  cityGrowth: number | null;
  /** Bazaar growth minus city growth, in points. */
  gapToCity: number | null;
  /** Bazaar order-count growth. */
  demandGrowth: number | null;
  direction: Direction;
}

export interface WeekPattern {
  weekendDailyGmv: number;
  weekdayDailyGmv: number;
  /** How much more (+) or less (-) a weekend day sells than a weekday, in percent. */
  weekendLiftPct: number;
}

export interface AreaIntelligence {
  scope: "city" | "bazaar";
  id: string;
  name: string;
  city: string;
  period: ComparisonPeriod;
  metrics: AreaMetrics;
  trend: TrendPoint[];
  breakdowns: GrowthBreakdown[];
  /** Bazaar scope only. */
  performance: PerformanceCount[] | null;
  /** Bazaar scope only. */
  impact: AreaImpact | null;
  weekPattern: WeekPattern | null;
  /** One plain-language headline built from the numbers above, or a "not enough data" line. */
  headline: string;
  /** A second supporting line, when the data supports one. */
  detail: string | null;
}

const CATEGORY_LABEL: Record<MerchantCategory, string> = {
  restaurant: "Restaurants",
  cafe: "Cafes",
  kirana: "Kiranas",
  pharmacy: "Pharmacies",
  bakery: "Bakeries",
  electronics: "Electronics",
  fashion: "Fashion",
  textiles: "Textiles",
};

const pct = (value: number) => `${value > 0 ? "+" : ""}${value}%`;

export function areaMetrics(rows: MerchantDailyMetric[], period: ComparisonPeriod, mids: string[]): AreaMetrics {
  const { current, previous } = periodMetrics(rows, period, mids);
  const set = new Set(mids);
  const active = new Set(
    rows.filter((r) => set.has(r.mid) && isWithin(r.businessDate, period.current) && r.successfulTransactions > 0).map((r) => r.mid),
  );
  return { current, previous, merchantCount: set.size, activeMerchants: active.size };
}

/** Daily sales summed across the area for the `days` ending with the current period. */
export function dailyTrend(rows: MerchantDailyMetric[], period: ComparisonPeriod, mids: string[], days = TREND_DAYS): TrendPoint[] {
  const set = new Set(mids);
  const window = { from: addDays(period.current.to, -(days - 1)), to: period.current.to };
  const byDate = new Map<string, number>();
  for (let d = window.from; d <= window.to; d = addDays(d, 1)) byDate.set(d, 0);
  for (const r of rows) {
    if (set.has(r.mid) && byDate.has(r.businessDate)) byDate.set(r.businessDate, byDate.get(r.businessDate)! + r.grossSalesInr);
  }
  return [...byDate.entries()].map(([date, gmv]) => ({ date, gmv: roundMoney(gmv) }));
}

/** Growth per group, hiding groups too small to be anonymous. */
export function growthBreakdown(
  dimension: GrowthBreakdown["dimension"],
  groups: { id: string; label: string; mids: string[] }[],
  rows: MerchantDailyMetric[],
  period: ComparisonPeriod,
): GrowthBreakdown {
  const shown = groups.filter((g) => g.mids.length >= MIN_COHORT_SIZE);
  const bars = shown
    .map((g) => ({
      id: g.id,
      label: g.label,
      growth: periodMetrics(rows, period, g.mids).current.growth,
      merchantCount: g.mids.length,
    }))
    .sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
  return { dimension, bars, hiddenGroups: groups.length - shown.length };
}

export function categoryGroups(merchants: Merchant[]) {
  const byCategory = new Map<MerchantCategory, string[]>();
  for (const m of merchants) byCategory.set(m.category, [...(byCategory.get(m.category) ?? []), m.mid]);
  return [...byCategory.entries()].map(([category, mids]) => ({ id: category, label: CATEGORY_LABEL[category], mids }));
}

/** How many merchants are growing, stable or declining. Counts only. */
export function performanceCounts(rows: MerchantDailyMetric[], period: ComparisonPeriod, mids: string[]): PerformanceCount[] {
  const counts: Record<PerformanceBand, number> = { growing_strongly: 0, growing: 0, stable: 0, declining: 0 };
  for (const mid of mids) {
    const growth = periodMetrics(rows, period, [mid]).current.growth;
    if (growth === null) continue;
    const band: PerformanceBand =
      growth >= STRONG_GROWTH_PCT ? "growing_strongly" : direction(growth) === "up" ? "growing" : direction(growth) === "down" ? "declining" : "stable";
    counts[band] += 1;
  }
  return (Object.keys(counts) as PerformanceBand[]).map((band) => ({ band, count: counts[band] }));
}

/** Weekend vs weekday sales per day in the current period, if the gap is meaningful. */
export function weekPattern(trend: TrendPoint[], period: ComparisonPeriod): WeekPattern | null {
  const days = trend.filter((p) => isWithin(p.date, period.current));
  const weekend = days.filter((p) => ["saturday", "sunday"].includes(istParts(`${p.date}T12:00:00+05:30`).dayOfWeek));
  const weekday = days.filter((p) => !weekend.includes(p));
  if (weekend.length === 0 || weekday.length === 0) return null;
  const avg = (ps: TrendPoint[]) => ps.reduce((s, p) => s + p.gmv, 0) / ps.length;
  const weekendDailyGmv = roundMoney(avg(weekend));
  const weekdayDailyGmv = roundMoney(avg(weekday));
  if (weekdayDailyGmv === 0) return null;
  const weekendLiftPct = roundPercent(((weekendDailyGmv - weekdayDailyGmv) / weekdayDailyGmv) * 100);
  return Math.abs(weekendLiftPct) >= WEEK_PATTERN_MIN_PCT ? { weekendDailyGmv, weekdayDailyGmv, weekendLiftPct } : null;
}

const NOT_ENOUGH = "Not enough data to identify a strong signal yet.";

function moved(growth: number) {
  const size = `${Math.abs(growth)}%`;
  return direction(growth) === "up" ? `grew ${size}` : direction(growth) === "down" ? `fell ${size}` : `held steady (${pct(growth)})`;
}

export function cityIntelligence(input: {
  city: string;
  bazaars: Bazaar[];
  merchants: Merchant[];
  rows: MerchantDailyMetric[];
  period: ComparisonPeriod;
}): AreaIntelligence {
  const { city, period, rows } = input;
  const bazaars = input.bazaars.filter((b) => b.city === city);
  const inCity = new Set(bazaars.map((b) => b.id));
  const merchants = input.merchants.filter((m) => inCity.has(m.bazaarId));
  const mids = merchants.map((m) => m.mid);

  const metrics = areaMetrics(rows, period, mids);
  const trend = dailyTrend(rows, period, mids);
  const byBazaar = growthBreakdown(
    "bazaar",
    bazaars.map((b) => ({ id: b.id, label: b.name, mids: merchants.filter((m) => m.bazaarId === b.id).map((m) => m.mid) })),
    rows,
    period,
  );
  const byCategory = growthBreakdown("category", categoryGroups(merchants), rows, period);

  const growth = metrics.current.growth;
  let headline = NOT_ENOUGH;
  let detail: string | null = null;
  if (growth !== null) {
    headline = `Sales across ${city} ${moved(growth)} this week.`;
    const known = byBazaar.bars.filter((b) => b.growth !== null);
    const top = known[0];
    const bottom = known.at(-1);
    if (top && bottom && top !== bottom && top.growth! - bottom.growth! >= SPREAD_MIN_PP) {
      detail = `${top.label} is growing fastest (${pct(top.growth!)}), while ${bottom.label} ${bottom.growth! < 0 ? "is declining" : "is slowest"} (${pct(bottom.growth!)}).`;
    }
  }

  return {
    scope: "city",
    id: city.toLowerCase(),
    name: city,
    city,
    period,
    metrics,
    trend,
    breakdowns: [byBazaar, byCategory],
    performance: null,
    impact: null,
    weekPattern: weekPattern(trend, period),
    headline,
    detail,
  };
}

export function bazaarIntelligence(input: {
  bazaar: Bazaar;
  bazaars: Bazaar[];
  merchants: Merchant[];
  rows: MerchantDailyMetric[];
  period: ComparisonPeriod;
}): AreaIntelligence {
  const { bazaar, period, rows } = input;
  const merchants = input.merchants.filter((m) => m.bazaarId === bazaar.id);
  const mids = merchants.map((m) => m.mid);
  const inCity = new Set(input.bazaars.filter((b) => b.city === bazaar.city).map((b) => b.id));
  const cityMids = input.merchants.filter((m) => inCity.has(m.bazaarId)).map((m) => m.mid);

  const metrics = areaMetrics(rows, period, mids);
  const trend = dailyTrend(rows, period, mids);
  const byCategory = growthBreakdown("category", categoryGroups(merchants), rows, period);
  const performance = performanceCounts(rows, period, mids);

  const bazaarGrowth = metrics.current.growth;
  const cityGrowth = periodMetrics(rows, period, cityMids).current.growth;
  const impact: AreaImpact = {
    bazaarGrowth,
    cityGrowth,
    gapToCity: bazaarGrowth !== null && cityGrowth !== null ? roundPercent(bazaarGrowth - cityGrowth) : null,
    demandGrowth:
      metrics.previous.transactions === 0
        ? null
        : roundPercent(((metrics.current.transactions - metrics.previous.transactions) / metrics.previous.transactions) * 100),
    direction: direction(bazaarGrowth),
  };

  let headline = NOT_ENOUGH;
  let detail: string | null = null;
  if (bazaarGrowth !== null) {
    const versus =
      impact.gapToCity === null || Math.abs(impact.gapToCity) < M2M_THRESHOLDS.flatGrowthPct
        ? `in line with ${bazaar.city} (${pct(cityGrowth!)})`
        : `${impact.gapToCity > 0 ? "ahead of" : "behind"} ${bazaar.city} (${pct(cityGrowth!)})`;
    headline = `Sales in ${bazaar.name} ${moved(bazaarGrowth)} this week, ${versus}.`;
    const growing = performance.filter((p) => p.band === "growing" || p.band === "growing_strongly").reduce((s, p) => s + p.count, 0);
    const counted = performance.reduce((s, p) => s + p.count, 0);
    if (counted > 0) detail = `${growing} of ${counted} shops here are growing.`;
  }

  return {
    scope: "bazaar",
    id: bazaar.id,
    name: bazaar.name,
    city: bazaar.city,
    period,
    metrics,
    trend,
    breakdowns: [byCategory],
    performance,
    impact,
    weekPattern: weekPattern(trend, period),
    headline,
    detail,
  };
}
