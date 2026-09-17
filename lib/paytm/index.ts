/**
 * Merchant data-source boundary.
 *
 * Everything above this module asks for merchants without knowing where they
 * came from. Today that is synthetic data in `data/`. Later it may be Supabase,
 * or — only with authorized access — a real Paytm integration. Swapping the
 * source must not require changes above this file.
 *
 * No Paytm API endpoint is called or fabricated here.
 *
 * Functions are async even though the current source is in-memory, so the
 * signatures survive the move to a real backing store.
 */

import { areas, merchants } from "@/data/merchants";
import type { Area, Merchant, MerchantCategory } from "@/m2m-engine";

export interface MerchantQuery {
  areaId?: string;
  category?: MerchantCategory;
}

export async function getAreas(): Promise<Area[]> {
  return areas;
}

export async function getMerchants(query: MerchantQuery = {}): Promise<Merchant[]> {
  return merchants.filter(
    (merchant) =>
      (query.areaId === undefined || merchant.areaId === query.areaId) &&
      (query.category === undefined || merchant.category === query.category),
  );
}

export async function getMerchant(id: string): Promise<Merchant | null> {
  return merchants.find((merchant) => merchant.id === id) ?? null;
}
