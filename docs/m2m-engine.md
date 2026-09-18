# M2M engine

> **Status: implemented.** This is the M2M domain layer, in
> [`m2m-engine/`](../m2m-engine). It reads data through the
> [Data Adapter](data-adapter.md) and returns structured intelligence. API
> routes, UI, the LLM, Cognee and n8n do not consume it yet.

## What M2M means here

M2M stands for merchant-to-merchant. A merchant learns from how comparable
merchants around them are doing, without seeing any one of those merchants'
private figures. The engine answers:

> How is this merchant performing against relevant merchants around it, and
> what Bazaar or network pattern stands out?

Everything else in the repository either feeds the engine data or
communicates its results.

## Deterministic, always

Numbers come from calculations over data, not from a language model.

```
transactions  →  M2M calculations  →  structured insight  →  LLM explanation
```

Never:

```
transactions  →  LLM  →  "what do you think happened?"
```

If a merchant's sales go from ₹45,000 to ₹30,000, the engine computes the
change and compares it with an appropriate cohort. It does not ask a model
whether sales fell. The LLM's job starts after the truth is established, and it
is limited to wording.

## Responsibilities

**M2M does:**

- metrics and aggregation
- cohort formation
- comparison with the cohort, the Bazaar and the city
- context analysis
- pattern detection
- evidence
- Bazaar Impact
- opportunity detection

**M2M does not:**

- call an LLM, Cognee or n8n
- write conversational text or recommendations
- trigger UI
- execute merchant actions
- query the database

## Dependencies

The engine imports nothing outside itself except the Data Adapter's domain
**types** (`lib/paytm/adapter/types.ts`). That file has no imports, so the
engine pulls in no React, Next.js, Supabase or provider SDK.

Data arrives through the `PaytmDataSource` interface, which the caller passes
in:

```ts
import { getPaytmDataSource } from "@/lib/paytm";
import { analyzeMerchant } from "@/m2m-engine";

const intelligence = await analyzeMerchant(getPaytmDataSource(), {
  merchantId: "PBZKOR001",
  current: { from: "2026-09-24", to: "2026-09-30" }, // previous defaults to 09-17 → 09-23
});
```

`analyzeMerchant` is the only function that reads data. It makes five adapter
calls:

- the merchant
- the bazaars
- the merchants
- the city's daily metrics for both periods
- the successful payments of the merchant and its cohort

Everything after that is the pure function `buildM2MIntelligence`, so the
whole pipeline is testable without a network.

## Pipeline

```
Data Adapter
  ↓
Merchant Metrics        metrics.ts
  ↓
Cohort Formation        cohort.ts
  ↓
Cohort / Category / Bazaar / City metrics   groups.ts
  ↓
Context Analysis        context.ts
  ↓
M2M Comparison          comparison.ts
  ↓
Evidence                evidence.ts
  ↓
Pattern Detection       patterns.ts
  ↓
Bazaar Impact           impact.ts
  ↓
Opportunity Detection   opportunities.ts
  ↓
M2MIntelligence         analyze.ts
```

Every threshold lives in `config.ts`.

### Periods

A comparison is a current period and a previous period of the same length.
By default the previous period is the one immediately before the current one:
current 09-10 → 09-16 compares with 09-03 → 09-09. The caller chooses the
dates; nothing is hardcoded. Dates are inclusive IST business dates, the same
calendar as the `merchant_daily_metrics` view. Periods that are reversed,
unequal in length or overlapping throw `M2MInputError`.

### Merchant Metrics

There are five figures, calculated the same way for every period and every
group:

| Metric | Definition |
| --- | --- |
| GMV | sum of the view's `grossSalesInr` (successful `ACQUIRING` amounts) |
| Transactions | sum of `successfulTransactions` |
| AOV | GMV / transactions. `null` when there are no transactions |
| Growth | GMV growth vs the previous period, in % (one decimal). `null` when previous GMV is 0 |
| Refunds | sum of `refundsInr` (successful refunds) |

