/** Server-only Cognee Cloud integration boundary. */

import "server-only";

import { cogneeProvider } from "./cognee";
import type { MemoryProvider } from "./types";

const DEFAULT_BASE_URL = "https://api.cognee.ai";
const REQUEST_TIMEOUT_MS = 15_000;

export type CogneeConnectionStatus = {
  service: "cognee";
  configured: boolean;
  reachable: boolean;
  status: number | null;
};

export class CogneeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CogneeError";
  }
}

export function isCogneeConfigured(): boolean {
  return Boolean(process.env.COGNEE_API_KEY && process.env.COGNEE_TENANT_ID);
}

export async function checkCogneeConnection(): Promise<CogneeConnectionStatus> {
  const apiKey = process.env.COGNEE_API_KEY;
  const tenantId = process.env.COGNEE_TENANT_ID;
  if (!apiKey || !tenantId) {
    return { service: "cognee", configured: false, reachable: false, status: null };
  }

  const baseUrl = (process.env.COGNEE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/health`, {
      headers: {
        "X-Api-Key": apiKey,
        "X-Tenant-Id": tenantId,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new CogneeError("Could not reach Cognee.", { cause });
  }

  if (!response.ok) {
    throw new CogneeError(`Cognee returned ${response.status} ${response.statusText}.`);
  }

  return { service: "cognee", configured: true, reachable: true, status: response.status };
}

// --- Merchant memory ----------------------------------------------------------
//
// Structured memories of past situations, recommendations, actions and
// outcomes. Product code depends on this file, never on `cognee.ts`, so the
// memory provider can be swapped without touching callers.

export * from "./types";
export { cogneeProvider, merchantDataset } from "./cognee";

export function getMemoryProvider(): MemoryProvider {
  return cogneeProvider;
}
