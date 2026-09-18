/**
 * n8n executor over a Webhook-triggered workflow
 * (see n8n/workflows/bazaar-merchant-action.json).
 *
 * Contract: POST the structured action to the workflow's webhook URL. The workflow
 * replies `{ "status": "executed", "reference": "<execution id>" }` once the
 * action has actually run. Anything else — network failure, a non-2xx status,
 * or a reply without `status: "executed"` — is recorded as a failure. Success
 * is never assumed.
 *
 * If `N8N_WEBHOOK_SECRET` is set it is sent as `X-Bazaar-Secret`, for the
 * workflow's Header Auth credential to check.
 */

import type { ActionExecutionRequest, ActionExecutionResult, ActionExecutor } from "./types";

const TIMEOUT_MS = 20_000;
const WEBHOOK_PATH = "webhook/bazaar-merchant-action";

/**
 * `N8N_WEBHOOK_URL` if set, otherwise the production URL of the Bazaar
 * workflow on `N8N_BASE_URL`. Null when neither is configured.
 */
export function n8nWebhookUrl(): string | null {
  if (process.env.N8N_WEBHOOK_URL) return process.env.N8N_WEBHOOK_URL;
  const base = process.env.N8N_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}/${WEBHOOK_PATH}` : null;
}

function failed(detail: string): ActionExecutionResult {
  return { status: "failed", reference: null, detail, finishedAt: new Date().toISOString() };
}

export const n8nWebhookExecutor: ActionExecutor = {
  name: "n8n",

  isConfigured() {
    return n8nWebhookUrl() !== null;
  },

  async execute(request: ActionExecutionRequest): Promise<ActionExecutionResult> {
    const url = n8nWebhookUrl();
    if (!url) return failed("n8n is not configured.");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.N8N_WEBHOOK_SECRET) headers["X-Bazaar-Secret"] = process.env.N8N_WEBHOOK_SECRET;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return failed("Could not reach n8n.");
    }
    if (!response.ok) return failed(`n8n returned ${response.status}.`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failed("n8n replied without JSON.");
    }
    const reply = body as { status?: unknown; reference?: unknown; detail?: unknown };
    if (reply?.status !== "executed") return failed("n8n did not confirm execution.");

    return {
      status: "executed",
      reference: typeof reply.reference === "string" || typeof reply.reference === "number" ? String(reply.reference) : null,
      detail: typeof reply.detail === "string" ? reply.detail.slice(0, 500) : null,
      finishedAt: new Date().toISOString(),
    };
  },
};
