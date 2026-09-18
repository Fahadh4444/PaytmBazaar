/**
 * Merchant action store: persists recommended actions, approvals, execution
 * results and outcomes in the `merchant_actions` table
 * (supabase/flyway/sql/V5__create_merchant_actions.sql).
 *
 * Part of the Data Adapter layer because it is the only other code that
 * touches Supabase. It is separate from `PaytmSupabaseAdapter`: that adapter
 * reads Paytm-like business data; this store records Bazaar's own actions.
 */

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { DataSourceError, PaytmDataError } from "./errors";
import { requireId } from "./validation";

/** No action with the given ID. */
export class ActionNotFoundError extends PaytmDataError {
  constructor(readonly actionId: string) {
    super(`Action not found: ${actionId}.`, "not_found");
    this.name = "ActionNotFoundError";
  }
}

/** The `merchant_actions` table has not been created yet (V5 not applied). */
export class ActionStoreMissingError extends DataSourceError {
  constructor(options?: { cause?: unknown }) {
    super("Action storage is not set up: apply supabase/flyway/sql/V5__create_merchant_actions.sql.", options);
    this.name = "ActionStoreMissingError";
  }
}

export type MerchantActionStatus = "proposed" | "approved" | "executed" | "failed";

export interface MerchantActionRecord {
  id: string;
  merchantId: string;
  type: "SCHEDULE_PROMOTION";
  parameters: Record<string, unknown>;
  description: string;
  basis: Record<string, unknown>;
  status: MerchantActionStatus;
  approvedAt: string | null;
  executedAt: string | null;
  executionReference: string | null;
  executionDetail: string | null;
  outcome: Record<string, unknown> | null;
  createdAt: string;
}

export type NewMerchantAction = Pick<MerchantActionRecord, "merchantId" | "type" | "parameters" | "description" | "basis">;

export type MerchantActionPatch = Partial<
  Pick<
    MerchantActionRecord,
    "status" | "approvedAt" | "executedAt" | "executionReference" | "executionDetail" | "outcome"
  >
>;

export interface MerchantActionStore {
  create(action: NewMerchantAction): Promise<MerchantActionRecord>;
  get(actionId: string): Promise<MerchantActionRecord>;
  /** Most recent actions for a merchant, newest first. */
  listForMerchant(merchantId: string, limit?: number): Promise<MerchantActionRecord[]>;
  update(actionId: string, patch: MerchantActionPatch): Promise<MerchantActionRecord>;
}

const TABLE = "merchant_actions";

interface ActionRow {
  id: string;
  mid: string;
  action_type: "SCHEDULE_PROMOTION";
  parameters: Record<string, unknown>;
  description: string;
  basis: Record<string, unknown>;
  status: MerchantActionStatus;
  approved_at: string | null;
  executed_at: string | null;
  execution_reference: string | null;
  execution_detail: string | null;
  outcome: Record<string, unknown> | null;
  created_at: string;
}

function toRecord(row: ActionRow): MerchantActionRecord {
  return {
    id: row.id,
    merchantId: row.mid,
    type: row.action_type,
    parameters: row.parameters,
    description: row.description,
    basis: row.basis,
    status: row.status,
    approvedAt: row.approved_at,
    executedAt: row.executed_at,
    executionReference: row.execution_reference,
    executionDetail: row.execution_detail,
    outcome: row.outcome,
    createdAt: row.created_at,
  };
}

function toPatchRow(patch: MerchantActionPatch): Record<string, unknown> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.approvedAt !== undefined) row.approved_at = patch.approvedAt;
  if (patch.executedAt !== undefined) row.executed_at = patch.executedAt;
  if (patch.executionReference !== undefined) row.execution_reference = patch.executionReference;
  if (patch.executionDetail !== undefined) row.execution_detail = patch.executionDetail;
  if (patch.outcome !== undefined) row.outcome = patch.outcome;
  return row;
}

function fail(error: PostgrestError | null, what: string): never {
  if (error?.code === "PGRST205" || error?.code === "42P01") throw new ActionStoreMissingError({ cause: error });
  throw new DataSourceError(`Could not ${what} a merchant action.`, { cause: error });
}

export class SupabaseMerchantActionStore implements MerchantActionStore {
  constructor(private readonly client: SupabaseClient) {}

  async create(action: NewMerchantAction): Promise<MerchantActionRecord> {
    requireId(action.merchantId, "mid");
    const { data, error } = await this.client
      .from(TABLE)
      .insert({
        mid: action.merchantId,
        action_type: action.type,
        parameters: action.parameters,
        description: action.description,
        basis: action.basis,
        status: "proposed",
      })
      .select("*")
      .single();
    if (error || !data) fail(error, "save");
    return toRecord(data as ActionRow);
  }

  async get(actionId: string): Promise<MerchantActionRecord> {
    requireId(actionId, "actionId");
    const { data, error } = await this.client.from(TABLE).select("*").eq("id", actionId).maybeSingle();
    if (error) fail(error, "read");
    if (!data) throw new ActionNotFoundError(actionId);
    return toRecord(data as ActionRow);
  }

  async listForMerchant(merchantId: string, limit = 10): Promise<MerchantActionRecord[]> {
    requireId(merchantId, "mid");
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("mid", merchantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) fail(error, "read");
    return ((data ?? []) as ActionRow[]).map(toRecord);
  }

  async update(actionId: string, patch: MerchantActionPatch): Promise<MerchantActionRecord> {
    requireId(actionId, "actionId");
    const { data, error } = await this.client
      .from(TABLE)
      .update(toPatchRow(patch))
      .eq("id", actionId)
      .select("*")
      .single();
    if (error || !data) fail(error, "update");
    return toRecord(data as ActionRow);
  }
}
