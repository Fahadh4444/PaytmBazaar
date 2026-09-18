import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

import type { MerchantInsightSnapshot } from "./types";

type PaymentEvent = {
  transaction_type: "ACQUIRING" | "REFUND";
  status: "TXN_SUCCESS" | "PENDING" | "TXN_FAILURE";
  amount_inr: number | string;
  refund_amount_inr: number | string;
  txn_at: string;
  payment_mode: string;
};

const DAY_MS = 86_400_000;

export async function getMerchantInsightSnapshot(
  bazaarId: string,
  merchantName: string,
): Promise<MerchantInsightSnapshot | null> {
  const supabase = getSupabaseServerClient();
  const { data: merchant, error: merchantError } = await supabase
    .from("merchants")
    .select("mid,name,category")
    .eq("bazaar_id", bazaarId)
    .eq("name", merchantName)
    .maybeSingle();

  if (merchantError) throw merchantError;
  if (!merchant) return null;

  const { data, error } = await supabase
    .from("payment_events")
    .select("transaction_type,status,amount_inr,refund_amount_inr,txn_at,payment_mode")
    .eq("mid", merchant.mid)
    .order("txn_at", { ascending: true });

  if (error) throw error;
  const events = (data ?? []) as PaymentEvent[];
  const successful = events.filter(
    (event) => event.transaction_type === "ACQUIRING" && event.status === "TXN_SUCCESS",
  );
  const latestTime = events.length ? Date.parse(events.at(-1)!.txn_at) : null;
  const currentStart = latestTime === null ? null : latestTime - 7 * DAY_MS;
  const previousStart = latestTime === null ? null : latestTime - 14 * DAY_MS;

  const sum = (values: PaymentEvent[], field: "amount_inr" | "refund_amount_inr") =>
    values.reduce((total, event) => total + Number(event[field]), 0);

  const currentSevenDays = successful.filter(
    (event) => currentStart !== null && Date.parse(event.txn_at) > currentStart,
  );
  const previousSevenDays = successful.filter((event) => {
    if (currentStart === null || previousStart === null) return false;
    const time = Date.parse(event.txn_at);
    return time > previousStart && time <= currentStart;
  });
  const sevenDaySalesInr = sum(currentSevenDays, "amount_inr");
  const previousSevenDaySalesInr = sum(previousSevenDays, "amount_inr");

  const modeCounts = successful.reduce<Record<string, number>>((counts, event) => {
    counts[event.payment_mode] = (counts[event.payment_mode] ?? 0) + 1;
    return counts;
  }, {});
  const leadingPaymentMode =
    Object.entries(modeCounts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;

  const grossSalesInr = sum(successful, "amount_inr");
  const refundsInr = sum(
    events.filter(
      (event) => event.transaction_type === "REFUND" && event.status === "TXN_SUCCESS",
    ),
    "refund_amount_inr",
  );

  return {
    merchant,
    periodEnd: latestTime === null ? null : new Date(latestTime).toISOString(),
    successfulTransactions: successful.length,
    grossSalesInr,
    averageOrderValueInr: successful.length ? grossSalesInr / successful.length : 0,
    failedTransactions: events.filter((event) => event.status === "TXN_FAILURE").length,
    pendingTransactions: events.filter((event) => event.status === "PENDING").length,
    refundsInr,
    sevenDaySalesInr,
    previousSevenDaySalesInr,
    sevenDayChangePercent:
      previousSevenDaySalesInr > 0
        ? ((sevenDaySalesInr - previousSevenDaySalesInr) / previousSevenDaySalesInr) * 100
        : null,
    leadingPaymentMode,
  };
}
