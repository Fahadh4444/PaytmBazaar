/**
 * Intelligence Trace: the story of what the backend computed for the City,
 * a Bazaar or a merchant, laid out as stages.
 *
 * Built only from the responses the dialogs already render (`AreaIntelligence`,
 * `MerchantBasics`, `MerchantExplanation`), so the trace can never disagree
 * with the numbers on screen. This module selects, labels and formats. It
 * never calculates: every figure, gap, score and result is the backend's own,
 * and a "calculation" line only lays out the inputs the backend reported next
 * to the result it reported.
 */

import type {
  AreaIntelligence,
  Comparison,
  ContextSegmentAnalysis,
  DataLimitation,
  Evidence,
  PatternType,
  PerformanceBand,
} from "@/m2m-engine";
import type { ActionExecutionOutcome, AskResult, MeasuredOutcome, MerchantBasics, MerchantExplanation } from "@/merchant-intelligence";
import type { DismissalReason, RelevanceSignal, SignalKind } from "@/relevance-engine";

import { formatGrowth, formatRupees, growthTone, shortDate, type LoadState } from "../present";

// --- Model ------------------------------------------------------------------------

/** `done`: ran and returned. `pending`: its request is still out. `not_used`: not part of this analysis. */
export type StageStatus = "done" | "pending" | "not_used" | "unavailable";
export type Tone = "up" | "down" | "flat";

export interface TraceRow {
  label: string;
  value: string;
  tone?: Tone;
}

/** Inputs the backend reported, laid next to the result it reported. */
export interface TraceCalc {
  label: string;
  formula: string;
  working: string;
  result: string;
  tone?: Tone;
}

export interface TraceGroup {
  title: string;
  badge?: string;
  rows: TraceRow[];
  note?: string;
}

export interface TraceStage {
  id: string;
  label: string;
  status: StageStatus;
  /** The conclusion of the stage, in one sentence. */
  summary: string;
  rows?: TraceRow[];
  calcs?: TraceCalc[];
  groups?: TraceGroup[];
  note?: string;
}

export type TraceScope = "city" | "bazaar" | "merchant";

export interface TraceModel {
  scope: TraceScope;
  subject: string;
  /** "14 Sep – 20 Sep vs 7 Sep – 13 Sep", when known. */
  window: string | null;
  /** Set when the underlying request failed: the dialog then shows only what is verified. */
  unavailable: string | null;
  stages: TraceStage[];
}

/** The Day / Time / Weather / Event controls on the City and Bazaar screens. */
export interface SceneContext {
  day: string;
  hour: number;
  weather: string;
  event: string;
}

// --- Formatting (no arithmetic) ---------------------------------------------------

