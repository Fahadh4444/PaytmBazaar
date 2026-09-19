/**
 * Context Analysis: how the merchant's and its cohort's successful sales are
 * distributed across time of day, day of week, weather and events, and how
 * each segment changed between periods.
 *
 * This describes *when* sales happened, not *why*. A segment growing during
 * rain is an association observed in the data, never evidence that rain caused
 * it. Weather and events differ between periods, so segment growth partly
 * reflects how often that condition occurred.
 *
 * To add a dimension, add one entry to DIMENSIONS.
 *
 * Pure functions: no I/O.
 */

import { MIN_COHORT_SIZE } from "./config";
import { roundMoney, roundPercent, growthPercent } from "./metrics";
import { istParts, isWithin } from "./period";
import type {
  ComparisonPeriod,
  ContextAnalysis,
  ContextDimension,
  ContextSegment,
  ContextSegmentAnalysis,
  ContextImpact,
  SelectedContext,
  SelectedContextEvidence,
  PaymentEvent,
  SegmentSide,
  TimeOfDay,
} from "./types";

export function timeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const MIN_SELECTED_TRANSACTIONS = 3;
const MATERIAL_GAP_PP = 5;

/**
 * Evaluates the selected controls against the already calculated, privacy-safe
 * context buckets. It deliberately does not imply that the four-way
 * intersection was observed: supported dimensions are reported separately.
 */
export function selectedContextImpact(context: ContextAnalysis, selected: SelectedContext): ContextImpact {
  const wanted = [
    ["dayOfWeek", selected.dayOfWeek],
    ["timeOfDay", selected.timeOfDay],
    ["weather", selected.weather],
    ["event", selected.event],
  ] as const;
  const evidence = wanted.map(([dimension, segment]) => {
    const found = context.segments.find((s) => s.dimension === dimension && s.segment === segment);
    const supported = Boolean(
      found?.cohort &&
      found.merchant.currentTransactions >= MIN_SELECTED_TRANSACTIONS &&
      found.merchant.previousTransactions >= MIN_SELECTED_TRANSACTIONS,
    );
    const gapPp = found?.merchant.growth != null && found.cohort?.growth != null
      ? Math.round((found.merchant.growth - found.cohort.growth) * 10) / 10
      : null;
    return {
      dimension,
      segment,
      merchantGrowth: found?.merchant.growth ?? null,
      cohortGrowth: found?.cohort?.growth ?? null,
      gapPp,
      merchantTransactions: found?.merchant.currentTransactions ?? 0,
      cohortTransactions: found?.cohort?.currentTransactions ?? null,
      cohortContributors: found?.cohortContributors ?? 0,
      supported,
    };
  });
  const supported = evidence.filter((e) => e.supported && e.gapPp !== null);
  const strongest = [...supported].sort((a, b) => Math.abs(b.gapPp!) - Math.abs(a.gapPp!))[0];
  if (!strongest) return {
    requested: selected, level: "insufficient", status: "insufficient_evidence", evidence,
    strongestDimension: null,
    message: "Not enough historical evidence for this context.",
    combined: { basis: "insufficient", merchantGrowth: null, cohortGrowth: null, gapPp: null, merchantTransactions: 0, cohortTransactions: null, cohortContributors: 0 },
    forecast: { direction: "unknown", expectedChangePercent: null, relativeToPeersPp: null, confidence: "insufficient", insight: "There is not enough evidence to estimate how this scenario may change demand." },
  };
  const meaningful = Math.abs(strongest.gapPp!) >= MATERIAL_GAP_PP;
  return {
    requested: selected,
    level: "single_dimensions",
    status: meaningful ? "meaningful_change" : "no_meaningful_change",
    evidence,
    strongestDimension: meaningful ? strongest.dimension : null,
    message: meaningful
      ? "The selected context changes the strongest supported merchant-to-peer signal."
      : "No meaningful change detected for the supported parts of this context.",
    combined: { basis: "insufficient", merchantGrowth: null, cohortGrowth: null, gapPp: null, merchantTransactions: 0, cohortTransactions: null, cohortContributors: 0 },
    forecast: { direction: "unknown", expectedChangePercent: null, relativeToPeersPp: null, confidence: "insufficient", insight: "A combined estimate is not available from dimension evidence alone." },
  };
}

