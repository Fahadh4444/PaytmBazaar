import { badRequest, errorResponse, readJson } from "@/app/api/_lib/errors";
import { answerMerchantQuestion, validChatMessages } from "@/merchant-intelligence/chat";
import { getIntelligenceDeps } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/merchants/:merchantId/chat
 * Body: { "messages": [{ "role": "user" | "assistant", "content": string }] }
 *
 * Answers the merchant's questions from their own M2M and relevance facts.
 */
export async function POST(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  const body = await readJson(request);
  const messages = validChatMessages(body?.messages);
  if (!messages) return badRequest("The conversation is empty or contains an invalid message.");

  try {
    const result = await answerMerchantQuestion(getIntelligenceDeps(), { merchantId, messages });
    const status = result.status === "answered" ? 200 : result.status === "unavailable" ? 503 : 502;
    return Response.json(result, { status });
  } catch (error) {
    return errorResponse(error);
  }
}
