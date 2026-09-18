/**
 * Comparison periods: a current period and its previous equivalent.
 *
 * Periods are inclusive `YYYY-MM-DD` business dates in India Standard Time,
 * the same calendar the `merchant_daily_metrics` view uses. Nothing here
 * assumes a particular demo date; callers choose the window.
 */

import { IST_OFFSET_MINUTES } from "./config";
import type { ComparisonPeriod, DateRange, DayOfWeek } from "./types";

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Thrown when the engine is asked something malformed, such as a reversed period. */
export class M2MInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "M2MInputError";
  }
}

function toEpochDay(date: string): number {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) {
    throw new M2MInputError(`Expected a YYYY-MM-DD date, got ${String(date)}.`);
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) {
    throw new M2MInputError(`Not a real date: ${date}.`);
  }
  return ms / DAY_MS;
}

const fromEpochDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Number of days in an inclusive range. */
export function daysIn(range: DateRange): number {
  const days = toEpochDay(range.to) - toEpochDay(range.from) + 1;
  if (days < 1) throw new M2MInputError(`Period ${range.from} → ${range.to} ends before it starts.`);
  return days;
}

/** The `days`-long period ending on `endDate`, inclusive. */
export function lastNDays(endDate: string, days: number): DateRange {
  if (!Number.isInteger(days) || days < 1) throw new M2MInputError("days must be a positive integer.");
  return { from: addDays(endDate, -(days - 1)), to: endDate };
}

/**
 * Builds the comparison. Without `previous`, it is the equally long period
 * immediately before `current`. A given `previous` must be equally long and
 * end before `current` begins, so the two are actually comparable.
 */
export function comparisonPeriod(current: DateRange, previous?: DateRange): ComparisonPeriod {
  const days = daysIn(current);
  const prev = previous ?? { from: addDays(current.from, -days), to: addDays(current.from, -1) };

  if (daysIn(prev) !== days) {
    throw new M2MInputError(`Previous period must be ${days} days long, like the current period.`);
  }
  if (toEpochDay(prev.to) >= toEpochDay(current.from)) {
    throw new M2MInputError("Previous period must end before the current period begins.");
  }
  return { current: { ...current }, previous: { ...prev }, days };
}

export function isWithin(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** The instants covering both periods, for reading payment events. End is exclusive. */
export function eventWindow(period: ComparisonPeriod): { start: string; end: string } {
  return {
    start: `${period.previous.from}T00:00:00+05:30`,
    end: `${addDays(period.current.to, 1)}T00:00:00+05:30`,
  };
}

const DAYS: DayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Business date, hour and weekday of a timestamp, in IST. */
export function istParts(timestamp: string): { date: string; hour: number; dayOfWeek: DayOfWeek } {
  const ist = new Date(Date.parse(timestamp) + IST_OFFSET_MINUTES * 60_000);
  return {
    date: ist.toISOString().slice(0, 10),
    hour: ist.getUTCHours(),
    dayOfWeek: DAYS[ist.getUTCDay()],
  };
}
