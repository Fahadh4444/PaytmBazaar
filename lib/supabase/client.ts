/**
 * Application-side Supabase access (browser).
 *
 * Schema lives in `supabase/migrations/` — that is the source of truth for what
 * the database looks like. This directory is only about how the app talks to it.
 *
 * Uses the publishable key (`sb_publishable_…`), which is safe to ship to the
 * browser: it carries no privileges of its own, so what it can reach is decided
 * entirely by Row Level Security. Legacy `anon` keys are accepted as a fallback
 * for projects that have not migrated.
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
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  browserClient = createClient(url, publishableKey);
  return browserClient;
}
