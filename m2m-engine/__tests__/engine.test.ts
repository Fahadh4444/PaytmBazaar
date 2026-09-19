import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  analyzeContext,
  analyzeMerchant,
  calculateBazaarMetrics,
  calculateCityMetrics,
  calculateCohortMetrics,
  calculateMerchantMetrics,
  compare,
  compareWithNetwork,
  comparisonPeriod,
  detectPatterns,
  getRelevantCohort,
  growthPercent,
  M2MInputError,
  selectedContextImpact,
  type ComparisonPeriod,
  type Evidence,
  type GroupMetrics,
  type MerchantMetrics,
} from "@/m2m-engine";
import { calculateGroupMetrics } from "@/m2m-engine/groups";

import { CURRENT, PREVIOUS, bazaars, dailyMetrics, events, fakeDataSource, merchants } from "./fixtures";

const period: ComparisonPeriod = comparisonPeriod(CURRENT);
const network = { bazaars, merchants };
const byId = (mid: string) => merchants.find((m) => m.mid === mid)!;
const analyze = (merchantId: string) => analyzeMerchant(fakeDataSource(), { merchantId, current: CURRENT });

describe("period", () => {
  it("derives the previous equivalent period", () => {
    assert.deepEqual(period, { current: CURRENT, previous: PREVIOUS, days: 7 });
  });

  it("rejects reversed, unequal and overlapping periods", () => {
    assert.throws(() => comparisonPeriod({ from: "2026-09-16", to: "2026-09-10" }), M2MInputError);
    assert.throws(() => comparisonPeriod(CURRENT, { from: "2026-09-01", to: "2026-09-09" }), M2MInputError);
    assert.throws(() => comparisonPeriod(CURRENT, { from: "2026-09-08", to: "2026-09-14" }), M2MInputError);
    assert.throws(() => comparisonPeriod({ from: "2026-02-30", to: "2026-03-01" }), M2MInputError);
  });
});

describe("merchant metrics", () => {
  const target = calculateMerchantMetrics("TARGET", dailyMetrics, period);

  it("GMV sums successful gross sales in each period only", () => {
    assert.equal(target.current.gmv, 8_200);
    assert.equal(target.previous.gmv, 10_000);
  });

  it("transactions count successful transactions", () => {
    assert.equal(target.current.transactions, 41);
    assert.equal(target.previous.transactions, 50);
  });

  it("AOV is GMV / transactions", () => {
    assert.equal(target.current.aov, 200);
    assert.equal(target.previous.aov, 200);
  });

  it("growth is GMV growth against the previous period", () => {
    assert.equal(target.current.growth, -18);
    assert.equal(growthPercent(11_400, 10_000), 14);
  });

  it("refunds sum refunded amounts", () => {
    assert.equal(target.current.refunds, 300);
    assert.equal(target.previous.refunds, 0);
  });

  it("zero transactions give null AOV and null growth, not NaN", () => {
    const idle = calculateMerchantMetrics("KIRANA-0", dailyMetrics, period);
    assert.deepEqual(idle.current, { gmv: 0, transactions: 0, aov: null, refunds: 0, growth: null });
    assert.deepEqual(idle.previous, { gmv: 0, transactions: 0, aov: null, refunds: 0 });
  });

  it("zero previous-period GMV gives null growth", () => {
    const fresh = calculateMerchantMetrics("CAFE-0", dailyMetrics, period);
    assert.equal(fresh.current.gmv, 500);
    assert.equal(fresh.current.aov, 100);
    assert.equal(fresh.current.growth, null);
    assert.equal(growthPercent(0, 0), null);
  });
});

describe("cohort formation", () => {
  it("uses same Bazaar + same category, excluding the merchant", () => {
    const cohort = getRelevantCohort(byId("TARGET"), network);
    assert.equal(cohort.basis, "bazaar_category");
    assert.deepEqual(cohort.cohortMerchantIds, ["PEER-R1", "PEER-R2", "PEER-R3", "PEER-R4", "PEER-R5"]);
    assert.equal(cohort.cohortSize, 5);
    assert.equal(cohort.reportable, true);
  });

  it("falls back to same category across the city when the Bazaar has too few peers", () => {
    const cohort = getRelevantCohort(byId("CAFE-0"), network);
    assert.equal(cohort.basis, "city_category");
    assert.deepEqual(cohort.cohortMerchantIds, ["PEER-C1", "PEER-C2", "PEER-C3", "PEER-C4", "PEER-C5"]);
  });

  it("marks a cohort that is still too small as not reportable", () => {
    const cohort = getRelevantCohort(byId("KIRANA-0"), network);
    assert.deepEqual(cohort.cohortMerchantIds, ["PEER-K1"]);
    assert.equal(cohort.reportable, false);
  });
});

