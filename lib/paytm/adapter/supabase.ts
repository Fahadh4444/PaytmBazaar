/**
 * Supabase-backed implementation of `PaytmDataSource`.
 *
 * This file is the only place that knows the prototype database's table
 * names, column names and query syntax. It reads, maps rows to domain types,
 * and nothing else: no metric, trend, or comparison is calculated here. The
 * daily rollup is the database's `merchant_daily_metrics` view, passed through
 * unchanged.
 *
 * The data behind it is synthetic Paytm-like prototype data (see
 * `supabase/migrations/`). No Paytm API is called.
 *
 * The client is injected rather than imported, so this class stays free of
 * `server-only` and can be tested against a fake. Product code gets an
 * instance from `getPaytmDataSource()` in `lib/paytm`.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { DataSourceError, NotFoundError, ResultTooLargeError } from "./errors";
import type {
  Bazaar,
  DailyMetricsQuery,
  DateRange,
  EventType,
  Merchant,
  MerchantCategory,
  MerchantDailyMetric,
  MerchantFilter,
  MerchantScope,
  MerchantWithBazaar,
  OneOrMany,
  PaymentEvent,
  PaymentMode,
  PaytmDataSource,
  SettlementStatus,
  TimeRange,
  TransactionFilter,
  TransactionQuery,
  TransactionStatus,
  TransactionType,
  WeatherCondition,
} from "./types";
import {
  MAX_PAGE_SIZE,
  normalizeDateRange,
  normalizePage,
  normalizeTimeRange,
  requireId,
  requireIds,
} from "./validation";

const BAZAARS = "bazaars";
const MERCHANTS = "merchants";
const PAYMENT_EVENTS = "payment_events";
const MERCHANT_DAILY_METRICS = "merchant_daily_metrics";

// --- Row shapes (database-specific, never exported) -------------------------

interface BazaarRow {
  id: string;
  name: string;
  city: string;
  created_at: string;
}

interface MerchantRow {
  mid: string;
  bazaar_id: string;
  name: string;
  category: MerchantCategory;
  email: string;
  phone_number: string;
  created_at: string;
}

interface PaymentEventRow {
  txn_id: string;
  mid: string;
  order_id: string;
  transaction_type: TransactionType;
  status: TransactionStatus;
  response_code: string;
  amount_inr: number | string;
  refund_amount_inr: number | string;
  txn_at: string;
  payment_mode: PaymentMode;
  settlement_status: SettlementStatus;
  settlement_at: string | null;
  weather_condition: WeatherCondition;
  event_name: string | null;
  event_type: EventType | null;
  created_at: string;
}

interface MerchantDailyMetricRow {
  mid: string;
  business_date: string;
  successful_transactions: number | string;
  pending_transactions: number | string;
  failed_transactions: number | string;
  gross_sales_inr: number | string;
  refunds_inr: number | string;
  net_sales_inr: number | string;
}

// --- Mapping ----------------------------------------------------------------

// PostgREST may return numeric and bigint columns as strings, so every
// number goes through Number(). Timestamps are normalised to UTC ISO 8601.
const toIso = (timestamp: string) => new Date(timestamp).toISOString();

function toBazaar(row: BazaarRow): Bazaar {
  return { id: row.id, name: row.name, city: row.city, createdAt: toIso(row.created_at) };
}

function toMerchant(row: MerchantRow): Merchant {
  return {
    mid: row.mid,
    bazaarId: row.bazaar_id,
    name: row.name,
    category: row.category,
    email: row.email,
    phoneNumber: row.phone_number,
    createdAt: toIso(row.created_at),
  };
}

function toPaymentEvent(row: PaymentEventRow): PaymentEvent {
  return {
    txnId: row.txn_id,
    mid: row.mid,
    orderId: row.order_id,
    transactionType: row.transaction_type,
    status: row.status,
    responseCode: row.response_code,
    amountInr: Number(row.amount_inr),
    refundAmountInr: Number(row.refund_amount_inr),
    txnAt: toIso(row.txn_at),
    paymentMode: row.payment_mode,
    settlementStatus: row.settlement_status,
    settlementAt: row.settlement_at === null ? null : toIso(row.settlement_at),
    context: {
      weather: row.weather_condition,
      // The schema guarantees name and type are both set or both null.
      event:
        row.event_name !== null && row.event_type !== null
          ? { name: row.event_name, type: row.event_type }
          : null,
    },
    createdAt: toIso(row.created_at),
  };
}

function toMerchantDailyMetric(row: MerchantDailyMetricRow): MerchantDailyMetric {
  return {
    mid: row.mid,
    businessDate: row.business_date,
    successfulTransactions: Number(row.successful_transactions),
    pendingTransactions: Number(row.pending_transactions),
    failedTransactions: Number(row.failed_transactions),
    grossSalesInr: Number(row.gross_sales_inr),
    refundsInr: Number(row.refunds_inr),
    netSalesInr: Number(row.net_sales_inr),
  };
}

// --- Query plumbing ---------------------------------------------------------

/** A filterable `select("*")` query. */
type Query = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