const paise = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const count = (n: number) => n.toLocaleString("en-IN");
/** Exact rupees as the backend reported them: paise only when there are any. */
const rupees = (n: number) => (Number.isInteger(n) ? whole : paise).format(n);
const points = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)} pts`);
const pctSigned = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const factor = (n: number) => n.toFixed(2);
const range = (r: { from: string; to: string }) => `${shortDate(r.from)} – ${shortDate(r.to)}`;
const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

function windowOf(period: { current: { from: string; to: string }; previous: { from: string; to: string } }) {
  return `${range(period.current)} vs ${range(period.previous)}`;
}

const tone = (n: number | null | undefined): Tone => growthTone(n);

// --- Plain words for backend codes -----------------------------------------------

const CATEGORY: Record<string, string> = {
  restaurant: "Restaurant",
  cafe: "Cafe",
  kirana: "Kirana",
  pharmacy: "Pharmacy",
  bakery: "Bakery",
  electronics: "Electronics",
  fashion: "Fashion",
  textiles: "Textiles",
};

export const PATTERN_WORDS: Record<PatternType, string> = {
  MERCHANT_DOWN_NETWORK_UP: "Shop is declining while similar shops grow",
  MERCHANT_UP_NETWORK_DOWN: "Shop is growing while similar shops decline",
  MERCHANT_DOWN_BAZAAR_UP: "Shop is declining while its Bazaar grows",
  MERCHANT_UP_BAZAAR_DOWN: "Shop is growing while its Bazaar declines",
  NETWORK_WIDE_GROWTH: "Shop, similar shops and the Bazaar are all growing",
  NETWORK_WIDE_DECLINE: "Shop, similar shops and the Bazaar are all declining",
  MERCHANT_ALIGNS_WITH_NETWORK: "Shop is moving with similar shops",
  CONTEXT_NETWORK_GROWTH: "Similar shops grew in one part of the week where this shop fell",
};

export const SIGNAL_WORDS: Record<SignalKind, string> = {
  COHORT_GAP: "Gap to similar shops",
  BAZAAR_GAP: "Gap to the Bazaar",
  CITY_GAP: "Gap to the city",
  MARKET_MOVEMENT: "The Bazaar itself moving",
  CONTEXT: "A gap in one part of the week",
  ALIGNMENT: "Moving with similar shops",
};

const DIRECTION_WORDS: Record<RelevanceSignal["direction"], string> = {
  behind: "behind",
  ahead: "ahead",
  up: "up",
  down: "down",
  aligned: "aligned",
};

const DISMISSAL_WORDS: Record<DismissalReason, string> = {
  GROUP_NOT_REPORTABLE: "group too small to show without identifying shops",
  GROWTH_UNAVAILABLE: "growth could not be computed",
  BELOW_NOISE_FLOOR: "gap too small to be more than noise",
  MIRRORS_OVERALL_GAP: "restates the overall gap, adds nothing new",
};

const LIMITATION_WORDS: Record<DataLimitation, string> = {
  COHORT_FALLBACK_TO_CITY_CATEGORY: "Too few similar shops in this Bazaar, so similar shops across the city were used.",
  COHORT_TOO_SMALL: "Too few similar shops to compare with without identifying them.",
  BAZAAR_TOO_SMALL: "The Bazaar is too small to report as a group.",
  CITY_TOO_SMALL: "The city is too small to report as a group.",
  NO_MERCHANT_ACTIVITY: "This shop had no sales in the period.",
  NO_PREVIOUS_PERIOD_GMV: "No sales in the previous period, so growth is undefined.",
};

const OPPORTUNITY_REASON: Record<string, string> = {
  MERCHANT_BEHIND_GROWING_NETWORK: "This shop trails a network that is growing or holding.",
  MERCHANT_BEHIND_NETWORK_IN_CONTEXT: "Similar shops grew in one part of the week where this shop fell.",
  MERCHANT_AHEAD_OF_DECLINING_NETWORK: "This shop is growing while the network declines.",
};

const BAND_WORDS: Record<PerformanceBand, string> = {
  growing_strongly: "Growing fast",
  growing: "Growing",
  stable: "Steady",
  declining: "Declining",
};

const GROUP_WORDS: Record<Comparison["against"], string> = {
  cohort: "Similar shops",
  bazaar: "Bazaar",
  city: "City",
};

function segmentWords(dimension: string, segment: string): string {
  const s = segment.replace(/_/g, " ");
  if (dimension === "timeOfDay") return `${s[0].toUpperCase()}${s.slice(1)}s`;
  if (dimension === "dayOfWeek") return `${s[0].toUpperCase()}${s.slice(1)}s`;
  if (dimension === "weather") return `${s[0].toUpperCase()}${s.slice(1)} weather`;
  return segment === "none" ? "Ordinary days" : `${s[0].toUpperCase()}${s.slice(1)} days`;
}

// --- Shared stages ----------------------------------------------------------------

function sceneStage(scene: SceneContext | undefined, rows: TraceRow[]): TraceStage {
  const sceneRows: TraceRow[] = scene
    ? [
        { label: "Scene day", value: scene.day },
        { label: "Scene time", value: hour(scene.hour) },
        { label: "Scene weather", value: scene.weather },
        { label: "Scene event", value: scene.event },
      ]
    : [];
  return {
    id: "context",
    label: "Context",
    status: "done",
    summary: "What was analysed, and over which window.",
    rows: [...rows, ...sceneRows],
    note: scene
      ? "The Day, Time, Weather and Event controls change the scene only; they are not yet sent to the engine. This analysis uses the latest recorded week of data. When they become inputs, they will arrive in the same response and appear here."
      : undefined,
  };
}

function growthCalc(label: string, current: number, previous: number, growth: number | null): TraceCalc {
  return {
    label,
    formula: "(This period − Previous) ÷ Previous × 100",
    working: `(${rupees(current)} − ${rupees(previous)}) ÷ ${rupees(previous)} × 100`,
    result: growth == null ? "Undefined: no sales in the previous period" : pctSigned(growth),
    tone: tone(growth),
  };
}

function aovCalc(gmv: number, transactions: number, aov: number | null): TraceCalc {
  return {
    label: "Average bill",
    formula: "Sales ÷ Paid orders",
    working: `${rupees(gmv)} ÷ ${count(transactions)}`,
    result: aov == null ? "Undefined: no paid orders" : rupees(aov),
  };
}

function pending(id: string, label: string, summary: string): TraceStage {
  return { id, label, status: "pending", summary };
}

// --- City and Bazaar ---------------------------------------------------------------

export interface AreaTraceInput {
  scope: "city" | "bazaar";
  /** Shown before the data arrives, e.g. the dialog title. */
  title: string;
  state: LoadState;
  data: AreaIntelligence | null;
  scene?: SceneContext;
}

const AREA_STEPS: Record<"city" | "bazaar", [string, string][]> = {
  city: [
    ["data", "Reading daily sales for every shop in the city"],
    ["metrics", "Calculating city sales, orders and growth"],
    ["bazaars", "Aggregating each Bazaar"],
    ["categories", "Aggregating each type of shop"],
    ["pattern", "Checking the weekly pattern"],
    ["headline", "Writing the headline from the figures"],
  ],
  bazaar: [
    ["data", "Reading daily sales for every shop in this Bazaar"],
    ["metrics", "Calculating Bazaar sales, orders and growth"],
    ["impact", "Comparing the Bazaar with the city"],
    ["categories", "Aggregating each type of shop"],
    ["performance", "Counting growing and declining shops"],
    ["headline", "Writing the headline from the figures"],
  ],
};

export function buildAreaTrace(input: AreaTraceInput): TraceModel {
  const { scope, data, state, scene } = input;
  const noun = scope === "city" ? "city" : "Bazaar";

  if (!data || state === "loading" || state === "error") {
    return {
      scope,
      subject: input.title,
      window: null,
      unavailable: state === "error" ? `Trace details unavailable: the ${noun} analysis could not be loaded.` : null,
      stages: AREA_STEPS[scope].map(([id, label]) =>
        state === "error"
          ? { id, label, status: "unavailable" as const, summary: "Not available: the request failed." }
          : pending(id, label, "Waiting for the analysis to return."),
      ),
    };
  }

  const { metrics, period } = data;
  const cur = metrics.current;
  const prev = metrics.previous;
  const stages: TraceStage[] = [];

  stages.push(
    sceneStage(scene, [
      { label: scope === "city" ? "City" : "Bazaar", value: data.name },
      ...(scope === "bazaar" ? [{ label: "City", value: data.city }] : []),
      { label: "This period", value: range(period.current) },
      { label: "Compared with", value: range(period.previous) },
      { label: "Window", value: `${period.days} days each` },
    ]),
  );

  stages.push({
    id: "data",
    label: "Data",
    status: "done",
    summary: `Read the daily sales totals of ${count(metrics.merchantCount)} shops; ${count(metrics.activeMerchants)} made at least one sale this period.`,
    rows: [
      { label: "Shops in scope", value: count(metrics.merchantCount) },
      { label: "Active this period", value: count(metrics.activeMerchants) },
      { label: "Paid orders (now / before)", value: `${count(cur.transactions)} / ${count(prev.transactions)}` },
      { label: "Refunds this period", value: formatRupees(cur.refunds) },
    ],
    note: "The browser received totals only: no transaction, and no single shop's figures.",
  });

  stages.push({
    id: "metrics",
    label: "Metrics",
    status: "done",
    summary: `Sales ${cur.growth == null ? "could not be compared" : `changed ${formatGrowth(cur.growth)}`} against the previous ${period.days} days.`,
    rows: [
      { label: "Sales", value: formatRupees(cur.gmv) },
      { label: "Sales before", value: formatRupees(prev.gmv) },
      { label: "Growth", value: formatGrowth(cur.growth), tone: tone(cur.growth) },
    ],
    calcs: [
      aovCalc(cur.gmv, cur.transactions, cur.aov),
      growthCalc("Sales growth", cur.gmv, prev.gmv, cur.growth),
    ],
  });

  const byBazaar = data.breakdowns.find((b) => b.dimension === "bazaar");
  const byCategory = data.breakdowns.find((b) => b.dimension === "category");
  const hidden = (n: number) =>
    n > 0 ? `${n} group${n > 1 ? "s" : ""} left out: too few shops to show without identifying them.` : undefined;

  if (scope === "bazaar" && data.impact) {
    const impact = data.impact;
    stages.push({
      id: "impact",
      label: "Bazaar vs City",
      status: "done",
      summary:
        impact.gapToCity == null
          ? "The Bazaar could not be compared with the city."
          : `${data.name} is ${points(impact.gapToCity)} ${impact.gapToCity >= 0 ? "ahead of" : "behind"} ${data.city}.`,
      rows: [
        { label: `${data.name} growth`, value: formatGrowth(impact.bazaarGrowth), tone: tone(impact.bazaarGrowth) },
        { label: `${data.city} growth`, value: formatGrowth(impact.cityGrowth), tone: tone(impact.cityGrowth) },
        { label: "Orders growth (demand)", value: formatGrowth(impact.demandGrowth), tone: tone(impact.demandGrowth) },
      ],
      calcs: [
        {
          label: "Bazaar impact",
          formula: "Bazaar growth − City growth",
          working: `${pctSigned(impact.bazaarGrowth)} − (${pctSigned(impact.cityGrowth)})`,
          result: points(impact.gapToCity),
          tone: tone(impact.gapToCity),
        },
        {
          label: "Demand",
          formula: "(Orders now − Orders before) ÷ Orders before × 100",
          working: `(${count(cur.transactions)} − ${count(prev.transactions)}) ÷ ${count(prev.transactions)} × 100`,
          result: impact.demandGrowth == null ? "Undefined: no orders before" : pctSigned(impact.demandGrowth),
          tone: tone(impact.demandGrowth),
        },
      ],
    });
  }

  if (scope === "city") {
    stages.push({
      id: "bazaars",
      label: "Bazaar aggregation",
      status: "done",
      summary: byBazaar?.bars.length
        ? `${byBazaar.bars.length} Bazaar${byBazaar.bars.length > 1 ? "s" : ""} aggregated; ${byBazaar.bars[0].label} is growing fastest.`
        : "No Bazaar was large enough to report on its own.",
      rows: byBazaar?.bars.map((b) => ({
        label: `${b.label} · ${count(b.merchantCount)} shops`,
        value: formatGrowth(b.growth),
        tone: tone(b.growth),
      })),
      note: byBazaar ? hidden(byBazaar.hiddenGroups) : undefined,
    });
  }

  stages.push({
    id: "categories",
    label: "Category movement",
    status: "done",
    summary: byCategory?.bars.length
      ? `${byCategory.bars.length} type${byCategory.bars.length > 1 ? "s" : ""} of shop reported; ${byCategory.bars[0].label} lead.`
      : "No type of shop was large enough to report on its own.",
    rows: byCategory?.bars.map((b) => ({
      label: `${b.label} · ${count(b.merchantCount)} shops`,
      value: formatGrowth(b.growth),
      tone: tone(b.growth),
    })),
    note: byCategory ? hidden(byCategory.hiddenGroups) : undefined,
  });

  if (scope === "bazaar" && data.performance) {
    stages.push({
      id: "performance",
      label: "Shop performance",
      status: "done",
      summary: "Each shop was placed in a band by its own growth; only the counts leave the engine.",
      rows: data.performance.map((p) => ({ label: BAND_WORDS[p.band], value: count(p.count) })),
    });
  }

  stages.push({
    id: "pattern",
    label: "Weekly pattern",
    status: "done",
    summary: data.weekPattern
      ? `A weekend day sells ${pctSigned(data.weekPattern.weekendLiftPct)} against a weekday.`
      : "Weekend and weekday sales were too close to call a pattern.",
    calcs: data.weekPattern
      ? [
          {
            label: "Weekend lift",
            formula: "(Weekend sales per day − Weekday sales per day) ÷ Weekday sales per day × 100",
            working: `(${rupees(data.weekPattern.weekendDailyGmv)} − ${rupees(data.weekPattern.weekdayDailyGmv)}) ÷ ${rupees(data.weekPattern.weekdayDailyGmv)} × 100`,
            result: pctSigned(data.weekPattern.weekendLiftPct),
            tone: tone(data.weekPattern.weekendLiftPct),
          },
        ]
      : undefined,
  });

  stages.push({
    id: "headline",
    label: "Headline",
    status: "done",
    summary: data.headline,
    rows: data.detail ? [{ label: "Supporting line", value: data.detail }] : undefined,
    note: "Written by fixed rules from the figures above. No LLM is used for the City and Bazaar views.",
  });

  stages.push({
    id: "not-used",
    label: "Not used here",
    status: "not_used",
    summary: `Relevance ranking, Cognee memory, the LLM and n8n work per merchant. This ${noun} view is aggregate-only.`,
  });

  return { scope, subject: data.name, window: windowOf(period), unavailable: null, stages };
}

// --- Merchant ----------------------------------------------------------------------

export interface MerchantTraceInput {
  /** Shown before the data arrives. */
  title: string;
  basics: MerchantBasics | null;
  explanation: MerchantExplanation | null;
  basicsLoading: boolean;
  explanationLoading: boolean;
  error: string | null;
  /** What the merchant has done in this dialog since it loaded (approval, measured result). */
  live?: { approval: ActionExecutionOutcome | null; measured: MeasuredOutcome | null; ask?: (AskResult & { question: string }) | null };
  scene?: SceneContext;
}

const MERCHANT_STEPS: [string, string][] = [
  ["data", "Loading this shop's sales"],
  ["metrics", "Calculating metrics"],
  ["cohort", "Building the similar-shops group"],
  ["m2m", "Comparing with similar shops, the Bazaar and the city"],
  ["context", "Evaluating when sales happened"],
  ["relevance", "Ranking relevant signals"],
  ["opportunity", "Detecting opportunities"],
  ["recommendation", "Proposing an action"],
  ["memory", "Recalling this shop's history"],
  ["explanation", "Generating explanation from structured intelligence"],
  ["action", "Checking approval and execution"],
];

/**
 * The figures behind a finding. The shop / similar shops / Bazaar / city
 * changes are the same for every finding in one analysis, so they are shown
 * once in the M2M stage; `base` adds them for a finding shown on its own.
 */
function evidenceRows(e: Evidence, base = false): TraceRow[] {
  const rows: TraceRow[] = [];
  if (base) {
    rows.push({ label: "This shop", value: formatGrowth(e.merchantChange), tone: tone(e.merchantChange) });
    if (e.cohortChange != null) rows.push({ label: "Similar shops", value: formatGrowth(e.cohortChange), tone: tone(e.cohortChange) });
    if (e.bazaarChange != null) rows.push({ label: "Bazaar", value: formatGrowth(e.bazaarChange), tone: tone(e.bazaarChange) });
  }
  if (e.context) {
    const when = segmentWords(e.context.dimension, e.context.segment);
    rows.push(
      { label: `${when}: this shop`, value: formatGrowth(e.context.merchantChange), tone: tone(e.context.merchantChange) },
      { label: `${when}: similar shops`, value: formatGrowth(e.context.cohortChange), tone: tone(e.context.cohortChange) },
      { label: `${when}: this shop's orders`, value: count(e.context.merchantTransactions) },
    );
  }
  return rows;
}

