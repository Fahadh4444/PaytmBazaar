# Planned API Contract

> **Status: Proposed API — not implemented.** None of the endpoints below exist
> in the codebase. There is no `app/api/` directory yet. This document records
> the agreed endpoint contract so UI and backend work can proceed in parallel
> (see [development.md](development.md#working-in-parallel)). Create each route
> when the vertical slice that needs it is built.
>
> Request and response shapes are **conceptual**. Exact field names and types
> are defined when each route is implemented, from what the M2M engine actually
> produces — consistent with the engine's deliberately undefined output
> contract ([m2m-engine.md](m2m-engine.md#what-is-not-built-yet)).

For how these endpoints fit the user journey, see [flow.md](flow.md).

## Endpoint groups

```
/api/context

── Shared intelligence (City / Bazaar) ───────────────────────
/api/city/*
/api/bazaars/*
/api/bazaar/*

── Merchant ──────────────────────────────────────────────────
/api/merchant/{id}/*
    Shared / network (Merchant Dialog, left side)
    /overview
    /trends
    /comparison
    /analysis
    /opportunities

    Private intelligence + action layer (Merchant Dialog, right side)
    /private-analysis
    /private-trends
    /ask
    /recommendations
    /history
    /interactions
    /actions
    /recommendation/{recommendationId}/decision
    /workflows
    /workflows/{workflowId}
    /experiments
    /experiments/{experimentId}
    /outcomes
```

There are two clearly separate layers:

| Layer | Endpoints | Visible to |
| --- | --- | --- |
| **Shared intelligence** | `/api/context`, `/api/city/*`, `/api/bazaars/*`, `/api/bazaar/*`, and the merchant `overview` / `trends` / `comparison` / `analysis` / `opportunities` | The shared Bazaar experience. Aggregated / anonymized only. |
| **Private merchant intelligence + action** | Every other `/api/merchant/{id}/*` endpoint | Only the merchant `{id}`, through Paytm |

## Privacy rules for every endpoint

- No response ever contains another merchant's private or raw figures.
- Network, cohort, Bazaar and City figures are aggregates, and are only
  surfaced for cohorts of at least `MIN_COHORT_SIZE` merchants
  (`m2m-engine/index.ts`).
- Private endpoints return data only for the merchant they are scoped to.

## Context

### `POST /api/context` — Proposed

Updates the active analysis context. Used by both the City page and the Bazaar
page.

Conceptual payload:

- `weather`
- `day`
- `time`
- `event`
- scope / context information, if required (e.g. which City or Bazaar)

Context is an **input to the intelligence engine**, not a UI filter. A change
causes the relevant City / Bazaar intelligence to be recalculated.

## City — shared intelligence

### `GET /api/city/insights` — Proposed

City-level patterns and trends, category movement, relevant aggregated
intelligence, context-aware city insights.

### `GET /api/city/analysis` — Proposed

Detailed city-level analysis: aggregated metrics, patterns, market/category
movement, context-aware analysis.

## Bazaars — shared intelligence

### `GET /api/bazaars/insights` — Proposed

Cross-Bazaar view from the City page: compare Bazaars, Bazaar-level movement,
Bazaar trends, relevant aggregated insights.

### `GET /api/bazaar/{id}/analysis` — Proposed

Bazaar GMV, transactions, category movement, demand patterns, market drivers,
context-aware patterns and other aggregated Bazaar intelligence.

### `GET /api/bazaar/{id}/insights` — Proposed

Relevant Bazaar insights, detected patterns, opportunities, aggregated network
intelligence.

## Merchant — shared / network intelligence (left side)

### `GET /api/merchant/{id}/overview` — Proposed

Business overview, GMV, transactions, AOV, growth, basic merchant metrics.

### `GET /api/merchant/{id}/trends` — Proposed

Transaction trends, GMV trends, time-based trends, category trends, relevant
changes.

### `GET /api/merchant/{id}/comparison` — Proposed

Compares:

```
Merchant  vs  relevant merchant cohort  vs  Bazaar  vs  City
```

Only aggregated / anonymized network information is returned. Never another
merchant's private or raw data.

### `GET /api/merchant/{id}/analysis` — Proposed

Merchant performance analysis, transaction changes, detected patterns,
cross-level comparison, context-aware analysis.

### `GET /api/merchant/{id}/opportunities` — Proposed

Relevant growth opportunities, detected gaps, network signals, and the evidence
supporting each opportunity.

## Merchant — private intelligence (right side)

### `POST /api/merchant/{id}/ask` — Implemented as `POST /api/merchants/{id}/chat`

Implemented, with `/chat/voice` (spoken questions) and `/chat/speech` (Listen).
See [ask-bazaar.md](ask-bazaar.md) and [intelligence-pipeline.md](intelligence-pipeline.md#api).

Ask Bazaar. The merchant asks a natural-language question, e.g. "Why are my
sales falling?", "What are similar businesses seeing?", "Have we seen this
pattern before?".

Conceptually combines M2M intelligence + merchant data + Bazaar/City context +
Cognee historical context, and uses the LLM to explain the result. The LLM does
not calculate core metrics.

### `GET /api/merchant/{id}/private-analysis` — Proposed

Merchant-specific private analysis, personalized insights, private business
context.

### `GET /api/merchant/{id}/private-trends` — Proposed

The merchant's private trends, historical performance, personalized trend
analysis.

### `GET /api/merchant/{id}/recommendations` — Proposed

Evidence-backed, merchant-specific recommendations generated from relevant M2M
opportunities.

### `GET /api/merchant/{id}/history` — Proposed

Relevant historical context retrieved from Cognee: previous situations,
insights, recommendations, actions and experiment outcomes.

### `POST /api/merchant/{id}/interactions` — Proposed

Stores merchant interactions: questions, decisions, relevant conversational /
action context.

## Merchant — action layer (right side)

### `POST /api/merchant/{id}/recommendation/{recommendationId}/decision` — Proposed

Records the merchant's decision on a recommendation:

- `approve` — the recommendation can proceed toward an action / workflow
- `reject` — it does not proceed

### `POST /api/merchant/{id}/actions` — Proposed

Direct merchant action, triggered from the private merchant experience without
a separate recommendation-approval step. May trigger an n8n workflow.

### `POST /api/merchant/{id}/workflows` — Proposed

Triggers an n8n workflow for an approved or direct merchant action. Passes the
required merchant / action / context information and tracks workflow
execution.

### `GET /api/merchant/{id}/workflows/{workflowId}` — Proposed

Workflow status: running, completed or failed, plus execution details.

### `POST /api/merchant/{id}/experiments` — Proposed

Creates a growth experiment after a merchant action / recommendation.

Conceptually contains:

- baseline
- action
- target metric
- start / end
- experiment context

### `GET /api/merchant/{id}/experiments/{experimentId}` — Proposed

Experiment progress, current status, execution state.

### `GET /api/merchant/{id}/outcomes` — Proposed

Experiment outcome: before vs after, GMV change, transaction change, growth,
experiment impact.

## Summary table

| Method | Path | Layer | Status |
| --- | --- | --- | --- |
| POST | `/api/context` | Context | Proposed |
| GET | `/api/city/insights` | Shared | Proposed |
| GET | `/api/city/analysis` | Shared | Proposed |
| GET | `/api/bazaars/insights` | Shared | Proposed |
| GET | `/api/bazaar/{id}/analysis` | Shared | Proposed |
| GET | `/api/bazaar/{id}/insights` | Shared | Proposed |
| GET | `/api/merchant/{id}/overview` | Shared (left) | Proposed |
| GET | `/api/merchant/{id}/trends` | Shared (left) | Proposed |
| GET | `/api/merchant/{id}/comparison` | Shared (left) | Proposed |
| GET | `/api/merchant/{id}/analysis` | Shared (left) | Proposed |
| GET | `/api/merchant/{id}/opportunities` | Shared (left) | Proposed |
| POST | `/api/merchant/{id}/ask` | Private (right) | Proposed |
| GET | `/api/merchant/{id}/private-analysis` | Private (right) | Proposed |
| GET | `/api/merchant/{id}/private-trends` | Private (right) | Proposed |
| GET | `/api/merchant/{id}/recommendations` | Private (right) | Proposed |
| GET | `/api/merchant/{id}/history` | Private (right) | Proposed |
| POST | `/api/merchant/{id}/interactions` | Private (right) | Proposed |
| POST | `/api/merchant/{id}/recommendation/{recommendationId}/decision` | Action (right) | Proposed |
| POST | `/api/merchant/{id}/actions` | Action (right) | Proposed |
| POST | `/api/merchant/{id}/workflows` | Action (right) | Proposed |
| GET | `/api/merchant/{id}/workflows/{workflowId}` | Action (right) | Proposed |
| POST | `/api/merchant/{id}/experiments` | Action (right) | Proposed |
| GET | `/api/merchant/{id}/experiments/{experimentId}` | Action (right) | Proposed |
| GET | `/api/merchant/{id}/outcomes` | Action (right) | Proposed |
