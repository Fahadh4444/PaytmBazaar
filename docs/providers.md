# External provider strategy

This project is built in a hackathon, where external access changes without
warning. The approach is: **stable internal boundaries, unstable external
integrations**.

Every integration sits behind a small boundary in `lib/`. Product code depends
on the boundary. Provider details do not leak past it.

## Status

| Provider | Role | Status |
| --- | --- | --- |
| Supabase | PostgreSQL, structured facts | Schema + clients implemented; read through the [Data Adapter](data-adapter.md) |
| Sarvam | Ask Bazaar chat (Sarvam 105B), voice input (Saaras STT), spoken answers (Bulbul TTS) | Implemented (`lib/llm/sarvam.ts`, `lib/speech/`); default LLM, needs `SARVAM_API_KEY` — see [ask-bazaar.md](ask-bazaar.md) |
| OpenRouter | LLM provider | Implemented; fallback when Sarvam is unconfigured or fails |
| Cognee | Contextual memory | Implemented (`MemoryProvider` over the REST API); needs credentials — see [intelligence-pipeline.md](intelligence-pipeline.md) |
| n8n | Action orchestration | Implemented (`ActionExecutor` via one webhook workflow); needs an n8n instance |
| Paytm | Intended data source | **No authorized access** — synthetic data in Supabase behind `PaytmDataSource` |

Nothing in this repository calls a Paytm API, and none of the demo data is real
Paytm merchant data. Do not describe the prototype as connected to Paytm
production data.

## LLM boundary

```
product code  →  lib/llm  →  provider
```

`lib/llm/types.ts` defines `LlmProvider`, `LlmRequest`, `LlmResponse` and
`LlmError`. `lib/llm/sarvam.ts` and `lib/llm/openrouter.ts` are the only files
that know each provider's wire format. `lib/llm/index.ts` picks the primary from
`LLM_PROVIDER` (default `sarvam`) and wraps it with `LLM_FALLBACK_PROVIDER`
(default `openrouter`). `LlmResponse.provider` / `model` report who actually
answered.

Sarvam was added exactly as this boundary intended: one provider file and one
map entry. The M2M engine, the API routes and the insight code did not change.
The endpoints follow Sarvam's published API reference (docs.sarvam.ai).

## Speech boundary

```
Ask Bazaar voice  →  lib/speech  →  Sarvam (Saaras STT, Bulbul TTS)
```

`lib/speech/types.ts` defines `SpeechProvider` (`transcribe`, `synthesize`),
the supported Indian languages and `SpeechError`. `lib/speech/sarvam.ts` is
the only file that knows Sarvam's speech formats. Both Sarvam files share
`lib/sarvam/client.ts`, the one place that reads `SARVAM_API_KEY`.

## Cognee

Contextual memory: what did this merchant face before, what was recommended,
what did they do, what happened. Not the database, not the engine, not an LLM.

Raw transactions belong in PostgreSQL. Deterministic analytics belong in the
engine. Cognee is for retrieving relevant history and relationships — "last time
evening sales dropped, what worked?"

Implemented in `lib/cognee/` as a `MemoryProvider` over Cognee's documented
REST API (add → cognify → search), one dataset per merchant. Cognee is
optional and stays optional: without it, insights are generated without
history.

## n8n

Action orchestration, after intelligence and after merchant approval:

```
insight  →  recommendation  →  merchant approves  →  n8n  →  action  →  outcome
```

n8n is the action / orchestration layer, not only a notification mechanism.
It can also be triggered directly from the merchant's private experience:

```
Indirect:  opportunity  →  recommendation  →  approval  →  n8n
Direct:    merchant  →  action  →  n8n
```

After execution, the outcome is measured and stored in Cognee as future
context. See [architecture.md](architecture.md#n8n--action--orchestration-layer)
and the planned `/api/merchant/{id}/workflows` endpoints in [api.md](api.md).

The M2M algorithm does not move into n8n. Workflows execute business actions;
the application owns the intelligence.

Not implemented yet — there is no approved action to execute.

## Failure strategy

Optional dependencies must not become hard dependencies.

- **Cognee unavailable** → continue with structured context; the answer is
  thinner, not absent.
- **OpenRouter fails** → the LLM-dependent operation returns a clear
  `LlmError`. Unrelated parts of the product keep working.
- **Sarvam failing or unconfigured** → chat falls back to OpenRouter; if that
  also fails, Ask Bazaar answers from the fact table by rules. Voice reports it is
  unavailable and the merchant types instead; a failed spoken answer leaves the text.
- **n8n unavailable** → the insight and recommendation still exist and are still
  shown. Only action execution fails, and it reports that it failed.
- **Supabase unconfigured** → clients throw a descriptive error at the call
  site, not at import time, so pages that do not touch the database still render.
  Through `lib/paytm` this surfaces as a `DataSourceError`, like any other
  database failure — callers never see a raw Supabase error.

Configuration is read lazily everywhere for this reason: a missing key breaks
the feature that needs it, not application startup.