function signalGroup(s: RelevanceSignal, background = false): TraceGroup {
  const f = s.factors;
  const rows: TraceRow[] = [
    { label: "Size", value: points(s.magnitudePp) },
    { label: "Score", value: `${s.score} / 100` },
  ];
  if (s.kind !== "ALIGNMENT") {
    rows.push({
      label: "Score working",
      value: `100 × ${factor(f.magnitude)} × ${factor(f.specificity)} × ${factor(f.confidence)} × ${factor(f.patternSupport)}${f.opportunityBonus ? ` + ${f.opportunityBonus}` : ""} → ${s.score}`,
    });
  }
  if (s.patterns.length) rows.push({ label: "Confirmed by", value: s.patterns.map((p) => PATTERN_WORDS[p]).join("; ") });
  return {
    title: `${SIGNAL_WORDS[s.kind]}${s.evidence.context ? ` · ${segmentWords(s.evidence.context.dimension, s.evidence.context.segment)}` : ""}`,
    badge: `${background ? "background · " : ""}${s.priority} · ${DIRECTION_WORDS[s.direction]}`,
    rows,
    note:
      s.kind === "ALIGNMENT"
        ? "Fixed low score: worth knowing, never a lead signal."
        : "Size × specificity × confidence × pattern support, plus a bonus when an opportunity rests on it; capped at 100.",
  };
}