function matchesSelected(event: PaymentEvent, selected: SelectedContext): boolean {
  const parts = istParts(event.txnAt);
  return parts.dayOfWeek === selected.dayOfWeek &&
    timeOfDay(parts.hour) === selected.timeOfDay &&
    event.context.weather === selected.weather &&
    (event.context.event?.type ?? "none") === selected.event;
}

/** Adds an exact four-way observation or a conservative combined estimate. */
export function combinedContextImpact(
  base: ContextImpact,
  merchantId: string,
  cohortMerchantIds: string[],
  events: PaymentEvent[],
  period: ComparisonPeriod,
): ContextImpact {
  const peers = new Set(cohortMerchantIds);
  const merchant = emptyTally();
  const cohort = emptyTally();
  const contributors = new Set<string>();
  for (const event of events) {
    if (event.transactionType !== "ACQUIRING" || event.status !== "TXN_SUCCESS" || !matchesSelected(event, base.requested)) continue;
    const parts = istParts(event.txnAt);
    const current = isWithin(parts.date, period.current);
    if (!current && !isWithin(parts.date, period.previous)) continue;
    if (event.mid === merchantId) add(merchant, current, event.amountInr);
    else if (peers.has(event.mid)) {
      add(cohort, current, event.amountInr);
      if (current) contributors.add(event.mid);
    }
  }
  const exactSupported = merchant.currentTransactions >= MIN_SELECTED_TRANSACTIONS &&
    merchant.previousTransactions >= MIN_SELECTED_TRANSACTIONS && contributors.size >= MIN_COHORT_SIZE;
  let merchantGrowth: number | null;
  let cohortGrowth: number | null;
  let basis: ContextImpact["combined"]["basis"];
  let merchantTransactions: number;
  let cohortTransactions: number | null;
  let cohortContributors: number;
  if (exactSupported) {
    merchantGrowth = growthPercent(merchant.currentGmv, merchant.previousGmv);
    cohortGrowth = growthPercent(cohort.currentGmv, cohort.previousGmv);
    basis = "exact_combination";
    merchantTransactions = merchant.currentTransactions;
    cohortTransactions = cohort.currentTransactions;
    cohortContributors = contributors.size;
  } else {
    const supported = base.evidence.filter((e) => e.supported && e.merchantGrowth !== null && e.cohortGrowth !== null);
    if (supported.length < 2) return base;
    const weight = (e: SelectedContextEvidence) => Math.min(e.merchantTransactions, 30);
    const total = supported.reduce((sum, e) => sum + weight(e), 0);
    merchantGrowth = roundPercent(supported.reduce((sum, e) => sum + e.merchantGrowth! * weight(e), 0) / total);
    cohortGrowth = roundPercent(supported.reduce((sum, e) => sum + e.cohortGrowth! * weight(e), 0) / total);
    basis = "dimension_model";
    merchantTransactions = Math.min(...supported.map((e) => e.merchantTransactions));
    cohortTransactions = null;
    cohortContributors = Math.min(...supported.map((e) => e.cohortContributors));
  }
  if (merchantGrowth === null || cohortGrowth === null) return base;
  const gapPp = roundPercent(merchantGrowth - cohortGrowth);
  const direction = Math.abs(merchantGrowth) < MATERIAL_GAP_PP ? "steady" : merchantGrowth > 0 ? "increase" : "decrease";
  const confidence = basis === "exact_combination" && merchantTransactions >= 10 ? "high" : basis === "exact_combination" ? "medium" : "low";
  const movement = direction === "steady" ? "remain broadly steady" : `${direction} by about ${Math.abs(merchantGrowth).toFixed(1)}%`;
  const relative = gapPp < 0 ? `trail similar shops by ${Math.abs(gapPp).toFixed(1)} points` : `lead similar shops by ${gapPp.toFixed(1)} points`;
  return {
    ...base,
    level: "single_dimensions",
    status: Math.abs(gapPp) >= MATERIAL_GAP_PP ? "meaningful_change" : "no_meaningful_change",
    message: basis === "exact_combination" ? "Forecast based on historical matches for all four selected conditions." : "Low-confidence forecast combining the supported context signals.",
    combined: { basis, merchantGrowth, cohortGrowth, gapPp, merchantTransactions, cohortTransactions, cohortContributors },
    forecast: {
      direction, expectedChangePercent: merchantGrowth, relativeToPeersPp: gapPp, confidence,
      insight: `If these conditions occur together and past patterns repeat, sales may ${movement} and ${relative}.`,
    },
  };
}

