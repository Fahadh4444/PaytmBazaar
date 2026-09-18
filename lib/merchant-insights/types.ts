export interface MerchantInsightSnapshot {
  merchant: {
    mid: string;
    name: string;
    category: string;
  };
  periodEnd: string | null;
  successfulTransactions: number;
  grossSalesInr: number;
  averageOrderValueInr: number;
  failedTransactions: number;
  pendingTransactions: number;
  refundsInr: number;
  sevenDaySalesInr: number;
  previousSevenDaySalesInr: number;
  sevenDayChangePercent: number | null;
  leadingPaymentMode: string | null;
}