describe("group metrics", () => {
  it("cohort metrics aggregate the peers (AOV = cohort GMV / cohort transactions)", () => {
    const cohort = calculateCohortMetrics(getRelevantCohort(byId("TARGET"), network), dailyMetrics, period);
    assert.equal(cohort.reportable, true);
    assert.deepEqual(cohort.current, { gmv: 57_000, transactions: 550, aov: 103.64, refunds: 0, growth: 14 });
    assert.deepEqual(cohort.previous, { gmv: 50_000, transactions: 500, aov: 100, refunds: 0 });
  });

  it("Bazaar metrics cover every merchant in the Bazaar", () => {
    const bazaar = calculateBazaarMetrics(byId("TARGET"), network, dailyMetrics, period);
    assert.equal(bazaar.merchantCount, 8);
    assert.equal(bazaar.current?.gmv, 65_700);
    assert.equal(bazaar.current?.transactions, 596);
    assert.equal(bazaar.current?.growth, 9.5);
  });

  it("City metrics cover every Bazaar in the city and nothing outside it", () => {
    const city = calculateCityMetrics(byId("TARGET"), network, dailyMetrics, period);
    assert.equal(city.merchantCount, 14);
    assert.equal(city.previous?.gmv, 86_000);
    assert.equal(city.current?.gmv, 91_700);
    assert.equal(city.current?.growth, 6.6);
  });

  it("withholds figures for a group without MIN_COHORT_SIZE merchants besides the viewer", () => {
    const five = ["TARGET", "PEER-R1", "PEER-R2", "PEER-R3", "PEER-R4"];
    const group = calculateGroupMetrics("bazaar", five, "TARGET", dailyMetrics, period);
    assert.equal(group.reportable, false);
    assert.equal(group.current, null);
    assert.equal(group.previous, null);
  });
});

describe("comparison", async () => {
  const result = await analyze("TARGET");
  const [cohort, bazaar, city] = result.comparisons;

  it("merchant vs cohort", () => {
    assert.deepEqual(cohort, {
      against: "cohort",
      available: true,
      merchantGrowth: -18,
      groupGrowth: 14,
      growthGap: -32,
      merchantDirection: "down",
      groupDirection: "up",
      aovGap: 93,
    });
  });

  it("merchant vs Bazaar", () => {
    assert.equal(bazaar.against, "bazaar");
    assert.equal(bazaar.groupGrowth, 9.5);
    assert.equal(bazaar.growthGap, -27.5);
  });

  it("merchant vs City", () => {
    assert.equal(city.against, "city");
    assert.equal(city.groupGrowth, 6.6);
    assert.equal(city.growthGap, -24.6);
  });
});

// Hand-built inputs for pattern rules that the fixture network does not trigger.
function merchantAt(growth: number | null): MerchantMetrics {
  return {
    merchantId: "X",
    current: { gmv: 100, transactions: 1, aov: 100, refunds: 0, growth },
    previous: { gmv: 100, transactions: 1, aov: 100, refunds: 0 },
  };
}
function groupAt(growth: number | null, reportable = true): GroupMetrics {
  return {
    scope: "cohort",
    merchantCount: 6,
    reportable,
    current: reportable ? { gmv: 100, transactions: 1, aov: 100, refunds: 0, growth } : null,
    previous: reportable ? { gmv: 100, transactions: 1, aov: 100, refunds: 0 } : null,
  };
}
const noEvidence: Evidence = {
  metric: "gmv_growth",
  merchantChange: null,
  cohortChange: null,
  bazaarChange: null,
  cityChange: null,
  cohortSize: 6,
  cohortBasis: "bazaar_category",
  observationWindow: { days: 7, current: CURRENT, previous: PREVIOUS },
};
function patternsFor(merchant: number, cohort: number, bazaar: number) {
  const comparisons = compareWithNetwork(merchantAt(merchant), {
    cohort: groupAt(cohort),
    bazaar: groupAt(bazaar),
    city: groupAt(0),
  });
  return detectPatterns({ comparisons, context: { segments: [] }, evidence: noEvidence }).map((p) => p.type);
}

