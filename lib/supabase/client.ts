/**
 * Application-side Supabase access (browser).
 *
 * Schema lives in `supabase/migrations/` — that is the source of truth for what
 * the database looks like. This directory is only about how the app talks to it.
 *
 * The client is created lazily so that a missing configuration fails at the
 * call site with a clear message, rather than crashing an unrelated page at
 * import time.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  browserClient = createClient(url, anonKey);
  return browserClient;
}
