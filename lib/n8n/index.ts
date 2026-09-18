/** Server-only n8n public API integration boundary. */

import "server-only";

const REQUEST_TIMEOUT_MS = 15_000;

export type N8nConnectionStatus = {
  service: "n8n";
  configured: boolean;
  reachable: boolean;
  status: number | null;
};

export class N8nError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "N8nError";
  }
}

export function isN8nConfigured(): boolean {
  return Boolean(process.env.N8N_BASE_URL && process.env.N8N_API_KEY);
}

export async function checkN8nConnection(): Promise<N8nConnectionStatus> {
  const baseUrl = process.env.N8N_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) {
    return { service: "n8n", configured: false, reachable: false, status: null };
  }

  let response: Response;
  try {
    const url = new URL("api/v1/workflows", `${baseUrl}/`);
    url.searchParams.set("limit", "1");
    response = await fetch(url, {
      headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new N8nError("Could not reach n8n.", { cause });
  }

  if (!response.ok) {
    throw new N8nError(`n8n returned ${response.status} ${response.statusText}.`);
  }

  return { service: "n8n", configured: true, reachable: true, status: response.status };
}
