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