describe("pattern detection", async () => {
  const result = await analyze("TARGET");
  const types = result.patterns.map((p) => p.type);

  it("detects MERCHANT_DOWN_NETWORK_UP (and the matching Bazaar pattern)", () => {
    assert.ok(types.includes("MERCHANT_DOWN_NETWORK_UP"));
    assert.ok(types.includes("MERCHANT_DOWN_BAZAAR_UP"));
    assert.ok(!types.includes("NETWORK_WIDE_GROWTH"));
    assert.ok(!types.includes("MERCHANT_ALIGNS_WITH_NETWORK"));
  });

  it("detects MERCHANT_UP_NETWORK_DOWN", () => {
    assert.deepEqual(patternsFor(12, -9, -6), ["MERCHANT_UP_NETWORK_DOWN", "MERCHANT_UP_BAZAAR_DOWN"]);
  });

  it("detects network-wide growth, decline and alignment", () => {
    assert.deepEqual(patternsFor(10, 12, 8), ["NETWORK_WIDE_GROWTH", "MERCHANT_ALIGNS_WITH_NETWORK"]);
    assert.deepEqual(patternsFor(-30, -8, -5), ["NETWORK_WIDE_DECLINE"]);
    assert.deepEqual(patternsFor(1, -1, 0), ["MERCHANT_ALIGNS_WITH_NETWORK"]);
  });

  it("does not compare against a group that is not reportable", () => {
    const c = compare(merchantAt(-20), groupAt(null, false), "cohort");
    assert.equal(c.available, false);
    const patterns = detectPatterns({
      comparisons: [c, compare(merchantAt(-20), groupAt(0), "bazaar"), compare(merchantAt(-20), groupAt(0), "city")],
      context: { segments: [] },
      evidence: noEvidence,
    });
    assert.deepEqual(patterns, []);
  });

  it("detects context patterns strongest first, never weekday patterns on a 7-day window", () => {
    const context = result.patterns.filter((p) => p.type === "CONTEXT_NETWORK_GROWTH");
    assert.deepEqual(
      context.map((p) => [p.evidence.context?.dimension, p.evidence.context?.segment]),
      [
        ["timeOfDay", "evening"],
        ["weather", "rain"],
      ],
    );
  });
});

describe("context analysis", () => {
  const cohort = getRelevantCohort(byId("TARGET"), network);
  const context = analyzeContext("TARGET", cohort.cohortMerchantIds, events, period);
  const find = (dimension: string, segment: string) =>
    context.segments.find((s) => s.dimension === dimension && s.segment === segment)!;

  it("buckets successful sales by time of day and compares periods", () => {
    const evening = find("timeOfDay", "evening");
    assert.equal(evening.merchant.previousGmv, 2_000);
    assert.equal(evening.merchant.currentGmv, 1_200); // failed payment and refund ignored
    assert.equal(evening.merchant.growth, -40);
    assert.equal(evening.cohort?.growth, 50);
    assert.equal(evening.cohortContributors, 5);
  });

  it("suppresses cohort figures for a segment too few peers traded in", () => {
    const night = find("timeOfDay", "night");
    assert.equal(night.cohortContributors, 2);
    assert.equal(night.cohort, null);
  });

  it("reports supported selected dimensions without pretending the exact combination was measured", () => {
    const impact = selectedContextImpact(context, {
      dayOfWeek: "friday", timeOfDay: "evening", weather: "rain", event: "none",
    });
    assert.equal(impact.level, "single_dimensions");
    assert.equal(impact.status, "meaningful_change");
    assert.equal(impact.strongestDimension, "timeOfDay");
    assert.equal(impact.evidence.find((e) => e.dimension === "timeOfDay")?.gapPp, -90);
  });

  it("returns insufficient evidence instead of fabricating a context effect", () => {
    const impact = selectedContextImpact(context, {
      dayOfWeek: "monday", timeOfDay: "night", weather: "heavy_rain", event: "festival",
    });
    assert.equal(impact.status, "insufficient_evidence");
    assert.equal(impact.strongestDimension, null);
  });

  it("combines all four controls into an exact-match behavior forecast when evidence supports it", async () => {
    const result = await analyzeMerchant(fakeDataSource(), {
      merchantId: "TARGET",
      current: CURRENT,
      context: { dayOfWeek: "friday", timeOfDay: "evening", weather: "rain", event: "none" },
    });
    assert.equal(result.contextImpact?.combined.basis, "exact_combination");
    assert.equal(result.contextImpact?.combined.merchantGrowth, -40);
    assert.equal(result.contextImpact?.combined.cohortGrowth, 50);
    assert.equal(result.contextImpact?.forecast.direction, "decrease");
    assert.equal(result.contextImpact?.forecast.confidence, "high");
  });
});

