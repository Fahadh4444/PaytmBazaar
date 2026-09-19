# Architecture

Paytm Bazaar turns the merchant network itself into an intelligence source: a
merchant learns from privacy-preserving patterns across comparable businesses,
never from another merchant's private figures.

This document describes the boundaries that exist today and what each one is
responsible for. It describes the *foundation*, not the finished product — most
of the product is not built yet.

## One question per layer

| Layer | Question it answers |
| --- | --- |
| `lib/paytm/` | Where does merchant data come from? (the Data Adapter) |
| `lib/supabase/` | What structured facts do we have? |
| `m2m-engine/` | What is true right now? |
| `lib/cognee/` | What relevant context do we remember? |
| `lib/llm/` | How do we explain it? |
| `lib/n8n/` | How do we act on it? |

Keeping these separate is the point of the repository. If a change makes one
layer answer another layer's question, it is the wrong change.

## Repository layout

```
app/              Next.js application (App Router) and API routes
components/       Shared UI components (created when the first one exists)
m2m-engine/       Deterministic merchant-to-merchant intelligence — core product
data/             Synthetic UI demo data (city/bazaar screens)
lib/
  paytm/          Data Adapter — the only reader of merchant data (see data-adapter.md)
  supabase/       Application-side database access
  llm/            LLM provider boundary (OpenRouter today)
  cognee/         Contextual memory boundary
  n8n/            Action / workflow boundary
supabase/
  migrations/     Database schema — source of truth
docs/             This documentation
```

### Two Supabase directories, on purpose

`supabase/` is **infrastructure**: migrations, schema evolution — *what the
database is*. `lib/supabase/` is **application code**: clients and queries —
*how the app reaches it*. They change for different reasons and are not
duplication.

### Why `m2m-engine/` is top-level and the integrations are not

Cognee, n8n, the LLM and the Paytm data source are all external things we wrap.
They belong under `lib/`, where the job is to keep a third party's shape from
leaking into the product.

The M2M engine is not external. It is the product. It gets its own top-level
boundary because it is the thing we are actually building.

## Data flow

```
Supabase  →  lib/paytm (Data Adapter)  →  domain types  →  m2m-engine
                                                       ↓
                                              deterministic insight
                                                       ↓
                                                   relevance
                                                       ↓
                              (optional) remembered context from Cognee
                                                       ↓
                                        lib/llm  →  explanation
                                                       ↓
                                              merchant approval
                                                       ↓
                                         lib/n8n  →  action  →  outcome
                                                       ↓
                                              stored as future context
```

A request uses only the layers it needs. A numeric comparison does not call an
LLM. A database read does not call Cognee. A recommendation with no external
effect does not call n8n.

## Complete pipeline (implemented)

```
Supabase → Data Adapter → M2M → Relevance → Merchant Intelligence service
  → Cognee (history) → LLM (explanation) → Recommendation
  → merchant approval → n8n → Outcome → Supabase + Cognee
```

The end-to-end vertical slice is implemented. See
[intelligence-pipeline.md](intelligence-pipeline.md) for each layer's
responsibility, the LLM/Cognee/n8n abstractions, the approval flow, failure
behaviour, privacy and setup.

## Backend intelligence flow (agreed design)

> **Status: implemented** — see [intelligence-pipeline.md](intelligence-pipeline.md).
> Earlier status note: planned, not implemented. This is the finalized target flow. The
> user-facing journey is in [flow.md](flow.md); the endpoint contract is in
> [api.md](api.md) (Planned API Contract).

```
Synthetic Paytm-like Data
        ↓
Data Adapter                 lib/paytm        ← implemented
        ↓
Data Normalization
        ↓
Intelligence Layer           m2m-engine       ← implemented
        ↓
Structured Intelligence
        ↓
Relevance Engine             relevance-engine ← implemented
        ↓
Cognee + LLM                 lib/cognee, lib/llm
        ↓
Insights / Recommendations
        ↓
Merchant Decision
        ↓
n8n                          lib/n8n
        ↓
Action
        ↓
Outcome Measurement
        ↓
Cognee
        ↓
Future Intelligence
```

### Core hierarchy

```
Transaction
    ↓
Merchant
    ↓
Bazaar
    ↓
City
```

