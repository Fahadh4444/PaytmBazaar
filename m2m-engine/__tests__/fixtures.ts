/**
 * Deterministic network for engine tests. Numbers are chosen so every
 * expected figure can be checked by hand.
 *
 * City Bengaluru
 *   B1: TARGET (restaurant) + PEER-R1..R5 (restaurants) + CAFE-0 + KIRANA-0
 *   B2: PEER-C1..C5 (cafes) + PEER-K1 (kirana)
 * City Mysuru (must never leak into Bengaluru figures)
 *   M1: MYS-R1 (restaurant)
 *
 * Periods: current 2026-09-10 → 16, previous 2026-09-03 → 09.
 *
 *   TARGET   prev GMV 10,000 / 50 txns   cur 8,200 / 41 txns, refunds 300   → -18%
 *   R1..R5   prev 10,000 / 100 each       cur 11,400 / 110 each              → cohort +14%
 *   CAFE-0   prev 0                       cur 500 / 5                        → growth null
 *   B1 total prev 60,000 / 550 txns      cur 65,700 / 596 txns              → Bazaar +9.5%
 *   C1..C5   5,000 / 25 each, both periods; K1 1,000 / 10 both periods
 *   city     prev 86,000                  cur 91,700                         → City +6.6%
 *   KIRANA-0 no activity at all
 */

import type {
  Bazaar,
  DateRange,
  Merchant,
  MerchantCategory,
  MerchantDailyMetric,
  PaymentEvent,
  PaytmDataSource,
} from "@/m2m-engine";

export const CURRENT: DateRange = { from: "2026-09-10", to: "2026-09-16" };
export const PREVIOUS: DateRange = { from: "2026-09-03", to: "2026-09-09" };
const CREATED = "2026-09-01T00:00:00.000Z";

export const bazaars: Bazaar[] = [
  { id: "B1", name: "Bazaar One", city: "Bengaluru", createdAt: CREATED },
  { id: "B2", name: "Bazaar Two", city: "Bengaluru", createdAt: CREATED },
  { id: "M1", name: "Mysuru Market", city: "Mysuru", createdAt: CREATED },
];

function merchant(mid: string, bazaarId: string, category: MerchantCategory): Merchant {
  const slug = mid.toLowerCase();
  return {
    mid,
    bazaarId,
    category,
    name: `Name of ${mid}`,
    email: `${slug}@example.com`,
    phoneNumber: `+9190000${String(mid.length).padStart(5, "0")}`,
    createdAt: CREATED,
  };
}

const PEER_RESTAURANTS = ["PEER-R1", "PEER-R2", "PEER-R3", "PEER-R4", "PEER-R5"];
const PEER_CAFES = ["PEER-C1", "PEER-C2", "PEER-C3", "PEER-C4", "PEER-C5"];

export const merchants: Merchant[] = [
  merchant("TARGET", "B1", "restaurant"),
  ...PEER_RESTAURANTS.map((mid) => merchant(mid, "B1", "restaurant")),
  merchant("CAFE-0", "B1", "cafe"),
  merchant("KIRANA-0", "B1", "kirana"),
  ...PEER_CAFES.map((mid) => merchant(mid, "B2", "cafe")),
  merchant("PEER-K1", "B2", "kirana"),
  merchant("MYS-R1", "M1", "restaurant"),
];

function day(mid: string, date: string, transactions: number, gross: number, refunds = 0): MerchantDailyMetric {
  return {
    mid,
    businessDate: date,
    successfulTransactions: transactions,
    pendingTransactions: 1,
    failedTransactions: 1,
    grossSalesInr: gross,
    refundsInr: refunds,
    netSalesInr: gross - refunds,
  };
}

export const dailyMetrics: MerchantDailyMetric[] = [
  // TARGET: split across two days in the current period to test summing.
  day("TARGET", "2026-09-05", 50, 10_000),
  day("TARGET", "2026-09-11", 20, 4_000, 100),
  day("TARGET", "2026-09-14", 21, 4_200, 200),
  // Outside both periods: must be ignored.
  day("TARGET", "2026-09-20", 999, 999_999),
  ...PEER_RESTAURANTS.flatMap((mid) => [day(mid, "2026-09-05", 100, 10_000), day(mid, "2026-09-12", 110, 11_400)]),
  day("CAFE-0", "2026-09-12", 5, 500),
  ...PEER_CAFES.flatMap((mid) => [day(mid, "2026-09-05", 25, 5_000), day(mid, "2026-09-12", 25, 5_000)]),
  day("PEER-K1", "2026-09-05", 10, 1_000),
  day("PEER-K1", "2026-09-12", 10, 1_000),
  day("MYS-R1", "2026-09-05", 1, 1_000),
  day("MYS-R1", "2026-09-12", 900, 99_999),
];

