/**
 * Every weight and threshold of the Relevance Engine. Thresholds are expressed
 * in terms of M2M's own (`M2M_THRESHOLDS`) so the two layers cannot disagree
 * about what counts as flat, aligned, or a large gap.
 */

import { M2M_THRESHOLDS } from "@/m2m-engine";

import type { SignalKind } from "./types";

/**
 * A gap of this many points scores full magnitude (1.0). It is M2M's
 * high-priority gap: past it, M2M already calls the gap as large as it gets.
 */
export const FULL_MAGNITUDE_PP = M2M_THRESHOLDS.highPriorityGapPp;

/**
 * Gaps and movements smaller than this are noise. It is M2M's alignment
 * tolerance, the widest gap M2M still calls "moving together".
 */
export const NOISE_FLOOR_PP = M2M_THRESHOLDS.alignmentTolerancePp;

/**
 * How specific each kind of signal is to this merchant. The cap on a kind's
 * score is 100 × its specificity, which is what keeps broad signals from ever
 * outranking merchant-specific ones:
 *   COHORT_GAP      1.00  the merchant vs its closest peers
 *   BAZAAR_GAP      0.80  the merchant vs its whole Bazaar (mixed categories)
 *   MARKET_MOVEMENT 0.55  the Bazaar moving: context, never HIGH on its own
 *   CONTEXT         0.50  one slice of the week: a smaller sample, never HIGH
 *   CITY_GAP        0.25  the whole city: always LOW
 */
export const SPECIFICITY: Record<Exclude<SignalKind, "ALIGNMENT">, number> = {
  COHORT_GAP: 1.0,
  BAZAAR_GAP: 0.8,
  MARKET_MOVEMENT: 0.55,
  CONTEXT: 0.5,
  CITY_GAP: 0.25,
};

/** Confidence in a peer comparison against the city-wide fallback cohort, vs 1.0 for same-Bazaar peers. */
export const FALLBACK_COHORT_CONFIDENCE = 0.75;

/** Confidence in Bazaar movement when the Bazaar's transaction count moves the other way. */
export const DEMAND_DISAGREES_CONFIDENCE = 0.8;

/** Pattern support when no M2M pattern confirms a gap or movement (e.g. both grew, one much faster). */
export const UNCONFIRMED_PATTERN_SUPPORT = 0.8;

/**
 * Merchant transactions in a segment at which context support is full. M2M
 * already requires `minSegmentTransactions` (20) to report the pattern at all;
 * support grows linearly from there and is full at four times that.
 */
export const CONTEXT_FULL_SUPPORT_TRANSACTIONS = M2M_THRESHOLDS.minSegmentTransactions * 4;

/** Points added to a signal an M2M opportunity rests on. */
export const OPPORTUNITY_BONUS = 10;

/**
 * Fixed score for "moving with the network". Worth knowing (a decline shared
 * with peers is not a merchant-specific problem) but never a lead signal.
 */
export const ALIGNMENT_SCORE = 15;

/**
 * Priority bands. HIGH needs a merchant-specific gap near M2M's high-priority
 * gap: a primary cohort gap of 19pp or more, a Bazaar gap of about 24pp, or a
 * fallback cohort gap at the full 25pp. MEDIUM starts around M2M's 10pp
 * opportunity gap on a cohort comparison.
 */
export const PRIORITY_SCORE = { high: 75, medium: 30 } as const;

/** At most this many signals lead; the rest are background. */
export const MAX_PRIORITY_SIGNALS = 5;
