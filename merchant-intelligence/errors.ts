/** Errors the Merchant Intelligence service raises for the API layer to map. */

export type IntelligenceErrorCode =
  | "approval_required"
  | "invalid_action_state"
  | "action_store_unavailable"
  | "no_merchant_data";

export class IntelligenceError extends Error {
  constructor(
    message: string,
    readonly code: IntelligenceErrorCode,
  ) {
    super(message);
    this.name = "IntelligenceError";
  }
}

export const approvalRequired = () =>
  new IntelligenceError("The merchant must explicitly approve the action before it runs.", "approval_required");

export const invalidActionState = (status: string) =>
  new IntelligenceError(`The action cannot be run from status "${status}".`, "invalid_action_state");

export const actionStoreUnavailable = () =>
  new IntelligenceError("Actions cannot be saved right now.", "action_store_unavailable");

export const noMerchantData = () =>
  new IntelligenceError("There is no transaction history for this merchant yet.", "no_merchant_data");
