/**
 * Synthetic demo data for Paytm Bazaar.
 *
 * This is NOT real Paytm merchant data. No authorized access to production
 * Paytm merchant or transaction data exists, and nothing in this repository
 * should be presented as such.
 *
 * Deliberately small: enough merchants to form category/area cohorts larger
 * than MIN_COHORT_SIZE, and nothing more. Transactions are not seeded yet —
 * they arrive with the first vertical slice, which decides what shape of
 * activity it needs to demonstrate.
 */

import type { Area, Merchant } from "@/m2m-engine";

export const areas: Area[] = [
  { id: "area-koramangala", name: "Koramangala", city: "Bengaluru" },
  { id: "area-indiranagar", name: "Indiranagar", city: "Bengaluru" },
  { id: "area-jayanagar", name: "Jayanagar", city: "Bengaluru" },
];

export const merchants: Merchant[] = [
  // Koramangala
  { id: "m-001", name: "Anand Bhavan", category: "restaurant", areaId: "area-koramangala" },
  { id: "m-002", name: "Malgudi Rasoi", category: "restaurant", areaId: "area-koramangala" },
  { id: "m-003", name: "Third Wave Corner", category: "cafe", areaId: "area-koramangala" },
  { id: "m-004", name: "Sunrise Kirana", category: "kirana", areaId: "area-koramangala" },
  { id: "m-005", name: "Nalpad Bakery", category: "bakery", areaId: "area-koramangala" },
  { id: "m-006", name: "Wellness Pharmacy", category: "pharmacy", areaId: "area-koramangala" },

  // Indiranagar
  { id: "m-007", name: "Chulha House", category: "restaurant", areaId: "area-indiranagar" },
  { id: "m-008", name: "Tandoor Junction", category: "restaurant", areaId: "area-indiranagar" },
  { id: "m-009", name: "Filter Coffee Works", category: "cafe", areaId: "area-indiranagar" },
  { id: "m-010", name: "Brew & Bloom", category: "cafe", areaId: "area-indiranagar" },
  { id: "m-011", name: "Daily Needs Kirana", category: "kirana", areaId: "area-indiranagar" },
  { id: "m-012", name: "Studio Kesh Salon", category: "salon", areaId: "area-indiranagar" },

  // Jayanagar
  { id: "m-013", name: "Udupi Grand", category: "restaurant", areaId: "area-jayanagar" },
  { id: "m-014", name: "Cafe Chitra", category: "cafe", areaId: "area-jayanagar" },
  { id: "m-015", name: "Sri Lakshmi Stores", category: "kirana", areaId: "area-jayanagar" },
  { id: "m-016", name: "Iyengar Bakery", category: "bakery", areaId: "area-jayanagar" },
  { id: "m-017", name: "Care Point Pharmacy", category: "pharmacy", areaId: "area-jayanagar" },
  { id: "m-018", name: "Voltage Electronics", category: "electronics", areaId: "area-jayanagar" },
];
