/**
 * Signal extraction and scoring: turns an `M2MIntelligence` into candidate
 * signals, each scored from values M2M already computed. Nothing here
 * recalculates metrics, growth, gaps or patterns.
 *
 * Each M2M pattern belongs to exactly one signal (see PATTERN_SIGNAL), so a
 * finding is never counted twice.
 *
 * Pure functions: no I/O.
 */

import { direction } from "@/m2m-engine";
import type {
  Comparison,
  Evidence,
  M2MIntelligence,
  Pattern,
  PatternType,
  Priority,
} from "@/m2m-engine";

import {
  ALIGNMENT_SCORE,
  CONTEXT_FULL_SUPPORT_TRANSACTIONS,
  DEMAND_DISAGREES_CONFIDENCE,
  FALLBACK_COHORT_CONFIDENCE,
  FULL_MAGNITUDE_PP,
  NOISE_FLOOR_PP,
  PRIORITY_SCORE,
  SPECIFICITY,
  UNCONFIRMED_PATTERN_SUPPORT,
} from "./config";
import type {
  DismissedSignal,
  RelevanceReason,
  RelevanceSignal,
  ScoreFactors,
  SignalKind,
} from "./types";

/** Which signal each M2M pattern confirms. Context patterns map per segment. */
export const PATTERN_SIGNAL: Record<Exclude<PatternType, "CONTEXT_NETWORK_GROWTH">, string> = {
  MERCHANT_DOWN_NETWORK_UP: "cohort_gap",
  MERCHANT_UP_NETWORK_DOWN: "cohort_gap",
  MERCHANT_DOWN_BAZAAR_UP: "bazaar_gap",
  MERCHANT_UP_BAZAAR_DOWN: "bazaar_gap",
  NETWORK_WIDE_GROWTH: "market_movement",
  NETWORK_WIDE_DECLINE: "market_movement",
  MERCHANT_ALIGNS_WITH_NETWORK: "alignment",
};

export function contextSignalId(evidence: Evidence): string {
  return `context:${evidence.context?.dimension}:${evidence.context?.segment}`;
}

