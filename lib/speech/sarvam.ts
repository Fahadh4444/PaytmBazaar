/**
 * Sarvam speech provider. The only file that knows Sarvam's speech formats:
 *
 *   STT  POST /speech-to-text   multipart: file, model (Saaras), language_code=unknown (auto-detect)
 *   TTS  POST /text-to-speech   JSON: text, language_code, model (Bulbul), speaker, output_audio_codec
 *
 * https://docs.sarvam.ai/api-reference-docs/speech-to-text/transcribe
 * https://docs.sarvam.ai/api-reference-docs/text-to-speech/convert
 */

import "server-only";

import { isSarvamConfigured, sarvamFetch } from "@/lib/sarvam/client";

import { canSpeak, isLanguageCode, SpeechError, type SpeechProvider } from "./types";

const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 30_000;
/** Bulbul v3 accepts up to 2500 characters per request. */
export const MAX_SPEECH_CHARS = 2500;

const sttModel = () => process.env.SARVAM_STT_MODEL || "saaras:v3";
const ttsModel = () => process.env.SARVAM_TTS_MODEL || "bulbul:v3";
const ttsSpeaker = () => process.env.SARVAM_TTS_SPEAKER || "shubh";

/**
 * Browsers label recordings with codec parameters ("audio/webm;codecs=opus"),
 * but Sarvam accepts only the bare media type ("audio/webm").
 */
export function sttUpload(audio: Blob): Blob {
  const type = audio.type.split(";")[0].trim().toLowerCase();
  return type === audio.type ? audio : new Blob([audio], { type: type || "application/octet-stream" });
}

/** Markdown the chat uses (bold, bullets) is read aloud as plain sentences. */
export function speakableText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/[*_`#]/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPEECH_CHARS);
}

export const sarvamSpeechProvider: SpeechProvider = {
  name: "sarvam",

  isConfigured: isSarvamConfigured,

  async transcribe({ audio, filename }) {
    const model = sttModel();
    const form = new FormData();
    form.append("file", sttUpload(audio), filename);
    form.append("model", model);
    // Let Saaras detect which Indian language the merchant spoke.
    form.append("language_code", "unknown");
    if (model.startsWith("saaras:v3")) form.append("mode", "transcribe");

    let body: { transcript?: string; language_code?: string | null };
    try {
      const response = await sarvamFetch("/speech-to-text", { method: "POST", body: form, timeoutMs: STT_TIMEOUT_MS });
      body = await response.json();
    } catch (cause) {
      throw new SpeechError("Voice input could not be transcribed.", "sarvam", "stt", { cause });
    }
    const text = body.transcript?.trim() ?? "";
    if (!text) throw new SpeechError("No speech was recognised.", "sarvam", "stt");
    return { text, language: isLanguageCode(body.language_code) ? body.language_code : null, provider: "sarvam", model };
  },

  async synthesize({ text, language }) {
    if (!canSpeak(language)) throw new SpeechError(`Spoken answers are not available in ${language}.`, "sarvam", "tts");
    const spoken = speakableText(text);
    if (!spoken) throw new SpeechError("Nothing to speak.", "sarvam", "tts");
    const model = ttsModel();

    let body: { audios?: string[] };
    try {
      const response = await sarvamFetch("/text-to-speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: spoken,
          language_code: language,
          model,
          speaker: ttsSpeaker(),
          output_audio_codec: "mp3",
        }),
        timeoutMs: TTS_TIMEOUT_MS,
      });
      body = await response.json();
    } catch (cause) {
      throw new SpeechError("The answer could not be spoken.", "sarvam", "tts", { cause });
    }
    const base64 = body.audios?.[0];
    if (!base64) throw new SpeechError("Sarvam returned no audio.", "sarvam", "tts");
    return { base64, mimeType: "audio/mpeg", language, provider: "sarvam", model };
  },
};