/** One row per distinct drop, marked with how many signals it covers. */
function dismissedRows(dismissed: { kind: SignalKind; reason: DismissalReason }[]): TraceRow[] {
  const seen = new Map<string, { row: TraceRow; times: number }>();
  for (const d of dismissed) {
    const key = `${d.kind}:${d.reason}`;
    const entry = seen.get(key) ?? { row: { label: SIGNAL_WORDS[d.kind], value: DISMISSAL_WORDS[d.reason] }, times: 0 };
    entry.times += 1;
    seen.set(key, entry);
  }
  return [...seen.values()].map(({ row, times }) => (times > 1 ? { ...row, label: `${row.label} (×${times})` } : row));
}

function segmentRows(segments: ContextSegmentAnalysis[]): TraceRow[] {
  return segments.map((s) => ({
    label: `${segmentWords(s.dimension, s.segment)} · ${s.merchant.currentShare.toFixed(1)}% of sales`,
    value: `${formatGrowth(s.merchant.growth)} vs ${s.cohort ? formatGrowth(s.cohort.growth) : "—"}`,
    tone: tone(s.merchant.growth),
  }));
}

export function buildMerchantTrace(input: MerchantTraceInput): TraceModel {
  const { basics, explanation, scene } = input;

  if (!basics) {
    const failed = input.error !== null;
    return {
      scope: "merchant",
      subject: input.title,
      window: null,
      unavailable: failed ? `Trace details unavailable: ${input.error}` : null,
      stages: MERCHANT_STEPS.map(([id, label]) =>
        failed
          ? { id, label, status: "unavailable" as const, summary: "Not available: the request failed." }
          : pending(id, label, input.basicsLoading ? "Waiting for the analysis to return." : "Not started."),
      ),
    };
  }

  const { merchant, m2m, relevance, recommendation, services } = basics;
  const mm = m2m.merchantMetrics;
  const cur = mm.current;
  const prev = mm.previous;
  const cohortCmp = m2m.comparisons.find((c) => c.against === "cohort");
  // Deterministic deployment: rules do the wording, nothing is remembered, and
  // an approved action is recorded rather than sent anywhere.
  const deterministic = services.mode === "deterministic";
  const stages: TraceStage[] = [];

  // Context
  stages.push(
    sceneStage(scene, [
      { label: "Merchant", value: merchant.name },
      { label: "Bazaar", value: merchant.bazaar.name },
      { label: "City", value: merchant.bazaar.city },
      { label: "Category", value: CATEGORY[merchant.category] ?? merchant.category },
      { label: "This period", value: range(m2m.period.current) },
      { label: "Compared with", value: range(m2m.period.previous) },
    ]),
  );

  // Data
  stages.push({
    id: "data",
    label: "Data",
    status: "done",
    summary: `${count(cur.transactions)} successful payments this period against ${count(prev.transactions)} before.`,
    rows: [
      { label: "Observation window", value: `${m2m.period.days} days vs the ${m2m.period.days} before` },
      { label: "Successful payments", value: count(cur.transactions) },
      { label: "Sales", value: rupees(cur.gmv) },
      { label: "Refunds", value: rupees(cur.refunds) },
    ],
    note: "Only this shop's own totals and anonymous group totals reach this screen. No transaction is sent.",
  });

  // Metrics
  stages.push({
    id: "metrics",
    label: "Metrics",
    status: "done",
    summary: `Sales ${cur.growth == null ? "could not be compared with the previous period" : `changed ${formatGrowth(cur.growth)}`}; average bill ${cur.aov == null ? "undefined" : rupees(cur.aov)}.`,
    calcs: [aovCalc(cur.gmv, cur.transactions, cur.aov), growthCalc("Growth", cur.gmv, prev.gmv, cur.growth)],
  });

  // Cohort
  const cohort = m2m.cohort;
  const basis =
    cohort.basis === "bazaar_category"
      ? `Same Bazaar + ${CATEGORY[cohort.category] ?? cohort.category}`
      : `Same city + ${CATEGORY[cohort.category] ?? cohort.category} (fallback)`;
  const cohortCurrent = m2m.cohortMetrics.current;
  stages.push({
    id: "cohort",
    label: "Cohort",
    status: "done",
    summary: cohort.reportable
      ? `Compared with ${count(cohort.size)} similar shops, never with any one of them.`
      : "Too few similar shops to compare with without identifying them; the Bazaar stands in as the network.",
    rows: [
      { label: "Rule", value: basis },
      { label: "Comparable shops", value: count(cohort.size) },
      { label: "Status", value: cohort.reportable ? "Reportable" : "Withheld for privacy" },
      ...(cohortCurrent
        ? [
            { label: "Similar shops' sales", value: formatRupees(cohortCurrent.gmv) },
            { label: "Similar shops' average bill", value: cohortCurrent.aov == null ? "—" : rupees(cohortCurrent.aov) },
          ]
        : []),
    ],
    calcs:
      cohortCmp?.available && cohortCmp.growthGap != null
        ? [
            {
              label: "This shop vs similar shops",
              formula: "Shop growth − Similar shops' growth",
              working: `${pctSigned(cohortCmp.merchantGrowth)} − (${pctSigned(cohortCmp.groupGrowth)})`,
              result: points(cohortCmp.growthGap),
              tone: tone(cohortCmp.growthGap),
            },
            ...(cohortCmp.aovGap != null
              ? [
                  {
                    label: "Average bill vs similar shops",
                    formula: "(Shop average bill − Group average bill) ÷ Group average bill × 100",
                    working: `(${cur.aov == null ? "—" : rupees(cur.aov)} − ${cohortCurrent?.aov == null ? "—" : rupees(cohortCurrent.aov)}) ÷ ${cohortCurrent?.aov == null ? "—" : rupees(cohortCurrent.aov)} × 100`,
                    result: pctSigned(cohortCmp.aovGap),
                    tone: tone(cohortCmp.aovGap),
                  },
                ]
              : []),
          ]
        : undefined,
  });

  // M2M comparisons and patterns
  const impact = m2m.bazaarImpact;
  stages.push({
    id: "m2m",
    label: "M2M analysis",
    status: "done",
    summary: m2m.patterns.length
      ? `Pattern detected: ${PATTERN_WORDS[m2m.patterns[0].type]}.`
      : "No network pattern stands out this period.",
    rows: [
      { label: "This shop growth", value: formatGrowth(cur.growth), tone: tone(cur.growth) },
      ...m2m.comparisons.map((c) => ({
        label: `${GROUP_WORDS[c.against]} growth · gap`,
        value: c.available ? `${formatGrowth(c.groupGrowth)} · ${points(c.growthGap)}` : "Withheld (group too small)",
        tone: c.available ? tone(c.groupGrowth) : undefined,
      })),
      { label: "Same category, city-wide", value: formatGrowth(impact.categoryGrowth), tone: tone(impact.categoryGrowth) },
      { label: "Bazaar orders (demand)", value: formatGrowth(impact.demandTrend.growth), tone: tone(impact.demandTrend.growth) },
      {
        label: `Gap to the network (${impact.networkBasis === "cohort" ? "similar shops" : "Bazaar"})`,
        value: points(impact.merchantVsNetworkGap),
        tone: tone(impact.merchantVsNetworkGap),
      },
    ],
    groups: m2m.patterns.map((p) => ({
      title: PATTERN_WORDS[p.type],
      badge: "Pattern",
      rows: evidenceRows(p.evidence),
    })),
    note: "Deterministic rules over the figures above, all from the same observation window. A pattern says what moved together, never why.",
  });

  // Context evidence
  const timeSegments = m2m.context.segments.filter((s) => s.dimension === "timeOfDay");
  const dimensions = new Set(m2m.context.segments.map((s) => s.dimension)).size;
  const contextPatterns = m2m.patterns.filter((p) => p.type === "CONTEXT_NETWORK_GROWTH");
  stages.push({
    id: "context-evidence",
    label: "Context evidence",
    status: "done",
    summary: contextPatterns.length
      ? `${contextPatterns.length} part${contextPatterns.length > 1 ? "s" : ""} of the week where similar shops grew and this shop fell.`
      : `Sales were split by time of day, weekday, weather and event (${dimensions} dimensions); no part of the week stood out on its own.`,
    rows: timeSegments.length ? segmentRows(timeSegments) : undefined,
    note: timeSegments.length
      ? "Time of day: share of this shop's sales, then this shop's growth vs similar shops'. Context is taken from when each recorded payment happened; these are associations, not causes."
      : undefined,
  });

  // Relevance
  const lead = relevance.prioritySignals[0];
  stages.push({
    id: "relevance",
    label: "Relevance",
    status: "done",
    summary: lead
      ? `Leading signal: ${SIGNAL_WORDS[lead.kind].toLowerCase()}, ${points(lead.magnitudePp)}, score ${lead.score}, ${lead.priority} priority.`
      : "No signal was strong enough to lead.",
    rows: [
      { label: "Leading", value: count(relevance.prioritySignals.length) },
      { label: "Background", value: count(relevance.backgroundSignals.length) },
      { label: "Dropped", value: count(relevance.dismissed.length) },
      {
        label: "Confidence in the comparison",
        value:
          relevance.cohortConfidence === "primary"
            ? "High: same-Bazaar peers"
            : relevance.cohortConfidence === "fallback"
              ? "Reduced: city-wide peers"
              : "Low: no reportable peers",
      },
      { label: "Top priority", value: relevance.topPriority ?? "None" },
    ],
    groups: [
      ...relevance.prioritySignals.map((signal) => signalGroup(signal)),
      // When nothing leads, the strongest background signals still show how scoring went.
      ...(relevance.prioritySignals.length === 0 ? relevance.backgroundSignals.slice(0, 3).map((signal) => signalGroup(signal, true)) : []),
      ...(relevance.dismissed.length
        ? [
            {
              title: "Dropped signals",
              rows: dismissedRows(relevance.dismissed),
            },
          ]
        : []),
    ],
  });

  // Opportunity
  const topOpp = relevance.relevantOpportunities[0];
  stages.push({
    id: "opportunity",
    label: "Opportunity",
    status: "done",
    summary: topOpp ? `${topOpp.opportunity.title} (${topOpp.priority} priority).` : "No opportunity detected this period.",
    groups: relevance.relevantOpportunities.map((o) => ({
      title: o.opportunity.title,
      badge: `${o.priority} · score ${o.score}`,
      rows: [
        { label: "Why", value: OPPORTUNITY_REASON[o.opportunity.reason] ?? o.opportunity.reason },
        { label: "M2M priority", value: o.opportunity.priority },
        { label: "After relevance", value: o.priority },
        ...evidenceRows(o.opportunity.evidence, !o.opportunity.evidence.context),
      ],
    })),
    note: relevance.relevantOpportunities.length
      ? "Relevance can lower M2M's priority, never raise it."
      : undefined,
  });

  // Recommendation (deterministic)
  stages.push({
    id: "recommendation",
    label: "Recommendation",
    status: "done",
    summary:
      recommendation.status === "proposed"
        ? recommendation.action.description
        : "No action proposed: no medium or high 'behind the network' opportunity.",
    rows:
      recommendation.status === "proposed"
        ? [
            { label: "Action", value: "Scheduled promotion" },
            {
              label: "Target",
              value:
                recommendation.action.parameters.targetSegment === "all_day"
                  ? "All day"
                  : segmentWords("timeOfDay", recommendation.action.parameters.targetSegment),
            },
            { label: "Length", value: `${recommendation.action.parameters.durationDays} days` },
            { label: "Based on", value: recommendation.action.basis.opportunityType === "CAPTURE_CONTEXT_DEMAND" ? "Context opportunity" : "Network gap opportunity" },
            { label: "Signals", value: count(recommendation.action.basis.signalIds.length) },
          ]
        : undefined,
    note: deterministic
      ? "Chosen by a fixed rule from the relevance result above, and worded by the same rules."
      : "Chosen by a fixed rule from the relevance result. The LLM words it but does not choose it.",
  });

  // Memory (Cognee)
  const history = explanation?.history;
  if (deterministic) {
    stages.push({
      id: "memory",
      label: "Memory",
      status: "not_used",
      summary: "Off in this deployment: Bazaar remembers nothing between visits.",
      note: "Every figure above comes from the recorded sales of this period alone, so the same week always gives the same answer.",
    });
  } else
  stages.push(
    !history
      ? input.explanationLoading
        ? pending("memory", "Memory (Cognee)", "Recalling this shop's past situations…")
        : { id: "memory", label: "Memory (Cognee)", status: "unavailable", summary: "History was not returned." }
      : history.status === "recalled"
        ? {
            id: "memory",
            label: "Memory (Cognee)",
            status: "done",
            summary: history.memories.length
              ? `Recalled ${history.memories.length} past record${history.memories.length > 1 ? "s" : ""} for this shop.`
              : "Searched this shop's memory; nothing similar recorded yet.",
            rows: history.memories.map((m) => ({
              label: `${m.kind === "insight" ? "Past insight" : m.kind === "action_outcome" ? "Past action" : "Measured outcome"} · ${range(m.situation.period)}`,
              value: m.outcome?.merchantGrowth != null ? `${formatGrowth(m.outcome.merchantGrowth)} after` : m.action?.status ?? "recorded",
            })),
            note: "Memory is kept per shop and searched only within that shop's space.",
          }
        : {
            id: "memory",
            label: "Memory (Cognee)",
            status: "unavailable",
            summary: history.status === "unavailable" ? "Cognee is not configured; explained without history." : "Cognee could not be reached; explained without history.",
          },
  );

  // Explanation (LLM)
  const insight = explanation?.insight;
  if (!insight) {
    stages.push(
      input.explanationLoading
        ? pending("explanation", deterministic ? "Explanation" : "AI explanation", "Writing the explanation from the calculated facts…")
        : { id: "explanation", label: deterministic ? "Explanation" : "AI explanation", status: "unavailable", summary: "The explanation was not returned." },
    );
  } else if (insight.status === "generated") {
    const factById = new Map(insight.facts.map((f) => [f.id, f]));
    stages.push({
      id: "explanation",
      label: deterministic ? "Explanation" : "AI explanation",
      status: "done",
      summary: deterministic
        ? `Bazaar wrote the explanation from ${insight.facts.length} calculated facts. No AI model was called.`
        : insight.source === "ai"
          ? `${insight.model} explained the result using ${insight.facts.length} structured facts.`
          : `Rule-based wording used (${insight.aiIssue === "LLM_NOT_CONFIGURED" ? "LLM not configured" : "the model's reply failed the checks"}).`,
      rows: [
        { label: "Input", value: `${insight.facts.length} facts from M2M, Relevance and memory` },
        { label: "Raw transactions sent", value: "None" },
        { label: "Other shops' identities sent", value: "None" },
        {
          label: "Written by",
          value: deterministic ? "Bazaar's rules, from the fact table" : insight.source === "ai" ? `${insight.provider} · ${insight.model}` : "Rules (fallback)",
        },
        { label: "Confidence", value: insight.insight.recommendation.confidence },
      ],
      groups: [
        {
          title: "Facts cited",
          rows: insight.insight.evidence.map((e) => {
            const fact = factById.get(e.factId);
            return {
              label: fact?.label ?? e.factId,
              value: fact
                ? fact.unit === "inr"
                  ? rupees(fact.value)
                  : fact.unit === "percent"
                    ? fact.id.endsWith("_share")
                      ? `${fact.value.toFixed(1)}%`
                      : pctSigned(fact.value)
                    : fact.unit === "points"
                      ? points(fact.value)
                      : count(fact.value)
                : "—",
            };
          }),
          note: deterministic
            ? "Each figure is copied from the fact table, so the wording and the numbers can never disagree."
            : "Every figure in the wording is checked against the fact table; a reply with any other figure is rejected.",
        },
      ],
    });
  } else {
    stages.push({
      id: "explanation",
      label: deterministic ? "Explanation" : "AI explanation",
      status: "unavailable",
      summary:
        insight.status === "unavailable"
          ? "LLM not configured; the structured intelligence above is shown without wording."
          : insight.status === "failed"
            ? "The LLM could not be reached; nothing was made up in its place."
            : "The LLM reply failed validation and was discarded.",
    });
  }

  // Ask Bazaar: the latest conversational answer
  const ask = input.live?.ask;
  if (ask) stages.push(askStage(ask, deterministic));

  // Action
  const live = input.live;
  if (recommendation.status === "proposed") {
    const approval = live?.approval ?? null;
    const executed = recommendation.actionStatus === "executed" || approval?.execution?.status === "executed";
    const failed = approval?.execution?.status === "failed";
    const approvedPending = !executed && (recommendation.actionStatus === "approved" || (approval !== null && approval.execution === null));
    const outcome = live?.measured ?? recommendation.outcome;
    stages.push({
      id: "action",
      label: "Action",
      status: "done",
      summary: executed
        ? deterministic
          ? "Approved by the merchant and recorded inside Bazaar."
          : "Approved by the merchant and executed by n8n."
        : failed
          ? "Approved, but n8n reported the run failed."
          : approvedPending
            ? "Approved by the merchant; saved as pending because no executor is configured."
            : recommendation.actionId
              ? "Waiting for the merchant's approval."
              : "Cannot be approved: action storage is unavailable.",
      rows: [
        { label: "Approval required", value: "Yes" },
        {
          label: "Status",
          value: executed ? "Executed" : failed ? "Failed" : approvedPending ? "Approved, pending" : (recommendation.actionStatus ?? "Not saved"),
        },
        {
          label: "Executor",
          value: deterministic ? "Recorded in Bazaar · no external workflow" : `n8n · ${services.executor.configured ? "configured" : "not configured"}`,
        },
        ...(recommendation.execution ? [{ label: "Ran on", value: shortDate(recommendation.execution.executedAt.slice(0, 10)) }] : []),
        ...(approval?.execution?.reference ? [{ label: "n8n reference", value: approval.execution.reference }] : []),
        ...(outcome
          ? [
              { label: "Outcome window", value: range(outcome.window) },
              { label: "Shop after", value: formatGrowth(outcome.merchantGrowth), tone: tone(outcome.merchantGrowth) },
              { label: "Similar shops after", value: formatGrowth(outcome.cohortGrowth), tone: tone(outcome.cohortGrowth) },
              { label: "Gap after", value: points(outcome.gapToCohort), tone: tone(outcome.gapToCohort) },
            ]
          : []),
      ],
      note: deterministic
        ? "The approval is stored with the structured action above; nothing is emailed or sent outside Bazaar. Outcomes come from demo data and do not prove the offer caused them."
        : "n8n receives only the structured action above, never LLM text. Outcomes come from demo data and do not prove the offer caused them.",
    });
  } else {
    stages.push({
      id: "action",
      label: "Action",
      status: "not_used",
      summary: "Nothing to approve, so n8n is not involved for this shop this period.",
    });
  }

  if (m2m.limitations.length) {
    stages.push({
      id: "limits",
      label: "Data limits",
      status: "done",
      summary: "What the engine could not say, and why.",
      rows: m2m.limitations.map((l) => ({ label: "Limit", value: LIMITATION_WORDS[l] })),
    });
  }

  return { scope: "merchant", subject: merchant.name, window: windowOf(m2m.period), unavailable: null, stages };
}

