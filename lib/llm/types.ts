/**
 * The LLM boundary.
 *
 * Product code depends on this file, never on a provider. OpenRouter is the
 * current provider; Sarvam may become one later. Adding or switching a provider
 * must not require touching the M2M engine, the API routes, or the UI.
 *
 * The LLM explains intelligence. It is never the source of a number — see
 * docs/m2m-engine.md.
 */

export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Provider-agnostic hint; each provider maps it to a concrete model. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  /** Which provider actually answered. Useful once fallback exists. */
  provider: string;
}

export interface LlmProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** Thrown for any LLM failure, so callers never unwrap provider-shaped errors. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}
