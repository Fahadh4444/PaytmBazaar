import { validMerchantId } from "@/app/api/_lib/ask";
import { badRequest, errorResponse, readJson } from "@/app/api/_lib/errors";
import { canSpeak, getSpeechProvider, MAX_SPEECH_CHARS, SpeechError } from "@/lib/speech";
import { getIntelligenceDeps } from "@/merchant-intelligence/server";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/**
 * POST /api/merchants/:merchantId/chat/speech    ("Listen" on an Ask Bazaar answer)
 * Body: { "text": string, "language": "hi-IN" | ... }
 *
 * Reads an answer aloud with Sarvam TTS. Returns { audio: { base64, mimeType } }.
 */
export async function POST(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  if (!validMerchantId(merchantId)) return badRequest("Unknown merchant.");
  const body = await readJson(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > MAX_SPEECH_CHARS) return badRequest("Nothing to read aloud.");
  if (typeof body?.language !== "string" || !canSpeak(body.language)) {
    return failure(422, "language_unsupported", "Listening isn't available in this language yet.");
  }

  const speech = getSpeechProvider();
  if (!speech.isConfigured()) return failure(503, "voice_unavailable", "Listening isn't available right now.");

  try {
    // Only an existing merchant's dialog can use this.
    await getIntelligenceDeps().dataSource.getMerchant(merchantId);
  } catch (error) {
    return errorResponse(error);
  }

  try {
    const audio = await speech.synthesize({ text, language: body.language });
    return Response.json({ audio: { base64: audio.base64, mimeType: audio.mimeType }, model: audio.model });
  } catch (error) {
    console.error("[ask-bazaar] text-to-speech failed:", error instanceof SpeechError && error.cause instanceof Error ? error.cause.message : String(error));
    return failure(502, "speech_failed", "Listening isn't available right now; the text answer is still here.");
  }
}
