import { answer, conversationFrom, conversationIdFrom, validMerchantId } from "@/app/api/_lib/ask";
import { badRequest, errorResponse } from "@/app/api/_lib/errors";
import { canSpeak, getSpeechProvider, SpeechError, type SpeechAudio } from "@/lib/speech";
import { MAX_MESSAGE_LENGTH } from "@/merchant-intelligence/chat";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** About 30 seconds of compressed speech, with room to spare. */
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const VOICE_FAILED = "Voice input couldn't be processed. You can type your question instead.";

const failure = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

/**
 * POST /api/merchants/:merchantId/chat/voice     (Ask Bazaar, spoken)
 * multipart/form-data: audio (file), history? (JSON array of turns), conversationId?, speak? ("false" to skip audio)
 *
 * Sarvam STT → the same Ask Bazaar pipeline as typed questions → Sarvam TTS.
 * Returns the transcript, the answer (as /chat does) and the spoken answer as
 * base64 audio. If speaking fails, the text answer is still returned.
 */
export async function POST(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = await params;
  if (!validMerchantId(merchantId)) return badRequest("Unknown merchant.");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("Send the recording as multipart/form-data.");
  }
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return badRequest("No recording was received.");
  if (audio.size > MAX_AUDIO_BYTES) return badRequest("That recording is too long. Please keep it under 30 seconds.");

  let history: unknown = [];
  try {
    history = JSON.parse(String(form.get("history") ?? "[]"));
  } catch {
    return badRequest("The conversation history is not valid.");
  }

  const speech = getSpeechProvider();
  if (!speech.isConfigured()) return failure(503, "voice_unavailable", "Voice isn't available right now. You can type your question instead.");

  let transcript;
  try {
    const filename = audio instanceof File && audio.name ? audio.name : "question.webm";
    transcript = await speech.transcribe({ audio, filename });
  } catch (error) {
    if (error instanceof SpeechError) {
      console.error("[ask-bazaar] speech-to-text failed:", error.cause instanceof Error ? error.cause.message : error.message);
      return failure(502, "voice_failed", VOICE_FAILED);
    }
    return errorResponse(error);
  }

  const messages = conversationFrom({ message: transcript.text.slice(0, MAX_MESSAGE_LENGTH), history });
  if (!messages) return badRequest("The conversation history is not valid.");

  try {
    const result = await answer(request, merchantId, messages, conversationIdFrom(form.get("conversationId")), "voice");

    let spoken: SpeechAudio | null = null;
    let audioError: string | null = null;
    if (form.get("speak") !== "false") {
      if (!canSpeak(result.language)) {
        audioError = "A spoken answer isn't available in this language yet.";
      } else {
        try {
          spoken = await speech.synthesize({ text: result.answer, language: result.language });
        } catch (error) {
          console.error("[ask-bazaar] text-to-speech failed:", error instanceof SpeechError && error.cause instanceof Error ? error.cause.message : String(error));
          audioError = "The spoken answer isn't available right now; the text answer is here.";
        }
      }
    }

    return Response.json({
      ...result,
      transcript: transcript.text,
      transcriptLanguage: transcript.language,
      speech: { stt: transcript.model, tts: spoken?.model ?? null },
      audio: spoken ? { base64: spoken.base64, mimeType: spoken.mimeType } : null,
      audioError,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
