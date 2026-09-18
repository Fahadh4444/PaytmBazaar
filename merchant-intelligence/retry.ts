/**
 * Retries a read when the data source is briefly unreachable (a network
 * blip), so a momentary failure does not surface as an error page. Anything
 * else (not found, invalid input) fails immediately.
 */

import { PaytmDataError } from "@/lib/paytm/adapter/errors";

export async function withRetry<T>(work: () => Promise<T>, attempts = 3, delayMs = 400): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      const transient = error instanceof PaytmDataError && error.code === "unavailable";
      if (!transient || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
