# M2M engine principles

The M2M engine is the core of Paytm Bazaar. It answers one question:

> What is true?

Everything else in the repository either feeds it data or communicates its
results.

## Deterministic, always

Numbers come from calculations over data. Not from a language model.

```
transactions  →  M2M calculations  →  structured insight  →  LLM explanation
```

Never:

```
transactions  →  LLM  →  "what do you think happened?"
```

If a merchant's sales go from ₹45,000 to ₹30,000, the engine computes the
absolute change, the percentage change, and how that compares with an
appropriate cohort. It does not ask a model whether sales fell. The LLM's job
starts after the truth is established, and it is limited to wording.

This matters beyond correctness: a benchmark a model invented is not a
benchmark, and a demo built on one has nothing underneath it.

## Framework independence

The engine imports nothing outside itself — no React, no Next.js, no browser
APIs, no Supabase, no OpenRouter, no Sarvam, no Cognee, no n8n.

In: structured business data. Out: structured analytical results.

That keeps it testable without a browser or a network, and keeps it reusable if
the product surface changes.

## Domain vocabulary

`m2m-engine/types.ts` holds the shared domain model — `Area`, `Merchant`,
`Transaction`, `MerchantCategory`, `TimeOfDay`, `Weather`. It lives here rather
than in a separate `types/` directory because the engine is the one layer with
no dependencies, so everything can import it safely.

`Transaction` stays deliberately lean: an amount and an ISO timestamp. Time of
day and day of week are *derived* from the timestamp, not stored alongside it.
Weather is declared as a type but not yet modelled — when it arrives it will be
an observation joined by area and date, not a column copied onto every
transaction.

## No assumed relationships

`Weather` existing does not mean "rain reduces restaurant sales". Any
relationship between weather, time, day, category, area and revenue must be
*derived from the data*, and must be allowed to come out as "no meaningful
relationship". Hardcoding folk wisdom would make the intelligence fake in a way
that is hard to see from the outside.

## Privacy is an engine concern

`MIN_COHORT_SIZE` and `isCohortReportable()` live in the engine because
suppression is part of computing a legitimate result, not a presentation detail
to be remembered later. An aggregate over three merchants is not anonymous.

## What is not built yet

Cohorting, aggregation, comparison, pattern detection, relevance scoring — none
of it exists yet, and no files are stubbed out for it. The agreed set of planned
components (Merchant Metrics through Opportunity Engine) is listed in
[architecture.md](architecture.md#intelligence-layer-components).

The engine's **output contract** is also deliberately undefined. Writing a
`NetworkInsight` interface before a real pattern has been computed would mean
guessing at fields we have not needed. The first vertical slice defines it from
what it actually produces.

## The first vertical slice

```
one merchant  →  one change  →  network calculation  →  one pattern  →  one insight
```

Concretely: a merchant's sales change; the engine recomputes; the merchant is
compared against an appropriate cohort of similar businesses; a meaningful
network-level pattern is detected; that becomes one insight.

The numbers and the wording must both come from the synthetic data and the
calculation. A button that prints a fixed sentence proves nothing — the whole
point is that the intelligence actually runs.

This slice matters more than a beautiful city. Build it first.
