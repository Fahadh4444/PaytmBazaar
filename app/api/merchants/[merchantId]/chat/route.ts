import { answer, conversationFrom, conversationIdFrom, validMerchantId } from "@/app/api/_lib/ask";
import { badRequest, errorResponse, readJson } from "@/app/api/_lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/merchants/:merchantId/chat          (Ask Bazaar, typed)
 * Body: { "message": string, "history"?: [{ "role", "content" }], "conversationId"?: string }
 *   (older clients: { "messages": [...] })
 *
 * Answers from the merchant's cached M2M + Relevance intelligence, in the
 * merchant's language. Returns the answer, its language and intent, the facts
 * it cites, and the approvable action when one applies. Never runs an action.
 */
export async function POST(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  if (!validMerchantId(merchantId)) return badRequest("Unknown merchant.");
  const body = await readJson(request);
  const messages = body ? conversationFrom(body) : null;
  if (!messages) return badRequest("The conversation is empty or contains an invalid message.");

  try {
    return Response.json(await answer(request, merchantId, messages, conversationIdFrom(body?.conversationId), "text"));
  } catch (error) {
    return errorResponse(error);
  }
}