/** The database is untyped, so rows arrive as `unknown` and are cast once, in `run`. */
interface QueryResult {
  data: unknown;
  error: PostgrestError | null;
}

/** Any ordered query that can be windowed with `.range()`. */
interface RangeableQuery {
  range(from: number, to: number): PromiseLike<QueryResult>;
}

function matchAny<T extends string>(query: Query, column: string, value: OneOrMany<T> | undefined): Query {
  if (value === undefined) return query;
  return Array.isArray(value) ? query.in(column, value) : query.eq(column, value);
}

export interface PaytmSupabaseAdapterOptions {
  /**
   * Rows fetched per request when reading a whole result. Must not exceed the
   * project's PostgREST `max-rows` setting (1000 by default on Supabase), or
   * reads end early.
   */
  pageSize?: number;
  /**
   * Most rows one call may return without an explicit page. Past this, the
   * call fails with `ResultTooLargeError` rather than loading an unbounded
   * number of payment events into memory.
   */
  maxRows?: number;
}

export const DEFAULT_MAX_ROWS = 25_000;

export class PaytmSupabaseAdapter implements PaytmDataSource {
  private readonly pageSize: number;
  private readonly maxRows: number;

  constructor(
    private readonly client: SupabaseClient,
    options: PaytmSupabaseAdapterOptions = {},
  ) {
    this.pageSize = options.pageSize ?? MAX_PAGE_SIZE;
    this.maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  }

  // --- Bazaars --------------------------------------------------------------

  async getBazaars(): Promise<Bazaar[]> {
    const rows = await this.readAll<BazaarRow>("bazaars", () =>
      this.client.from(BAZAARS).select("*").order("id"),
    );
    return rows.map(toBazaar);
  }

  async getBazaar(bazaarId: string): Promise<Bazaar> {
    requireId(bazaarId, "bazaarId");
    const row = await this.run<BazaarRow>(
      "bazaar",
      this.client.from(BAZAARS).select("*").eq("id", bazaarId).maybeSingle(),
    );
    if (!row) throw new NotFoundError("bazaar", [bazaarId]);
    return toBazaar(row);
  }

  // --- Merchants ------------------------------------------------------------

  async getMerchants(filter: MerchantFilter = {}): Promise<Merchant[]> {
    // Distinguish "no such bazaar" from "a bazaar with no merchants".
    if (filter.bazaarId !== undefined) await this.getBazaar(filter.bazaarId);

    const rows = await this.readAll<MerchantRow>("merchants", () => {
      let query = this.client.from(MERCHANTS).select("*");
      if (filter.bazaarId !== undefined) query = query.eq("bazaar_id", filter.bazaarId);
      if (filter.category !== undefined) query = query.eq("category", filter.category);
      return query.order("mid");
    });
    return rows.map(toMerchant);
  }

