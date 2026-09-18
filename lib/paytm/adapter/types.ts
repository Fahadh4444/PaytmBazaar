/**
 * Domain types returned by the Paytm data source.
 *
 * These describe business data — bazaars, merchants, payment events and daily
 * rollups — not database rows. Nothing above `lib/paytm` should know that they
 * come from Supabase tables, what those tables are called, or how their
 * columns are spelled. Row shapes and mapping live in `supabase.ts`.
 *
 * Values mirror the database's check constraints exactly. Codes such as
 * `TXN_SUCCESS` and `ACQUIRING` are kept as-is rather than renamed, so their
 * meaning cannot drift between the database and the application.
 *
 * All data behind this contract today is synthetic Paytm-like prototype data.
 * No production Paytm data or API is involved.
 *
 * This file has no imports on purpose: any layer, including the M2M engine,
 * can depend on these types without depending on Supabase.
 */

// --- Vocabulary -------------------------------------------------------------

export type MerchantCategory =
  | "restaurant"
  | "cafe"
  | "kirana"
  | "pharmacy"
  | "bakery"
  | "electronics"
  | "fashion"
  | "textiles";

/** `ACQUIRING` is a payment taken; `REFUND` is money returned against an order. */
export type TransactionType = "ACQUIRING" | "REFUND";

export type TransactionStatus = "TXN_SUCCESS" | "PENDING" | "TXN_FAILURE";

export type PaymentMode = "UPI" | "CC" | "DC" | "PPI" | "NB";

export type SettlementStatus = "PENDING" | "SETTLED" | "NOT_ELIGIBLE";

export type WeatherCondition = "clear" | "cloudy" | "rain" | "heavy_rain";

export type EventType =
  | "festival"
  | "public_holiday"
  | "local_event"
  | "sports_event"
  | "payday";

// --- Entities ---------------------------------------------------------------

