# Intelligence pipeline (end to end)

> **Status: implemented.** Every layer below exists and is tested. LLM,
> Cognee and n8n run for real once their credentials are set (see
> [Setup](#setup)); until then each one reports "not configured" instead of
> pretending.

```
Supabase ─► Data Adapter ─► M2M ─► Relevance ─► Merchant Intelligence service
                                                   │
                                  Cognee (history) ┤
                                    LLM (wording)  ┤
                                                   ▼
                                        Recommendation (proposed action)
                                                   │  merchant approves
                                                   ▼
                                          ActionExecutor ─► n8n
                                                   │
                                                   ▼
                                     Outcome ─► Supabase + Cognee
```

## Layers and responsibilities

| Layer | Where | Does | Never |
| --- | --- | --- | --- |
| Data Adapter | `lib/paytm/` | All Supabase reads, and `merchant_actions` writes | calculate |
| M2M | `m2m-engine/` | Metrics, cohorts, comparisons, patterns, opportunities | read data or call AI |
| Relevance | `relevance-engine/` | Rank M2M findings for this merchant | read data or call AI |
| Merchant Intelligence service | `merchant-intelligence/` | Wire the layers; propose the action; degrade gracefully | calculate metrics or query Supabase |
| Memory | `lib/cognee/` | Remember and recall structured merchant history | store transactions |
| LLM | `lib/llm/` | Word explanations and recommendations | produce figures |
| Action executor | `lib/n8n/` | Run an approved action | decide what to run |
| API | `app/api/` | HTTP interface and error mapping | contain logic |

## Flow for one merchant

`GET /api/merchants/:merchantId/intelligence` runs these steps:

1. Resolve the period: the merchant's latest 7 days against the 7 before, or
   `?from=&to=`.
2. **M2M.** `analyzeMerchant()` over the Data Adapter.
3. **Relevance.** `analyzeRelevance()`.
4. **Proposal.** `proposeAction()` is deterministic, built from Relevance
   alone. It proposes a `SCHEDULE_PROMOTION` when a `CLOSE_NETWORK_GAP` or
   `CAPTURE_CONTEXT_DEMAND` opportunity is medium or high priority. The
   promotion targets the time of day where the merchant trails peers most, if
   one leads; otherwise the whole day.
5. **Memory.** `recall()` asks Cognee for this merchant's similar past
   situations, recommendations, actions and outcomes.
6. **LLM.** The model gets a fact table plus signals, opportunities, the
   proposed action and the recalled history, and replies with validated JSON.
7. **Persist.** The proposal is saved as `proposed` in `merchant_actions` and
   remembered. An identical open proposal is reused, not duplicated.

`POST /api/merchants/:merchantId/actions` with `{ actionId, approved: true }`
runs the approved action through n8n. The result is saved in Supabase and
remembered in Cognee.

`POST /api/merchants/:merchantId/actions/:actionId/outcome` measures the
outcome with M2M: the 7 days from execution against the 7 before. It then
saves and remembers the result, which the next analysis recalls.

## LLM provider abstraction

`LlmProvider` (`lib/llm/types.ts`) has one implementation today: OpenRouter.
The model comes from `OPENROUTER_MODEL`, default `deepseek/deepseek-v4-flash`.
Requests use `response_format: json_object` and a token cap.

### What the model sees

The model sees a **fact table**: every figure it may use, each with an ID,
built from M2M, Relevance and memory (`merchant-intelligence/facts.ts`). It
also sees the merchant's own name, category and Bazaar. It never sees
transactions, other merchants, or contact details.

### Output schema

The schema is `insightSchema` in `merchant-intelligence/insight.ts`. It is
strict: extra keys are rejected.

```json
{
  "summary": "…",
  "whatIsHappening": "…",
  "whyItMatters": "…",
  "opportunity": { "title": "…", "reason": "…" },
  "recommendation": { "action": "…", "expectedOutcome": "…", "confidence": "high|medium|low" },
  "evidence": [{ "factId": "merchant.gmv.growth", "note": "…" }],
  "historicalContext": "…"
}
```

`opportunity` and `historicalContext` may also be `null`.

### Validation

A reply is rejected with status `invalid` and a reason when any of these
fails:

| Reason | What failed |
| --- | --- |
| `INVALID_JSON` | the reply didn't parse as JSON |
| `SCHEMA_MISMATCH` | the schema didn't match |
| `UNKNOWN_FACT` | the evidence cites a fact ID that doesn't exist |
| `UNSUPPORTED_FIGURE` | any text contains a business figure (a %, ₹, points, decimal, or number over 99) that isn't in the fact table. Scaled figures such as "83k" or "1.2 lakh" are also rejected |

Model confidence is capped by cohort quality: high for a primary cohort,
medium for a fallback cohort, low for no cohort.

### What the model can't do

LLM text is never sent to n8n. The executed action and its description are
the deterministic proposal.

## Memory (Cognee) abstraction

`MemoryProvider` (`lib/cognee/types.ts`), implemented over Cognee's
[REST API](https://docs.cognee.ai/api-reference/introduction):

| Operation | Calls |
| --- | --- |
| remember | `POST /api/v1/add` (multipart: the memory as a text file, `datasetName`), then `POST /api/v1/cognify` |
| recall | `POST /api/v1/search` with `search_type: CHUNKS`, restricted to the merchant's dataset |

Requests send `X-Api-Key` and `X-Tenant-Id`.

Each memory (`MerchantMemory`) is a structured record of `kind` (`insight`,
`action_outcome` or `measured_outcome`), the situation (leading relevance
signals and patterns), the recommendation, the action, the outcome, and a
timestamp. There are no transactions and no other merchants.

Privacy works in three layers:

- each merchant has its own dataset (`bazaar_merchant_<mid>`)
- searches are always restricted to that dataset
- recalled records are checked for the merchant ID before use

## Action executor (n8n)

`ActionExecutor` (`lib/n8n/types.ts`) has one implementation, the webhook
executor.

### The request

The executor POSTs the structured action to
`${N8N_BASE_URL}/webhook/bazaar-merchant-action`, or to `N8N_WEBHOOK_URL`
when that's set:

```json
{
  "actionId": "…",
  "merchantId": "…",
  "type": "SCHEDULE_PROMOTION",
  "parameters": { "targetSegment": "evening", "durationDays": 7, "channel": "paytm_merchant_notification" },
  "description": "Run a 7-day evening promotion on Paytm."
}
```

### What counts as executed

The action counts as executed only if the workflow replies
`{ "status": "executed", "reference": … }`. Anything else is recorded as
failed: a network error, a non-2xx status, or a reply without that status.

### The workflow

The workflow is `n8n/workflows/bazaar-merchant-action.json`. It runs a
Webhook node with Header Auth, then a Code node that schedules the promotion
window, then a Respond to Webhook node that confirms with the execution ID.
Add a Slack, email or WhatsApp node after "Schedule promotion" to deliver the
promotion somewhere visible.

## Approval flow

```
proposed ──(merchant approves: approved === true)──► approved ──► n8n ──► executed | failed
```

- Anything but a literal `true` is refused with `approval_required`, and
  nothing runs.
- If no executor is configured, the action is saved as `approved` and the API
  returns 202 with `ACTION_EXECUTOR_NOT_CONFIGURED`. It is not reported as
  executed.
- An action can't be run twice (`invalid_action_state`).
- One merchant can't run another merchant's action: that returns 404.

## Outcome persistence

The outcome is written in two places:

- **Supabase:** `merchant_actions`, created by migration
  `supabase/flyway/sql/V5__create_merchant_actions.sql`. It holds the
  proposal, basis, status, approval and execution times, the n8n reference
  and detail, and the measured outcome.
- **Cognee:** `action_outcome` and `measured_outcome` memories. The next
  analysis recalls them, and they reach the LLM as history, with any figures
  added to the fact table.

## Failure behaviour

| Unavailable | Result |
| --- | --- |
| Cognee | `history.status = unavailable/failed`; the LLM runs without history |
| LLM | `insight.status = unavailable/failed/invalid`; M2M and Relevance are still returned |
| n8n | the proposal shows `executorConfigured: false`; approving saves it as `approved`, pending |
| `merchant_actions` table | the proposal is shown with `actionId: null` (it can't be approved); actions return `action_store_missing` |

## API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/api/merchants/:merchantId/intelligence` | merchant profile, period, `m2m`, `relevance`, `history`, `insight`, `recommendation`, `services` |
| POST | `/api/merchants/:merchantId/actions` | `{ action, execution, pendingReason, memory }`. 200 executed · 502 failed · 202 pending |
| POST | `/api/merchants/:merchantId/actions/:actionId/outcome` | `measured` or `pending_data` |
| POST | `/api/merchants/:merchantId/chat` | an answer grounded in the same fact table; replies with unsupported figures are withheld |
| GET | `/api/bazaars/:bazaarId/merchants` | public profiles (ID, name, category) for the UI |

Errors are `{ error: { code, message } }` and never include causes or
secrets.

## Privacy

- Merchant profiles in responses exclude email and phone.
- The LLM, Cognee and API responses carry only the merchant's own figures and
  aggregates over at least `MIN_COHORT_SIZE` other merchants.
- A test checks all three for peer identities, contact details and
  transactions.
- **There is no authentication yet.** Any caller can request any merchant ID.
  Merchant login must scope these routes before real use.

## Setup

1. **Apply the action table:** run
   `supabase/flyway/sql/V5__create_merchant_actions.sql` in the Supabase SQL
   editor.
2. **LLM:** set `OPENROUTER_API_KEY`, and optionally `OPENROUTER_MODEL`.
3. **Cognee:** set `COGNEE_API_KEY` and `COGNEE_TENANT_ID`, plus
   `COGNEE_BASE_URL` if you're not using `https://api.cognee.ai`.
4. **n8n:**
   1. Import `n8n/workflows/bazaar-merchant-action.json`.
   2. Create a Header Auth credential named `X-Bazaar-Secret` on the webhook
      node, and set its value in `N8N_WEBHOOK_SECRET`.
   3. Activate the workflow.
   4. Set `N8N_BASE_URL`, or `N8N_WEBHOOK_URL` to the webhook's production
      URL.
5. Restart `npm run dev`, then open a merchant in a Bazaar, or call
   `GET /api/merchants/PBZKOR006/intelligence`.

## Limitations

- **One action type** (`SCHEDULE_PROMOTION`), as scoped.
- **The data doesn't react to actions.** Measured outcomes come from the
  synthetic dataset, which runs to 2026-09-30 and wasn't generated in
  response to any promotion.
- **Buildings map to merchants by position.** The shared street render maps
  building N to the Bazaar's Nth merchant.
