/**
 * Input validation shared by every data-source implementation.
 *
 * Checking input here, before any query runs, means a malformed request fails
 * the same way no matter which store is behind the adapter.
 */

import { InvalidQueryError } from "./errors";
import type { DateRange, Page, TimeRange } from "./types";

export const MAX_PAGE_SIZE = 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireId(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidQueryError(`${label} must be a non-empty string.`);
  }
  return value;
}

/** Validates each ID and removes duplicates, keeping the original order. */
export function requireIds(values: string[], label: string): string[] {
  if (!Array.isArray(values)) {
    throw new InvalidQueryError(`${label} must be an array.`);
  }
  return [...new Set(values.map((value) => requireId(value, label)))];
}

function toInstant(value: string | Date, label: string): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new InvalidQueryError(`Time range ${label} is not a valid timestamp: ${String(value)}.`);
  }
  return instant;
}

/** Returns the range as ISO strings. Rejects unparseable, empty, or reversed ranges. */
export function normalizeTimeRange(range: TimeRange): { start: string; end: string } {
  if (!range) throw new InvalidQueryError("Time range is required.");
  const start = toInstant(range.start, "start");
  const end = toInstant(range.end, "end");
  if (start.getTime() >= end.getTime()) {
    throw new InvalidQueryError(
      `Time range start (${start.toISOString()}) must be before end (${end.toISOString()}).`,
    );
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function requireCalendarDate(value: string, label: string): string {
  const invalid = () =>
    new InvalidQueryError(`Date range ${label} must be a real YYYY-MM-DD date: ${String(value)}.`);

  if (typeof value !== "string" || !DATE_PATTERN.test(value)) throw invalid();

  // Round-trip through a UTC date to reject impossible dates such as 2026-02-30.
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw invalid();
  }
  return value;
}

/** Rejects malformed dates and ranges where `from` is after `to`. Equal dates are one day. */
export function normalizeDateRange(range: DateRange): DateRange {
  if (!range) throw new InvalidQueryError("Date range is required.");
  const from = requireCalendarDate(range.from, "from");
  const to = requireCalendarDate(range.to, "to");
  if (from > to) {
    throw new InvalidQueryError(`Date range from (${from}) must not be after to (${to}).`);
  }
  return { from, to };
}

export function normalizePage(page: Page): { limit: number; offset: number } {
  const offset = page.offset ?? 0;
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_SIZE) {
    throw new InvalidQueryError(`Page limit must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new InvalidQueryError("Page offset must be a non-negative integer.");
  }
  return { limit: page.limit, offset };
}
