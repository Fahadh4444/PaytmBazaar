/**
 * Opportunity Detection: turns patterns and Bazaar Impact into structured
 * opportunities. It says where the merchant stands against the network, not
 * what to do about it; recommendations come later, from the LLM layer.
 */

import { M2M_THRESHOLDS } from "./config";
import type {
  BazaarImpact,
  Evidence,
  Opportunity,
  OpportunityType,
  Pattern,
  PatternType,
  Priority,
} from "./types";

const TITLES: Record<OpportunityType, string> = {
  CLOSE_NETWORK_GAP: "Behind a growing network",
  CAPTURE_CONTEXT_DEMAND: "Network demand growing in a specific context",
  SUSTAIN_OUTPERFORMANCE: "Ahead of a declining network",
};

export function priorityForGap(gap: number): Priority {
  const size = Math.abs(gap);
  if (size >= M2M_THRESHOLDS.highPriorityGapPp) return "high";
  if (size >= M2M_THRESHOLDS.mediumPriorityGapPp) return "medium";
  return "low";
}

const RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function detectOpportunities(input: {
  patterns: Pattern[];
  impact: BazaarImpact;
  evidence: Evidence;
}): Opportunity[] {
  const { patterns, impact, evidence } = input;
  const found = (types: PatternType[]) => patterns.filter((p) => types.includes(p.type)).map((p) => p.type);
  const opportunities: Opportunity[] = [];

  // Behind the network: it is growing (or holding) while the merchant trails it.
  const behind = found(["MERCHANT_DOWN_NETWORK_UP", "MERCHANT_DOWN_BAZAAR_UP"]);
  const gap = impact.merchantVsNetworkGap;
  const wideGap =
    gap !== null &&
    gap <= -M2M_THRESHOLDS.opportunityGapPp &&
    (impact.networkDirection === "up" || impact.networkDirection === "flat");
  if (behind.length > 0 || wideGap) {
    opportunities.push({
      type: "CLOSE_NETWORK_GAP",
      title: TITLES.CLOSE_NETWORK_GAP,
      reason: "MERCHANT_BEHIND_GROWING_NETWORK",
      priority: priorityForGap(gap ?? 0),
      patterns: behind,
      evidence,
    });
  }

  // Only the strongest context finding (patterns arrive strongest first). A
  // segment is a smaller sample than the whole period, so it caps at medium.
  const context = patterns.find((p) => p.type === "CONTEXT_NETWORK_GROWTH");
  if (context) {
    const ctx = context.evidence.context!;
    const priority = priorityForGap((ctx.merchantChange ?? 0) - (ctx.cohortChange ?? 0));
    opportunities.push({
      type: "CAPTURE_CONTEXT_DEMAND",
      title: TITLES.CAPTURE_CONTEXT_DEMAND,
      reason: "MERCHANT_BEHIND_NETWORK_IN_CONTEXT",
      priority: priority === "high" ? "medium" : priority,
      patterns: [context.type],
      evidence: context.evidence,
    });
  }

  // Doing well against a falling network is worth holding on to, but rarely urgent.
  const ahead = found(["MERCHANT_UP_NETWORK_DOWN", "MERCHANT_UP_BAZAAR_DOWN"]);
  if (ahead.length > 0) {
    opportunities.push({
      type: "SUSTAIN_OUTPERFORMANCE",
      title: TITLES.SUSTAIN_OUTPERFORMANCE,
      reason: "MERCHANT_AHEAD_OF_DECLINING_NETWORK",
      priority: "low",
      patterns: ahead,
      evidence,
    });
  }

  return opportunities.sort((a, b) => RANK[a.priority] - RANK[b.priority]);
}
