/**
 * City and Bazaar intelligence: loads the network through the Data Adapter and
 * hands it to the pure area functions in the M2M engine. Nothing is computed
 * here; this only fetches and wires.
 */

import {
  bazaarIntelligence,
  cityIntelligence,
  comparisonPeriod,
  lastNDays,
  type AreaIntelligence,
  type Bazaar,
  type ComparisonPeriod,
  type Merchant,
  type MerchantDailyMetric,
} from "@/m2m-engine";

import { noMerchantData } from "./errors";
import type { IntelligenceDeps } from "./types";

export interface NetworkSnapshot {
  bazaars: Bazaar[];
  merchants: Merchant[];
  rows: MerchantDailyMetric[];
  /** The latest full week of data against the week before. */
  period: ComparisonPeriod;
}

export async function loadNetwork(deps: IntelligenceDeps): Promise<NetworkSnapshot> {
  const [bazaars, merchants, rows] = await Promise.all([
    deps.dataSource.getBazaars(),
    deps.dataSource.getMerchants(),
    deps.dataSource.getDailyMetrics({}),
  ]);
  const latest = rows.map((r) => r.businessDate).sort().at(-1);
  if (!latest) throw noMerchantData();
  return { bazaars, merchants, rows, period: comparisonPeriod(lastNDays(latest, 7)) };
}

/** The city every Bazaar in the network belongs to (one city in the prototype). */
export function primaryCity(network: NetworkSnapshot): string {
  const counts = new Map<string, number>();
  for (const b of network.bazaars) counts.set(b.city, (counts.get(b.city) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "City";
}

export function getCityIntelligence(network: NetworkSnapshot, city = primaryCity(network)): AreaIntelligence {
  return cityIntelligence({ city, ...network });
}

export async function getBazaarIntelligence(
  deps: IntelligenceDeps,
  network: NetworkSnapshot,
  bazaarId: string,
): Promise<AreaIntelligence> {
  // Throws NotFoundError for an unknown Bazaar.
  const bazaar = await deps.dataSource.getBazaar(bazaarId);
  return bazaarIntelligence({ bazaar, ...network });
}
