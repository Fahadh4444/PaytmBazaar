/**
 * Pattern Detection: deterministic rules over comparisons and context.
 *
 * A pattern states that things moved together. It never states a cause.
 * Each rule is independent; to add one, append it to RULES.
 */

import { M2M_THRESHOLDS } from "./config";
import { direction, findComparison } from "./comparison";
import { withContext } from "./evidence";
import type {
  Comparison,
  ContextAnalysis,
  ContextSegmentAnalysis,
  Evidence,
  Pattern,
  PatternType,
} from "./types";

export interface PatternInput {
  comparisons: Comparison[];
  context: ContextAnalysis;
  evidence: Evidence;
}

const segmentGap = (s: ContextSegmentAnalysis) => (s.cohort?.growth ?? 0) - (s.merchant.growth ?? 0);

type Rule = (input: PatternInput) => Pattern[];

/** Merchant moved `merchant` while an available group moved `group`. */
function opposing(type: PatternType, against: "cohort" | "bazaar", merchant: "up" | "down"): Rule {
  const group = merchant === "up" ? "down" : "up";
  return ({ comparisons, evidence }) => {
    const c = findComparison(comparisons, against);
    return c.available && c.merchantDirection === merchant && c.groupDirection === group
      ? [{ type, evidence }]
      : [];
  };
}

function networkWide(type: PatternType, dir: "up" | "down"): Rule {
  return ({ comparisons, evidence }) => {
    const cohort = findComparison(comparisons, "cohort");
    const bazaar = findComparison(comparisons, "bazaar");
    return cohort.available &&
      bazaar.available &&
      cohort.merchantDirection === dir &&
      cohort.groupDirection === dir &&
      bazaar.groupDirection === dir
      ? [{ type, evidence }]
      : [];
  };
}

const alignsWithNetwork: Rule = ({ comparisons, evidence }) => {
  const c = findComparison(comparisons, "cohort");
  return c.available &&
    c.merchantDirection !== "unknown" &&
    c.merchantDirection === c.groupDirection &&
    c.growthGap !== null &&
    Math.abs(c.growthGap) <= M2M_THRESHOLDS.alignmentTolerancePp
    ? [{ type: "MERCHANT_ALIGNS_WITH_NETWORK", evidence }]
    : [];
};

/**
 * In a context segment (e.g. evenings), the cohort grew while the merchant
 * fell by a clear margin, on enough of the merchant's own transactions to be
 * more than noise. EVENING_NETWORK_GROWTH is this pattern with segment
 * `evening`. Strongest first.
 */
const contextNetworkGrowth: Rule = ({ context, evidence }) => {
  const t = M2M_THRESHOLDS;
  const weekdaysComparable = evidence.observationWindow.days >= t.minDaysForDayOfWeekPatterns;
  return context.segments
    .filter(
      (s) =>
        s.segment !== "none" &&
        (s.dimension !== "dayOfWeek" || weekdaysComparable) &&
        s.cohort !== null &&
        s.merchant.previousTransactions >= t.minSegmentTransactions &&
        s.merchant.currentTransactions >= t.minSegmentTransactions &&
        direction(s.cohort.growth) === "up" &&
        direction(s.merchant.growth) === "down" &&
        segmentGap(s) >= t.opportunityGapPp,
    )
    .sort((a, b) => segmentGap(b) - segmentGap(a))
    .slice(0, t.maxContextPatterns)
    .map((segment) => ({ type: "CONTEXT_NETWORK_GROWTH", evidence: withContext(evidence, segment) }));
};

const RULES: Rule[] = [
  opposing("MERCHANT_DOWN_NETWORK_UP", "cohort", "down"),
  opposing("MERCHANT_UP_NETWORK_DOWN", "cohort", "up"),
  opposing("MERCHANT_DOWN_BAZAAR_UP", "bazaar", "down"),
  opposing("MERCHANT_UP_BAZAAR_DOWN", "bazaar", "up"),
  networkWide("NETWORK_WIDE_GROWTH", "up"),
  networkWide("NETWORK_WIDE_DECLINE", "down"),
  alignsWithNetwork,
  contextNetworkGrowth,
];

export function detectPatterns(input: PatternInput): Pattern[] {
  return RULES.flatMap((rule) => rule(input));
}