describe("evidence", async () => {
  const result = await analyze("TARGET");

  it("carries the figures behind the findings", () => {
    assert.deepEqual(result.evidence, {
      metric: "gmv_growth",
      merchantChange: -18,
      cohortChange: 14,
      bazaarChange: 9.5,
      cityChange: 6.6,
      cohortSize: 5,
      cohortBasis: "bazaar_category",
      observationWindow: { days: 7, current: CURRENT, previous: PREVIOUS },
    });
    for (const pattern of result.patterns) assert.ok(pattern.evidence.observationWindow);
  });

  it("adds the segment to context evidence", () => {
    const context = result.patterns.find((p) => p.type === "CONTEXT_NETWORK_GROWTH")!;
    assert.deepEqual(context.evidence.context, {
      dimension: "timeOfDay",
      segment: "evening",
      merchantChange: -40,
      cohortChange: 50,
      merchantTransactions: 20,
      cohortContributors: 5,
    });
  });
});

describe("Bazaar Impact", async () => {
  const result = await analyze("TARGET");

  it("summarises the network around the merchant", () => {
    assert.deepEqual(result.bazaarImpact, {
      bazaarGrowth: 9.5,
      cohortGrowth: 14,
      categoryGrowth: 14,
      cityGrowth: 6.6,
      demandTrend: { growth: 8.4, direction: "up" },
      networkBasis: "cohort",
      networkDirection: "up",
      merchantVsNetworkGap: -32,
    });
  });
});

describe("opportunity detection", async () => {
  const result = await analyze("TARGET");

  it("flags an underperforming merchant, then the strongest context gap", () => {
    assert.deepEqual(
      result.opportunities.map((o) => [o.type, o.priority, o.patterns]),
      [
        ["CLOSE_NETWORK_GAP", "high", ["MERCHANT_DOWN_NETWORK_UP", "MERCHANT_DOWN_BAZAAR_UP"]],
        ["CAPTURE_CONTEXT_DEMAND", "medium", ["CONTEXT_NETWORK_GROWTH"]],
      ],
    );
    assert.equal(result.opportunities[0].reason, "MERCHANT_BEHIND_GROWING_NETWORK");
    assert.equal(result.opportunities[0].evidence.merchantChange, -18);
  });

  it("finds nothing to act on for an aligned merchant", () => {
    const comparisons = compareWithNetwork(merchantAt(10), { cohort: groupAt(12), bazaar: groupAt(8), city: groupAt(5) });
    const patterns = detectPatterns({ comparisons, context: { segments: [] }, evidence: noEvidence });
    assert.ok(!patterns.some((p) => p.type.startsWith("MERCHANT_DOWN")));
  });
});

describe("small or empty cohorts", async () => {
  const result = await analyze("KIRANA-0");

  it("returns an explicit state instead of invented values", () => {
    assert.deepEqual(result.cohort, { basis: "city_category", category: "kirana", size: 1, reportable: false });
    assert.equal(result.cohortMetrics.current, null);
    assert.equal(result.comparisons[0].available, false);
    assert.equal(result.bazaarImpact.networkBasis, "bazaar");
    assert.equal(result.bazaarImpact.merchantVsNetworkGap, null);
    assert.deepEqual(result.patterns, []);
    assert.deepEqual(result.opportunities, []);
    assert.deepEqual(result.limitations, [
      "COHORT_FALLBACK_TO_CITY_CATEGORY",
      "COHORT_TOO_SMALL",
      "NO_MERCHANT_ACTIVITY",
      "NO_PREVIOUS_PERIOD_GMV",
    ]);
  });
});

describe("privacy", async () => {
  const result = await analyze("TARGET");
  const json = JSON.stringify(result);

  it("never exposes another merchant's identity or contact details", () => {
    for (const leak of ["PEER-", "MYS-", "CAFE-0", "KIRANA-0", "Name of", "@example.com", "+9190000"]) {
      assert.ok(!json.includes(leak), `output contains ${leak}`);
    }
  });

  it("exposes the cohort's shape, not its members", () => {
    assert.deepEqual(Object.keys(result.cohort).sort(), ["basis", "category", "reportable", "size"]);
  });
});
