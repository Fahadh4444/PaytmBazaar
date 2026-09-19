/**
 * The action boundary: executing an approved merchant action somewhere real.
 *
 * Executors only run actions that have already been approved; approval is
 * enforced by the caller (merchant-intelligence/actions.ts) before an
 * executor is ever reached.
 */

/** The one action type Bazaar can execute today. */
export type MerchantActionType = "SCHEDULE_PROMOTION";

export interface PromotionParameters {
  /** Time of day the promotion targets, or `all_day`. */
  targetSegment: "morning" | "afternoon" | "evening" | "night" | "all_day";
  durationDays: number;
  channel: "email";
}

/** What an executor receives: structured, validated fields only, never raw model output. */
export interface ActionExecutionRequest {
  actionId: string;
  merchantId: string;
  type: MerchantActionType;
  parameters: PromotionParameters;
  /** Short human-readable description, length-capped. */
  description: string;
}

export interface ActionExecutionResult {
  status: "executed" | "failed";
  /** Reference returned by the executor, e.g. an n8n execution ID. */
  reference: string | null;
  detail: string | null;
  /** ISO 8601. */
  finishedAt: string;
}

export interface ActionExecutor {
  readonly name: string;
  isConfigured(): boolean;
  execute(request: ActionExecutionRequest): Promise<ActionExecutionResult>;
}
