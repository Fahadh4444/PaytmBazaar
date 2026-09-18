/**
 * Domain types for the M2M engine: its inputs, intermediate results, and the
 * `M2MIntelligence` output contract.
 *
 * Business data (bazaars, merchants, payment events, daily metrics) is
 * described once, by the Data Adapter, in `lib/paytm/adapter/types.ts`. That
 * file has no imports, so depending on it brings in no Supabase and no
 * provider SDK. The engine imports types only from there.
 *
 * Nothing here may import React, Next.js, Supabase, or any provider SDK.
 */

import type {
  DateRange,
  EventType,
  MerchantCategory,
  WeatherCondition,
} from "@/lib/paytm/adapter/types";

export type {
  Bazaar,
  DateRange,
  Merchant,
  MerchantCategory,
  MerchantDailyMetric,
  PaymentEvent,
  PaytmDataSource,
  WeatherCondition,
} from "@/lib/paytm/adapter/types";

// --- Periods ----------------------------------------------------------------

/** A current period and the equally long period immediately before it. */
export interface ComparisonPeriod {
  current: DateRange;
  previous: DateRange;
  /** Length of each period in days. */
  days: number;
}

// --- Metrics ----------------------------------------------------------------

/**
 * The five M2M figures for one period, from successful payments only.
 * Money is in rupees, rounded to paise.
 */
export interface PeriodMetrics {
  /** Gross sales: sum of successful `ACQUIRING` amounts. */
  gmv: number;
  /** Count of successful `ACQUIRING` transactions. */
  transactions: number;
  /** `gmv / transactions`; null when there were no transactions. */
  aov: number | null;
  /** Sum of successful refunds. */
  refunds: number;
}

export interface CurrentPeriodMetrics extends PeriodMetrics {
  /**
   * GMV growth against the previous period, in percent (one decimal).
   * Null when the previous period had no GMV, so growth is undefined.
   */
  growth: number | null;
}

export interface MerchantMetrics {
  merchantId: string;
  current: CurrentPeriodMetrics;
  previous: PeriodMetrics;
}

export type GroupScope = "cohort" | "category" | "bazaar" | "city";

/**
 * Aggregate metrics for a group of merchants. Figures are present only when
 * the group is large enough to be anonymous (`MIN_COHORT_SIZE`). Otherwise
 * they are null and `reportable` is false, so no single merchant's figures
 * can leak through a group of one or two.
 */
export interface GroupMetrics {
  scope: GroupScope;
  /** Merchants whose figures make up the aggregate. */
  merchantCount: number;
  reportable: boolean;
  current: CurrentPeriodMetrics | null;
  previous: PeriodMetrics | null;
}

// --- Cohort -----------------------------------------------------------------

/**
 * How the cohort was chosen. The rule is same Bazaar and same category. When
 * that yields too few peers, it falls back to the same category across the
 * city.
 */
export type CohortBasis = "bazaar_category" | "city_category";

/** Internal: lists peer IDs. Never part of `M2MIntelligence`. */
export interface MerchantCohort {
  merchantId: string;
  basis: CohortBasis;
  category: MerchantCategory;
  bazaarId: string;
  city: string;
  /** Peers only; the merchant itself is excluded. */
  cohortMerchantIds: string[];
  cohortSize: number;
  reportable: boolean;
}

/** What the output reveals about the cohort: its shape, never its members. */
export interface CohortSummary {
  basis: CohortBasis;
  category: MerchantCategory;
  size: number;
  reportable: boolean;
}

// --- Context ----------------------------------------------------------------

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export type DayOfWeek =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

/** Dimensions a payment can be bucketed by. Derived from `txnAt` or recorded context. */
export type ContextDimension = "timeOfDay" | "dayOfWeek" | "weather" | "event";

/** A bucket within a dimension, e.g. `evening`, `saturday`, `rain`, `festival`, or `none`. */
export type ContextSegment = TimeOfDay | DayOfWeek | WeatherCondition | EventType | "none";

export interface SegmentSide {
  currentGmv: number;
  previousGmv: number;
  currentTransactions: number;
  previousTransactions: number;
  /** GMV growth in percent; null when previous GMV is zero. */
  growth: number | null;
  /** This segment's share of the period's GMV, in percent. */
  currentShare: number;
}

/**
 * One segment compared across periods for the merchant and its cohort.
 * Cohort figures are null when fewer than `MIN_COHORT_SIZE` cohort merchants
 * traded in the segment.
 */
export interface ContextSegmentAnalysis {
  dimension: ContextDimension;
  segment: ContextSegment;
  merchant: SegmentSide;
  cohort: SegmentSide | null;
  /** Cohort merchants with at least one sale in this segment in the current period. */
  cohortContributors: number;
}

export interface ContextAnalysis {
  segments: ContextSegmentAnalysis[];
}

// --- Comparison -------------------------------------------------------------

export type Direction = "up" | "down" | "flat" | "unknown";