export function signalIdForPattern(pattern: Pattern): string {
  return pattern.type === "CONTEXT_NETWORK_GROWTH" ? contextSignalId(pattern.evidence) : PATTERN_SIGNAL[pattern.type];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function magnitudeOf(pp: number): number {
  return Math.min(Math.abs(pp) / FULL_MAGNITUDE_PP, 1);
}

export function scoreOf(f: ScoreFactors): number {
  const base = Math.round(100 * f.magnitude * f.specificity * f.confidence * f.patternSupport);
  return Math.min(100, base + f.opportunityBonus);
}

export function priorityOf(score: number): Priority {
  if (score >= PRIORITY_SCORE.high) return "high";
  if (score >= PRIORITY_SCORE.medium) return "medium";
  return "low";
}

function makeSignal(input: {
  id: string;
  kind: SignalKind;
  magnitudePp: number;
  direction: RelevanceSignal["direction"];
  factors: Omit<ScoreFactors, "opportunityBonus">;
  reasons: RelevanceReason[];
  patterns: PatternType[];
  evidence: Evidence;
}): RelevanceSignal {
  const factors: ScoreFactors = {
    magnitude: round2(input.factors.magnitude),
    specificity: input.factors.specificity,
    confidence: round2(input.factors.confidence),
    patternSupport: input.factors.patternSupport,
    opportunityBonus: 0,
  };
  const score = scoreOf(factors);
  return {
    id: input.id,
    kind: input.kind,
    priority: priorityOf(score),
    score,
    direction: input.direction,
    magnitudePp: input.magnitudePp,
    factors,
    reasons: input.reasons,
    patterns: input.patterns,
    opportunities: [],
    evidence: input.evidence,
  };
}

export interface Extraction {
  signals: RelevanceSignal[];
  dismissed: DismissedSignal[];
}

function patternsFor(m2m: M2MIntelligence, id: string): PatternType[] {
  return m2m.patterns.filter((p) => signalIdForPattern(p) === id).map((p) => p.type);
}

const GAP: Record<Comparison["against"], { kind: SignalKind; id: string; reason: RelevanceReason }> = {
  cohort: { kind: "COHORT_GAP", id: "cohort_gap", reason: "DIVERGES_FROM_COHORT" },
  bazaar: { kind: "BAZAAR_GAP", id: "bazaar_gap", reason: "DIVERGES_FROM_BAZAAR" },
  city: { kind: "CITY_GAP", id: "city_gap", reason: "DIVERGES_FROM_CITY" },
};

/** Merchant vs cohort, Bazaar or city, from M2M's comparison. */
export function gapSignal(m2m: M2MIntelligence, comparison: Comparison): RelevanceSignal | DismissedSignal {
  const { kind, id, reason } = GAP[comparison.against];
  if (!comparison.available) return { kind, reason: "GROUP_NOT_REPORTABLE" };
  if (comparison.growthGap === null) return { kind, reason: "GROWTH_UNAVAILABLE" };
  if (Math.abs(comparison.growthGap) < NOISE_FLOOR_PP) return { kind, reason: "BELOW_NOISE_FLOOR" };

  const patterns = patternsFor(m2m, id);
  const fallback = comparison.against === "cohort" && m2m.cohort.basis === "city_category";
  const reasons: RelevanceReason[] = [reason, patterns.length ? "CONFIRMED_BY_PATTERN" : "NOT_CONFIRMED_BY_PATTERN"];
  if (comparison.against === "cohort") reasons.push(fallback ? "FALLBACK_COHORT_REDUCED_CONFIDENCE" : "PRIMARY_COHORT");
  if (comparison.against === "city") reasons.push("CITY_LEVEL_LOW_SPECIFICITY");

  return makeSignal({
    id,
    kind,
    magnitudePp: comparison.growthGap,
    direction: comparison.growthGap < 0 ? "behind" : "ahead",
    factors: {
      magnitude: magnitudeOf(comparison.growthGap),
      specificity: SPECIFICITY[kind as keyof typeof SPECIFICITY],
      confidence: fallback ? FALLBACK_COHORT_CONFIDENCE : 1,
      patternSupport: patterns.length ? 1 : UNCONFIRMED_PATTERN_SUPPORT,
    },
    reasons,
    patterns,
    evidence: m2m.evidence,
  });
}

/** The merchant's Bazaar moving as a whole, from Bazaar Impact. */
export function marketSignal(m2m: M2MIntelligence): RelevanceSignal | DismissedSignal {
  const kind: SignalKind = "MARKET_MOVEMENT";
  const growth = m2m.bazaarImpact.bazaarGrowth;
  if (!m2m.bazaarMetrics.reportable) return { kind, reason: "GROUP_NOT_REPORTABLE" };
  if (growth === null) return { kind, reason: "GROWTH_UNAVAILABLE" };
  if (Math.abs(growth) < NOISE_FLOOR_PP) return { kind, reason: "BELOW_NOISE_FLOOR" };

  const bazaarDirection = direction(growth);
  const demandAgrees = m2m.bazaarImpact.demandTrend.direction === bazaarDirection;
  const patterns = patternsFor(m2m, "market_movement");
  return makeSignal({
    id: "market_movement",
    kind,
    magnitudePp: growth,
    direction: growth < 0 ? "down" : "up",
    factors: {
      magnitude: magnitudeOf(growth),
      specificity: SPECIFICITY.MARKET_MOVEMENT,
      confidence: demandAgrees ? 1 : DEMAND_DISAGREES_CONFIDENCE,
      patternSupport: patterns.length ? 1 : UNCONFIRMED_PATTERN_SUPPORT,
    },
    reasons: [
      "BAZAAR_MOVEMENT",
      demandAgrees ? "DEMAND_TREND_AGREES" : "DEMAND_TREND_DISAGREES",
      patterns.length ? "CONFIRMED_BY_PATTERN" : "NOT_CONFIRMED_BY_PATTERN",
    ],
    patterns,
    evidence: m2m.evidence,
  });
}

/**
 * One context segment M2M flagged. Two checks keep context conservative:
 *
 *  - Concentration: a merchant far behind its cohort overall is behind in
 *    every segment, so only the part of the segment gap beyond the overall
 *    cohort gap counts. A segment that merely mirrors the overall gap is
 *    dismissed as MIRRORS_OVERALL_GAP.
 *  - Support: M2M already requires a minimum sample; relevance further scales
 *    confidence by the merchant's own transactions in the segment.
 *
 * Always an association, never a cause.
 */
export function contextSignal(m2m: M2MIntelligence, pattern: Pattern): RelevanceSignal | DismissedSignal {
  const kind: SignalKind = "CONTEXT";
  const ctx = pattern.evidence.context;
  if (!ctx || ctx.merchantChange === null || ctx.cohortChange === null) return { kind, reason: "GROWTH_UNAVAILABLE" };
  const gap = Math.round((ctx.merchantChange - ctx.cohortChange) * 10) / 10;
  if (Math.abs(gap) < NOISE_FLOOR_PP) return { kind, reason: "BELOW_NOISE_FLOOR" };

  // How much wider the segment gap is than the overall cohort gap in the same direction.
  const overall = m2m.comparisons.find((c) => c.against === "cohort")?.growthGap ?? null;
  const excess =
    overall !== null && Math.sign(overall) === Math.sign(gap) ? Math.abs(gap) - Math.abs(overall) : Math.abs(gap);
  if (excess < NOISE_FLOOR_PP) return { kind, reason: "MIRRORS_OVERALL_GAP" };

  const support = Math.min(ctx.merchantTransactions / CONTEXT_FULL_SUPPORT_TRANSACTIONS, 1);
  const fallback = m2m.cohort.basis === "city_category";
  const reasons: RelevanceReason[] = [
    "CONTEXT_SEGMENT_GAP",
    "CONCENTRATED_IN_SEGMENT",
    support >= 1 ? "FULL_SEGMENT_SUPPORT" : "LIMITED_SEGMENT_SUPPORT",
    "ASSOCIATION_NOT_CAUSE",
  ];
  if (fallback) reasons.push("FALLBACK_COHORT_REDUCED_CONFIDENCE");

  return makeSignal({
    id: contextSignalId(pattern.evidence),
    kind,
    magnitudePp: gap,
    direction: gap < 0 ? "behind" : "ahead",
    factors: {
      magnitude: magnitudeOf(excess),
      specificity: SPECIFICITY.CONTEXT,
      confidence: support * (fallback ? FALLBACK_COHORT_CONFIDENCE : 1),
      patternSupport: 1,
    },
    reasons,
    patterns: [pattern.type],
    evidence: pattern.evidence,
  });
}

/** "Moving with the network": fixed low relevance, kept as background. */
export function alignmentSignal(m2m: M2MIntelligence): RelevanceSignal | null {
  if (!m2m.patterns.some((p) => p.type === "MERCHANT_ALIGNS_WITH_NETWORK")) return null;
  const cohort = m2m.comparisons.find((c) => c.against === "cohort");
  return {
    id: "alignment",
    kind: "ALIGNMENT",
    priority: priorityOf(ALIGNMENT_SCORE),
    score: ALIGNMENT_SCORE,
    direction: "aligned",
    magnitudePp: cohort?.growthGap ?? 0,
    factors: { magnitude: 0, specificity: 0, confidence: 1, patternSupport: 1, opportunityBonus: 0 },
    reasons: ["MOVES_WITH_NETWORK", "CONFIRMED_BY_PATTERN"],
    patterns: ["MERCHANT_ALIGNS_WITH_NETWORK"],
    opportunities: [],
    evidence: m2m.evidence,
  };
}

const isSignal = (value: RelevanceSignal | DismissedSignal): value is RelevanceSignal => "score" in value;

export function extractSignals(m2m: M2MIntelligence): Extraction {
  const candidates: (RelevanceSignal | DismissedSignal)[] = [
    ...m2m.comparisons.map((c) => gapSignal(m2m, c)),
    marketSignal(m2m),
    ...m2m.patterns.filter((p) => p.type === "CONTEXT_NETWORK_GROWTH").map((p) => contextSignal(m2m, p)),
  ];
  const alignment = alignmentSignal(m2m);
  if (alignment) candidates.push(alignment);

  return {
    signals: candidates.filter(isSignal),
    dismissed: candidates.filter((c): c is DismissedSignal => !isSignal(c)),
  };
}

