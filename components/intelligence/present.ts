/**
 * Presentation helpers for intelligence panels: formatting, chart geometry,
 * and wording of values the backend already computed. No business logic:
 * nothing here calculates a metric, a growth rate, a cohort or a priority.
 */

import type { GrowthBar, PerformanceCount, TrendPoint } from "@/m2m-engine";
import type { MerchantBasics } from "@/merchant-intelligence";

// --- Formatting ---------------------------------------------------------------

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** ₹1.2 Cr, ₹58.6 L, or ₹74,195: how Indian shopkeepers read money. */
export function formatRupees(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toFixed(1)} L`;
  return inr.format(value);
}

export function formatGrowth(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export function growthTone(value: number | null | undefined): "up" | "down" | "flat" {
  if (value == null || Math.abs(value) < 2) return "flat";
  return value > 0 ? "up" : "down";
}

export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// --- Chart geometry ---------------------------------------------------------------

export interface LineGeometry {
  path: string;
  area: string;
  points: { x: number; y: number; date: string; gmv: number }[];
  max: number;
  min: number;
}

/** Scales a sales series into an SVG path inside `width` × `height`. */
export function lineGeometry(series: TrendPoint[], width: number, height: number, pad = 4): LineGeometry | null {
  if (series.length < 2) return null;
  const values = series.map((p) => p.gmv);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = (width - pad * 2) / (series.length - 1);
  const points = series.map((p, i) => ({
    x: pad + i * step,
    y: pad + (height - pad * 2) * (1 - (p.gmv - min) / span),
    date: p.date,
    gmv: p.gmv,
  }));
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${path} L${points.at(-1)!.x.toFixed(1)} ${height} L${points[0].x.toFixed(1)} ${height} Z`;
  return { path, area, points, max, min };
}

export interface BarGeometry {
  label: string;
  growth: number | null;
  /** Bar start and width as fractions (0–1) of the track, centred on zero. */
  start: number;
  width: number;
  tone: "up" | "down" | "flat";
}

/** Horizontal growth bars around a shared zero line. */
export function barGeometry(bars: Pick<GrowthBar, "label" | "growth">[]): BarGeometry[] {
  const known = bars.map((b) => b.growth).filter((g): g is number => g !== null);
  const reach = Math.max(1, ...known.map(Math.abs));
  const hasNegative = known.some((g) => g < 0);
  const zero = hasNegative ? 0.5 : 0;
  const scale = hasNegative ? 0.5 : 1;
  return bars.map((b) => {
    const size = b.growth === null ? 0 : (Math.abs(b.growth) / reach) * scale;
    return {
      label: b.label,
      growth: b.growth,
      start: b.growth !== null && b.growth < 0 ? zero - size : zero,
      width: size,
      tone: growthTone(b.growth),
    };
  });
}

export const BAND_LABEL: Record<PerformanceCount["band"], string> = {
  growing_strongly: "Growing fast",
  growing: "Growing",
  stable: "Steady",
  declining: "Slowing down",
};

// --- Merchant ---------------------------------------------------------------------

/**
 * Every Bazaar shares one street drawing: building N opens the Bazaar's Nth
 * merchant, with merchants in MID order (as the API returns them).
 */
export function merchantForBuilding<T extends { mid: string }>(merchants: T[], buildingIndex: number): T | null {
  if (merchants.length === 0) return null;
  const sorted = [...merchants].sort((a, b) => a.mid.localeCompare(b.mid));
  return sorted[Math.max(0, buildingIndex) % sorted.length];
}

const SEGMENT_WORDS: Record<string, string> = {
  morning: "mornings",
  afternoon: "afternoons",
  evening: "evenings",
  night: "nights",
  rain: "rainy days",
  heavy_rain: "heavy rain",
  clear: "clear days",
  cloudy: "cloudy days",
};

export interface TopSignal {
  title: string;
  sentence: string;
  priority: "high" | "medium" | "low";
  basis: string;
}

