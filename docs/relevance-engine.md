# Relevance Engine

> **Status: implemented.** Lives in [`relevance-engine/`](../relevance-engine).
> It consumes [M2M engine](m2m-engine.md) output. No API route, UI, Cognee or
> LLM consumes it yet.

## Why it exists

The M2M engine finds everything it can: every comparison, pattern and
opportunity. On the current demo data that is about 107 patterns across 56
merchants, and a merchant can receive half a dozen at once. Most are true, but
few matter equally. Passing all of them to an LLM invites it to dwell on
noise, or to treat a city-wide drift as seriously as a merchant falling 47
points behind its peers.

The Relevance Engine decides which findings matter to *this* merchant *now*,
ranks them, and records why.

```
M2M Intelligence
      ↓
Signal Extraction
      ↓
Relevance Scoring
      ↓
Prioritization
      ↓
Relevant Intelligence
      ↓
   Future LLM
```

## M2M vs Relevance

| | M2M engine | Relevance Engine |
| --- | --- | --- |
| Question | What patterns and opportunities exist? | Which of them matter to this merchant now? |
| Input | Data Adapter (Supabase) | One `M2MIntelligence` |
| Computes | Metrics, cohorts, comparisons, patterns, opportunities | Scores and ranks M2M's findings |
| New business figures | Yes | None. Every number comes from M2M |

The Relevance Engine never reads data, never recalculates a metric, growth
rate or gap, and never detects a pattern. The one arithmetic step it adds is
the gap within a context segment (merchant change minus cohort change, both
from M2M evidence), because M2M reports the two sides but not their difference.

## Input and output

```ts
import { analyzeRelevance } from "@/relevance-engine";

const relevant = analyzeRelevance(m2mIntelligence); // pure, deterministic
```

`RelevantIntelligence` (`relevance-engine/types.ts`):

| Field | Contents |
| --- | --- |
| `merchantId`, `bazaarId`, `city`, `category`, `period`, `cohort` | passed through from M2M |
| `cohortConfidence` | `primary` (same Bazaar), `fallback` (same category, city-wide), or `none` |
| `topPriority` | highest priority among the leading signals, or `null` if nothing is relevant |
| `prioritySignals` | high and medium signals, strongest first, at most 5 |
| `backgroundSignals` | low signals: context worth knowing, not worth leading with |
| `relevantPatterns` | the M2M `Pattern` objects behind the leading signals, in the same order |
| `relevantOpportunities` | every M2M opportunity with a relevance score, a priority, and the signals it rests on |
| `dismissed` | every candidate signal that was dropped, with a reason code |
| `limitations` | passed through from M2M |

Each `RelevanceSignal` answers the questions the LLM layer will need:

| Question | Field |
| --- | --- |
| What is happening? | `kind`, `direction`, `magnitudePp` |
| Why is it relevant? | `reasons` (codes), `factors` |
| What supports it? | `evidence` (the M2M `Evidence`, unchanged), `patterns` |
| Is there an opportunity? | `opportunities` |
| How important is it? | `score` (0–100), `priority` |

The output is structured codes and numbers only. Wording is the LLM's job.

## Signals

Every signal is built from one part of the M2M output, and each M2M pattern
confirms exactly one signal, so no finding is counted twice.

| Signal | From | Confirmed by |
| --- | --- | --- |
| `COHORT_GAP` | `comparisons` (cohort) | `MERCHANT_DOWN_NETWORK_UP`, `MERCHANT_UP_NETWORK_DOWN` |
| `BAZAAR_GAP` | `comparisons` (bazaar) | `MERCHANT_DOWN_BAZAAR_UP`, `MERCHANT_UP_BAZAAR_DOWN` |
| `CITY_GAP` | `comparisons` (city) | none |
| `MARKET_MOVEMENT` | `bazaarImpact.bazaarGrowth`, `demandTrend` | `NETWORK_WIDE_GROWTH`, `NETWORK_WIDE_DECLINE` |
| `CONTEXT` | each `CONTEXT_NETWORK_GROWTH` pattern | itself |
| `ALIGNMENT` | `MERCHANT_ALIGNS_WITH_NETWORK` | itself |

## Scoring model

```
score = min(100, round(100 × magnitude × specificity × confidence × patternSupport) + opportunityBonus)
```

Every factor is stored on the signal, so any score can be reproduced and
explained.

| Factor | Meaning | Values |
| --- | --- | --- |
| magnitude | size of the gap or movement | `|pp| / 25`, capped at 1. 25pp is M2M's high-priority gap |
| specificity | how specific the comparison is to this merchant | cohort 1.0 · Bazaar gap 0.8 · market 0.55 · context 0.5 · city 0.25 |
| confidence | how far the data can be trusted | 1.0, or 0.75 for a fallback cohort · 0.8 if Bazaar demand disagrees with Bazaar GMV · context: merchant's segment transactions ÷ 80, capped at 1 |
| patternSupport | whether an M2M pattern confirms it | 1.0 confirmed · 0.8 not (e.g. both grew, one far faster) |
| opportunityBonus | an M2M opportunity rests on it | +10 |

`ALIGNMENT` has a fixed score of 15. It's worth knowing, because a decline
shared with peers isn't a merchant-specific problem, but it is never a lead.