The metrics come from the database's daily rollup, so the engine never
re-decides what a successful sale or a refund is. When a value is undefined,
it is `null`, never `0`, `NaN` or `Infinity`.

### Cohort Formation

The cohort is chosen by fixed rules, with no similarity model, embeddings or
LLM:

1. **Same Bazaar and same category** (`basis: "bazaar_category"`).
2. If that gives fewer than `MIN_COHORT_SIZE` (5) peers, use the **same
   category across the city** (`basis: "city_category"`).
3. If the cohort is still too small, it is `reportable: false`.

The merchant is never in its own cohort.

### Cohort, Category, Bazaar and City metrics

These use the same five figures, aggregated over a group. Group AOV is group
GMV divided by group transactions, not an average of merchants' AOVs.

| Group | Members |
| --- | --- |
| Cohort | from Cohort Formation |
| Category | same category across the city, excluding the merchant (feeds `categoryGrowth`) |
| Bazaar | every merchant in the merchant's Bazaar |
| City | every merchant in every Bazaar with the same `city`. Supports any number of cities |

Privacy rule: a group's figures are returned only if it contains at least
`MIN_COHORT_SIZE` merchants besides the viewing merchant. Otherwise the figures
are `null` and the group is marked `reportable: false`.

### Context Analysis

The engine buckets the successful sales of the merchant and its cohort by four
dimensions:

- time of day: morning, afternoon, evening or night, in IST
- day of week
- weather
- event type, or `none`

For each segment it reports current and previous GMV, transactions, growth,
and the segment's share of the period's GMV.

A segment's cohort figures are withheld unless at least `MIN_COHORT_SIZE`
cohort merchants traded in it.

This describes when sales happened, not why. Weather and events differ between
periods, so segment growth partly reflects how often a condition occurred. The
engine reports associations only: "observed during", "coincides with". It
never says one thing caused another.

To add a dimension, add one entry to `DIMENSIONS` in `context.ts`.

### M2M Comparison

The merchant is compared with the cohort, the Bazaar and the city. Each
comparison gives:

- merchant growth and group growth
- `growthGap` in percentage points
- the direction of each: `up`, `down`, `flat` (within ±2%) or `unknown`
- `aovGap` in percent

A comparison with a group that isn't reportable is `available: false`, and
all its values are `null`.

### Pattern Detection

Deterministic rules. Each rule is one entry in `RULES` in `patterns.ts`.

| Pattern | Rule |
| --- | --- |
| `MERCHANT_DOWN_NETWORK_UP` | merchant down, cohort up |
| `MERCHANT_UP_NETWORK_DOWN` | merchant up, cohort down |
| `MERCHANT_DOWN_BAZAAR_UP` | merchant down, Bazaar up |
| `MERCHANT_UP_BAZAAR_DOWN` | merchant up, Bazaar down |
| `NETWORK_WIDE_GROWTH` | merchant, cohort and Bazaar all up |
| `NETWORK_WIDE_DECLINE` | merchant, cohort and Bazaar all down |
| `MERCHANT_ALIGNS_WITH_NETWORK` | same direction as the cohort, within 5 points |
| `CONTEXT_NETWORK_GROWTH` | in one segment, the cohort is up and the merchant is down by at least 10 points (e.g. evening = "EVENING_NETWORK_GROWTH") |

Rules that involve a group need that group to be reportable.

Context patterns need at least 20 of the merchant's own transactions in the
segment in each period. Day-of-week patterns also need a period of 14 days or
more, because in a 7-day window each weekday occurs only once. At most three
context patterns are reported, strongest first.

### Evidence

Every pattern carries the figures behind it:

- merchant, cohort, Bazaar and city GMV growth
- cohort size and basis
- the observation window
- for context patterns, the segment's own figures

A later layer can answer "why was this detected?" from the evidence alone.
The engine writes no explanation text.

### Bazaar Impact

Bazaar Impact describes the network around the merchant. It is not a
dashboard metric.

