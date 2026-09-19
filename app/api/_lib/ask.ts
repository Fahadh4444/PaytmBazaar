/**
 * Shared request handling for Ask Bazaar (typed and voice).
 *
 * Merchant scope: the merchant comes only from the route path, is validated
 * here, and must exist in the Data Adapter before anything else runs. Nothing
 * in a request body can widen that scope; all intelligence, memory and
 * actions are then read for that one merchant. (The prototype has no merchant
 * login yet; when it does, the signed-in merchant replaces the path check.)
 */

import { randomUUID } from "node:crypto";

import type { LlmMessage } from "@/lib/llm";
import { askBazaar, validChatMessages, type AskResult } from "@/merchant-intelligence/chat";
import { contextFromUrl } from "@/merchant-intelligence/context-request";
import { getCachedBasics, getCachedHistory, getIntelligenceDeps } from "@/merchant-intelligence/server";

const MERCHANT_ID = /^[A-Za-z0-9_-]{1,40}$/;
const CONVERSATION_ID = /^[A-Za-z0-9-]{8,64}$/;

export function validMerchantId(merchantId: string): boolean {
  return MERCHANT_ID.test(merchantId);
}

/** The client's conversation ID when well-formed, otherwise a new one. */
export function conversationIdFrom(value: unknown): string {
  return typeof value === "string" && CONVERSATION_ID.test(value) ? value : randomUUID();
}

/**
 * The bounded conversation: `history` (earlier turns) plus the new `message`.
 * Older clients may send the whole `messages` array instead.
 */
export function conversationFrom(body: { message?: unknown; history?: unknown; messages?: unknown }): LlmMessage[] | null {
  if (typeof body.message === "string") {
    const history = Array.isArray(body.history) ? body.history : [];
    return validChatMessages([...history, { role: "user", content: body.message.trim() }]);
  }
  return validChatMessages(body.messages);
}

/** Runs one Ask Bazaar turn on the merchant's cached intelligence and memory. */
export async function answer(
  request: Request,
  merchantId: string,
  messages: LlmMessage[],
  conversationId: string,
  input: "text" | "voice",
): Promise<AskResult & { conversationId: string }> {
  const deps = getIntelligenceDeps();
  const context = contextFromUrl(new URL(request.url));
  // Computed once per merchant and period, then reused by every follow-up.
  const basics = await getCachedBasics(deps, merchantId, context);
  const history = await getCachedHistory(deps, basics);
  const result = await askBazaar(deps, { merchantId, messages, context, basics, history, input, conversationId });
  return { ...result, conversationId };
}