  async getMerchant(mid: string): Promise<Merchant> {
    requireId(mid, "mid");
    const row = await this.run<MerchantRow>(
      "merchant",
      this.client.from(MERCHANTS).select("*").eq("mid", mid).maybeSingle(),
    );
    if (!row) throw new NotFoundError("merchant", [mid]);
    return toMerchant(row);
  }

  async getMerchantWithBazaar(mid: string): Promise<MerchantWithBazaar> {
    const merchant = await this.getMerchant(mid);
    return { ...merchant, bazaar: await this.getBazaar(merchant.bazaarId) };
  }

  async getMerchantsByBazaar(bazaarId: string): Promise<Merchant[]> {
    return this.getMerchants({ bazaarId: requireId(bazaarId, "bazaarId") });
  }

  async getMerchantsByCategory(category: MerchantCategory, bazaarId?: string): Promise<Merchant[]> {
    return this.getMerchants({ category: requireId(category, "category") as MerchantCategory, bazaarId });
  }

  // --- Payment events -------------------------------------------------------

  async getTransactions(query: TransactionQuery): Promise<PaymentEvent[]> {
    // Validate everything before touching the database.
    const range = query.range ? normalizeTimeRange(query.range) : undefined;
    const page = query.page ? normalizePage(query.page) : undefined;

    const mids = await this.resolveScope(query);
    if (mids?.length === 0) return [];

    const rows = await this.readAll<PaymentEventRow>(
      "payment events",
      () => {
        let q = this.client.from(PAYMENT_EVENTS).select("*");
        if (mids) q = q.in("mid", mids);
        if (range) q = q.gte("txn_at", range.start).lt("txn_at", range.end);
        q = matchAny(q, "status", query.status);
        q = matchAny(q, "transaction_type", query.transactionType);
        q = matchAny(q, "payment_mode", query.paymentMode);
        q = matchAny(q, "weather_condition", query.weather);
        q = matchAny(q, "event_type", query.eventType);
        if (query.eventName !== undefined) q = q.eq("event_name", query.eventName);
        if (query.duringEvent === true) q = q.not("event_type", "is", null);
        if (query.duringEvent === false) q = q.is("event_type", null);
        return q.order("txn_at").order("txn_id");
      },
      page,
    );
    return rows.map(toPaymentEvent);
  }

  async getMerchantTransactions(mid: string, filter: TransactionFilter = {}): Promise<PaymentEvent[]> {
    return this.getTransactions({ ...filter, mids: [requireId(mid, "mid")] });
  }

  async getMerchantTransactionsForRange(
    mid: string,
    range: TimeRange,
    filter: TransactionFilter = {},
  ): Promise<PaymentEvent[]> {
    return this.getMerchantTransactions(mid, { ...filter, range });
  }

  async getTransactionsForMerchants(mids: string[], filter: TransactionFilter = {}): Promise<PaymentEvent[]> {
    return this.getTransactions({ ...filter, mids });
  }

  async getBazaarTransactions(bazaarId: string, filter: TransactionFilter = {}): Promise<PaymentEvent[]> {
    return this.getTransactions({ ...filter, bazaarId: requireId(bazaarId, "bazaarId") });
  }

  async getTransactionsForRange(range: TimeRange, filter: TransactionFilter = {}): Promise<PaymentEvent[]> {
    // The range is what bounds this query, so it is mandatory here.
    return this.getTransactions({ ...filter, range: normalizeTimeRange(range) });
  }

  // --- Daily metrics --------------------------------------------------------

