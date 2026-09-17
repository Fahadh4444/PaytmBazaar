/**
 * Application-side Supabase access (server).
 *
 * Uses the secret key (`sb_secret_…`), which bypasses Row Level Security and
 * must never reach the browser — import this module only from server
 * components, route handlers, or server actions. The `server-only` import makes
 * a mistake here a build error rather than a leak. Legacy `service_role` keys
 * are accepted as a fallback for projects that have not migrated.
 */

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serverClient: SupabaseClient | null = null;

function readSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && readSecretKey());
}

export function getSupabaseServerClient(): SupabaseClient {
  if (serverClient) return serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = readSecretKey();

  if (!url || !secretKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.",
    );
  }

  serverClient = createClient(url, secretKey, {
    auth: { persistSession: false },
  });
  return serverClient;
}