/** Words the Relevance Engine's top signal using only the numbers it carries. */
export function describeTopSignal(basics: MerchantBasics): TopSignal | null {
  const signal = basics.relevance.prioritySignals[0];
  if (!signal) return null;
  const e = signal.evidence;
  const gap = `${Math.abs(signal.magnitudePp)} points`;
  const peers =
    basics.relevance.cohortConfidence === "fallback" ? "similar shops across the city" : "similar shops near you";
  let title = "What stands out";
  let sentence = "";
  switch (signal.kind) {
    case "COHORT_GAP":
      title = signal.direction === "behind" ? "You're behind similar shops" : "You're ahead of similar shops";
      sentence = `Your sales changed ${formatGrowth(e.merchantChange)} while ${peers} changed ${formatGrowth(e.cohortChange)}: a gap of ${gap}.`;
      break;
    case "BAZAAR_GAP":
      title = signal.direction === "behind" ? "You're behind your market" : "You're ahead of your market";
      sentence = `Your sales changed ${formatGrowth(e.merchantChange)} while ${basics.merchant.bazaar.name} changed ${formatGrowth(e.bazaarChange)}: a gap of ${gap}.`;
      break;
    case "CITY_GAP":
      title = "Compared with the city";
      sentence = `Your sales changed ${formatGrowth(e.merchantChange)} while ${basics.merchant.bazaar.city} changed ${formatGrowth(e.cityChange)}.`;
      break;
    case "MARKET_MOVEMENT":
      title = signal.direction === "up" ? "Your market is growing" : "Your market is slowing";
      sentence = `Sales across ${basics.merchant.bazaar.name} changed ${formatGrowth(e.bazaarChange)} this week.`;
      break;
    case "CONTEXT": {
      const segment = e.context ? (SEGMENT_WORDS[e.context.segment] ?? e.context.segment) : "one part of the week";
      title = `A pattern on ${segment}`;
      sentence = `On ${segment}, your sales changed ${formatGrowth(e.context?.merchantChange)} while ${peers} changed ${formatGrowth(e.context?.cohortChange)}.`;
      break;
    }
    case "ALIGNMENT":
      title = "You're moving with similar shops";
      sentence = `Your sales changed ${formatGrowth(e.merchantChange)}, close to ${peers} (${formatGrowth(e.cohortChange)}).`;
      break;
  }
  const basis =
    basics.relevance.cohortConfidence === "none"
      ? "Too few similar shops to compare with, so this is based on your market."
      : `Compared with ${basics.relevance.cohort.size} ${peers}. No shop's own numbers are shown.`;
  return { title, sentence, priority: signal.priority, basis };
}

// --- Chat ------------------------------------------------------------------------

const FOLLOW_UPS = [
  "How do I compare with shops nearby?",
  "Which time of day is weakest for me?",
  "What offer would help most this week?",
  "How did my weekend go?",
  "Why did my sales change?",
  "What is my strongest day?",
];

/** Up to three follow-up questions not asked yet in this conversation. */
export function followUpQuestions(asked: string[], hasOffer: boolean): string[] {
  const seen = new Set(asked.map((q) => q.trim().toLowerCase()));
  const pool = hasOffer ? ["Tell me about the suggested offer", ...FOLLOW_UPS] : FOLLOW_UPS;
  return pool.filter((q) => !seen.has(q.toLowerCase())).slice(0, 3);
}

// --- States -----------------------------------------------------------------------

export type LoadState = "loading" | "error" | "empty" | "ready";

export function areaStateMessage(scope: "city" | "bazaar", state: LoadState): string | null {
  if (state === "loading") return scope === "city" ? "Reading the whole city…" : "Reading this Bazaar…";
  if (state === "error")
    return scope === "city" ? "City intelligence is temporarily unavailable." : "Bazaar intelligence is temporarily unavailable.";
  if (state === "empty") return "Not enough data to show a strong signal yet.";
  return null;
}
