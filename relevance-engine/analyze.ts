/**
 * The Relevance Engine pipeline:
 *
 *   M2MIntelligence → extract signals → link opportunities → score → rank
 *     → RelevantIntelligence
 *
 * Deterministic and pure: it reads nothing but its argument.
 */

import type { M2MIntelligence, Opportunity, Priority } from "@/m2m-engine";

import { MAX_PRIORITY_SIGNALS, OPPORTUNITY_BONUS } from "./config";
import { contextSignalId, extractSignals, PATTERN_SIGNAL, priorityOf, scoreOf } from "./signals";
import type {
  CohortConfidence,
  RelevanceSignal,
  RelevantIntelligence,
  RelevantOpportunity,
  SignalKind,
} from "./types";

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Tie-break order: more merchant-specific kinds first. */
const KIND_RANK: Record<SignalKind, number> = {
  COHORT_GAP: 0,
  BAZAAR_GAP: 1,
  CONTEXT: 2,
  MARKET_MOVEMENT: 3,
  CITY_GAP: 4,
  ALIGNMENT: 5,
};

export function rankSignals(signals: RelevanceSignal[]): RelevanceSignal[] {
  return [...signals].sort(
    (a, b) => b.score - a.score || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id.localeCompare(b.id),
  );
}

/**
 * IDs of the signals an opportunity rests on: those its patterns confirm, or
 * for a context opportunity its segment. A gap-based `CLOSE_NETWORK_GAP`
 * without patterns rests on whichever group M2M used as "the network".
 */
export function linkedSignalIds(opportunity: Opportunity, m2m: M2MIntelligence): string[] {
  if (opportunity.type === "CAPTURE_CONTEXT_DEMAND") return [contextSignalId(opportunity.evidence)];
  const ids = opportunity.patterns
    .filter((type) => type !== "CONTEXT_NETWORK_GROWTH")
    .map((type) => PATTERN_SIGNAL[type as keyof typeof PATTERN_SIGNAL]);
  if (ids.length === 0 && opportunity.type === "CLOSE_NETWORK_GAP") {
    ids.push(m2m.bazaarImpact.networkBasis === "cohort" ? "cohort_gap" : "bazaar_gap");
  }
  return [...new Set(ids)];
}

const lower = (a: Priority, b: Priority): Priority => (PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b);

function cohortConfidence(m2m: M2MIntelligence): CohortConfidence {
  if (!m2m.cohort.reportable) return "none";
  return m2m.cohort.basis === "bazaar_category" ? "primary" : "fallback";
}

export function analyzeRelevance(m2m: M2MIntelligence): RelevantIntelligence {
  const { signals, dismissed } = extractSignals(m2m);
  const selected = m2m.contextImpact;
  if (selected?.status === "meaningful_change" && selected.strongestDimension) {
    const strongest = selected.evidence.find((e) => e.dimension === selected.strongestDimension);
    const match = strongest && signals.find((s) => s.id === `context:${strongest.dimension}:${strongest.segment}`);
    if (match) {
      // The evidence and magnitude are unchanged; user-selected relevance only
      // breaks ranking ties and can raise visibility by one small, explicit step.
      match.score = Math.min(100, match.score + 10);
      match.priority = priorityOf(match.score);
      match.reasons.push("MATCHES_SELECTED_CONTEXT");
    }
  }
  const byId = new Map(signals.map((s) => [s.id, s]));

  // Link each opportunity to the signals it rests on, and credit those signals.
  const links = m2m.opportunities.map((opportunity) => ({
    opportunity,
    ids: linkedSignalIds(opportunity, m2m).filter((id) => byId.has(id)),
  }));
  for (const { opportunity, ids } of links) {
    for (const id of ids) {
      const signal = byId.get(id)!;
      if (!signal.opportunities.includes(opportunity.type)) signal.opportunities.push(opportunity.type);
    }
  }
  for (const signal of signals) {
    if (signal.opportunities.length === 0 || signal.kind === "ALIGNMENT") continue;
    signal.factors.opportunityBonus = OPPORTUNITY_BONUS;
    signal.score = scoreOf(signal.factors);
    signal.priority = priorityOf(signal.score);
    signal.reasons.push("LINKED_TO_OPPORTUNITY");
  }

  const ranked = rankSignals(signals);
  const prioritySignals = ranked.filter((s) => s.priority !== "low").slice(0, MAX_PRIORITY_SIGNALS);
  const leading = new Set(prioritySignals.map((s) => s.id));
  const backgroundSignals = ranked.filter((s) => !leading.has(s.id));

  // M2M patterns behind the leading signals, in the same order.
  const relevantPatterns = prioritySignals.flatMap((signal) =>
    m2m.patterns.filter((p) =>
      p.type === "CONTEXT_NETWORK_GROWTH"
        ? signal.kind === "CONTEXT" && contextSignalId(p.evidence) === signal.id
        : signal.patterns.includes(p.type),
    ),
  );

  const relevantOpportunities: RelevantOpportunity[] = links
    .map(({ opportunity, ids }) => {
      const score = Math.max(0, ...ids.map((id) => byId.get(id)!.score));
      return {
        opportunity,
        score,
        // Relevance can lower M2M's priority but never raise it.
        priority: lower(priorityOf(score), opportunity.priority),
        signalIds: ids,
      };
    })
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.score - a.score);

  return {
    merchantId: m2m.merchantId,
    bazaarId: m2m.bazaarId,
    city: m2m.city,
    category: m2m.category,
    period: m2m.period,
    cohort: m2m.cohort,
    cohortConfidence: cohortConfidence(m2m),
    topPriority: prioritySignals[0]?.priority ?? null,
    prioritySignals,
    backgroundSignals,
    relevantPatterns,
    relevantOpportunities,
    dismissed,
    limitations: m2m.limitations,
    contextImpact: m2m.contextImpact,
  };
}
