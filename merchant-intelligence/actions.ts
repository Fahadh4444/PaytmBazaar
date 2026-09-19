/**
 * Merchant actions: proposal, approval, execution and outcome.
 *
 *   relevance ──► proposeAction (deterministic)
 *                    │ saved as "proposed"
 *   merchant approves ──► executeApprovedAction ──► n8n ──► executed / failed
 *                    │ saved + remembered
 *   later ──► measureActionOutcome (M2M on the days after execution)
 *                    │ saved + remembered
 *
 * The executable action is built from Relevance output only. LLM wording is
 * shown to the merchant but never sent to n8n. Nothing runs without an
 * explicit `approved: true`.
 */

import { z } from "zod";

import type { MerchantMemory } from "@/lib/cognee";
import type { PromotionParameters } from "@/lib/n8n";
import { ActionNotFoundError, type MerchantActionRecord } from "@/lib/paytm/adapter/actions";
import { analyzeMerchant, type DateRange } from "@/m2m-engine";
import type { RelevantIntelligence } from "@/relevance-engine";

import { actionStoreUnavailable, approvalRequired, invalidActionState } from "./errors";
import { rememberSafely, situationOf } from "./memory";
import type {
  ActionExecutionOutcome,
  IntelligenceDeps,
  MeasuredOutcome,
  MeasuredOutcomeResult,
  MemoryWriteStatus,
  ProposedAction,
} from "./types";

/** Opportunities an evening/all-day promotion can reasonably address. */
const ACTIONABLE = new Set(["CLOSE_NETWORK_GAP", "CAPTURE_CONTEXT_DEMAND"]);
export const PROMOTION_DAYS = 7;

const SEGMENTS = ["morning", "afternoon", "evening", "night"] as const;

/**
 * A promotion when Relevance ranks a "behind the network" opportunity at
 * medium or high. It targets the time of day where the merchant trails its
 * peers most, if Relevance found one, otherwise the whole day.
 */
export function proposeAction(relevance: RelevantIntelligence): ProposedAction | null {
  const opportunity = relevance.relevantOpportunities.find(
    (o) => ACTIONABLE.has(o.opportunity.type) && o.priority !== "low",
  );
  if (!opportunity) return null;

  const timeSignal = relevance.prioritySignals.find(
    (s) => s.kind === "CONTEXT" && s.evidence.context?.dimension === "timeOfDay",
  );
  const segment = timeSignal?.evidence.context?.segment;
  const targetSegment: PromotionParameters["targetSegment"] = SEGMENTS.includes(segment as (typeof SEGMENTS)[number])
    ? (segment as PromotionParameters["targetSegment"])
    : "all_day";

  return {
    type: "SCHEDULE_PROMOTION",
    parameters: { targetSegment, durationDays: PROMOTION_DAYS, channel: "email" },
    description:
      targetSegment === "all_day"
        ? `Run a ${PROMOTION_DAYS}-day promotion on Paytm for all-day customers.`
        : `Run a ${PROMOTION_DAYS}-day ${targetSegment} promotion on Paytm.`,
    basis: {
      opportunityType: opportunity.opportunity.type,
      signalIds: [...new Set([...opportunity.signalIds, ...(timeSignal ? [timeSignal.id] : [])])],
      period: relevance.period.current,
      topPriority: relevance.topPriority,
      context: relevance.contextImpact?.requested,
    },
  };
}

const promotionSchema = z
  .object({
    targetSegment: z.enum(["morning", "afternoon", "evening", "night", "all_day"]),
    durationDays: z.number().int().min(1).max(30),
    channel: z.literal("email"),
  })
  .strict();

/**
 * The same action for this merchant and period that is open or has already
 * run: reuse it instead of proposing it again. Only a failed one may be retried.
 */
export function findReusable(records: MerchantActionRecord[], action: ProposedAction): MerchantActionRecord | undefined {
  return records.find(
    (r) =>
      r.status !== "failed" &&
      r.type === action.type &&
      (r.parameters as Partial<PromotionParameters>).targetSegment === action.parameters.targetSegment &&
      (r.basis as { period?: DateRange }).period?.to === action.basis.period.to &&
      JSON.stringify((r.basis as { context?: unknown }).context ?? null) === JSON.stringify(action.basis.context ?? null),
  );
}

function basisSituation(record: MerchantActionRecord) {
  const situation = (record.basis as { situation?: ReturnType<typeof situationOf> }).situation;
  return (
    situation ?? {
      period: (record.basis as { period: DateRange }).period,
      topPriority: null,
      cohortBasis: "unknown",
      signals: [],
      patterns: [],
    }
  );
}

