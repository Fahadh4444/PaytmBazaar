/**
 * Cohort Formation: which merchants a merchant is compared against.
 *
 * Deliberately simple and deterministic, with no similarity model:
 *   1. same Bazaar and same category;
 *   2. if that leaves fewer than MIN_COHORT_SIZE peers, same category across
 *      the merchant's city.
 * The merchant itself is never in its own cohort. `basis` records which rule
 * applied, and `reportable` whether the cohort is large enough to show.
 */

import { MIN_COHORT_SIZE } from "./config";
import type { Bazaar, Merchant, MerchantCohort } from "./types";

export interface Network {
  bazaars: Bazaar[];
  merchants: Merchant[];
}

export function cityOf(bazaarId: string, bazaars: Bazaar[]): string {
  const bazaar = bazaars.find((b) => b.id === bazaarId);
  if (!bazaar) throw new Error(`Bazaar ${bazaarId} is not in the network.`);
  return bazaar.city;
}

/** Merchants in every Bazaar of `city`. */
export function cityMerchants(city: string, network: Network): Merchant[] {
  const inCity = new Set(network.bazaars.filter((b) => b.city === city).map((b) => b.id));
  return network.merchants.filter((m) => inCity.has(m.bazaarId));
}

/** Same category anywhere in the city, excluding the merchant itself. */
export function cityCategoryPeers(merchant: Merchant, network: Network): string[] {
  const city = cityOf(merchant.bazaarId, network.bazaars);
  return cityMerchants(city, network)
    .filter((m) => m.category === merchant.category && m.mid !== merchant.mid)
    .map((m) => m.mid)
    .sort();
}

export function getRelevantCohort(merchant: Merchant, network: Network): MerchantCohort {
  const city = cityOf(merchant.bazaarId, network.bazaars);

  const bazaarPeers = network.merchants
    .filter(
      (m) => m.bazaarId === merchant.bazaarId && m.category === merchant.category && m.mid !== merchant.mid,
    )
    .map((m) => m.mid)
    .sort();

  const useBazaar = bazaarPeers.length >= MIN_COHORT_SIZE;
  const peers = useBazaar ? bazaarPeers : cityCategoryPeers(merchant, network);

  return {
    merchantId: merchant.mid,
    basis: useBazaar ? "bazaar_category" : "city_category",
    category: merchant.category,
    bazaarId: merchant.bazaarId,
    city,
    cohortMerchantIds: peers,
    cohortSize: peers.length,
    reportable: peers.length >= MIN_COHORT_SIZE,
  };
}
