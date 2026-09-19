/**
 * Sarvam provider: Sarvam 105B over Sarvam's OpenAI-compatible chat
 * completions endpoint (POST /v1/chat/completions,
 * https://docs.sarvam.ai/api-reference-docs/chat/chat-completions).
 *
 * The only file that knows Sarvam's chat wire format.
 */

import "server-only";

import { isSarvamConfigured, sarvamFetch } from "@/lib/sarvam/client";

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

export const DEFAULT_SARVAM_MODEL = "sarvam-105b";
const REQUEST_TIMEOUT_MS = 45_000;

export function sarvamModel(): string {
  return process.env.SARVAM_CHAT_MODEL || DEFAULT_SARVAM_MODEL;
}

interface SarvamChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { completion_tokens?: number };
}

/** Sarvam 105B is a reasoning model; drop any thinking that leaks into the content. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

export const sarvamProvider: LlmProvider = {
  name: "sarvam",

  isConfigured: isSarvamConfigured,

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = request.model ?? sarvamModel();
    let response: Response;
    try {
      response = await sarvamFetch("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          response_format: request.responseFormat ? { type: request.responseFormat } : undefined,
          // The facts are already computed, so thinking only costs time and tokens. Only `null`
          // turns it off: even "low" spends ~1k reasoning tokens and can exhaust max_tokens
          // before any answer is written (finish_reason "length", empty content).
          reasoning_effort: request.reasoning === false ? null : undefined,
        }),
        timeoutMs: request.timeoutMs ?? REQUEST_TIMEOUT_MS,
      });
    } catch (cause) {
      throw new LlmError(cause instanceof Error ? cause.message : "Could not reach Sarvam.", "sarvam", { cause });
    }

    let body: SarvamChatResponse;
    try {
      body = (await response.json()) as SarvamChatResponse;
    } catch (cause) {
      throw new LlmError("Sarvam returned an unreadable response.", "sarvam", { cause });
    }
    const text = stripThinking(body.choices?.[0]?.message?.content ?? "");
    if (!text) {
      const choice = body.choices?.[0];
      throw new LlmError(
        `Sarvam returned no completion (finish_reason: ${choice?.finish_reason ?? "none"}, completion tokens: ${body.usage?.completion_tokens ?? "?"}).`,
        "sarvam",
      );
    }
    return { text, provider: "sarvam", model };
  },
};
