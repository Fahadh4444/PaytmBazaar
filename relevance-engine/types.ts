/**
 * Types for the Relevance Engine: which parts of an `M2MIntelligence` matter
 * to this merchant now, and why.
 *
 * Everything here points back at M2M output (`Pattern`, `Evidence`,
 * `Opportunity`, `Priority`), reused rather than redefined. The engine adds a
 * ranking and the reasons for it; it never adds new business figures.
 */

import type {
  CohortSummary,
  ComparisonPeriod,
  DataLimitation,
  Evidence,
  MerchantCategory,
  Opportunity,
  OpportunityType,
  Pattern,
  PatternType,
  Priority,
} from "@/m2m-engine";

/** Where a signal comes from in the M2M output. */
export type SignalKind =
  | "COHORT_GAP" //       merchant vs its cohort        (comparisons, cohort)
  | "BAZAAR_GAP" //       merchant vs its Bazaar        (comparisons, bazaar)
  | "CITY_GAP" //         merchant vs its city          (comparisons, city)
  | "MARKET_MOVEMENT" //  the Bazaar itself moving      (bazaarImpact)
  | "CONTEXT" //          one context segment           (CONTEXT_NETWORK_GROWTH)
  | "ALIGNMENT"; //       merchant moving with cohort   (MERCHANT_ALIGNS_WITH_NETWORK)

/**
 * `behind`/`ahead`: the merchant against the comparison group.
 * `up`/`down`: the market's own direction. `aligned`: moving together.
 */
export type SignalDirection = "behind" | "ahead" | "up" | "down" | "aligned";

/** Machine-readable reasons behind a score. The LLM layer turns these into words. */
export type RelevanceReason =
  | "DIVERGES_FROM_COHORT"
  | "DIVERGES_FROM_BAZAAR"
  | "DIVERGES_FROM_CITY"
  | "CITY_LEVEL_LOW_SPECIFICITY"
  | "CONFIRMED_BY_PATTERN"
  | "NOT_CONFIRMED_BY_PATTERN"
  | "PRIMARY_COHORT"
  | "FALLBACK_COHORT_REDUCED_CONFIDENCE"
  | "BAZAAR_MOVEMENT"
  | "DEMAND_TREND_AGREES"
  | "DEMAND_TREND_DISAGREES"
  | "CONTEXT_SEGMENT_GAP"
  | "CONCENTRATED_IN_SEGMENT"
  | "FULL_SEGMENT_SUPPORT"
  | "LIMITED_SEGMENT_SUPPORT"
  | "ASSOCIATION_NOT_CAUSE"
  | "MOVES_WITH_NETWORK"
  | "LINKED_TO_OPPORTUNITY";

/**
 * The parts of a score, so every ranking can be explained:
 * `score = min(100, round(100 × magnitude × specificity × confidence × patternSupport) + opportunityBonus)`.
 */
export interface ScoreFactors {
  /** Size of the gap or movement, 0–1, relative to M2M's high-priority gap. */
  magnitude: number;
  /** How specific to this merchant the comparison is, 0–1. */
  specificity: number;
  /** How far the underlying data can be trusted, 0–1 (cohort basis, segment support, demand agreement). */
  confidence: number;
  /** 1 when an M2M pattern confirms the signal, lower when it does not. */
  patternSupport: number;
  /** Points added when an M2M opportunity is linked to this signal. */
  opportunityBonus: number;
}

export interface RelevanceSignal {
  /** Stable within one result, e.g. `cohort_gap` or `context:timeOfDay:evening`. */
  id: string;
  kind: SignalKind;
  priority: Priority;
  /** 0–100. */
  score: number;
  direction: SignalDirection;
  /** The gap or movement in percentage points, exactly as M2M reported it. */
  magnitudePp: number;
  factors: ScoreFactors;
  reasons: RelevanceReason[];
  /** M2M patterns that confirm this signal. */
  patterns: PatternType[];
  /** M2M opportunities that rest on this signal. */
  opportunities: OpportunityType[];
  /** The M2M evidence behind the signal, unchanged. */
  evidence: Evidence;
}

export type DismissalReason =
  /** M2M withheld the group (too few merchants), so there is nothing to compare. */
  | "GROUP_NOT_REPORTABLE"
  /** Growth could not be computed (e.g. no previous-period sales). */
  | "GROWTH_UNAVAILABLE"
  /** Within M2M's alignment tolerance: indistinguishable from noise. */
  | "BELOW_NOISE_FLOOR"
  /**
   * A context segment whose gap is no wider than the merchant's overall gap
   * to its cohort: it restates the overall picture rather than adding to it.
   */
  | "MIRRORS_OVERALL_GAP";

/** A candidate signal that was considered and dropped, and why. */
export interface DismissedSignal {
  kind: SignalKind;
  reason: DismissalReason;
}

export interface RelevantOpportunity {
  opportunity: Opportunity;
  /** Relevance of the strongest signal the opportunity rests on, 0–100. */
  score: number;
  /** Score-based priority, never above the priority M2M gave the opportunity. */
  priority: Priority;
  /** IDs of the signals it rests on. Empty if none survived. */
  signalIds: string[];
}

/**
 * How much the peer comparison can be trusted: a same-Bazaar cohort, the
 * city-wide fallback, or no reportable cohort at all.
 */
export type CohortConfidence = "primary" | "fallback" | "none";

/**
 * The part of an `M2MIntelligence` worth passing on, ranked and explained.
 * Structured only: no wording for the merchant.
 */
export interface RelevantIntelligence {
  merchantId: string;
  bazaarId: string;
  city: string;
  category: MerchantCategory;
  period: ComparisonPeriod;
  cohort: CohortSummary;
  cohortConfidence: CohortConfidence;
  /** Highest priority among `prioritySignals`, or null when nothing is relevant. */
  topPriority: Priority | null;
  /** High and medium signals, strongest first, at most `MAX_PRIORITY_SIGNALS`. */
  prioritySignals: RelevanceSignal[];
  /** Low signals: useful background, not worth leading with. */
  backgroundSignals: RelevanceSignal[];
  /** The M2M patterns behind `prioritySignals`, in the same order. */
  relevantPatterns: Pattern[];
  relevantOpportunities: RelevantOpportunity[];
  dismissed: DismissedSignal[];
  /** Passed through from M2M. */
  limitations: DataLimitation[];
}
