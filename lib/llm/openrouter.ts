/**
 * OpenRouter provider.
 *
 * The only file in the repository that knows OpenRouter's request/response
 * shape. Uses the documented chat completions endpoint over plain fetch — no
 * SDK, nothing invented.
 */

import "server-only";

import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const REQUEST_TIMEOUT_MS = 30_000;

interface OpenRouterChoice {
  message?: { content?: string };
}

interface OpenRouterResponse {
  choices?: OpenRouterChoice[];
  error?: { message?: string };
}

export const openRouterProvider: LlmProvider = {
  name: "openrouter",

  isConfigured() {
    return Boolean(process.env.OPENROUTER_API_KEY);
  },

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new LlmError("OPENROUTER_API_KEY is not set.", "openrouter");
    }

    let response: Response;
    try {
      response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(process.env.NEXT_PUBLIC_APP_URL
            ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL }
            : {}),
          "X-Title": "Paytm Bazaar",
        },
        body: JSON.stringify({
          model: request.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (cause) {
      throw new LlmError("Could not reach OpenRouter.", "openrouter", { cause });
    }

    if (!response.ok) {
      throw new LlmError(
        `OpenRouter returned ${response.status} ${response.statusText}.`,
        "openrouter",
      );
    }

    const body = (await response.json()) as OpenRouterResponse;
    const text = body.choices?.[0]?.message?.content;

    if (!text) {
      throw new LlmError(
        body.error?.message ?? "OpenRouter returned no completion.",
        "openrouter",
      );
    }

    return { text, provider: "openrouter" };
  },
};
