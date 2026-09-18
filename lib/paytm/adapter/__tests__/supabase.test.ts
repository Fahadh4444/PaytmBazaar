import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DataSourceError,
  InvalidQueryError,
  NotFoundError,
  PaytmDataError,
  PaytmSupabaseAdapter,
  ResultTooLargeError,
  type PaytmSupabaseAdapterOptions,
} from "@/lib/paytm/adapter";

import { createFakeSupabase, type FakeSupabaseOptions } from "./fake-supabase";
import { seedTables } from "./seed";

function setup(options: PaytmSupabaseAdapterOptions & FakeSupabaseOptions = {}) {
  const fake = createFakeSupabase(seedTables(), options);
  return { adapter: new PaytmSupabaseAdapter(fake.client, options), requests: fake.requests };
}

const txnIds = (events: { txnId: string }[]) => events.map((e) => e.txnId);
const mids = (rows: { mid: string }[]) => rows.map((r) => r.mid);

// 18 Sep 2026, a full IST day.
const SEP_18_IST = { start: "2026-09-18T00:00:00+05:30", end: "2026-09-19T00:00:00+05:30" };

describe("bazaars", () => {
  it("gets all bazaars, ordered by id", async () => {
    const { adapter } = setup();
    const bazaars = await adapter.getBazaars();
    assert.deepEqual(
      bazaars.map((b) => b.id),
      ["indiranagar", "jayanagar", "koramangala"],
    );
  });

  it("gets a bazaar by id, mapped to the domain shape", async () => {
    const { adapter } = setup();
    assert.deepEqual(await adapter.getBazaar("koramangala"), {
      id: "koramangala",
      name: "Koramangala",
      city: "Bengaluru",
      createdAt: "2026-09-18T11:12:02.123Z",
    });
  });

  it("gets the merchants in a bazaar", async () => {
    const { adapter } = setup();
    assert.deepEqual(mids(await adapter.getMerchantsByBazaar("koramangala")), [
      "MID-KOR-001",
      "MID-KOR-002",
      "MID-KOR-003",
    ]);
  });
});

describe("merchants", () => {
  it("gets a merchant by MID", async () => {
    const { adapter } = setup();
    assert.deepEqual(await adapter.getMerchant("MID-KOR-002"), {
      mid: "MID-KOR-002",
      bazaarId: "koramangala",
      name: "FreshKart",
      category: "kirana",
      email: "koramangala.freshkart@example.com",
      phoneNumber: "+919810000002",
      createdAt: "2026-09-18T11:12:02.123Z",
    });
  });

  it("gets a merchant with its bazaar", async () => {
    const { adapter } = setup();
    const merchant = await adapter.getMerchantWithBazaar("MID-IND-001");
    assert.equal(merchant.name, "Sharma Electronics");
    assert.equal(merchant.bazaar.name, "Indiranagar");
  });

  it("gets all merchants, and by category within and across bazaars", async () => {
    const { adapter } = setup();
    assert.equal((await adapter.getMerchants()).length, 5);
    assert.deepEqual(mids(await adapter.getMerchantsByCategory("pharmacy")), ["MID-IND-002"]);
    assert.deepEqual(await adapter.getMerchantsByCategory("pharmacy", "koramangala"), []);
  });
});

