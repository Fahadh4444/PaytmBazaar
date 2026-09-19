/**
 * The speech boundary: turning a merchant's voice into text (STT) and an
 * answer back into audio (TTS).
 *
 * Voice is only another way in and out of Ask Bazaar. The transcript goes
 * through the same pipeline as a typed question; speech never sees merchant
 * intelligence beyond the answer text it reads aloud.
 */

/** Indian languages Ask Bazaar recognises, as BCP-47 codes (Sarvam's codes). */
export const LANGUAGE_NAMES = {
  "en-IN": "English",
  "hi-IN": "Hindi",
  "bn-IN": "Bengali",
  "gu-IN": "Gujarati",
  "kn-IN": "Kannada",
  "ml-IN": "Malayalam",
  "mr-IN": "Marathi",
  "od-IN": "Odia",
  "pa-IN": "Punjabi",
  "ta-IN": "Tamil",
  "te-IN": "Telugu",
  "as-IN": "Assamese",
  "ur-IN": "Urdu",
  "ne-IN": "Nepali",
  "kok-IN": "Konkani",
  "ks-IN": "Kashmiri",
  "sd-IN": "Sindhi",
  "sa-IN": "Sanskrit",
  "sat-IN": "Santali",
  "mni-IN": "Manipuri",
  "brx-IN": "Bodo",
  "mai-IN": "Maithili",
  "doi-IN": "Dogri",
} as const;

export type LanguageCode = keyof typeof LANGUAGE_NAMES;

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && Object.hasOwn(LANGUAGE_NAMES, value);
}

/** Languages that can be spoken back (Sarvam Bulbul). */
export const SPOKEN_LANGUAGES: readonly LanguageCode[] = [
  "en-IN", "hi-IN", "bn-IN", "gu-IN", "kn-IN", "ml-IN", "mr-IN", "od-IN", "pa-IN", "ta-IN", "te-IN",
];

export function canSpeak(language: string): language is LanguageCode {
  return (SPOKEN_LANGUAGES as readonly string[]).includes(language);
}

export interface TranscriptionRequest {
  audio: Blob;
  filename: string;
}

export interface Transcript {
  text: string;
  /** Detected language, when the provider reports one it recognises. */
  language: LanguageCode | null;
  provider: string;
  model: string;
}

export interface SynthesisRequest {
  text: string;
  language: LanguageCode;
}

export interface SpeechAudio {
  /** Base64-encoded audio, ready for a `data:` URL. */
  base64: string;
  mimeType: string;
  language: LanguageCode;
  provider: string;
  model: string;
}

export interface SpeechProvider {
  readonly name: string;
  isConfigured(): boolean;
  transcribe(request: TranscriptionRequest): Promise<Transcript>;
  synthesize(request: SynthesisRequest): Promise<SpeechAudio>;
}

/** Any speech failure, so callers never unwrap provider-shaped errors. */
export class SpeechError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly stage: "stt" | "tts",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SpeechError";
  }
}