export interface Bazaar {
  id: string;
  name: string;
  city: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface Merchant {
  /** Paytm merchant ID. */
  mid: string;
  bazaarId: string;
  name: string;
  category: MerchantCategory;
  /**
   * Private contact details. They exist for acting on the merchant's own
   * behalf and must never be shown to another merchant.
   */
  email: string;
  phoneNumber: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export interface MerchantWithBazaar extends Merchant {
  bazaar: Bazaar;
}

/**
 * Circumstances recorded alongside a payment event. The adapter only reports
 * them. What they mean for sales is for the intelligence layer to decide.
 */
export interface TransactionContext {
  weather: WeatherCondition;
  /** A named event in effect at the time, or null when there was none. */
  event: { name: string; type: EventType } | null;
}

/**
 * One payment event, exactly as recorded. It is not necessarily a sale: check
 * `transactionType` and `status` before treating it as one.
 */
export interface PaymentEvent {
  txnId: string;
  mid: string;
  orderId: string;
  transactionType: TransactionType;
  status: TransactionStatus;
  responseCode: string;
  /** Transaction amount in rupees. On a refund this is the original order amount. */
  amountInr: number;
  /** Refunded amount in rupees. Zero on `ACQUIRING` events. */
  refundAmountInr: number;
  /** ISO 8601 timestamp of the transaction. */
  txnAt: string;
  paymentMode: PaymentMode;
  settlementStatus: SettlementStatus;
  /** ISO 8601 timestamp; null unless `settlementStatus` is `SETTLED`. */
  settlementAt: string | null;
  context: TransactionContext;
  /** ISO 8601 timestamp the record was written. */
  createdAt: string;
}

/**
 * Daily rollup for one merchant, calculated by the database. The adapter
 * passes these figures through and never recalculates them.
 */
export interface MerchantDailyMetric {
  mid: string;
  /** Calendar date in Asia/Kolkata, `YYYY-MM-DD`. */
  businessDate: string;
  /** Count of successful `ACQUIRING` events. */
  successfulTransactions: number;
  /** Count of pending `ACQUIRING` events. */
  pendingTransactions: number;
  /** Count of failed `ACQUIRING` events. */
  failedTransactions: number;
  /** Sum of successful `ACQUIRING` amounts, in rupees. */
  grossSalesInr: number;
  /** Sum of successful refund amounts, in rupees. */
  refundsInr: number;
  /** `grossSalesInr - refundsInr`. May be negative on a day with only refunds. */
  netSalesInr: number;
}

// --- Queries ----------------------------------------------------------------

/**
 * A span of time, half-open: `start` is included and `end` is not.
 * Accepts ISO 8601 strings (with an offset) or `Date` objects.
 */
export interface TimeRange {
  start: string | Date;
  end: string | Date;
}

/**
 * A span of Asia/Kolkata business dates, inclusive at both ends.
 * Both dates are `YYYY-MM-DD`.
 */
export interface DateRange {
  from: string;
  to: string;
}

/**
 * One page of results. Without a page, the adapter reads every matching row
 * in batches, up to a safety cap (see `PaytmSupabaseAdapterOptions.maxRows`).
 */
export interface Page {
  /** 1 to 1000. */
  limit: number;
  /** Rows to skip. Defaults to 0. */
  offset?: number;
}

/** Matches one value, or any of several. */
export type OneOrMany<T> = T | T[];

export interface MerchantFilter {
  bazaarId?: string;
  category?: MerchantCategory;
}

/** Everything a transaction lookup can be narrowed by, apart from whose transactions they are. */
export interface TransactionFilter {
  range?: TimeRange;
  status?: OneOrMany<TransactionStatus>;
  transactionType?: OneOrMany<TransactionType>;
  paymentMode?: OneOrMany<PaymentMode>;
  weather?: OneOrMany<WeatherCondition>;
  eventType?: OneOrMany<EventType>;
  eventName?: string;
  /** true: only during a named event. false: only when there was none. */
  duringEvent?: boolean;
  page?: Page;
}

/**
 * Whose transactions to read. Scope fields combine: `{ bazaarId, category }`
 * is one category within one Bazaar. With no scope, every merchant is included,
 * so pass a `range`.
 */
export interface MerchantScope {
  mids?: string[];
  bazaarId?: string;
  category?: MerchantCategory;
}

export interface TransactionQuery extends MerchantScope, TransactionFilter {}

export interface DailyMetricsQuery extends MerchantScope {
  range?: DateRange;
  page?: Page;
}

// --- The data source --------------------------------------------------------

/**
 * Everything the intelligence system can ask of Paytm-like merchant data.
 *
 * `PaytmSupabaseAdapter` implements it against our Supabase prototype
 * database. A real Paytm integration, if authorized access ever exists, would
 * be another implementation of this same interface, and callers would not
 * change.
 *
 * Results are ordered: entities by ID, payment events by `txnAt` then `txnId`,
 * and daily metrics by `businessDate` then `mid`.
 *
 * Errors are always `PaytmDataError` subclasses (see `errors.ts`):
 * `NotFoundError` when a named bazaar or merchant does not exist,
 * `InvalidQueryError` for malformed input such as a reversed range, and
 * `DataSourceError` when the underlying store fails. A query that is valid but
 * matches nothing returns an empty array.
 */
export interface PaytmDataSource {
  // Bazaars
  getBazaars(): Promise<Bazaar[]>;
  getBazaar(bazaarId: string): Promise<Bazaar>;

  // Merchants
  getMerchants(filter?: MerchantFilter): Promise<Merchant[]>;
  getMerchant(mid: string): Promise<Merchant>;
  getMerchantWithBazaar(mid: string): Promise<MerchantWithBazaar>;
  getMerchantsByBazaar(bazaarId: string): Promise<Merchant[]>;
  getMerchantsByCategory(category: MerchantCategory, bazaarId?: string): Promise<Merchant[]>;

  // Payment events
  getTransactions(query: TransactionQuery): Promise<PaymentEvent[]>;
  getMerchantTransactions(mid: string, filter?: TransactionFilter): Promise<PaymentEvent[]>;
  getMerchantTransactionsForRange(
    mid: string,
    range: TimeRange,
    filter?: TransactionFilter,
  ): Promise<PaymentEvent[]>;
  getTransactionsForMerchants(mids: string[], filter?: TransactionFilter): Promise<PaymentEvent[]>;
  getBazaarTransactions(bazaarId: string, filter?: TransactionFilter): Promise<PaymentEvent[]>;
  getTransactionsForRange(range: TimeRange, filter?: TransactionFilter): Promise<PaymentEvent[]>;

  // Daily metrics
  getDailyMetrics(query: DailyMetricsQuery): Promise<MerchantDailyMetric[]>;
  getMerchantDailyMetrics(mid: string, range?: DateRange): Promise<MerchantDailyMetric[]>;
  getDailyMetricsForMerchants(mids: string[], range?: DateRange): Promise<MerchantDailyMetric[]>;
  getBazaarDailyMetrics(bazaarId: string, range?: DateRange): Promise<MerchantDailyMetric[]>;
  getDailyMetricsForRange(range: DateRange): Promise<MerchantDailyMetric[]>;
}