describe("payment events", () => {
  it("gets a merchant's transactions in time order, including refunds, unaltered", async () => {
    const { adapter } = setup();
    const events = await adapter.getMerchantTransactions("MID-KOR-002");

    assert.deepEqual(txnIds(events), ["TXN-DEMO-0002", "TXN-DEMO-0006", "TXN-DEMO-0010"]);

    const refund = events[2];
    assert.equal(refund.transactionType, "REFUND");
    assert.equal(refund.amountInr, 742.5);
    assert.equal(refund.refundAmountInr, 250);
    assert.equal(refund.txnAt, "2026-09-19T05:38:21.000Z");
    assert.equal(refund.settlementAt, "2026-09-20T00:42:00.000Z");
  });

  it("exposes weather and event context without interpreting it", async () => {
    const { adapter } = setup();
    const [, festival] = await adapter.getMerchantTransactions("MID-KOR-002");
    assert.deepEqual(festival.context, {
      weather: "heavy_rain",
      event: { name: "Koramangala Food Festival", type: "local_event" },
    });

    const [plain] = await adapter.getMerchantTransactions("MID-KOR-001");
    assert.deepEqual(plain.context, { weather: "cloudy", event: null });
  });

  it("gets transactions for a time range, excluding the range end", async () => {
    const { adapter } = setup();
    const onSep18 = await adapter.getTransactionsForRange(SEP_18_IST);
    assert.equal(onSep18.length, 9);
    assert.ok(!txnIds(onSep18).includes("TXN-DEMO-0010"));

    // End is exclusive: a range ending exactly at TXN-DEMO-0001 excludes it.
    const beforeFirst = await adapter.getTransactionsForRange({
      start: "2026-09-18T00:00:00+05:30",
      end: new Date("2026-09-18T08:42:16+05:30"),
    });
    assert.deepEqual(beforeFirst, []);
  });

  it("gets a merchant's transactions for a range", async () => {
    const { adapter } = setup();
    const events = await adapter.getMerchantTransactionsForRange("MID-KOR-002", SEP_18_IST);
    assert.deepEqual(txnIds(events), ["TXN-DEMO-0002", "TXN-DEMO-0006"]);
  });

  it("gets a bazaar's transactions", async () => {
    const { adapter } = setup();
    const events = await adapter.getBazaarTransactions("indiranagar");
    assert.deepEqual(txnIds(events), ["TXN-DEMO-0004", "TXN-DEMO-0005", "TXN-DEMO-0008", "TXN-DEMO-0009"]);
  });

  it("gets transactions for several merchants", async () => {
    const { adapter } = setup();
    const events = await adapter.getTransactionsForMerchants(["MID-KOR-001", "MID-IND-002", "MID-KOR-001"]);
    assert.deepEqual(txnIds(events), ["TXN-DEMO-0001", "TXN-DEMO-0005", "TXN-DEMO-0009"]);
  });

  it("filters by status, type, weather, event and category", async () => {
    const { adapter } = setup();

    const failedOrPending = await adapter.getBazaarTransactions("indiranagar", {
      status: ["TXN_FAILURE", "PENDING"],
    });
    assert.deepEqual(txnIds(failedOrPending), ["TXN-DEMO-0004", "TXN-DEMO-0005"]);

    const refunds = await adapter.getTransactions({ transactionType: "REFUND" });
    assert.deepEqual(txnIds(refunds), ["TXN-DEMO-0010"]);

    const inRain = await adapter.getTransactions({ weather: ["rain", "heavy_rain"], range: SEP_18_IST });
    assert.deepEqual(txnIds(inRain), ["TXN-DEMO-0003", "TXN-DEMO-0004", "TXN-DEMO-0005", "TXN-DEMO-0006"]);

    const duringEvents = await adapter.getTransactions({ duringEvent: true });
    assert.deepEqual(txnIds(duringEvents), ["TXN-DEMO-0003", "TXN-DEMO-0006", "TXN-DEMO-0007"]);

    const duringOdi = await adapter.getTransactions({ eventName: "India vs Australia ODI" });
    assert.deepEqual(txnIds(duringOdi), ["TXN-DEMO-0003", "TXN-DEMO-0007"]);

    const outsideEvents = await adapter.getBazaarTransactions("koramangala", { duringEvent: false });
    assert.deepEqual(txnIds(outsideEvents), ["TXN-DEMO-0001", "TXN-DEMO-0002", "TXN-DEMO-0010"]);

    const restaurants = await adapter.getTransactions({ bazaarId: "koramangala", category: "restaurant" });
    assert.deepEqual(txnIds(restaurants), ["TXN-DEMO-0003", "TXN-DEMO-0007"]);
  });
});

describe("daily metrics", () => {
  it("passes a merchant's daily rollup through from the database", async () => {
    const { adapter } = setup();
    assert.deepEqual(await adapter.getMerchantDailyMetrics("MID-KOR-002"), [
      {
        mid: "MID-KOR-002",
        businessDate: "2026-09-18",
        successfulTransactions: 2,
        pendingTransactions: 0,
        failedTransactions: 0,
        grossSalesInr: 2011.25,
        refundsInr: 0,
        netSalesInr: 2011.25,
      },
      {
        mid: "MID-KOR-002",
        businessDate: "2026-09-19",
        successfulTransactions: 0,
        pendingTransactions: 0,
        failedTransactions: 0,
        grossSalesInr: 0,
        refundsInr: 250,
        netSalesInr: -250,
      },
    ]);
  });

  it("filters by inclusive date range, merchants and bazaar", async () => {
    const { adapter } = setup();
    const sep19 = await adapter.getDailyMetricsForRange({ from: "2026-09-19", to: "2026-09-19" });
    assert.deepEqual(mids(sep19), ["MID-KOR-002"]);

    const both = await adapter.getDailyMetricsForMerchants(["MID-IND-001", "MID-KOR-001"], {
      from: "2026-09-18",
      to: "2026-09-18",
    });
    assert.deepEqual(mids(both), ["MID-IND-001", "MID-KOR-001"]);

    const bazaar = await adapter.getBazaarDailyMetrics("indiranagar");
    assert.deepEqual(mids(bazaar), ["MID-IND-001", "MID-IND-002"]);
    assert.equal(bazaar[0].failedTransactions, 1);
  });
});

describe("empty results", () => {
  it("returns [] for valid queries that match nothing", async () => {
    const { adapter, requests } = setup();

    assert.deepEqual(await adapter.getMerchantsByBazaar("jayanagar"), []);
    assert.deepEqual(await adapter.getBazaarTransactions("jayanagar"), []);
    assert.deepEqual(await adapter.getBazaarDailyMetrics("jayanagar"), []);
    assert.deepEqual(
      await adapter.getMerchantTransactionsForRange("MID-KOR-001", {
        start: "2026-10-01T00:00:00Z",
        end: "2026-11-01T00:00:00Z",
      }),
      [],
    );
    assert.deepEqual(await adapter.getMerchantDailyMetrics("MID-KOR-001", { from: "2026-10-01", to: "2026-10-31" }), []);

    const before = requests.length;
    assert.deepEqual(await adapter.getTransactionsForMerchants([]), []);
    assert.deepEqual(await adapter.getDailyMetricsForMerchants([]), []);
    assert.equal(requests.length, before, "an empty merchant list needs no query");
  });
});

