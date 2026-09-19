/**
 * The fact table: every figure the LLM is allowed to mention, taken verbatim
 * from M2M, Relevance and memory. The LLM cites facts by ID and may not use
 * any other business figure (see insight.ts).
 */

import type { MerchantMemory } from "@/lib/cognee";
import type { M2MIntelligence } from "@/m2m-engine";
import type { RelevantIntelligence } from "@/relevance-engine";

import type { Fact, FactUnit, ProposedAction } from "./types";

/** Plain words for the groups M2M compares against. */
const GROUP = { cohort: "similar shops near you", bazaar: "your market", city: "the city" } as const;

/** "in the evening", "on Fridays", "in rainy weather", "during festivals". */
function when(dimension: string, segment: string): string {
  if (dimension === "dayOfWeek") return `on ${segment[0].toUpperCase()}${segment.slice(1)}s`;
  if (dimension === "timeOfDay") return `in the ${segment}`;
  if (dimension === "weather") return `in ${segment.replace("_", " ")} weather`;
  return segment === "none" ? "on ordinary days" : `during ${segment.replace("_", " ")}s`;
}

export function buildFacts(
  m2m: M2MIntelligence,
  relevance: RelevantIntelligence,
  memories: MerchantMemory[],
  action: ProposedAction | null,
): Fact[] {
  const facts: Fact[] = [];
  const add = (id: string, label: string, value: number | null | undefined, unit: FactUnit) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) facts.push({ id, label, value, unit });
  };

  const { current, previous } = m2m.merchantMetrics;
  for (const item of m2m.contextImpact?.evidence ?? []) {
    const key = `selected_context.${item.dimension}.${item.segment}`;
    add(`${key}.merchant_growth`, `Your sales change for the selected ${item.dimension}`, item.merchantGrowth, "percent");
    add(`${key}.cohort_growth`, `Similar shops' sales change for the selected ${item.dimension}`, item.cohortGrowth, "percent");
    add(`${key}.gap`, `Your gap to similar shops for the selected ${item.dimension}`, item.gapPp, "points");
    add(`${key}.transactions`, `Your paid orders supporting the selected ${item.dimension}`, item.merchantTransactions, "count");
  }
  const weekly = m2m.period.days === 7;
  const thisWeek = weekly ? "this week" : "this period";
  const lastWeek = weekly ? "last week" : "the period before";
  const market = "your market";
  add("merchant.gmv.current", `Your sales ${thisWeek} (₹)`, current.gmv, "inr");
  add("merchant.gmv.previous", `Your sales ${lastWeek} (₹)`, previous.gmv, "inr");
  add("merchant.gmv.growth", `Change in your sales vs ${lastWeek} (%)`, current.growth, "percent");
  add("merchant.transactions.current", `Paid orders ${thisWeek}`, current.transactions, "count");
  add("merchant.transactions.previous", `Paid orders ${lastWeek}`, previous.transactions, "count");
  add("merchant.aov.current", `Your average bill ${thisWeek} (₹)`, current.aov, "inr");
  add("merchant.refunds.current", `Money refunded ${thisWeek} (₹)`, current.refunds, "inr");

  const impact = m2m.bazaarImpact;
  add("cohort.gmv.growth", "Change in sales for similar shops near you (%)", impact.cohortGrowth, "percent");
  add("cohort.size", "Number of similar shops compared with", m2m.cohort.reportable ? m2m.cohort.size : null, "count");
  add("category.gmv.growth", "Change in sales for your type of shop across the city (%)", impact.categoryGrowth, "percent");
  add("bazaar.gmv.growth", `Change in sales across ${market} (%)`, impact.bazaarGrowth, "percent");
  add("bazaar.demand.growth", `Change in number of orders across ${market} (%)`, impact.demandTrend.growth, "percent");
  add("city.gmv.growth", `Change in sales across ${m2m.city} (%)`, impact.cityGrowth, "percent");
  add("network.gap", "How far ahead (+) or behind (-) similar shops your sales change is", impact.merchantVsNetworkGap, "points");

  for (const c of m2m.comparisons) {
    if (!c.available) continue;
    add(`gap.${c.against}`, `How far ahead (+) or behind (-) ${GROUP[c.against]} your sales change is`, c.growthGap, "points");
    add(`aov_gap.${c.against}`, `Your average bill compared with ${GROUP[c.against]} (%)`, c.aovGap, "percent");
  }

  for (const s of [...relevance.prioritySignals, ...relevance.backgroundSignals]) {
    const ctx = s.kind === "CONTEXT" ? s.evidence.context : undefined;
    if (!ctx) continue;
    const key = `context.${ctx.dimension}.${ctx.segment}`;
    add(`${key}.merchant_growth`, `Change in your sales ${when(ctx.dimension, ctx.segment)} (%)`, ctx.merchantChange, "percent");
    add(`${key}.cohort_growth`, `Change in sales for similar shops ${when(ctx.dimension, ctx.segment)} (%)`, ctx.cohortChange, "percent");
  }

  // The merchant's sales pattern by time of day and weekday, from M2M's context
  // analysis. Lets the model speak about "your Fridays" or "your evenings".
  for (const seg of m2m.context.segments) {
    if (seg.dimension !== "timeOfDay" && seg.dimension !== "dayOfWeek") continue;
    const key = `pattern.${seg.dimension}.${seg.segment}`;
    const label = when(seg.dimension, seg.segment);
    add(`${key}.merchant_gmv`, `Your sales ${label} ${thisWeek} (₹)`, seg.merchant.currentGmv || null, "inr");
    add(`${key}.merchant_share`, `Part of your ${thisWeek} sales made ${label} (%)`, seg.merchant.currentShare || null, "percent");
    add(`${key}.merchant_growth`, `Change in your sales ${label} (%)`, seg.merchant.growth, "percent");
    add(`${key}.cohort_growth`, `Change in sales for similar shops ${label} (%)`, seg.cohort?.growth, "percent");
  }

  memories.forEach((memory, i) => {
    add(`history.${i}.merchant_growth`, `Change in your sales after a past action (%)`, memory.outcome?.merchantGrowth, "percent");
    add(`history.${i}.cohort_growth`, `Change in sales for similar shops after a past action (%)`, memory.outcome?.cohortGrowth, "percent");
  });

  add("period.days", "Days compared", m2m.period.days, "count");
  if (action) add("action.duration_days", "Length of the suggested offer (days)", action.parameters.durationDays, "count");
  return facts;
}
