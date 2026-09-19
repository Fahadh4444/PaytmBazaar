/**
 * The one place that knows how to reach Sarvam AI (https://docs.sarvam.ai):
 * base URL, authentication and timeouts. Chat (lib/llm/sarvam.ts) and speech
 * (lib/speech/sarvam.ts) both go through here, so keys are read in exactly
 * one file and never leave the server.
 *
 * Two keys are supported: SARVAM_API_KEY (primary) and SARVAM_API_KEY_BACKUP.
 * When the primary account is out of credits, rate-limited or rejected, the
 * same request is retried with the backup, and the primary is skipped for a
 * while so later calls don't pay for a failed attempt first.
 */

import "server-only";

export const DEFAULT_SARVAM_BASE_URL = "https://api.sarvam.ai";

/** How long a primary key that ran out of credits is skipped before it is tried again. */
export const KEY_COOLDOWN_MS = 15 * 60_000;

export function isSarvamConfigured(): boolean {
  return sarvamKeys().length > 0;
}

export class SarvamRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SarvamRequestError";
  }
}

interface SarvamKey {
  label: "primary" | "backup";
  value: string;
}

function sarvamKeys(): SarvamKey[] {
  const keys: SarvamKey[] = [];
  if (process.env.SARVAM_API_KEY) keys.push({ label: "primary", value: process.env.SARVAM_API_KEY });
  const backup = process.env.SARVAM_API_KEY_BACKUP;
  if (backup && backup !== process.env.SARVAM_API_KEY) keys.push({ label: "backup", value: backup });
  return keys;
}

// When each key may be tried again. Survives dev-server module reloads.
const cooling: Map<string, number> = ((globalThis as { __sarvamKeyCooldown?: Map<string, number> }).__sarvamKeyCooldown ??= new Map());

/** Resets key cooldowns (tests). */
export function resetSarvamKeyCooldown(): void {
  cooling.clear();
}

const ACCOUNT_STATUSES = new Set([401, 402, 403, 429]);
const ACCOUNT_WORDS = /credit|quota|balance|insufficient|exhaust|limit|subscription|billing|payment/i;

/**
 * A failure that belongs to the account (no credits, rate limit, revoked
 * key), where another account can succeed. A bad request or a Sarvam outage
 * would fail the same way with any key, so those are not retried.
 */
export function isAccountFailure(status: number, reason: string | undefined): boolean {
  return ACCOUNT_STATUSES.has(status) || (status < 500 && status !== 400 && status !== 422 && ACCOUNT_WORDS.test(reason ?? ""));
}

async function reasonOf(response: Response): Promise<string | undefined> {
  return response
    .json()
    .then((body: { error?: { message?: string } | string; message?: string }) =>
      typeof body?.error === "string" ? body.error : body?.error?.message ?? body?.message,
    )
    .catch(() => undefined);
}

/**
 * Calls a Sarvam endpoint, using the backup key when the primary account
 * cannot pay for it. Throws SarvamRequestError for no configured key, a
 * network failure or a non-2xx reply.
 */
export async function sarvamFetch(path: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const all = sarvamKeys();
  if (all.length === 0) throw new SarvamRequestError("SARVAM_API_KEY is not set.", null);
  const now = Date.now();
  // Keys still cooling down go last, not away: if everything else fails they are still tried.
  const keys = [...all.filter((k) => (cooling.get(k.value) ?? 0) <= now), ...all.filter((k) => (cooling.get(k.value) ?? 0) > now)];
  const baseUrl = (process.env.SARVAM_BASE_URL || DEFAULT_SARVAM_BASE_URL).replace(/\/+$/, "");
  const { timeoutMs, headers, ...rest } = init;

  let lastError: SarvamRequestError | null = null;
  for (const [index, key] of keys.entries()) {
    const hasNext = index < keys.length - 1;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...rest,
        // Sarvam documents `api-subscription-key`; its chat endpoint also takes a bearer token.
        headers: { "api-subscription-key": key.value, Authorization: `Bearer ${key.value}`, ...(headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      // Network failure or timeout: the same for every key.
      throw new SarvamRequestError("Could not reach Sarvam.", null, { cause });
    }
    if (response.ok) {
      cooling.delete(key.value);
      return response;
    }

    // Sarvam's own reason, for server logs only; callers show merchants their own message.
    const reason = await reasonOf(response);
    lastError = new SarvamRequestError(
      `Sarvam returned ${response.status} ${response.statusText}${reason ? `: ${reason.slice(0, 300)}` : ""}.`,
      response.status,
    );
    if (!isAccountFailure(response.status, reason)) throw lastError;
    cooling.set(key.value, Date.now() + KEY_COOLDOWN_MS);
    if (hasNext) console.warn(`[sarvam] ${key.label} key unavailable (${response.status}${reason ? `: ${reason.slice(0, 120)}` : ""}); trying ${keys[index + 1].label} key.`);
  }
  throw lastError!;
}
