/**
 * A small in-process cache for merchant intelligence, so reopening a merchant
 * is instant and a background warm-up and a click never do the work twice
 * (entries hold the in-flight promise).
 *
 * Deliberately simple: one server process, time-based expiry, and explicit
 * invalidation when a merchant's actions change. Failed work is not kept.
 */

interface Entry {
  value: Promise<unknown>;
  expires: number;
}

// Survives dev-server module reloads.
const store: Map<string, Entry> = ((globalThis as { __bazaarIntelligenceCache?: Map<string, Entry> })
  .__bazaarIntelligenceCache ??= new Map());

/**
 * Returns the cached value for `key`, or runs `fn` and caches it for `ttlMs`.
 * `keep` decides whether a successful result is worth caching.
 */
export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as Promise<T>;

  const value = fn();
  store.set(key, { value, expires: Date.now() + ttlMs });
  value.then(
    (result) => {
      if (!keep(result)) store.delete(key);
    },
    () => store.delete(key),
  );
  return value;
}

/** Drops everything cached for one merchant (e.g. after an action runs). */
export function invalidateMerchant(merchantId: string): void {
  for (const key of store.keys()) {
    if (key.includes(`:${merchantId}:`) || key.endsWith(`:${merchantId}`)) store.delete(key);
  }
}