// --- Ask Bazaar -------------------------------------------------------------------

const ASK_SOURCE: Record<AskResult["source"], string> = {
  ai: "Model wording, every figure checked",
  ai_trimmed: "Model wording, unchecked sentences removed",
  summary: "Built from the facts by rules",
};

const ASK_ISSUE: Record<NonNullable<AskResult["trace"]["aiIssue"]>, string> = {
  LLM_NOT_CONFIGURED: "No language model configured",
  LLM_ERROR: "The language model could not be reached",
  INVALID_RESPONSE: "The model's reply was not valid",
  UNSUPPORTED_FIGURE: "The model used a figure not in the facts",
};

const providerName = (provider: string) => (provider === "sarvam" ? "Sarvam" : provider === "openrouter" ? "OpenRouter" : provider === "rules" ? "Rules" : provider);

function factText(f: AskResult["evidence"][number]): string {
  if (f.unit === "inr") return rupees(f.value);
  if (f.unit === "percent") return f.id.endsWith("_share") ? `${f.value.toFixed(1)}%` : pctSigned(f.value);
  if (f.unit === "points") return points(f.value);
  return count(f.value);
}

/** The latest Ask Bazaar turn: which intelligence it used and how the wording was produced and checked. */
function askStage(ask: AskResult & { question: string }, deterministic: boolean): TraceStage {
  const t = ask.trace;
  const wordedBy =
    ask.source !== "summary"
      ? `${providerName(ask.provider)} · ${ask.model}`
      : deterministic
        ? "Bazaar's rules, from the fact table"
        : "Rules (fallback)";
  return {
    id: "ask",
    label: "Ask Bazaar",
    status: "done",
    summary:
      ask.source !== "summary"
        ? `${providerName(ask.provider)} turned ${t.factsSent} structured facts into a ${t.input === "voice" ? "spoken" : "written"} answer.`
        : deterministic
          ? `Answered from ${t.factsSent} calculated facts by rules. No AI model was called.`
          : "Answered from the structured facts by rules; nothing was made up in place of the model.",
    rows: [
      { label: "Question", value: ask.question.length > 80 ? `${ask.question.slice(0, 80)}…` : ask.question },
      { label: "Asked by", value: t.input === "voice" ? "Voice (Sarvam speech-to-text)" : "Typing" },
      { label: "Answer language", value: ask.language },
      { label: "Intent", value: ask.intent.toLowerCase() },
      { label: "Worded by", value: wordedBy },
      { label: "Checks", value: ASK_SOURCE[ask.source] },
      ...(t.aiIssue && !deterministic ? [{ label: "Why", value: ASK_ISSUE[t.aiIssue] }] : []),
      { label: "Facts sent", value: `${t.factsSent} (from M2M, Relevance and memory)` },
      { label: "Conversation sent", value: `Last ${t.turnsSent} turn${t.turnsSent === 1 ? "" : "s"}` },
      { label: "Memory", value: t.memory.status === "recalled" ? `${t.memory.used} past record${t.memory.used === 1 ? "" : "s"}` : t.memory.status === "not_requested" ? "Not used" : "Not available; answered without history" },
      { label: "Raw transactions sent", value: "None" },
      { label: "Other shops' identities sent", value: "None" },
    ],
    groups: [
      ...(ask.evidence.length
        ? [{ title: "Facts the answer cites", rows: ask.evidence.map((f) => ({ label: f.label, value: factText(f) })), note: "Resolved from the fact table on the server, not taken from the model." }]
        : []),
      {
        title: "Intelligence behind it",
        rows: [
          ...t.signals.map((s) => ({ label: SIGNAL_WORDS[s.kind as SignalKind] ?? s.kind, value: `${s.priority} priority · ${s.direction} · ${Math.abs(s.magnitudePp).toFixed(1)} pts` })),
          ...t.patterns.map((p) => ({ label: "Pattern", value: PATTERN_WORDS[p as PatternType] ?? p })),
          ...(t.opportunity ? [{ label: "Opportunity", value: t.opportunity }] : []),
        ],
      },
      ...(ask.action
        ? [{ title: "Action offered", rows: [{ label: "Proposal", value: ask.action.description }, { label: "Needs approval", value: "Yes" }], note: "The same deterministic proposal as the offer card. The model can point to it but cannot create or run it." }]
        : []),
    ],
  };
}
