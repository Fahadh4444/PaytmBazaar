/**
 * Paytm data-source boundary.
 *
 * Everything above this module asks for bazaars, merchants, payment events
 * and daily metrics through `PaytmDataSource`, without knowing where they come
 * from. Today the source is our Supabase prototype database holding synthetic
 * Paytm-like data. If authorized access to a real Paytm API ever exists, it
 * becomes another `PaytmDataSource` implementation, chosen here. Nothing above
 * this file changes.
 *
 * No Paytm API endpoint is called or fabricated here.
 *
 * Server-only: the Supabase implementation uses the secret key and returns
 * merchants' private contact details. Client components may import types from
 * here with `import type`, but must not call it.
 */

import { getSupabaseServerClient } from "@/lib/supabase/server";

import { DataSourceError, PaytmSupabaseAdapter, type PaytmDataSource } from "./adapter";

export * from "./adapter/types";
export * from "./adapter/errors";

let dataSource: PaytmDataSource | null = null;

/**
 * Returns the configured data source. It is created lazily, so a missing
 * Supabase configuration only fails the request that needs data.
 */
export function getPaytmDataSource(): PaytmDataSource {
  if (dataSource) return dataSource;

  let client;
  try {
    client = getSupabaseServerClient();
  } catch (cause) {
    throw new DataSourceError("The Paytm data source is not configured.", { cause });
  }

  dataSource = new PaytmSupabaseAdapter(client);
  return dataSource;
}
