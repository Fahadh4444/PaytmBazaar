import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bazaarIntelligence, cityIntelligence, comparisonPeriod, dailyTrend, weekPattern, type TrendPoint } from "@/m2m-engine";

import { CURRENT, bazaars, dailyMetrics, merchants } from "./fixtures";

const period = comparisonPeriod(CURRENT);
const network = { bazaars, merchants, rows: dailyMetrics, period };
const b1 = bazaars.find((b) => b.id === "B1")!;

describe("city intelligence", () => {
  const city = cityIntelligence({ city: "Bengaluru", ...network });

  it("totals every Bazaar in the city and nothing outside it", () => {
    assert.equal(city.metrics.merchantCount, 14);
    assert.equal(city.metrics.current.gmv, 91_700);
    assert.equal(city.metrics.previous.gmv, 86_000);
    assert.equal(city.metrics.current.growth, 6.6);
  });

  it("breaks growth down by Bazaar and by category, hiding groups under MIN_COHORT_SIZE", () => {
    const [byBazaar, byCategory] = city.breakdowns;
    assert.deepEqual(byBazaar.bars.map((b) => [b.id, b.growth]), [["B1", 9.5], ["B2", 0]]);
    assert.equal(byBazaar.hiddenGroups, 0);
    assert.deepEqual(byCategory.bars.map((b) => b.id).sort(), ["cafe", "restaurant"]);
    assert.equal(byCategory.hiddenGroups, 1, "the two kiranas are too few to show");
  });

  it("builds a data-backed headline", () => {
    assert.equal(city.headline, "Sales across Bengaluru grew 6.6% this week.");
  });

  it("says so when there is not enough data", () => {
    const empty = cityIntelligence({ city: "Bengaluru", ...network, rows: [] });
    assert.equal(empty.metrics.current.growth, null);
    assert.equal(empty.headline, "Not enough data to identify a strong signal yet.");
  });
});

describe("Bazaar intelligence", () => {
  const bazaar = bazaarIntelligence({ bazaar: b1, ...network });

  it("summarises the Bazaar and compares it with the city", () => {
    assert.equal(bazaar.metrics.current.gmv, 65_700);
    assert.equal(bazaar.metrics.current.growth, 9.5);
    assert.deepEqual(bazaar.impact, { bazaarGrowth: 9.5, cityGrowth: 6.6, gapToCity: 2.9, demandGrowth: 8.4, direction: "up" });
    assert.equal(bazaar.headline, "Sales in Bazaar One grew 9.5% this week, ahead of Bengaluru (+6.6%).");
  });

  it("counts shops by performance band without naming any", () => {
    assert.deepEqual(bazaar.performance, [
      { band: "growing_strongly", count: 5 },
      { band: "growing", count: 0 },
      { band: "stable", count: 0 },
      { band: "declining", count: 1 },
    ]);
    assert.equal(bazaar.detail, "5 of 6 shops here are growing.");
  });

  it("is privacy-safe: no merchant ID, name or contact detail appears", () => {
    const json = JSON.stringify(bazaar);
    for (const leak of ["TARGET", "PEER-", "CAFE-0", "KIRANA-0", "Name of", "@example.com"]) {
      assert.ok(!json.includes(leak), `leaked ${leak}`);
    }
    const [byCategory] = bazaar.breakdowns;
    assert.deepEqual(byCategory.bars.map((b) => b.id), ["restaurant"]);
    assert.equal(byCategory.hiddenGroups, 2, "the single cafe and kirana are hidden");
  });
});

describe("trend and week pattern", () => {
  it("sums daily sales across the area for 28 days, including quiet days", () => {
    const trend = dailyTrend(dailyMetrics, period, merchants.filter((m) => m.bazaarId === "B1").map((m) => m.mid));
    assert.equal(trend.length, 28);
    assert.equal(trend.at(-1)!.date, "2026-09-16");
    assert.equal(trend.find((p) => p.date === "2026-09-12")!.gmv, 57_500);
    assert.equal(trend.find((p) => p.date === "2026-09-13")!.gmv, 0);
  });

  it("reports a weekend lift only when it is meaningful", () => {
    const days = (weekend: number, weekday: number): TrendPoint[] =>
      ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({
        date,
        gmv: ["2026-09-12", "2026-09-13"].includes(date) ? weekend : weekday,
      }));
    assert.deepEqual(weekPattern(days(130, 100), period), { weekendDailyGmv: 130, weekdayDailyGmv: 100, weekendLiftPct: 30 });
    assert.equal(weekPattern(days(105, 100), period), null);
  });
});