// --- Payment events for context analysis ------------------------------------

let seq = 0;
function sale(
  mid: string,
  txnAt: string,
  amount: number,
  weather: PaymentEvent["context"]["weather"],
  overrides: Partial<PaymentEvent> = {},
): PaymentEvent {
  seq += 1;
  return {
    txnId: `T${seq}`,
    mid,
    orderId: `O${seq}`,
    transactionType: "ACQUIRING",
    status: "TXN_SUCCESS",
    responseCode: "01",
    amountInr: amount,
    refundAmountInr: 0,
    txnAt: new Date(txnAt).toISOString(),
    paymentMode: "UPI",
    settlementStatus: "SETTLED",
    settlementAt: null,
    context: { weather, event: null },
    createdAt: CREATED,
    ...overrides,
  };
}

const times = (n: number, make: () => PaymentEvent) => Array.from({ length: n }, make);

// Both 2026-09-04 and 2026-09-11 are Fridays; 18:30 IST is evening, 09:00 IST morning.
const PREV_EVENING = "2026-09-04T18:30:00+05:30";
const CUR_EVENING = "2026-09-11T18:30:00+05:30";
const PREV_MORNING = "2026-09-04T09:00:00+05:30";
const CUR_MORNING = "2026-09-11T09:00:00+05:30";

/**
 * Evenings (and rain, which only fell in the evenings): TARGET 2,000 → 1,200
 * (-40%) while each peer 2,000 → 3,000 (+50%). Mornings flat for everyone.
 */
export const events: PaymentEvent[] = [
  ...times(20, () => sale("TARGET", PREV_EVENING, 100, "rain")),
  ...times(20, () => sale("TARGET", CUR_EVENING, 60, "rain")),
  ...times(20, () => sale("TARGET", PREV_MORNING, 100, "clear")),
  ...times(20, () => sale("TARGET", CUR_MORNING, 100, "clear")),
  ...PEER_RESTAURANTS.flatMap((mid) => [
    ...times(20, () => sale(mid, PREV_EVENING, 100, "rain")),
    ...times(20, () => sale(mid, CUR_EVENING, 150, "rain")),
    ...times(20, () => sale(mid, PREV_MORNING, 100, "clear")),
    ...times(20, () => sale(mid, CUR_MORNING, 100, "clear")),
  ]),
  // Only two peers trade at night: too few to report that segment.
  sale("PEER-R1", "2026-09-11T23:00:00+05:30", 500, "cloudy"),
  sale("PEER-R2", "2026-09-11T23:00:00+05:30", 500, "cloudy"),
  // Not successful sales: must be ignored.
  sale("TARGET", CUR_EVENING, 99_999, "rain", { status: "TXN_FAILURE" }),
  sale("TARGET", CUR_EVENING, 99_999, "rain", { transactionType: "REFUND", refundAmountInr: 50 }),
];

/** In-memory PaytmDataSource over the fixtures, implementing what the engine calls. */
export function fakeDataSource(): PaytmDataSource {
  const within = (e: PaymentEvent, range?: { start: string | Date; end: string | Date }) =>
    !range || (Date.parse(e.txnAt) >= Date.parse(String(range.start)) && Date.parse(e.txnAt) < Date.parse(String(range.end)));

  const source: Partial<PaytmDataSource> = {
    async getMerchant(mid) {
      const found = merchants.find((m) => m.mid === mid);
      if (!found) throw new Error(`Merchant not found: ${mid}`);
      return found;
    },
    async getBazaars() {
      return bazaars;
    },
    async getMerchants() {
      return merchants;
    },
    async getDailyMetricsForMerchants(mids, range) {
      return dailyMetrics.filter(
        (d) => mids.includes(d.mid) && (!range || (d.businessDate >= range.from && d.businessDate <= range.to)),
      );
    },
    async getTransactionsForMerchants(mids, filter = {}) {
      return events.filter(
        (e) =>
          mids.includes(e.mid) &&
          within(e, filter.range) &&
          (!filter.status || e.status === filter.status) &&
          (!filter.transactionType || e.transactionType === filter.transactionType),
      );
    },
  };
  return source as PaytmDataSource;
}