  async getDailyMetrics(query: DailyMetricsQuery): Promise<MerchantDailyMetric[]> {
    const range = query.range ? normalizeDateRange(query.range) : undefined;
    const page = query.page ? normalizePage(query.page) : undefined;

    const mids = await this.resolveScope(query);
    if (mids?.length === 0) return [];

    const rows = await this.readAll<MerchantDailyMetricRow>(
      "daily metrics",
      () => {
        let q = this.client.from(MERCHANT_DAILY_METRICS).select("*");
        if (mids) q = q.in("mid", mids);
        if (range) q = q.gte("business_date", range.from).lte("business_date", range.to);
        return q.order("business_date").order("mid");
      },
      page,
    );
    return rows.map(toMerchantDailyMetric);
  }

  async getMerchantDailyMetrics(mid: string, range?: DateRange): Promise<MerchantDailyMetric[]> {
    return this.getDailyMetrics({ mids: [requireId(mid, "mid")], range });
  }

  async getDailyMetricsForMerchants(mids: string[], range?: DateRange): Promise<MerchantDailyMetric[]> {
    return this.getDailyMetrics({ mids, range });
  }

  async getBazaarDailyMetrics(bazaarId: string, range?: DateRange): Promise<MerchantDailyMetric[]> {
    return this.getDailyMetrics({ bazaarId: requireId(bazaarId, "bazaarId"), range });
  }

  async getDailyMetricsForRange(range: DateRange): Promise<MerchantDailyMetric[]> {
    return this.getDailyMetrics({ range: normalizeDateRange(range) });
  }

  // --- Internals ------------------------------------------------------------

  /**
   * Turns a scope into the list of merchant IDs to read, or `undefined` for
   * "every merchant". Named merchants and bazaars must exist.
   */
  private async resolveScope({ mids, bazaarId, category }: MerchantScope): Promise<string[] | undefined> {
    let scoped = mids === undefined ? undefined : requireIds(mids, "mid");
    if (scoped && scoped.length > 0) await this.assertMerchantsExist(scoped);

    if (bazaarId !== undefined || category !== undefined) {
      const inScope = new Set((await this.getMerchants({ bazaarId, category })).map((m) => m.mid));
      scoped = scoped ? scoped.filter((mid) => inScope.has(mid)) : [...inScope];
    }
    return scoped;
  }

  private async assertMerchantsExist(mids: string[]): Promise<void> {
    const rows = await this.readAll<Pick<MerchantRow, "mid">>("merchants", () =>
      this.client.from(MERCHANTS).select("mid").in("mid", mids).order("mid"),
    );
    const found = new Set(rows.map((row) => row.mid));
    const missing = mids.filter((mid) => !found.has(mid));
    if (missing.length > 0) throw new NotFoundError("merchant", missing);
  }

  /** Runs one query and converts any failure into a `DataSourceError`. */
  private async run<T>(what: string, query: PromiseLike<QueryResult>): Promise<T | null> {
    let result: QueryResult;
    try {
      result = await query;
    } catch (cause) {
      throw new DataSourceError(`Could not read ${what} from the Paytm data source.`, { cause });
    }
    if (result.error) {
      throw new DataSourceError(`Could not read ${what} from the Paytm data source.`, {
        cause: result.error,
      });
    }
    return result.data as T | null;
  }

  /**
   * Reads one requested page, or every matching row in `pageSize` batches up
   * to `maxRows`. `build` must return a fresh, ordered query on each call so
   * that batches line up.
   */
  private async readAll<Row>(
    what: string,
    build: () => RangeableQuery,
    page?: { limit: number; offset: number },
  ): Promise<Row[]> {
    if (page) {
      const rows = await this.run<Row[]>(what, build().range(page.offset, page.offset + page.limit - 1));
      return rows ?? [];
    }

    const rows: Row[] = [];
    for (;;) {
      const batch =
        (await this.run<Row[]>(what, build().range(rows.length, rows.length + this.pageSize - 1))) ?? [];
      rows.push(...batch);
      if (rows.length > this.maxRows) throw new ResultTooLargeError(this.maxRows);
      if (batch.length < this.pageSize) return rows;
    }
  }
}
