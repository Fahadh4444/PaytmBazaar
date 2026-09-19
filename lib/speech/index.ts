/** Server-only speech boundary. Product code depends on this file, never on `sarvam.ts`. */

import "server-only";

import { sarvamSpeechProvider } from "./sarvam";
import type { SpeechProvider } from "./types";

export * from "./types";
export { MAX_SPEECH_CHARS, speakableText } from "./sarvam";

export function getSpeechProvider(): SpeechProvider {
  return sarvamSpeechProvider;
}
