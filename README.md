# Paytm Bazaar

> Bazaar Se Seekho. Business Badhao.

A merchant-to-merchant intelligence ecosystem. Built by **FinWays** for the
Paytm Build for India AI Hackathon — Merchant Growth AI track.

A merchant should not have to learn only from their own business. Millions of
merchants operate in the same ecosystem, and their collective activity contains
patterns that no single dashboard can show. Paytm Bazaar turns the network into
a source of intelligence for the individual merchant — without exposing any
merchant's private data.

Not this:

> Restaurant B made ₹80,000 this week.

This:

> Similar restaurants in your area are seeing stronger evening demand.

## Status: bootstrap

This is a foundation, not the product. What exists today:

- a runnable Next.js + TypeScript application with a minimal landing page
- the M2M engine: merchant, cohort, Bazaar and City metrics, context, patterns, evidence, Bazaar Impact and opportunities
- a database schema of synthetic Paytm-like data, read through the Data Adapter (`lib/paytm`)
- Supabase clients, and an LLM boundary with an OpenRouter provider

What does not exist yet: the Bazaar city, merchant dashboards, simulation,
API routes, Ask Bazaar,
Cognee recall, and n8n actions. These arrive as vertical slices.

The prototype uses **synthetic data**. There is no authorized access to real
Paytm merchant data, and nothing here should be presented as such.

## Quick start

```bash
npm install
cp .env.example .env.local
npm run dev
```

http://localhost:3000. No credentials are needed to start.

## Deployment modes

Bazaar runs in one of two modes, chosen by `BAZAAR_MODE` (see `lib/mode.ts`).

| | `deterministic` (default) | `full` |
| --- | --- | --- |
| Figures | M2M + Relevance | the same, unchanged |
| Wording | written from the fact table by fixed rules | Sarvam / OpenRouter, every figure checked |
| Ask Bazaar | rule-based answers per question topic | conversational, multilingual, voice |
| History | none | Cognee |
| Approved action | recorded inside Bazaar | run by n8n (email) |

Deterministic is the default so a deployment cannot quietly start calling a paid
provider because a key happens to be present. Nothing is missing in that mode:
every number and every sentence comes from the recorded sales, and the Trace and
System Flow say exactly which stages ran.

To switch the integrations back on, set both (the second is what the browser
reads for its labels) and provide the keys:

```bash
BAZAAR_MODE=full
NEXT_PUBLIC_BAZAAR_MODE=full
```

## Layout

```
app/          Next.js application
m2m-engine/   Deterministic merchant-to-merchant intelligence (no dependencies)
data/         Synthetic demo data
lib/paytm/    Data Adapter — the only reader of merchant data
lib/supabase/ Application-side database access
lib/llm/      LLM provider boundary (Sarvam 105B, OpenRouter fallback)
lib/speech/   Voice boundary (Sarvam speech-to-text and text-to-speech)
lib/cognee/   Contextual memory boundary
lib/n8n/      Action / workflow boundary
supabase/     Database schema and migrations
docs/         Architecture and development documentation
```

One question per layer:

| Layer | Answers |
| --- | --- |
| `lib/paytm/` | Where does merchant data come from? |
| `lib/supabase/` | What structured facts do we have? |
| `m2m-engine/` | What is true? |
| `lib/cognee/` | What context do we remember? |
| `lib/llm/` | How do we explain it? |
| `lib/n8n/` | How do we act? |

The M2M engine computes the numbers. The LLM only explains them.

## Next milestone

```
one merchant  →  one change  →  network calculation  →  one pattern  →  one insight
```

The engine half of this exists: `analyzeMerchant()` computes the network
comparison, patterns and opportunities from the synthetic data. Next is exposing
it through an API route and showing it in the Merchant Dialog.

## Documentation

- [Architecture](docs/architecture.md) — boundaries, data flow, intelligence layer, privacy
- [End-to-end flow](docs/flow.md) — Landing → City → Bazaar → Merchant Dialog → action → learning (planned)
- [Planned API contract](docs/api.md) — proposed endpoints, not yet implemented
- [Data Adapter](docs/data-adapter.md) — how merchant data is read; the M2M engine's only data dependency (implemented)
- [M2M engine](docs/m2m-engine.md) — pipeline, metrics, cohorts, patterns, output contract (implemented)
- [Relevance Engine](docs/relevance-engine.md) — which M2M findings matter to a merchant now, and why (implemented)
- [Intelligence pipeline](docs/intelligence-pipeline.md) — end to end: M2M → Relevance → Cognee → LLM → approval → n8n → outcome (implemented)
- [Ask Bazaar](docs/ask-bazaar.md) — the merchant conversation: Sarvam chat, voice and languages, privacy, approval and memory boundaries
- [Provider strategy](docs/providers.md) — external integrations and failure handling
- [Local development](docs/development.md) — setup, scripts, branching, parallel work
