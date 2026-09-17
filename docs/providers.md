# External provider strategy

This project is built in a hackathon, where external access changes without
warning. The approach is: **stable internal boundaries, unstable external
integrations**.

Every integration sits behind a small boundary in `lib/`. Product code depends
on the boundary. Provider details do not leak past it.

## Status

| Provider | Role | Status |
| --- | --- | --- |
| Supabase | PostgreSQL, structured facts | Clients implemented; no schema yet |
| OpenRouter | LLM provider | Implemented |
| Sarvam | Possible future LLM / voice / multilingual | **Not integrated** — no confirmed access |
| Cognee | Contextual memory | Boundary only — not implemented |
| n8n | Action orchestration | Boundary only — not implemented |
| Paytm | Intended data source | **No authorized access** — synthetic data only |

Nothing in this repository calls a Paytm API, and none of the demo data is real
Paytm merchant data. Do not describe the prototype as connected to Paytm
production data.

## LLM boundary

```
product code  →  lib/llm  →  provider
```

`lib/llm/types.ts` defines `LlmProvider`, `LlmRequest`, `LlmResponse` and
`LlmError`. `lib/llm/openrouter.ts` is the only file that knows OpenRouter's
wire format. `lib/llm/index.ts` picks a provider from `LLM_PROVIDER` (default
`openrouter`).

Adding Sarvam later means: write `lib/llm/sarvam.ts` implementing
`LlmProvider`, add one entry to the map in `index.ts`. The M2M engine, the API
routes and the UI do not change. That is the entire reason this boundary exists.

Sarvam is not implemented and will not be until real access and documentation
exist. Guessed endpoints are worse than a missing feature.

## Cognee

Contextual memory: what did this merchant face before, what was recommended,
what did they do, what happened. Not the database, not the engine, not an LLM.

Raw transactions belong in PostgreSQL. Deterministic analytics belong in the
engine. Cognee is for retrieving relevant history and relationships — "last time
evening sales dropped, what worked?"

Not implemented yet: we have credits but have not confirmed the API surface
against real credentials. `isCogneeConfigured()` is the whole boundary today.
Cognee is optional and must stay optional.

## n8n

Action orchestration, after intelligence and after merchant approval:

```
insight  →  recommendation  →  merchant approves  →  n8n  →  action  →  outcome
```

The M2M algorithm does not move into n8n. Workflows execute business actions;
the application owns the intelligence.

Not implemented yet — there is no approved action to execute.

## Failure strategy

Optional dependencies must not become hard dependencies.

- **Cognee unavailable** → continue with structured context; the answer is
  thinner, not absent.
- **OpenRouter fails** → the LLM-dependent operation returns a clear
  `LlmError`. Unrelated parts of the product keep working.
- **Sarvam available later and failing** → fall back to OpenRouter where
  configured and appropriate.
- **n8n unavailable** → the insight and recommendation still exist and are still
  shown. Only action execution fails, and it reports that it failed.
- **Supabase unconfigured** → clients throw a descriptive error at the call
  site, not at import time, so pages that do not touch the database still render.

Configuration is read lazily everywhere for this reason: a missing key breaks
the feature that needs it, not application startup.