| Field | Meaning |
| --- | --- |
| `bazaarGrowth`, `cohortGrowth`, `categoryGrowth`, `cityGrowth` | GMV growth of each group |
| `demandTrend` | growth and direction of the Bazaar's transaction count |
| `networkBasis` | the group that stands in for "the network": the cohort if reportable, otherwise the Bazaar |
| `networkDirection` | direction of the network's growth |
| `merchantVsNetworkGap` | merchant growth minus network growth, in points (e.g. -18 vs +14 → -32) |

### Opportunity Detection

Opportunities are built from patterns and Bazaar Impact. Each one has:

- `type`
- a fixed `title`
- a `reason` code
- `priority`
- the patterns behind it
- `evidence`

| Opportunity | When | Priority |
| --- | --- | --- |
| `CLOSE_NETWORK_GAP` | merchant down while the cohort or Bazaar is up, or at least 10 points behind a flat or growing network | by gap: ≥25 high, ≥15 medium, else low |
| `CAPTURE_CONTEXT_DEMAND` | the strongest `CONTEXT_NETWORK_GROWTH` | at most medium, because a segment is a smaller sample |
| `SUSTAIN_OUTPERFORMANCE` | merchant up while the cohort or Bazaar is down | low |

The engine says where the merchant stands. What to do about it is for the
LLM layer to phrase, later.

## Output: `M2MIntelligence`

```
{
  merchantId, bazaarId, city, category,
  period:          { current, previous, days },
  cohort:          { basis, category, size, reportable },   // no member IDs
  merchantMetrics: { merchantId, current: {gmv, transactions, aov, growth, refunds}, previous },
  cohortMetrics, categoryMetrics, bazaarMetrics, cityMetrics,   // GroupMetrics
  comparisons:     [cohort, bazaar, city],
  context:         { segments: [...] },
  patterns:        [{ type, evidence }],
  evidence,
  bazaarImpact,
  opportunities:   [{ type, title, reason, priority, patterns, evidence }],
  limitations:     ["COHORT_FALLBACK_TO_CITY_CATEGORY", ...]
}
```

This is the contract that future API, UI and LLM layers consume. The types are
in `m2m-engine/types.ts`.

`limitations` explains why some output is missing or thin. The values are:

- `COHORT_FALLBACK_TO_CITY_CATEGORY`
- `COHORT_TOO_SMALL`
- `BAZAAR_TOO_SMALL`
- `CITY_TOO_SMALL`
- `NO_MERCHANT_ACTIVITY`
- `NO_PREVIOUS_PERIOD_GMV`

When the data can't support a figure, the engine reports that state. It does
not invent a value.

## Privacy

The output is safe to show the merchant it describes. It contains:

- the merchant's own figures
- aggregates over groups of at least `MIN_COHORT_SIZE` other merchants
- cohort shape (basis, category, size)

It never contains another merchant's name, ID, contact details, figures or
transactions. The engine uses individual rows internally to build aggregates,
and a test checks the serialised output for leaks.

## No assumed relationships

The engine never assumes something like "rain reduces restaurant sales". Any
relationship between weather, time, day, category and revenue must come from
the data, and the data is allowed to show no relationship at all.

## Current data limitations

- **Cohorts always use the fallback today.** The synthetic dataset has one
  merchant per category per Bazaar, so every cohort is "same category across
  Bengaluru": 5 peers, exactly `MIN_COHORT_SIZE`. Every live result carries
  `COHORT_FALLBACK_TO_CITY_CATEGORY`. With 5 or more same-category merchants in
  a Bazaar, the primary rule applies automatically.
- **One city.** City and Bazaar figures are real, but "city" is Bengaluru only.
- **Short windows are noisy.** Context segments in a 7-day window rest on few
  days. That's why the thresholds above exist, and why context opportunities
  cap at medium priority.
- **Speed.** One analysis takes about 1 second against the live database.
  That's fine for one merchant per request; analysing all merchants at once
  would need batching.

## Tests

`m2m-engine/__tests__/` runs under `npm test`, using hand-calculable fixtures
and an in-memory `PaytmDataSource`. It needs no network.
