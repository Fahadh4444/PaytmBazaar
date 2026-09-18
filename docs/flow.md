# End-to-end flow

> **Status: agreed design, not implemented.** This document describes the
> finalized UI → API → Backend → Intelligence → Action → Learning flow. The
> endpoints referenced here are a **Planned API Contract** — see
> [api.md](api.md). None of them exist in the codebase yet.

## Overview

```
Landing
  ↓
City
  ↓
Bazaar
  ↓
Merchant Dialog
  ├── Left:  Shared / Bazaar Intelligence
  └── Right: Private Merchant Intelligence + Actions
  ↓
Recommendation / Action
  ↓
n8n
  ↓
Outcome
  ↓
Cognee
  ↓
Future Intelligence
```

The single most important distinction in the product is the split inside the
Merchant Dialog:

| Side | What it is | Who it is for |
| --- | --- | --- |
| **Left** | Shared / network / Bazaar intelligence | The shared Bazaar experience |
| **Right** | Private merchant intelligence, questions, recommendations and actions | Only that merchant, through Paytm |

The right side may trigger n8n workflows, directly or indirectly.

## 1. Landing page

No backend endpoint. The landing page only navigates into Paytm Bazaar.

## 2. City page

### 2.1 Context update

The City page has controls for **weather**, **day**, **time** and **event**.
When any of them changes, the backend updates the active analysis context and
intelligence is recalculated.

- `POST /api/context` — shared with the Bazaar page.

Changing context is an **input to the intelligence engine**, not a UI filter.
It changes what is computed, not only what is shown.

### 2.2 City-level insights

User clicks City Insights.

- `GET /api/city/insights` — city-level patterns, trends, category movement,
  relevant aggregated intelligence, context-aware city insights.

### 2.3 Bazaar-level insights (from the City)

User wants to see what is happening across Bazaars.

- `GET /api/bazaars/insights` — compare Bazaars, Bazaar-level movement and
  trends, relevant aggregated insights.

### 2.4 City analysis

- `GET /api/city/analysis` — detailed city-level analysis: aggregated metrics,
  patterns, market/category movement, context-aware analysis.

## 3. Bazaar page

### 3.1 Context update

Same controls (weather, day, time, event), same endpoint:

- `POST /api/context`

Context changes cause the relevant Bazaar intelligence to refresh/recalculate.

### 3.2 Bazaar analysis

User clicks Bazaar Analysis.

- `GET /api/bazaar/{id}/analysis` — Bazaar GMV, transactions, category
  movement, demand patterns, market drivers, context-aware patterns and other
  aggregated Bazaar intelligence.

### 3.3 Bazaar insights

- `GET /api/bazaar/{id}/insights` — relevant Bazaar insights, detected
  patterns, opportunities, aggregated network intelligence.

## 4. Merchant Dialog — left side (shared / network intelligence)

Selecting a merchant inside a Bazaar opens the Merchant Dialog. The left side
shows information derived from the Bazaar/network and merchant-level analytics
that belongs to the shared Bazaar experience.

| Step | Endpoint | Purpose |
| --- | --- | --- |
| 4.1 Overview | `GET /api/merchant/{id}/overview` | Business overview, GMV, transactions, AOV, growth, basic metrics |
| 4.2 Trends | `GET /api/merchant/{id}/trends` | Transaction, GMV, time-based and category trends; relevant changes |
| 4.3 Comparison | `GET /api/merchant/{id}/comparison` | Merchant vs cohort vs Bazaar vs City |
| 4.4 Analysis | `GET /api/merchant/{id}/analysis` | Performance, transaction changes, detected patterns, cross-level comparison, context-aware analysis |
| 4.5 Opportunities | `GET /api/merchant/{id}/opportunities` | Growth opportunities, detected gaps, network signals, supporting evidence |

The comparison never exposes another merchant's private or raw data. Only
aggregated, anonymized network information is returned (see
[Privacy](architecture.md#privacy)).

## 5. Merchant Dialog — right side (private merchant intelligence)

This is what **only** the selected merchant sees through the Paytm app/website.
It is not another dashboard. It is the merchant's private intelligence,
questions, personalized trends, recommendations, decisions, actions,
experiments and outcomes.

| Step | Endpoint | Purpose |
| --- | --- | --- |
| 5.1 Ask Bazaar | `POST /api/merchant/{id}/ask` | Merchant asks questions in natural language |
| 5.2 Private analysis | `GET /api/merchant/{id}/private-analysis` | Merchant-specific analysis, personalized insights, private business context |
| 5.3 Private trends | `GET /api/merchant/{id}/private-trends` | Private trends, historical performance, personalized trend analysis |
| 5.4 Recommendations | `GET /api/merchant/{id}/recommendations` | Evidence-backed, merchant-specific recommendations from relevant M2M opportunities |
| 5.5 History | `GET /api/merchant/{id}/history` | Previous situations, insights, recommendations, actions and experiment outcomes, retrieved from Cognee |
| 5.6 Interactions | `POST /api/merchant/{id}/interactions` | Store questions, decisions and conversational/action context |
| 5.7 Decision | `POST /api/merchant/{id}/recommendation/{recommendationId}/decision` | Approve or reject a recommendation |
| 5.8 Direct action | `POST /api/merchant/{id}/actions` | Merchant triggers an action directly, without a separate approval step |
| 5.9 Trigger workflow | `POST /api/merchant/{id}/workflows` | Start an n8n workflow for an approved/direct action |
| 5.10 Workflow status | `GET /api/merchant/{id}/workflows/{workflowId}` | Running / completed / failed, execution details |
| 5.11 Experiment | `POST /api/merchant/{id}/experiments` | Create a growth experiment after an action/recommendation |
| 5.12 Experiment status | `GET /api/merchant/{id}/experiments/{experimentId}` | Progress, current status, execution state |
| 5.13 Outcomes | `GET /api/merchant/{id}/outcomes` | Before vs after, GMV change, transaction change, growth, impact |

### Ask Bazaar

Example questions:

- Why are my sales falling?
- What is happening in my Bazaar?
- What are similar businesses seeing?
- What opportunity should I act on?
- Have we seen this pattern before?

The backend conceptually combines:

```
M2M Intelligence
  + Merchant Data
  + Bazaar / City Context
  + Cognee Historical Context
  + LLM
```

The LLM explains intelligence that has already been calculated. It does not
calculate core metrics.

## 6. Two paths to action

```
Indirect:  Opportunity → Recommendation → Approval → n8n
Direct:    Merchant → Action → n8n
```

Indirect path, in endpoint terms:

```
GET  /recommendations
  ↓
POST /recommendation/{recommendationId}/decision   (approve)
  ↓
POST /workflows
  ↓
GET  /workflows/{workflowId}
```

Direct path:

```
POST /actions
  ↓
POST /workflows
  ↓
GET  /workflows/{workflowId}
```

A rejected recommendation does not proceed to a workflow.

## 7. Outcome / learning loop

```
Action
  ↓
Experiment            POST /experiments, GET /experiments/{experimentId}
  ↓
Outcome Measurement   GET /outcomes
  ↓
Store Outcome
  ↓
Cognee
  ↓
Future Intelligence   GET /history, POST /ask
  ↓
Better contextual recommendations
```

This is the continuous learning loop: every situation, insight, action and
outcome becomes context that makes the next recommendation more relevant.

See [architecture.md](architecture.md) for the backend intelligence flow and the
roles of the M2M engine, Cognee, the LLM and n8n.