describe("not found", () => {
  it("rejects unknown bazaars and merchants with NotFoundError", async () => {
    const { adapter } = setup();

    await assert.rejects(adapter.getBazaar("atlantis"), (error: unknown) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.entity, "bazaar");
      assert.deepEqual(error.ids, ["atlantis"]);
      assert.equal(error.code, "not_found");
      return true;
    });
    await assert.rejects(adapter.getMerchantsByBazaar("atlantis"), NotFoundError);
    await assert.rejects(adapter.getBazaarTransactions("atlantis"), NotFoundError);
    await assert.rejects(adapter.getMerchant("MID-NOPE"), NotFoundError);
    await assert.rejects(adapter.getMerchantTransactions("MID-NOPE"), NotFoundError);
    await assert.rejects(adapter.getMerchantDailyMetrics("MID-NOPE"), NotFoundError);
  });

  it("names every missing merchant in a multi-merchant query", async () => {
    const { adapter } = setup();
    await assert.rejects(
      adapter.getTransactionsForMerchants(["MID-KOR-001", "MID-X", "MID-Y"]),
      (error: unknown) => error instanceof NotFoundError && error.ids.join() === "MID-X,MID-Y",
    );
  });
});

describe("invalid input", () => {
  it("rejects bad time ranges before querying", async () => {
    const { adapter, requests } = setup();

    const reversed = { start: "2026-09-19T00:00:00Z", end: "2026-09-18T00:00:00Z" };
    const empty = { start: "2026-09-18T00:00:00Z", end: "2026-09-18T00:00:00Z" };
    const garbage = { start: "yesterday", end: "2026-09-18T00:00:00Z" };

    await assert.rejects(adapter.getTransactionsForRange(reversed), InvalidQueryError);
    await assert.rejects(adapter.getTransactionsForRange(empty), InvalidQueryError);
    await assert.rejects(adapter.getMerchantTransactionsForRange("MID-KOR-001", garbage), InvalidQueryError);
    await assert.rejects(adapter.getBazaarTransactions("koramangala", { range: reversed }), InvalidQueryError);

    assert.equal(requests.length, 0, "no query should reach the database");
  });

  it("rejects bad date ranges, pages and IDs", async () => {
    const { adapter, requests } = setup();

    await assert.rejects(adapter.getDailyMetricsForRange({ from: "2026-09-19", to: "2026-09-18" }), InvalidQueryError);
    await assert.rejects(adapter.getDailyMetricsForRange({ from: "2026-02-30", to: "2026-03-01" }), InvalidQueryError);
    await assert.rejects(adapter.getDailyMetricsForRange({ from: "18/09/2026", to: "2026-09-19" }), InvalidQueryError);
    await assert.rejects(adapter.getTransactions({ page: { limit: 0 } }), InvalidQueryError);
    await assert.rejects(adapter.getTransactions({ page: { limit: 5000 } }), InvalidQueryError);
    await assert.rejects(adapter.getMerchant("  "), InvalidQueryError);
    await assert.rejects(adapter.getBazaar(""), InvalidQueryError);

    assert.equal(requests.length, 0);
  });
});

describe("large results", () => {
  it("reads past the server row cap in batches", async () => {
    const { adapter, requests } = setup({ serverMaxRows: 3, pageSize: 3 });
    const events = await adapter.getTransactions({});
    assert.equal(events.length, 10);
    assert.equal(new Set(txnIds(events)).size, 10);
    assert.equal(requests.length, 4);
  });

  it("returns exactly the requested page", async () => {
    const { adapter } = setup();
    const page = await adapter.getTransactionsForRange(SEP_18_IST, { page: { limit: 2, offset: 2 } });
    assert.deepEqual(txnIds(page), ["TXN-DEMO-0003", "TXN-DEMO-0004"]);
  });

  it("refuses to load more than maxRows without a page", async () => {
    const { adapter } = setup({ pageSize: 3, serverMaxRows: 3, maxRows: 5 });
    await assert.rejects(adapter.getTransactions({}), ResultTooLargeError);
  });
});

describe("database failures", () => {
  it("wraps store errors in DataSourceError, keeping the original as cause", async () => {
    const { adapter } = setup({ failingTables: ["payment_events"] });

    await assert.rejects(adapter.getMerchantTransactions("MID-KOR-001"), (error: unknown) => {
      assert.ok(error instanceof DataSourceError);
      assert.ok(error instanceof PaytmDataError);
      assert.equal(error.code, "unavailable");
      assert.doesNotMatch(error.message, /connection reset/);
      assert.equal((error.cause as { code: string }).code, "08006");
      return true;
    });
  });
});
