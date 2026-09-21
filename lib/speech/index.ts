/** Server-only speech boundary. Product code depends on this file, never on `sarvam.ts`. */

import "server-only";

import { isDeterministic } from "@/lib/mode";

import { sarvamSpeechProvider } from "./sarvam";
import { SpeechError, type SpeechProvider } from "./types";

export * from "./types";
export { MAX_SPEECH_CHARS, speakableText } from "./sarvam";

/** Deterministic mode: no speech-to-text and no spoken answers. */
export const offSpeechProvider: SpeechProvider = {
  name: "off",
  isConfigured: () => false,
  async transcribe() {
    throw new SpeechError("Voice is off in deterministic mode (set BAZAAR_MODE=full to use it).", "off", "stt");
  },
  async synthesize() {
    throw new SpeechError("Voice is off in deterministic mode (set BAZAAR_MODE=full to use it).", "off", "tts");
  },
};

export function getSpeechProvider(): SpeechProvider {
  return isDeterministic() ? offSpeechProvider : sarvamSpeechProvider;
}
