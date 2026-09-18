# Data Adapter

> **Status: implemented.** This is the current Data Adapter layer, in
> [`lib/paytm/`](../lib/paytm). It is the first backend layer of the
> [intelligence flow](architecture.md#backend-intelligence-flow-agreed-design);
> the [M2M engine](m2m-engine.md) is built on it.

## Why it exists

The intelligence system needs business data: bazaars, merchants, payment
events, daily figures. It must not need to know where that data lives or how it
is queried.

```
Supabase (PostgreSQL)
      ↓
lib/supabase/server.ts       one server client, secret key
      ↓
lib/paytm/adapter            PaytmSupabaseAdapter: queries, paging, mapping, errors
      ↓
PaytmDataSource + domain types
      ↓
M2M engine                   asks for "merchants", "transactions", "daily metrics"
```

The engine asks *"give me this merchant's transactions for this week"*. The
adapter turns that into a query against `payment_events`. Table names, column
names, PostgREST filter syntax and Supabase errors stop at the adapter.

## What it owns

- **Reading** every table and view that holds prototype merchant data.
- **Mapping** database rows (`snake_case`, numeric-as-string) to domain types
  (`camelCase`, numbers, UTC ISO timestamps).
- **Filtering** by merchant, bazaar, category, time range, status, transaction
  type, payment mode, weather and event.
- **Paging** large results safely.
- **Validating** input, and turning every failure into a `PaytmDataError`.

## What it does not own

The adapter retrieves data. It does not interpret it. It never calculates:

- GMV, AOV, growth, trends or any other merchant metric
- cohort membership or cohort averages
- patterns, relevance, opportunities or recommendations
- the meaning of weather or events for sales

Daily figures come from the database's `merchant_daily_metrics` view unchanged.
The adapter does not recalculate them from events.

It also does not write. No feature writes merchant data yet.

## Current sources

All synthetic Paytm-like prototype data. No production Paytm data and no Paytm
API are involved. The schema is in `supabase/migrations/`.

| Source | Kind | Becomes |
| --- | --- | --- |
| `bazaars` | table | `Bazaar` |
| `merchants` | table | `Merchant` (and `MerchantWithBazaar`) |
| `payment_events` | table | `PaymentEvent`, with weather/event as `context` |
| `merchant_daily_metrics` | view over `payment_events` | `MerchantDailyMetric` |

### Field meanings are preserved

| Field | Meaning |
| --- | --- |
| `PaymentEvent.amountInr` | transaction amount; on a refund, the original order amount |
| `PaymentEvent.refundAmountInr` | amount refunded; 0 on `ACQUIRING` events |
| `transactionType`, `status` | kept as the raw codes (`ACQUIRING`/`REFUND`, `TXN_SUCCESS`/`PENDING`/`TXN_FAILURE`) |
| `grossSalesInr` | sum of successful `ACQUIRING` amounts that day |
| `refundsInr` | sum of successful refunds that day |
| `netSalesInr` | gross minus refunds; can be negative |
| `successful/pending/failedTransactions` | counts of `ACQUIRING` events by status |
| `businessDate` | the calendar date in Asia/Kolkata |

Not every payment event is a sale. Consumers must check `transactionType` and
`status`.

## Using it

```ts
import { getPaytmDataSource, NotFoundError } from "@/lib/paytm";

const paytm = getPaytmDataSource(); // server-only

const events = await paytm.getMerchantTransactions("PBZKOR001", {
  range: { start: "2026-09-01T00:00:00+05:30", end: "2026-09-08T00:00:00+05:30" },
  status: "TXN_SUCCESS",
});
```

`lib/paytm` imports `lib/supabase/server`, so it can only run on the server:
in route handlers, server components and server actions. Client code may use
`import type` for the domain types.

## Capabilities

All methods are on `PaytmDataSource` (`lib/paytm/adapter/types.ts`).

**Bazaars:** `getBazaars()` and `getBazaar(bazaarId)`.

**Merchants:**

- `getMerchants({ bazaarId?, category? })`
- `getMerchant(mid)`
- `getMerchantWithBazaar(mid)`
- `getMerchantsByBazaar(bazaarId)`
- `getMerchantsByCategory(category, bazaarId?)`

**Payment events:**

| Method | Scope |
| --- | --- |
| `getTransactions(query)` | any combination of `mids`, `bazaarId`, `category`, plus filters |
| `getMerchantTransactions(mid, filter?)` | one merchant |
| `getMerchantTransactionsForRange(mid, range, filter?)` | one merchant, required range |
| `getTransactionsForMerchants(mids, filter?)` | several merchants |
| `getBazaarTransactions(bazaarId, filter?)` | every merchant in a bazaar |
| `getTransactionsForRange(range, filter?)` | every merchant, required range |

A `TransactionFilter` can narrow any of these. Each field takes one value or an
array of values:

- `range`
- `status`
- `transactionType`
- `paymentMode`
- `weather`
- `eventType`
- `eventName`
- `duringEvent` (true or false)
- `page`

**Daily metrics:**

- `getDailyMetrics(query)`
- `getMerchantDailyMetrics(mid, range?)`
- `getDailyMetricsForMerchants(mids, range?)`
- `getBazaarDailyMetrics(bazaarId, range?)`
- `getDailyMetricsForRange(range)`

### Ranges

- `TimeRange { start, end }` is for events. Values are instants (ISO strings or
  `Date`s), half-open: `start` is included and `end` is not.
- `DateRange { from, to }` is for daily metrics. Values are `YYYY-MM-DD`
  Asia/Kolkata business dates, inclusive at both ends.

### Ordering and paging

Entities come back ordered by ID. Events are ordered by `txnAt`, then `txnId`.
Metrics are ordered by `businessDate`, then `mid`.

Without a `page`, the adapter reads every matching row in 1000-row batches,
since Supabase caps each response at 1000. It stops with `ResultTooLargeError`
past 25,000 rows rather than loading an unbounded table into memory. For wide
queries, pass a range or a narrower scope, or request `page: { limit, offset }`
yourself. `limit` must be between 1 and 1000.

### Errors

Every failure is a `PaytmDataError` with a `code`. Raw Supabase errors never
escape; they are kept only as `cause`.

| Error | `code` | When |
| --- | --- | --- |
| `NotFoundError` (`entity`, `ids`) | `not_found` | a named bazaar or merchant does not exist |
| `InvalidQueryError` | `invalid_query` | reversed/empty/unparseable range, impossible date, bad page, blank ID |
| `ResultTooLargeError` | `result_too_large` | an unpaged read passed the row cap |
| `DataSourceError` | `unavailable` | Supabase unconfigured, unreachable, or rejected the query |

A valid query that matches nothing returns `[]`. That includes a bazaar that
exists but has no merchants. A bazaar or merchant that does not exist throws
`NotFoundError`, so an unknown merchant is never mistaken for one with no
sales. Invalid input is rejected before any query runs.

## Files

```
lib/paytm/
  index.ts                 public boundary: getPaytmDataSource(), types, errors
  adapter/
    types.ts               domain types, query types, PaytmDataSource interface (no imports)
    errors.ts              PaytmDataError and subclasses
    validation.ts          ranges, pages, IDs — shared by any implementation
    supabase.ts            PaytmSupabaseAdapter — the only file that knows table names
    index.ts               adapter exports (no server-only), for tests and implementations
    __tests__/             node:test suite against an in-memory fake Supabase client
```

Tests run with `npm test`. They use the repository's own demo seed in a fake
client, so they need no network or credentials.

## How the M2M engine depends on it

The engine depends on the `PaytmDataSource` **interface** and the domain types,
never on `PaytmSupabaseAdapter` or `lib/supabase`. `adapter/types.ts` has no
imports, so a type-only dependency on it brings in nothing. The caller, such as
an API route, calls `getPaytmDataSource()` and hands the data, or the data
source itself, to the engine. Tests can hand it a fake.

This is how it works now: `analyzeMerchant(source, input)` takes the data
source as an argument, and `m2m-engine/types.ts` re-exports these domain types
instead of keeping its own.

## Extending it

**New tables** (customer data, merchant profiles, goals, experiments,
outcomes, contextual data): add a domain type and methods to `PaytmDataSource`,
then implement them in `PaytmSupabaseAdapter`. Existing methods and their
callers stay as they are.

**A new source.** If authorized access to a real Paytm API ever exists, write
`PaytmApiAdapter implements PaytmDataSource`, reusing `validation.ts` and
`errors.ts`, and choose it in `getPaytmDataSource()`. The engine does not
change. A source could also combine both: Supabase for our own tables, an API
for transactions.

```
PaytmDataSource
  ├── PaytmSupabaseAdapter   (implemented, synthetic prototype data)
  └── PaytmApiAdapter        (not implemented, no authorized access)
```

Nothing here calls a Paytm API, and nothing should claim it does.