interface DimensionDefinition {
  dimension: ContextDimension;
  segmentOf(event: PaymentEvent, parts: ReturnType<typeof istParts>): ContextSegment;
}

const DIMENSIONS: DimensionDefinition[] = [
  { dimension: "timeOfDay", segmentOf: (_, parts) => timeOfDay(parts.hour) },
  { dimension: "dayOfWeek", segmentOf: (_, parts) => parts.dayOfWeek },
  { dimension: "weather", segmentOf: (event) => event.context.weather },
  { dimension: "event", segmentOf: (event) => event.context.event?.type ?? "none" },
];

interface Tally {
  currentGmv: number;
  previousGmv: number;
  currentTransactions: number;
  previousTransactions: number;
}

const emptyTally = (): Tally => ({ currentGmv: 0, previousGmv: 0, currentTransactions: 0, previousTransactions: 0 });

function add(tally: Tally, isCurrent: boolean, amount: number) {
  if (isCurrent) {
    tally.currentGmv += amount;
    tally.currentTransactions += 1;
  } else {
    tally.previousGmv += amount;
    tally.previousTransactions += 1;
  }
}

function toSide(tally: Tally, periodGmv: number): SegmentSide {
  const currentGmv = roundMoney(tally.currentGmv);
  const previousGmv = roundMoney(tally.previousGmv);
  return {
    currentGmv,
    previousGmv,
    currentTransactions: tally.currentTransactions,
    previousTransactions: tally.previousTransactions,
    growth: growthPercent(currentGmv, previousGmv),
    currentShare: periodGmv === 0 ? 0 : roundPercent((tally.currentGmv / periodGmv) * 100),
  };
}

/**
 * Buckets successful sales by context. Events outside both periods, and
 * anything other than a successful `ACQUIRING` payment, are ignored.
 */
export function analyzeContext(
  merchantId: string,
  cohortMerchantIds: string[],
  events: PaymentEvent[],
  period: ComparisonPeriod,
): ContextAnalysis {
  const cohort = new Set(cohortMerchantIds);
  const buckets = new Map<string, { merchant: Tally; cohort: Tally; contributors: Set<string> }>();
  const totals = { merchant: 0, cohort: 0 };

  for (const event of events) {
    if (event.transactionType !== "ACQUIRING" || event.status !== "TXN_SUCCESS") continue;
    const isMerchant = event.mid === merchantId;
    if (!isMerchant && !cohort.has(event.mid)) continue;

    const parts = istParts(event.txnAt);
    const isCurrent = isWithin(parts.date, period.current);
    if (!isCurrent && !isWithin(parts.date, period.previous)) continue;

    if (isCurrent) totals[isMerchant ? "merchant" : "cohort"] += event.amountInr;

    for (const { dimension, segmentOf } of DIMENSIONS) {
      const key = `${dimension}:${segmentOf(event, parts)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { merchant: emptyTally(), cohort: emptyTally(), contributors: new Set() };
        buckets.set(key, bucket);
      }
      add(isMerchant ? bucket.merchant : bucket.cohort, isCurrent, event.amountInr);
      if (!isMerchant && isCurrent) bucket.contributors.add(event.mid);
    }
  }

  const segments: ContextSegmentAnalysis[] = [...buckets.entries()].map(([key, bucket]) => {
    const [dimension, segment] = key.split(":") as [ContextDimension, ContextSegment];
    return {
      dimension,
      segment,
      merchant: toSide(bucket.merchant, totals.merchant),
      // A segment only a few peers traded in would expose those peers.
      cohort: bucket.contributors.size >= MIN_COHORT_SIZE ? toSide(bucket.cohort, totals.cohort) : null,
      cohortContributors: bucket.contributors.size,
    };
  });

  const order = DIMENSIONS.map((d) => d.dimension);
  segments.sort(
    (a, b) => order.indexOf(a.dimension) - order.indexOf(b.dimension) || a.segment.localeCompare(b.segment),
  );
  return { segments };
}
