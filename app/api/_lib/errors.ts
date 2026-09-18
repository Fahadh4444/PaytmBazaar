/**
 * Maps service errors to HTTP responses. Messages are the services' own
 * user-safe messages; causes, stack traces and provider details never leave.
 */

import { ZodError } from "zod";

import { ActionStoreMissingError, PaytmDataError } from "@/lib/paytm";
import { IntelligenceError } from "@/merchant-intelligence";
import { M2MInputError } from "@/m2m-engine";

const INTELLIGENCE_STATUS: Record<IntelligenceError["code"], number> = {
  approval_required: 400,
  invalid_action_state: 409,
  action_store_unavailable: 503,
  no_merchant_data: 404,
};

const DATA_STATUS: Record<PaytmDataError["code"], number> = {
  not_found: 404,
  invalid_query: 400,
  result_too_large: 422,
  unavailable: 503,
};

export function errorResponse(error: unknown): Response {
  if (error instanceof IntelligenceError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: INTELLIGENCE_STATUS[error.code] });
  }
  if (error instanceof ActionStoreMissingError) {
    return Response.json({ error: { code: "action_store_missing", message: error.message } }, { status: 503 });
  }
  if (error instanceof PaytmDataError) {
    const message = error.code === "unavailable" ? "Merchant data is unavailable right now." : error.message;
    return Response.json({ error: { code: error.code, message } }, { status: DATA_STATUS[error.code] });
  }
  if (error instanceof M2MInputError) {
    return Response.json({ error: { code: "invalid_query", message: error.message } }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: { code: "invalid_action", message: "The stored action is not valid." } }, { status: 500 });
  }
  return Response.json({ error: { code: "internal", message: "Something went wrong." } }, { status: 500 });
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const badRequest = (message: string) =>
  Response.json({ error: { code: "invalid_request", message } }, { status: 400 });
