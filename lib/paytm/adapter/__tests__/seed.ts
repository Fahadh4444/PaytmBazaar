/**
 * Rows for the fake database, copied from the prototype seed
 * (`supabase/flyway/sql/V2__seed_10_payment_events.sql` and `V3__…`), plus one
 * bazaar with no merchants.
 *
 * `merchant_daily_metrics` holds what the database view returns for these
 * events. The fake does not calculate it, and neither does the adapter.
 */

const CREATED_AT = "2026-09-18T11:12:02.123913+00:00";

export const bazaars = [
  { id: "koramangala", name: "Koramangala", city: "Bengaluru", created_at: CREATED_AT },
  { id: "indiranagar", name: "Indiranagar", city: "Bengaluru", created_at: CREATED_AT },
  { id: "jayanagar", name: "Jayanagar", city: "Bengaluru", created_at: CREATED_AT },
];

function merchant(mid: string, bazaarId: string, name: string, category: string, email: string, phone: string) {
  return { mid, bazaar_id: bazaarId, name, category, email, phone_number: phone, created_at: CREATED_AT };
}

export const merchants = [
  merchant("MID-KOR-001", "koramangala", "Filter Kapi", "cafe", "koramangala.filterkapi@example.com", "+919810000001"),
  merchant("MID-KOR-002", "koramangala", "FreshKart", "kirana", "koramangala.freshkart@example.com", "+919810000002"),
  merchant("MID-KOR-003", "koramangala", "Udupi Darshini", "restaurant", "koramangala.udupidarshini@example.com", "+919810000003"),
  merchant("MID-IND-001", "indiranagar", "Sharma Electronics", "electronics", "indiranagar.sharmaelectronics@example.com", "+919810000004"),
  merchant("MID-IND-002", "indiranagar", "Apollo Pharmacy", "pharmacy", "indiranagar.apollopharmacy@example.com", "+919810000005"),
];

type EventName = [name: string, type: string] | null;

function event(
  n: number,
  mid: string,
  order: number,
  type: "ACQUIRING" | "REFUND",
  status: string,
  code: string,
  amount: number,
  refund: number,
  txnAt: string,
  mode: string,
  settlement: string,
  settledAt: string | null,
  weather: string,
  named: EventName,
) {
  const id = String(n).padStart(4, "0");
  return {
    txn_id: `TXN-DEMO-${id}`,
    mid,
    order_id: `ORD-DEMO-${String(order).padStart(4, "0")}`,
    transaction_type: type,
    status,
    response_code: code,
    amount_inr: amount,
    refund_amount_inr: refund,
    txn_at: txnAt,
    payment_mode: mode,
    settlement_status: settlement,
    settlement_at: settledAt,
    weather_condition: weather,
    event_name: named?.[0] ?? null,
    event_type: named?.[1] ?? null,
    created_at: CREATED_AT,
  };
}

const ODI: EventName = ["India vs Australia ODI", "sports_event"];
const FOOD_FEST: EventName = ["Koramangala Food Festival", "local_event"];

// Deliberately not in txn_at order, so ordering is the adapter's job.
export const paymentEvents = [
  event(10, "MID-KOR-002", 2, "REFUND", "TXN_SUCCESS", "01", 742.5, 250, "2026-09-19T11:08:21+05:30", "UPI", "SETTLED", "2026-09-20T06:12:00+05:30", "clear", null),
  event(1, "MID-KOR-001", 1, "ACQUIRING", "TXN_SUCCESS", "01", 185, 0, "2026-09-18T08:42:16+05:30", "UPI", "SETTLED", "2026-09-19T06:15:00+05:30", "cloudy", null),
  event(2, "MID-KOR-002", 2, "ACQUIRING", "TXN_SUCCESS", "01", 742.5, 0, "2026-09-18T10:17:43+05:30", "UPI", "SETTLED", "2026-09-19T06:18:00+05:30", "cloudy", null),
  event(3, "MID-KOR-003", 3, "ACQUIRING", "TXN_SUCCESS", "01", 428, 0, "2026-09-18T13:05:28+05:30", "DC", "SETTLED", "2026-09-19T06:22:00+05:30", "rain", ODI),
  event(4, "MID-IND-001", 4, "ACQUIRING", "TXN_FAILURE", "227", 3499, 0, "2026-09-18T14:26:51+05:30", "CC", "NOT_ELIGIBLE", null, "rain", null),
  event(5, "MID-IND-002", 5, "ACQUIRING", "PENDING", "402", 612, 0, "2026-09-18T15:11:09+05:30", "UPI", "PENDING", null, "rain", null),
  event(6, "MID-KOR-002", 6, "ACQUIRING", "TXN_SUCCESS", "01", 1268.75, 0, "2026-09-18T17:38:34+05:30", "UPI", "SETTLED", "2026-09-19T06:31:00+05:30", "heavy_rain", FOOD_FEST),
  event(7, "MID-KOR-003", 7, "ACQUIRING", "TXN_SUCCESS", "01", 895, 0, "2026-09-18T19:22:47+05:30", "PPI", "SETTLED", "2026-09-19T06:37:00+05:30", "cloudy", ODI),
  event(8, "MID-IND-001", 8, "ACQUIRING", "TXN_SUCCESS", "01", 18999, 0, "2026-09-18T20:04:12+05:30", "CC", "SETTLED", "2026-09-19T06:42:00+05:30", "clear", null),
  event(9, "MID-IND-002", 9, "ACQUIRING", "TXN_SUCCESS", "01", 347.4, 0, "2026-09-18T21:16:55+05:30", "UPI", "PENDING", null, "clear", null),
];

function metric(
  mid: string,
  date: string,
  successful: number,
  pending: number,
  failed: number,
  gross: string,
  refunds: string,
  net: string,
) {
  // numeric/bigint given as strings, as PostgREST can return them.
  return {
    mid,
    business_date: date,
    successful_transactions: String(successful),
    pending_transactions: String(pending),
    failed_transactions: String(failed),
    gross_sales_inr: gross,
    refunds_inr: refunds,
    net_sales_inr: net,
  };
}

export const merchantDailyMetrics = [
  metric("MID-KOR-001", "2026-09-18", 1, 0, 0, "185.00", "0", "185.00"),
  metric("MID-KOR-002", "2026-09-18", 2, 0, 0, "2011.25", "0", "2011.25"),
  metric("MID-KOR-002", "2026-09-19", 0, 0, 0, "0", "250.00", "-250.00"),
  metric("MID-KOR-003", "2026-09-18", 2, 0, 0, "1323.00", "0", "1323.00"),
  metric("MID-IND-001", "2026-09-18", 1, 0, 1, "18999.00", "0", "18999.00"),
  metric("MID-IND-002", "2026-09-18", 1, 1, 0, "347.40", "0", "347.40"),
];

export function seedTables() {
  return {
    bazaars,
    merchants,
    payment_events: paymentEvents,
    merchant_daily_metrics: merchantDailyMetrics,
  };
}