Intelligence flows **upward** through aggregation and comes back **down** as
relevant network insights. Individual merchant data is never exposed to another
merchant (see [Privacy](#privacy)).

### Intelligence layer components

> **Status: implemented.** Components 1–8 and 10 are in `m2m-engine/`
> ([m2m-engine.md](m2m-engine.md)). The Relevance Engine (9) is a separate
> layer in `relevance-engine/` ([relevance-engine.md](relevance-engine.md)).

| # | Component | Responsibility | Where |
| --- | --- | --- | --- |
| 1 | Merchant Metrics | GMV, transactions, AOV, growth, refunds over two periods | `metrics.ts` |
| 2 | Bazaar Aggregation | The same five figures for the merchant's Bazaar | `groups.ts` |
| 3 | City Aggregation | The same five figures for every Bazaar in the city | `groups.ts` |
| 4 | Context Engine | Sales by time of day, weekday, weather, event (associations only) | `context.ts` |
| 5 | Cohort Engine | Same Bazaar + category, falling back to city + category; `MIN_COHORT_SIZE` | `cohort.ts` |
| 6 | Pattern Detection | Deterministic rules over comparisons and context | `patterns.ts` |
| 7 | Cross-Level Comparison | Merchant vs cohort vs Bazaar vs City | `comparison.ts` |
| 8 | Evidence Engine | The figures behind every finding | `evidence.ts` |
| 9 | Relevance Engine | Rank M2M findings by what matters to this merchant now | `relevance-engine/` |
| 10 | Opportunity Engine | Structured opportunities, including **Bazaar Impact** | `impact.ts`, `opportunities.ts` |

`analyzeMerchant()` runs the whole pipeline and returns one `M2MIntelligence`
object, the contract for the future API, UI and LLM layers.

Context (`POST /api/context`) is an input to this layer, not a UI filter:
changing it changes what is computed.

## Roles: M2M engine, Cognee, LLM, n8n

```
M2M Engine  = calculates what is happening
Cognee      = provides relevant historical context
LLM         = explains and communicates the intelligence, generates recommendations
n8n         = executes and orchestrates actions
```

### Cognee — memory / context layer

Cognee remembers situations, insights, recommendations, actions and outcomes:

```
Situation → Insight → Action → Outcome → Cognee → Future relevant context
```

Cognee is **not** the core transaction analytics engine. M2M calculates current
intelligence; Cognee provides historical context.

### LLM — explanation layer

The LLM explains already-calculated intelligence and phrases recommendations. It
is not responsible for calculating core metrics or detecting the underlying
statistical pattern.

```
LlmProvider (lib/llm, primary + fallback)
  ├── Sarvam 105B           (implemented, default)
  └── OpenRouter            (implemented, fallback)

SpeechProvider (lib/speech)
  └── Sarvam                (Saaras STT, Bulbul TTS)
```

Ask Bazaar, the merchant conversation, is described in [ask-bazaar.md](ask-bazaar.md).

### n8n — action / orchestration layer

n8n is not only a notification mechanism. It executes and orchestrates actions:

```
Recommendation → Merchant Approval → n8n → Execute Action → Track Action
      → Measure Outcome → Store Outcome → Cognee
```

Two valid paths lead into n8n:

```
Indirect:  Opportunity → Recommendation → Approval → n8n
Direct:    Merchant → Action → n8n
```

The direct path is triggered from the merchant's private experience (right side
of the Merchant Dialog) without a separate approval step.

### Outcome / learning loop

```
Action
  ↓
Experiment
  ↓
Outcome Measurement
  ↓
Store Outcome
  ↓
Cognee
  ↓
Future Intelligence
  ↓
Better contextual recommendations
```

This is the continuous learning loop.

## Shared vs private intelligence

The Merchant Dialog is split in two, and the backend mirrors that split:

| | Left side | Right side |
| --- | --- | --- |
| Kind | Shared / network / Bazaar intelligence | Private merchant intelligence + actions |
| Audience | The shared Bazaar experience | Only that merchant, through Paytm |
| Data | Aggregated / anonymized | The merchant's own data, plus network insights relevant to them |
| Can act | No | Yes — recommendations, decisions, n8n workflows, experiments |

See [api.md](api.md#endpoint-groups) for which endpoints belong to which side.

## Dependency rules

- `m2m-engine/` imports nothing outside itself except those adapter types. No
  React, no Next.js, no browser APIs, no Supabase, no provider SDKs. It must
  stay runnable and testable on its own.
- The engine gets merchant data only through the `PaytmDataSource` interface,
  passed in by its caller, and imports only the types in
  `lib/paytm/adapter/types.ts` — a file with no imports — never `lib/supabase`
  or table names. See [data-adapter.md](data-adapter.md).
- Everything else may import `m2m-engine/` — that is where the shared domain
  vocabulary (`Merchant`, `Transaction`, `Area`) lives, precisely because it has
  no dependencies and therefore creates no cycles.
- Product code imports `lib/llm`, never `lib/llm/openrouter`. The same applies
  to every other boundary: depend on the boundary, not the provider behind it.

## Privacy

A merchant must never be able to read another merchant's private figures out of
Bazaar. The architecture reflects that rather than relying on discipline:

- individual merchant data flows **into** aggregation, never out to another
  merchant;
- aggregates are only surfaced for cohorts of at least `MIN_COHORT_SIZE`
  merchants (`m2m-engine/index.ts`) — below that, an "aggregate" is one
  merchant's data wearing a hat;
- insights are phrased as network patterns ("similar restaurants in your area
  are seeing stronger evening demand"), never as another merchant's numbers.

Synthetic demo data follows the same model, so the demo cannot accidentally
teach us the wrong habits.

## Current state

Implemented: the Next.js app, the landing page, the domain vocabulary, the
database schema (synthetic Paytm-like data), the Supabase clients, the
**Data Adapter** in `lib/paytm/` ([data-adapter.md](data-adapter.md)), the
**M2M engine** in `m2m-engine/` ([m2m-engine.md](m2m-engine.md)) — metrics,
cohorts, Bazaar/City aggregation, context, patterns, evidence, Bazaar Impact and
opportunities — and the LLM boundary with an OpenRouter provider.

Implemented on top of M2M: the **Relevance Engine** in `relevance-engine/`
([relevance-engine.md](relevance-engine.md)), which ranks M2M findings for the
future LLM layer.

Not implemented: any API route, the Bazaar city, simulation, Ask Bazaar, Cognee recall, and n8n
actions. See [m2m-engine.md](m2m-engine.md) and [providers.md](providers.md).

The endpoints in [api.md](api.md) are a **Planned API Contract**, agreed before
implementation. None of them exist yet.
