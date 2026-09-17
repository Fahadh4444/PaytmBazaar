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
| `lib/paytm/` | Where does merchant data come from? |
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
data/             Synthetic demo data
lib/
  paytm/          Merchant data-source boundary
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
data source  →  lib/paytm  →  structured data  →  m2m-engine
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

## Dependency rules

- `m2m-engine/` imports nothing outside itself. No React, no Next.js, no
  browser APIs, no Supabase, no provider SDKs. It must stay runnable and
  testable on its own.
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
synthetic data source behind `lib/paytm/`, the Supabase clients, and the LLM
boundary with an OpenRouter provider.

Not implemented: cohorting, aggregation, pattern detection, the database schema,
any API route, the Bazaar city, simulation, Ask Bazaar, Cognee recall, and n8n
actions. See [m2m-engine.md](m2m-engine.md) and [providers.md](providers.md).
