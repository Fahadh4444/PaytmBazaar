/**
 * Provider selection for the LLM boundary.
 *
 * `LLM_PROVIDER` names the primary provider (default `sarvam`: Sarvam 105B).
 * `LLM_FALLBACK_PROVIDER` names the one used when the primary is not
 * configured or fails (default `openrouter` when the primary is Sarvam; set it
 * to `none` to disable). Callers see one LlmProvider and never know which
 * answered, except through `LlmResponse.provider`.
 */

import "server-only";

import { openRouterModel, openRouterProvider } from "./openrouter";
import { sarvamModel, sarvamProvider } from "./sarvam";
import { LlmError, type LlmProvider } from "./types";

export * from "./types";

const providers: Record<string, LlmProvider> = {
  sarvam: sarvamProvider,
  openrouter: openRouterProvider,
};

const models: Record<string, () => string> = {
  sarvam: sarvamModel,
  openrouter: openRouterModel,
};

const DEFAULT_PROVIDER = "sarvam";
const DEFAULT_FALLBACK: Record<string, string> = { sarvam: "openrouter" };

function lookup(name: string): LlmProvider {
  const provider = providers[name];
  if (!provider) {
    throw new LlmError(`Unknown LLM provider "${name}". Available: ${Object.keys(providers).join(", ")}.`, name);
  }
  return provider;
}

function chainNames(): [string, string | null] {
  const primary = process.env.LLM_PROVIDER || DEFAULT_PROVIDER;
  const configured = process.env.LLM_FALLBACK_PROVIDER;
  const fallback = configured === "none" ? null : configured || DEFAULT_FALLBACK[primary] || null;
  return [primary, fallback && fallback !== primary ? fallback : null];
}

/**
 * Tries `primary`, then `fallback` when the primary is unconfigured or throws.
 * Never invents a reply: if both fail, the primary's error is thrown.
 */
export function withFallback(primary: LlmProvider, fallback: LlmProvider | null): LlmProvider {
  if (!fallback) return primary;
  return {
    get name() {
      return primary.isConfigured() || !fallback.isConfigured() ? primary.name : fallback.name;
    },
    isConfigured: () => primary.isConfigured() || fallback.isConfigured(),
    async complete(request) {
      if (!primary.isConfigured()) return fallback.complete(request);
      try {
        return await primary.complete(request);
      } catch (error) {
        if (!fallback.isConfigured()) throw error;
        // Visible in server logs, so a silent fallback never hides a broken primary.
        console.warn(`[llm] ${primary.name} failed, falling back to ${fallback.name}:`, error instanceof Error ? error.message : error);
        return fallback.complete(request);
      }
    },
  };
}

export function getLlmProvider(): LlmProvider {
  const [primary, fallback] = chainNames();
  return withFallback(lookup(primary), fallback ? lookup(fallback) : null);
}

/** True when an LLM-dependent feature can actually run right now. */
export function isLlmConfigured(): boolean {
  return getLlmProvider().isConfigured();
}

/** Safe configuration metadata for diagnostics; never exposes provider secrets. */
export function getLlmStatus() {
  const [primaryName, fallbackName] = chainNames();
  const primary = lookup(primaryName);
  // The provider that will be tried first.
  const active = primary.isConfigured() || !fallbackName ? primaryName : fallbackName;
  return {
    provider: active,
    configured: lookup(active).isConfigured(),
    model: models[active]?.() ?? "unknown",
    primary: primaryName,
    fallback: fallbackName,
  };
}
