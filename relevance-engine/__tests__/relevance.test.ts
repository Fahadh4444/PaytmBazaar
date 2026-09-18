import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeMerchant } from "@/m2m-engine";
import { CURRENT, fakeDataSource } from "@/m2m-engine/__tests__/fixtures";
import {
  analyzeRelevance,
  PRIORITY_SCORE,
  type RelevanceSignal,
  type RelevantIntelligence,
} from "@/relevance-engine";

import { intelligence, segment, type Scenario } from "./fixtures";

const relevance = (s: Scenario) => analyzeRelevance(intelligence(s));
const signal = (r: RelevantIntelligence, id: string): RelevanceSignal | undefined =>
  [...r.prioritySignals, ...r.backgroundSignals].find((s) => s.id === id);
const ids = (signals: RelevanceSignal[]) => signals.map((s) => s.id);

// Merchant -29.5% while its cohort grows +17.6% (the live PBZKOR006 case).
const DIVERGING: Scenario = { merchant: -29.5, cohort: 17.6, bazaar: 7.7, city: 2.8 };

describe("merchant vs cohort divergence", () => {
  it("1. strong decline against a growing cohort is high relevance and leads", () => {
    const r = relevance(DIVERGING);
    const cohort = r.prioritySignals[0];
    assert.equal(cohort.id, "cohort_gap");
    assert.equal(cohort.priority, "high");
    assert.equal(cohort.score, 100);
    assert.equal(cohort.direction, "behind");
    assert.equal(cohort.magnitudePp, -47.1);
    assert.deepEqual(cohort.patterns, ["MERCHANT_DOWN_NETWORK_UP"]);
    assert.ok(cohort.reasons.includes("PRIMARY_COHORT"));
    assert.equal(r.topPriority, "high");
  });

  it("2. strong growth against a declining cohort is high relevance", () => {
    const r = relevance({ merchant: 20, cohort: -12, bazaar: -5, city: 1 });
    const cohort = signal(r, "cohort_gap")!;
    assert.equal(cohort.priority, "high");
    assert.equal(cohort.direction, "ahead");
    assert.deepEqual(cohort.patterns, ["MERCHANT_UP_NETWORK_DOWN"]);
  });

  it("3. moving with the network ranks below a strong divergence", () => {
    const aligned = relevance({ merchant: 9, cohort: 12.7, bazaar: 8.1, city: 2.8 });
    const diverging = relevance(DIVERGING);
    assert.deepEqual(aligned.dismissed.find((d) => d.kind === "COHORT_GAP"), {
      kind: "COHORT_GAP",
      reason: "BELOW_NOISE_FLOOR",
    });
    const alignment = signal(aligned, "alignment")!;
    assert.equal(alignment.priority, "low");
    assert.ok(aligned.backgroundSignals.includes(alignment));
    assert.ok(alignment.score < diverging.prioritySignals[0].score);
  });

  it("4. a small gap (-2% vs +1%) is not relevant", () => {
    const r = relevance({ merchant: -2, cohort: 1, bazaar: 0.5, city: 0 });
    assert.deepEqual(r.prioritySignals, []);
    assert.equal(r.topPriority, null);
    assert.ok(r.dismissed.some((d) => d.kind === "COHORT_GAP" && d.reason === "BELOW_NOISE_FLOOR"));
    assert.ok(r.backgroundSignals.every((s) => s.priority === "low"));
  });
});

describe("Bazaar and network movement", () => {
  it("5. strong Bazaar movement around the merchant is relevant", () => {
    const r = relevance({ merchant: 3, cohort: 5, bazaar: 22, city: 4 });
    const bazaarGap = signal(r, "bazaar_gap")!;
    const market = signal(r, "market_movement")!;
    assert.equal(bazaarGap.direction, "behind");
    assert.ok(bazaarGap.reasons.includes("NOT_CONFIRMED_BY_PATTERN"));
    assert.equal(market.direction, "up");
    for (const s of [bazaarGap, market]) {
      assert.equal(s.priority, "medium");
      assert.ok(r.prioritySignals.includes(s));
    }
  });

  it("6. network-wide decline is relevant but below a merchant-specific divergence", () => {
    const r = relevance({ merchant: -15, cohort: -18.5, bazaar: -20, city: 1, bazaarDemand: -12 });
    const market = signal(r, "market_movement")!;
    assert.deepEqual(market.patterns, ["NETWORK_WIDE_DECLINE"]);
    assert.equal(market.direction, "down");
    assert.equal(market.priority, "medium");
    assert.ok(market.reasons.includes("DEMAND_TREND_AGREES"));
    assert.ok(market.score < relevance(DIVERGING).prioritySignals[0].score);
    // The merchant's own decline matches its peers: that is background, not a lead.
    assert.equal(signal(r, "alignment")?.priority, "low");
  });

  it("caps city-level divergence at low relevance", () => {
    const city = signal(relevance(DIVERGING), "city_gap")!;
    assert.equal(city.priority, "low");
    assert.ok(city.reasons.includes("CITY_LEVEL_LOW_SPECIFICITY"));
  });
});

