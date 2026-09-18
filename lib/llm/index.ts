/**
 * Provider selection for the LLM boundary.
 *
 * Only OpenRouter is implemented. Sarvam is deliberately absent: we have no
 * confirmed access or documentation, and guessing at its API would be worse
 * than not having it. When access exists, add `lib/llm/sarvam.ts` implementing
 * LlmProvider and register it in the map below — nothing else should change.
 */

import "server-only";

import { openRouterModel, openRouterProvider } from "./openrouter";
import { LlmError, type LlmProvider } from "./types";

export * from "./types";

const providers: Record<string, LlmProvider> = {
  openrouter: openRouterProvider,
};

const DEFAULT_PROVIDER = "openrouter";

export function getLlmProvider(): LlmProvider {
  const name = process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
  const provider = providers[name];

  if (!provider) {
    throw new LlmError(
      `Unknown LLM provider "${name}". Available: ${Object.keys(providers).join(", ")}.`,
      name,
    );
  }

  return provider;
}

/** True when an LLM-dependent feature can actually run right now. */
export function isLlmConfigured(): boolean {
  const name = process.env.LLM_PROVIDER ?? DEFAULT_PROVIDER;
  return providers[name]?.isConfigured() ?? false;
}

/** Safe configuration metadata for diagnostics; never exposes provider secrets. */
export function getLlmStatus() {
  const provider = getLlmProvider();
  return {
    provider: provider.name,
    configured: provider.isConfigured(),
    model: provider.name === "openrouter" ? openRouterModel() : "unknown",
  };
}
