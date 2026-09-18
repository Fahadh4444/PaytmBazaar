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
- the core domain vocabulary and the M2M engine boundary
- synthetic demo merchants behind a data-source boundary
- Supabase clients, and an LLM boundary with an OpenRouter provider

What does not exist yet: the Bazaar city, merchant dashboards, simulation,
cohorting and pattern detection, API routes, database schema, Ask Bazaar,
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

## Layout

```
app/          Next.js application
m2m-engine/   Deterministic merchant-to-merchant intelligence (no dependencies)
data/         Synthetic demo data
lib/paytm/    Merchant data-source boundary
lib/supabase/ Application-side database access
lib/llm/      LLM provider boundary (OpenRouter today, Sarvam possible later)
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

Real deterministic logic over the synthetic data — not a button that prints a
fixed sentence. This matters more than the visual city.

## Documentation

- [Architecture](docs/architecture.md) — boundaries, data flow, intelligence layer, privacy
- [End-to-end flow](docs/flow.md) — Landing → City → Bazaar → Merchant Dialog → action → learning (planned)
- [Planned API contract](docs/api.md) — proposed endpoints, not yet implemented
- [M2M engine principles](docs/m2m-engine.md) — what the engine may and may not do
- [Provider strategy](docs/providers.md) — external integrations and failure handling
- [Local development](docs/development.md) — setup, scripts, branching, parallel work