describe("context", () => {
  const strongContext: Scenario = {
    merchant: -10,
    cohort: 12.8,
    bazaar: 5,
    city: 2.8,
    segments: [segment("timeOfDay", "evening", -30, 35, 100)],
  };

  it("7. a context gap backed by plenty of transactions is relevant, as an association", () => {
    const r = relevance(strongContext);
    const evening = signal(r, "context:timeOfDay:evening")!;
    assert.equal(evening.priority, "medium");
    assert.ok(r.prioritySignals.includes(evening));
    assert.deepEqual(evening.reasons.slice(0, 4), [
      "CONTEXT_SEGMENT_GAP",
      "CONCENTRATED_IN_SEGMENT",
      "FULL_SEGMENT_SUPPORT",
      "ASSOCIATION_NOT_CAUSE",
    ]);
    assert.equal(evening.evidence.context?.segment, "evening");
  });

  it("8. a thinly supported context gap is not treated as important", () => {
    const r = relevance({ ...strongContext, segments: [segment("weather", "rain", -30, 35, 22)] });
    const rain = signal(r, "context:weather:rain")!;
    assert.equal(rain.priority, "low");
    assert.ok(rain.reasons.includes("LIMITED_SEGMENT_SUPPORT"));
    assert.ok(!r.prioritySignals.includes(rain));
  });

  it("8b. a segment that only mirrors the overall gap is dismissed", () => {
    // Overall the merchant trails its cohort by 22.8 points; rain trails by 12.
    const r = relevance({ ...strongContext, segments: [segment("weather", "rain", -3, 9, 100)] });
    assert.equal(signal(r, "context:weather:rain"), undefined);
    assert.ok(r.dismissed.some((d) => d.kind === "CONTEXT" && d.reason === "MIRRORS_OVERALL_GAP"));
  });

  it("never lets a context signal reach high priority", () => {
    const r = relevance({ ...strongContext, segments: [segment("event", "festival", -60, 60, 500)] });
    assert.notEqual(signal(r, "context:event:festival")!.priority, "high");
  });
});

describe("opportunities and ranking", () => {
  it("9. an opportunity resting on a strong pattern keeps high priority", () => {
    const [top] = relevance(DIVERGING).relevantOpportunities;
    assert.equal(top.opportunity.type, "CLOSE_NETWORK_GAP");
    assert.equal(top.priority, "high");
    assert.equal(top.score, 100);
    assert.deepEqual(top.signalIds.sort(), ["bazaar_gap", "cohort_gap"]);
  });

  it("never raises an opportunity above the priority M2M gave it", () => {
    const r = relevance({ merchant: 20, cohort: -12, bazaar: -5, city: 1 });
    const sustain = r.relevantOpportunities.find((o) => o.opportunity.type === "SUSTAIN_OUTPERFORMANCE")!;
    assert.equal(sustain.opportunity.priority, "low");
    assert.equal(sustain.priority, "low");
    assert.ok(sustain.score >= PRIORITY_SCORE.high, "the signal is strong; the cap is M2M's call");
  });

  it("10. ranks several signals strongest first and explains each score", () => {
    const r = relevance({
      merchant: -10,
      cohort: 12.8,
      bazaar: 5,
      city: 2.8,
      segments: [segment("timeOfDay", "evening", -30, 35, 100)],
    });
    assert.deepEqual(ids(r.prioritySignals), ["cohort_gap", "context:timeOfDay:evening", "bazaar_gap"]);
    const scores = [...r.prioritySignals, ...r.backgroundSignals].map((s) => s.score);
    assert.deepEqual(scores.slice(0, 3), [...scores.slice(0, 3)].sort((a, b) => b - a));
    for (const s of r.prioritySignals) {
      const f = s.factors;
      const expected = Math.min(100, Math.round(100 * f.magnitude * f.specificity * f.confidence * f.patternSupport) + f.opportunityBonus);
      assert.equal(s.score, expected, `${s.id} score is reproducible from its factors`);
    }
    assert.deepEqual(
      r.relevantPatterns.map((p) => p.type),
      ["MERCHANT_DOWN_NETWORK_UP", "CONTEXT_NETWORK_GROWTH", "MERCHANT_DOWN_BAZAAR_UP"],
    );
  });

  it("13. no opportunities is a valid result", () => {
    const r = relevance({ merchant: 9, cohort: 12.7, bazaar: 8.1, city: 2.8 });
    assert.deepEqual(r.relevantOpportunities, []);
  });
});

