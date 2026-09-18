/**
 * The Paytm data adapter: domain types, errors, and the Supabase-backed
 * implementation.
 *
 * Product code should import from `@/lib/paytm`, which also supplies a
 * configured instance. This module exists so tests and future
 * implementations can reach the pieces without going through `server-only`.
 */

export * from "./types";
export * from "./errors";
export { MAX_PAGE_SIZE } from "./validation";
export {
  DEFAULT_MAX_ROWS,
  PaytmSupabaseAdapter,
  type PaytmSupabaseAdapterOptions,
} from "./supabase";