/** Writes memory after the response when the host supports it; otherwise waits for it. */
async function rememberOrDefer(deps: IntelligenceDeps, record: MerchantMemory): Promise<MemoryWriteStatus> {
  if (!deps.memory.isConfigured()) return "unavailable";
  if (deps.defer) {
    deps.defer(() => rememberSafely(deps.memory, record));
    return "scheduled";
  }
  return rememberSafely(deps.memory, record);
}

export interface ExecuteActionInput {
  merchantId: string;
  actionId: string;
  /** Must be exactly `true`. */
  approved: unknown;
}

export async function executeApprovedAction(
  deps: IntelligenceDeps,
  input: ExecuteActionInput,
): Promise<ActionExecutionOutcome> {
  if (input.approved !== true) throw approvalRequired();
  if (!deps.actions) throw actionStoreUnavailable();

  const record = await deps.actions.get(input.actionId);
  // Another merchant's action is indistinguishable from a missing one.
  if (record.merchantId !== input.merchantId) {
    throw new ActionNotFoundError(input.actionId);
  }
  if (record.status !== "proposed" && record.status !== "approved") throw invalidActionState(record.status);

  const parameters = promotionSchema.parse(record.parameters);
  const approvedAt = record.approvedAt ?? deps.now().toISOString();
  let current = await deps.actions.update(record.id, { status: "approved", approvedAt });

  if (!deps.executor.isConfigured()) {
    // Approved but not run: say so, never pretend.
    return { action: current, execution: null, pendingReason: "ACTION_EXECUTOR_NOT_CONFIGURED", memory: "unavailable" };
  }

  const merchant = await deps.dataSource.getMerchantWithBazaar(record.merchantId);
  const execution = await deps.executor.execute({
    actionId: record.id,
    merchantId: record.merchantId,
    merchantName: merchant.name,
    bazaarName: merchant.bazaar.name,
    type: record.type,
    parameters,
    description: record.description.slice(0, 280),
  });

  current = await deps.actions.update(record.id, {
    status: execution.status,
    executedAt: execution.finishedAt,
    executionReference: execution.reference,
    executionDetail: execution.detail,
  });

  const memory = await rememberOrDefer(deps, {
    merchantId: record.merchantId,
    kind: "action_outcome",
    recordedAt: execution.finishedAt,
    situation: basisSituation(record),
    recommendation: (record.basis as { recommendation?: { action: string; expectedOutcome: string } }).recommendation,
    action: { actionId: record.id, type: record.type, parameters, status: execution.status },
    outcome: { status: execution.status, detail: execution.detail ?? undefined },
  });

  return { action: current, execution, pendingReason: null, memory };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** IST calendar date of an instant. */
function istDate(iso: string): string {
  return new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Measures what happened after an executed action, with the same M2M engine:
 * merchant and cohort GMV growth over the `days` from execution, against the
 * equally long period before. Returns `pending_data` until those days exist.
 */
export async function measureActionOutcome(
  deps: IntelligenceDeps,
  input: { merchantId: string; actionId: string; days?: number },
): Promise<MeasuredOutcomeResult> {
  if (!deps.actions) throw actionStoreUnavailable();
  const record = await deps.actions.get(input.actionId);
  if (record.merchantId !== input.merchantId) {
    throw new ActionNotFoundError(input.actionId);
  }
  if (record.status !== "executed" || !record.executedAt) throw invalidActionState(record.status);

  const days = input.days ?? PROMOTION_DAYS;
  const from = istDate(record.executedAt);
  const window: DateRange = { from, to: addDays(from, days - 1) };

  const available = await deps.dataSource.getMerchantDailyMetrics(record.merchantId, window);
  const availableDays = new Set(available.map((d) => d.businessDate)).size;
  if (availableDays < days) return { status: "pending_data", availableDays, requiredDays: days, window };

  const m2m = await analyzeMerchant(deps.dataSource, { merchantId: record.merchantId, current: window });
  const outcome: MeasuredOutcome = {
    window,
    merchantGrowth: m2m.merchantMetrics.current.growth,
    cohortGrowth: m2m.cohortMetrics.current?.growth ?? null,
    gapToCohort: m2m.comparisons.find((c) => c.against === "cohort")?.growthGap ?? null,
    measuredAt: deps.now().toISOString(),
  };
  const updated = await deps.actions.update(record.id, { outcome: { ...outcome } });

  const memory = await rememberOrDefer(deps, {
    merchantId: record.merchantId,
    kind: "measured_outcome",
    recordedAt: outcome.measuredAt,
    situation: basisSituation(record),
    action: { actionId: record.id, type: record.type, parameters: record.parameters, status: record.status },
    outcome: { status: "measured", merchantGrowth: outcome.merchantGrowth, cohortGrowth: outcome.cohortGrowth },
  });

  return { status: "measured", action: updated, outcome, memory };
}