Specificity sets each kind's ceiling (100 × specificity before the bonus). So
city movement can never outrank a peer comparison, and context and market
movement can never reach HIGH on their own.

## Priority levels and thresholds

| Priority | Score | What it takes |
| --- | --- | --- |
| high | ≥ 75 | a primary cohort gap ≥ 18.75pp, a Bazaar gap ≈ 23.4pp, or a fallback cohort gap at the full 25pp |
| medium | ≥ 30 | about M2M's 10pp opportunity gap against the cohort. A strong Bazaar movement (≥ ~14pp). A well-supported context gap (≥ 15pp beyond the overall gap) |
| low | < 30 | background |

Every threshold comes from M2M's own (`M2M_THRESHOLDS`), so the two layers
agree on what counts as flat, aligned or large:

| Relevance constant | Derived from | Value |
| --- | --- | --- |
| `NOISE_FLOOR_PP` | `alignmentTolerancePp`, the widest gap M2M still calls aligned | 5pp |
| `FULL_MAGNITUDE_PP` | `highPriorityGapPp` | 25pp |
| `CONTEXT_FULL_SUPPORT_TRANSACTIONS` | 4 × `minSegmentTransactions` | 80 |

A signal is **dismissed** rather than scored when:

| Reason | When |
| --- | --- |
| `GROUP_NOT_REPORTABLE` | M2M withheld the group |
| `GROWTH_UNAVAILABLE` | growth couldn't be computed |
| `BELOW_NOISE_FLOOR` | the gap is under 5pp |
| `MIRRORS_OVERALL_GAP` | a context segment's gap is no wider than the merchant's overall cohort gap |

Opportunities take the score of the strongest signal they rest on. Their
priority is the lower of that score's priority and the priority M2M gave them.
Relevance can demote an opportunity but never promote one.

## Context is treated conservatively

- It comes only from M2M's `CONTEXT_NETWORK_GROWTH`, which already requires
  enough transactions, enough contributing peers and, for weekdays, a 14-day
  window.
- **Concentration.** A merchant 47 points behind its peers overall is behind in
  every hour and every kind of weather. Only the part of a segment's gap that
  goes beyond the overall cohort gap is scored. Segments that only restate the
  overall gap are dismissed as `MIRRORS_OVERALL_GAP`.
- **Support.** Confidence scales with the merchant's own transactions in the
  segment.
- **Ceiling.** Context is capped at medium by its specificity. Its reasons
  always include `ASSOCIATION_NOT_CAUSE`: "sales fell during rainy periods",
  never "rain caused sales to fall".

## Cohort fallback

M2M's cohort semantics are respected, not reinterpreted:

- **primary** (same Bazaar + category): full confidence.
- **fallback** (same category, city-wide): cohort and context signals get
  confidence 0.75 and the reason `FALLBACK_COHORT_REDUCED_CONFIDENCE`. A 20pp
  gap is HIGH against a primary cohort (score 90) but MEDIUM against a
  fallback cohort (70).
- **none** (not reportable): no cohort, context or alignment signal is
  produced. The dismissal is recorded as `GROUP_NOT_REPORTABLE`. Bazaar and
  city comparisons are still used, because they are real.

## Privacy

The engine reads only the M2M output, which already contains nothing but the
merchant's own figures and aggregates over at least `MIN_COHORT_SIZE` other
merchants. It passes through the cohort's shape (basis, category, size), never
its members. A test serialises the output built from real M2M output and checks
it for peer IDs, names and contact details.

## Examples (live demo data, 2026-09-24 → 30)

| Merchant | Leading signals | Notes |
| --- | --- | --- |
| PBZKOR006, restaurant, −29.5% vs cohort +17.6% | `cohort_gap` 100 high, `bazaar_gap` 90 high, `context:weather:cloudy` 46 medium | `CLOSE_NETWORK_GAP` stays high |
| PBZHSRLAY001, cafe | `cohort_gap` 100 high, `bazaar_gap` 58 medium, `context:timeOfDay:evening` 41 medium | the evening-demand scenario the data was built for |
| PBZJAY008, bakery, +20% vs cohort −9% | `cohort_gap` 100 high (ahead), `bazaar_gap` 88 high | `SUSTAIN_OUTPERFORMANCE` stays low, as M2M set it |
| PBZIND006, moving with its network | none | alignment and market growth are background |
| PBZMAR007, textiles, network-wide decline | `cohort_gap` 33 medium (declining less than peers) | market decline is background |
| PBZELECIT003, too few peers | `bazaar_gap` 50 medium | no peer intelligence produced |

Across all 56 merchants, 107 M2M patterns become 54 leading signals. 5
merchants have a high top priority, 29 medium, and 22 nothing worth leading
with.

## Limitations

- **Weights are judgement.** They are derived from M2M's thresholds, but they
  are not fitted to outcomes. Once actions and outcomes are recorded (n8n,
  Cognee), they should be tuned against what actually helped merchants.
- **Only the current period.** A gap that has persisted for weeks scores the
  same as one that appeared this week.
- **One view per merchant.** The engine doesn't yet compare a merchant's
  relevance against other merchants.
- **Context covers only M2M's gap pattern.** Segments where the merchant
  outperforms its peers, and concentration shares, aren't scored.