export interface Comparison {
  against: "cohort" | "bazaar" | "city";
  /** False when the group is not reportable; every figure is then null. */
  available: boolean;
  merchantGrowth: number | null;
  groupGrowth: number | null;
  /** `merchantGrowth - groupGrowth`, in percentage points. */
  growthGap: number | null;
  merchantDirection: Direction;
  groupDirection: Direction;
  /** How far the merchant's AOV sits above (+) or below (-) the group's, in percent. */
  aovGap: number | null;
}

// --- Evidence ---------------------------------------------------------------

export interface ObservationWindow {
  days: number;
  current: DateRange;
  previous: DateRange;
}

/**
 * The numbers behind a finding, so a later layer can show why it was made.
 * Growth values are GMV growth in percent; null means not available.
 */
export interface Evidence {
  metric: "gmv_growth";
  merchantChange: number | null;
  cohortChange: number | null;
  bazaarChange: number | null;
  cityChange: number | null;
  cohortSize: number;
  cohortBasis: CohortBasis;
  observationWindow: ObservationWindow;
  /** Present when the finding is about one context segment. */
  context?: {
    dimension: ContextDimension;
    segment: ContextSegment;
    merchantChange: number | null;
    cohortChange: number | null;
    merchantTransactions: number;
    cohortContributors: number;
  };
}

// --- Patterns ---------------------------------------------------------------

export type PatternType =
  | "MERCHANT_DOWN_NETWORK_UP"
  | "MERCHANT_UP_NETWORK_DOWN"
  | "MERCHANT_DOWN_BAZAAR_UP"
  | "MERCHANT_UP_BAZAAR_DOWN"
  | "NETWORK_WIDE_GROWTH"
  | "NETWORK_WIDE_DECLINE"
  | "MERCHANT_ALIGNS_WITH_NETWORK"
  /** The cohort grew in a context segment where the merchant fell behind. */
  | "CONTEXT_NETWORK_GROWTH";

/**
 * A deterministic observation. It states what moved together, never why.
 * Context patterns are associations observed during a segment, not causes.
 */
export interface Pattern {
  type: PatternType;
  evidence: Evidence;
}

// --- Bazaar Impact ----------------------------------------------------------

export type NetworkBasis = "cohort" | "bazaar";

/** How the network around the merchant is moving, relative to the merchant. */
export interface BazaarImpact {
  bazaarGrowth: number | null;
  cohortGrowth: number | null;
  /** Same category across the city, excluding the merchant. */
  categoryGrowth: number | null;
  cityGrowth: number | null;
  /** Bazaar transaction-count growth, in percent, and its direction. */
  demandTrend: { growth: number | null; direction: Direction };
  /** Which group stands in for "the network": the cohort if reportable, else the Bazaar. */
  networkBasis: NetworkBasis;
  networkDirection: Direction;
  /** Merchant growth minus network growth, in percentage points. */
  merchantVsNetworkGap: number | null;
}

// --- Opportunities ----------------------------------------------------------

export type OpportunityType =
  | "CLOSE_NETWORK_GAP"
  | "CAPTURE_CONTEXT_DEMAND"
  | "SUSTAIN_OUTPERFORMANCE";

export type OpportunityReason =
  | "MERCHANT_BEHIND_GROWING_NETWORK"
  | "MERCHANT_BEHIND_NETWORK_IN_CONTEXT"
  | "MERCHANT_AHEAD_OF_DECLINING_NETWORK";

export type Priority = "high" | "medium" | "low";

/**
 * A structured opportunity. `title` is a fixed label per type. Explaining it
 * to the merchant is the LLM layer's job, later.
 */
export interface Opportunity {
  type: OpportunityType;
  title: string;
  reason: OpportunityReason;
  priority: Priority;
  patterns: PatternType[];
  evidence: Evidence;
}

// --- Output -----------------------------------------------------------------

/** Explicit reasons some output is missing or thinner than usual. */
export type DataLimitation =
  | "COHORT_FALLBACK_TO_CITY_CATEGORY"
  | "COHORT_TOO_SMALL"
  | "BAZAAR_TOO_SMALL"
  | "CITY_TOO_SMALL"
  | "NO_MERCHANT_ACTIVITY"
  | "NO_PREVIOUS_PERIOD_GMV";

/**
 * Everything the M2M engine concluded for one merchant.
 *
 * Safe to show to that merchant: it contains the merchant's own figures and
 * aggregates over groups of at least `MIN_COHORT_SIZE` merchants, and never
 * another merchant's name, ID, contact details, figures, or transactions.
 */
export interface M2MIntelligence {
  merchantId: string;
  bazaarId: string;
  city: string;
  category: MerchantCategory;
  period: ComparisonPeriod;
  cohort: CohortSummary;
  merchantMetrics: MerchantMetrics;
  cohortMetrics: GroupMetrics;
  categoryMetrics: GroupMetrics;
  bazaarMetrics: GroupMetrics;
  cityMetrics: GroupMetrics;
  comparisons: Comparison[];
  context: ContextAnalysis;
  patterns: Pattern[];
  evidence: Evidence;
  bazaarImpact: BazaarImpact;
  opportunities: Opportunity[];
  limitations: DataLimitation[];
}
