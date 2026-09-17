/**
 * Core domain vocabulary for Paytm Bazaar.
 *
 * This file lives inside the M2M engine on purpose: the engine is the layer
 * with zero outward dependencies, so every other layer is free to depend on it
 * (data source, API routes, UI) without creating a cycle.
 *
 * Nothing here may import React, Next.js, Supabase, or any provider SDK.
 */

export type MerchantCategory =
  | "restaurant"
  | "cafe"
  | "kirana"
  | "salon"
  | "pharmacy"
  | "bakery"
  | "electronics";

/** Bucketing of a timestamp. Derived, never stored on a transaction. */
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

/**
 * Contextual weather state for an area on a date.
 *
 * Declared now so the dimension exists in the vocabulary. No weather
 * observations are modelled yet, and no relationship between weather and sales
 * is assumed anywhere — any such relationship must be derived from data.
 */
export type Weather = "clear" | "cloudy" | "rain" | "heavy_rain";

export interface Area {
  id: string;
  name: string;
  city: string;
}

export interface Merchant {
  id: string;
  name: string;
  category: MerchantCategory;
  areaId: string;
}

export interface Transaction {
  id: string;
  merchantId: string;
  /** Amount in rupees. */
  amount: number;
  /** ISO 8601 timestamp. Time of day and day of week are derived from this. */
  timestamp: string;
}
