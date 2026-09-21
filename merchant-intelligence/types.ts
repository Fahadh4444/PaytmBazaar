/**
 * Types for the Merchant Intelligence service: the orchestration layer that
 * runs Data Adapter → M2M → Relevance → memory → LLM → action for one merchant.
 */

import type { MemoryProvider, MerchantMemory } from "@/lib/cognee";
import type { BazaarMode } from "@/lib/mode";
import type { LlmProvider } from "@/lib/llm";
import type { ActionExecutionResult, ActionExecutor, PromotionParameters } from "@/lib/n8n";
import type { MerchantActionRecord, MerchantActionStore } from "@/lib/paytm/adapter/actions";
import type { ComparisonPeriod, DateRange, M2MIntelligence, MerchantCategory, OpportunityType, PaytmDataSource, SelectedContext } from "@/m2m-engine";
import type { RelevantIntelligence } from "@/relevance-engine";

/** Everything the service talks to, injected so tests can replace any of it. */
export interface IntelligenceDeps {
  /**
   * How much of Bazaar is switched on (see lib/mode.ts). In `deterministic`
   * the wording is written by rules rather than by a model, and nothing is
   * apologised for: that is the product, not a degraded one.
   * Defaults to `full` so injected test doubles behave as before.
   */
  mode?: BazaarMode;
  /** Whether voice input and spoken answers are available. */
  speechConfigured?: boolean;
  dataSource: PaytmDataSource;
  llm: LlmProvider;
  /** Model identifier reported with generated insights. */
  llmModel: string;
  memory: MemoryProvider;
  executor: ActionExecutor;
  /** Null when persistence cannot be set up (e.g. Supabase unconfigured). */
  actions: MerchantActionStore | null;
  now: () => Date;
  /**
   * Runs work that must not delay the response (e.g. writing memory). In
   * production this is Next's `after()`; when omitted, the work is awaited.
   */
  defer?: (task: () => Promise<unknown>) => void;
}

/** The merchant's own public profile. Contact details are deliberately left out. */
export interface MerchantProfile {
  mid: string;
  name: string;
  category: MerchantCategory;
  bazaar: { id: string; name: string; city: string };
}

// --- Facts: the only figures the LLM may use ---------------------------------

export type FactUnit = "percent" | "points" | "inr" | "count";

export interface Fact {
  id: string;
  label: string;
  value: number;
  unit: FactUnit;
}

// --- LLM insight --------------------------------------------------------------

export interface MerchantInsight {
  summary: string;
  whatIsHappening: string;
  whyItMatters: string;
  opportunity: { title: string; reason: string } | null;
  recommendation: {
    action: string;
    expectedOutcome: string;
    confidence: "high" | "medium" | "low";
  };
  evidence: { factId: string; note: string }[];
  /** How past memories were used, or null when there were none. */
  historicalContext: string | null;
}

export type InsightInvalidReason = "INVALID_JSON" | "SCHEMA_MISMATCH" | "UNKNOWN_FACT" | "UNSUPPORTED_FIGURE";

export type InsightResult =
  | {
      status: "generated";
      /** `ai`: written by the model and validated. `rules`: built from the facts because the model could not be used. */
      source: "ai" | "rules";
      /** Why the model's wording was not used, when source is `rules`. */
      aiIssue?: "LLM_NOT_CONFIGURED" | "LLM_ERROR" | InsightInvalidReason;
      provider: string;
      model: string;
      insight: MerchantInsight;
      facts: Fact[];
    }
  | { status: "unavailable"; reason: "LLM_NOT_CONFIGURED" }
  | { status: "failed"; reason: "LLM_ERROR" }
  | { status: "invalid"; reason: InsightInvalidReason; detail: string };

// --- Memory -------------------------------------------------------------------

export type HistoryResult =
  | { status: "recalled"; memories: MerchantMemory[] }
  | { status: "unavailable"; reason: "MEMORY_NOT_CONFIGURED" }
  | { status: "failed"; reason: "MEMORY_ERROR" };

// --- Actions ------------------------------------------------------------------

export interface ProposedAction {
  type: "SCHEDULE_PROMOTION";
  parameters: PromotionParameters;
  /** Deterministic description, the only text that reaches n8n. */
  description: string;
  basis: {
    opportunityType: OpportunityType;
    signalIds: string[];
    period: DateRange;
    topPriority: string | null;
    context?: SelectedContext;
  };
}

export type RecommendationResult =
  | { status: "none"; reason: "NO_ACTIONABLE_OPPORTUNITY" }
  | {
      status: "proposed";
      action: ProposedAction;
      /** Null when the proposal could not be persisted; it cannot be approved then. */
      actionId: string | null;
      persistence: "saved" | "reused" | "unavailable";
      /** Where the action stands: `executed` means it is already running and must not be offered again. */
      actionStatus: "proposed" | "approved" | "executed" | null;
      /** When it ran, and what n8n reported. Null until it has run. */
      execution: { executedAt: string; detail: string | null } | null;
      /** Measured after the action (see measureActionOutcome). Null until measured. */
      outcome: MeasuredOutcome | null;
      /** Whether an executor is configured to run it once approved. */
      executorConfigured: boolean;
    };

/** Step 1: numbers, priorities and the proposed action. Fast; no AI, no memory. */
export interface MerchantBasics {
  merchant: MerchantProfile;
  period: ComparisonPeriod;
  m2m: M2MIntelligence;
  relevance: RelevantIntelligence;
  recommendation: RecommendationResult;
  /** For a what-if scenario: whether it calls for an offer email (see contextActionSupported). */
  contextAction: { supported: boolean } | null;
  services: {
    /** `deterministic`: rules only, no LLM, memory, workflow or voice. */
    mode: BazaarMode;
    llm: { configured: boolean; provider: string; model: string };
    memory: { configured: boolean; provider: string };
    executor: { configured: boolean; provider: string };
    speech: { configured: boolean };
  };
}

/** Step 2: remembered history and the AI summary. Slower. */
export interface MerchantExplanation {
  history: HistoryResult;
  insight: InsightResult;
}

export type MerchantIntelligenceResult = MerchantBasics & MerchantExplanation;

/** `scheduled`: handed to `defer`, written after the response is sent. */
export type MemoryWriteStatus = "remembered" | "scheduled" | "unavailable" | "failed";

export interface ActionExecutionOutcome {
  action: MerchantActionRecord;
  /** Null when nothing was executed (executor not configured). */
  execution: ActionExecutionResult | null;
  pendingReason: "ACTION_EXECUTOR_NOT_CONFIGURED" | null;
  memory: MemoryWriteStatus;
}

export type MeasuredOutcomeResult =
  | { status: "pending_data"; availableDays: number; requiredDays: number; window: DateRange }
  | {
      status: "measured";
      action: MerchantActionRecord;
      outcome: MeasuredOutcome;
      memory: MemoryWriteStatus;
    };

export interface MeasuredOutcome {
  window: DateRange;
  merchantGrowth: number | null;
  cohortGrowth: number | null;
  gapToCohort: number | null;
  measuredAt: string;
}