describe("cohort quality", () => {
  it("11. a fallback cohort lowers confidence and can lower priority", () => {
    const moderate: Scenario = { merchant: -6, cohort: 14, bazaar: 4, city: 2 };
    const primary = signal(relevance(moderate), "cohort_gap")!;
    const fallbackResult = relevance({ ...moderate, basis: "city_category" });
    const fallback = signal(fallbackResult, "cohort_gap")!;

    assert.equal(fallbackResult.cohortConfidence, "fallback");
    assert.equal(fallback.factors.confidence, 0.75);
    assert.ok(fallback.reasons.includes("FALLBACK_COHORT_REDUCED_CONFIDENCE"));
    assert.ok(fallback.score < primary.score);
    assert.equal(primary.priority, "high");
    assert.equal(fallback.priority, "medium");
  });

  it("12. an insufficient cohort produces no peer intelligence", () => {
    const r = relevance({ ...DIVERGING, cohortReportable: false, basis: "city_category", segments: [segment("timeOfDay", "evening", -30, 35, 100)] });
    assert.equal(r.cohortConfidence, "none");
    assert.deepEqual(r.dismissed.find((d) => d.kind === "COHORT_GAP"), { kind: "COHORT_GAP", reason: "GROUP_NOT_REPORTABLE" });
    const all = [...r.prioritySignals, ...r.backgroundSignals];
    assert.ok(!all.some((s) => s.kind === "COHORT_GAP" || s.kind === "CONTEXT" || s.kind === "ALIGNMENT"));
    assert.ok(r.limitations.includes("COHORT_TOO_SMALL"));
    // The Bazaar comparison is still real and still used.
    assert.equal(r.prioritySignals[0].id, "bazaar_gap");
  });
});

describe("edge cases", () => {
  it("14. minimal intelligence (no growth anywhere) is handled gracefully", () => {
    const r = relevance({ merchant: null, cohortReportable: false, bazaarReportable: false });
    assert.deepEqual(r.prioritySignals, []);
    assert.deepEqual(r.backgroundSignals, []);
    assert.deepEqual(r.relevantPatterns, []);
    assert.deepEqual(r.relevantOpportunities, []);
    assert.equal(r.topPriority, null);
    assert.deepEqual(
      r.dismissed.map((d) => `${d.kind}:${d.reason}`),
      ["COHORT_GAP:GROUP_NOT_REPORTABLE", "BAZAAR_GAP:GROUP_NOT_REPORTABLE", "CITY_GAP:GROWTH_UNAVAILABLE", "MARKET_MOVEMENT:GROUP_NOT_REPORTABLE"],
    );
  });

  it("is deterministic and does not modify its input", () => {
    const input = intelligence(DIVERGING);
    const before = JSON.stringify(input);
    assert.deepEqual(analyzeRelevance(input), analyzeRelevance(input));
    assert.equal(JSON.stringify(input), before);
  });

  it("limits leading signals to MAX_PRIORITY_SIGNALS", () => {
    const r = relevance({
      ...DIVERGING,
      segments: [
        segment("timeOfDay", "evening", -40, 40, 100),
        segment("weather", "rain", -40, 40, 100),
        segment("event", "festival", -40, 40, 100),
      ],
    });
    assert.ok(r.prioritySignals.length <= 5);
  });
});

describe("privacy", () => {
  it("15. output built from real M2M output carries no peer identities or figures", async () => {
    const m2m = await analyzeMerchant(fakeDataSource(), { merchantId: "TARGET", current: CURRENT });
    const r = analyzeRelevance(m2m);
    const json = JSON.stringify(r);

    assert.ok(r.prioritySignals.length > 0);
    for (const leak of ["PEER-", "MYS-", "CAFE-0", "KIRANA-0", "Name of", "@example.com", "+9190000", "cohortMerchantIds"]) {
      assert.ok(!json.includes(leak), `output contains ${leak}`);
    }
    // Only the cohort's shape is passed on, never its members.
    assert.deepEqual(Object.keys(r.cohort).sort(), ["basis", "category", "reportable", "size"]);
  });
});
