import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  areaStateMessage,
  barGeometry,
  describeTopSignal,
  formatGrowth,
  formatRupees,
  lineGeometry,
  merchantForBuilding,
} from "@/components/intelligence/present";
import { NotFoundError } from "@/lib/paytm/adapter/errors";
import { getBazaarIntelligence, getCityIntelligence, getMerchantBasics, loadNetwork } from "@/merchant-intelligence";
import { CURRENT, deps } from "@/merchant-intelligence/__tests__/fakes";

describe("chart data transformation", () => {
  it("scales a sales series into an SVG path, highest day at the top", () => {
    const g = lineGeometry(
      [
        { date: "2026-09-01", gmv: 100 },
        { date: "2026-09-02", gmv: 300 },
        { date: "2026-09-03", gmv: 200 },
      ],
      100,
      50,
      0,
    )!;
    assert.deepEqual(g.points.map((p) => [p.x, p.y]), [[0, 50], [50, 0], [100, 25]]);
    assert.ok(g.path.startsWith("M0.0 50.0"));
    assert.equal(g.max, 300);
    assert.equal(lineGeometry([{ date: "2026-09-01", gmv: 1 }], 100, 50), null, "one point is not a trend");
  });

  it("places growth bars around a shared zero line", () => {
    const mixed = barGeometry([
      { label: "A", growth: 10 },
      { label: "B", growth: -5 },
      { label: "C", growth: null },
    ]);
    assert.deepEqual(mixed.map((b) => [b.start, b.width, b.tone]), [[0.5, 0.5, "up"], [0.25, 0.25, "down"], [0.5, 0, "flat"]]);
    const positive = barGeometry([{ label: "A", growth: 8 }, { label: "B", growth: 4 }]);
    assert.deepEqual(positive.map((b) => [b.start, b.width]), [[0, 1], [0, 0.5]]);
  });

  it("formats money the way Indian shopkeepers read it", () => {
    assert.equal(formatRupees(5_857_015), "₹58.6 L");
    assert.equal(formatRupees(12_345_678), "₹1.23 Cr");
    assert.equal(formatRupees(83_330), "₹83,330");
    assert.equal(formatGrowth(-29.5), "-29.5%");
    assert.equal(formatGrowth(null), "—");
  });
});

describe("building to merchant mapping", () => {
  const merchants = [{ mid: "PBZKOR003" }, { mid: "PBZKOR001" }, { mid: "PBZKOR002" }];

  it("maps building N to the Nth merchant in MID order, wrapping around", () => {
    assert.equal(merchantForBuilding(merchants, 0)?.mid, "PBZKOR001");
    assert.equal(merchantForBuilding(merchants, 2)?.mid, "PBZKOR003");
    assert.equal(merchantForBuilding(merchants, 3)?.mid, "PBZKOR001");
    assert.equal(merchantForBuilding(merchants, -1)?.mid, "PBZKOR001", "unknown building falls back to the first");
    assert.equal(merchantForBuilding([], 0), null);
  });
});

describe("merchant presentation", () => {
  it("words the top relevance signal with the backend's own numbers and no peer identity", async () => {
    const basics = await getMerchantBasics(deps(), { merchantId: "TARGET", current: CURRENT });
    const top = describeTopSignal(basics)!;
    assert.equal(top.priority, "high");
    assert.equal(top.title, "You're behind similar shops");
    assert.equal(top.sentence, "Your sales changed -18.0% while similar shops near you changed +14.0%: a gap of 32 points.");
    assert.ok(!JSON.stringify(top).includes("PEER-"));
  });
});

describe("City and Bazaar intelligence services", () => {
  it("load the network through the Data Adapter and use its latest week", async () => {
    const network = await loadNetwork(deps());
    assert.deepEqual(network.period.current, { from: "2026-09-14", to: "2026-09-20" });
    const city = getCityIntelligence(network);
    assert.equal(city.name, "Bengaluru");
    assert.equal(city.scope, "city");
  });

  it("reject an unknown Bazaar with NotFoundError", async () => {
    const d = deps();
    await assert.rejects(getBazaarIntelligence(d, await loadNetwork(d), "atlantis"), NotFoundError);
  });
});

describe("loading, error and empty states", () => {
  it("uses friendly messages and never exposes internals", () => {
    assert.equal(areaStateMessage("city", "loading"), "Reading the whole city…");
    assert.equal(areaStateMessage("bazaar", "loading"), "Reading this Bazaar…");
    assert.equal(areaStateMessage("city", "error"), "City intelligence is temporarily unavailable.");
    assert.equal(areaStateMessage("bazaar", "error"), "Bazaar intelligence is temporarily unavailable.");
    assert.equal(areaStateMessage("city", "empty"), "Not enough data to show a strong signal yet.");
    assert.equal(areaStateMessage("city", "ready"), null);
  });
});

describe("frontend boundary", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "api" || name === "__tests__" ? [] : files(path);
      return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
    });

  it("no UI code touches Supabase, the Data Adapter or runtime intelligence", () => {
    for (const file of [...files("components"), ...files("app")]) {
      const source = readFileSync(file, "utf8");
      assert.ok(!/supabase/i.test(source), `${file} mentions Supabase`);
      assert.ok(!/from "@\/lib\/(paytm|supabase)/.test(source), `${file} imports the Data Adapter`);
      for (const match of source.matchAll(/import\s+(?!type\b)[^;]*from\s+"@\/(m2m-engine|relevance-engine|merchant-intelligence)[^"]*"/g)) {
        assert.fail(`${file} imports runtime intelligence: ${match[0]}`);
      }
    }
  });
});
