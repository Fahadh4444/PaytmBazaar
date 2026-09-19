import { z } from "zod";

import type { SelectedContext } from "@/m2m-engine";
import { M2MInputError } from "@/m2m-engine";

const schema = z.object({
  dayOfWeek: z.enum(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]),
  timeOfDay: z.enum(["morning", "afternoon", "evening", "night"]),
  weather: z.enum(["clear", "cloudy", "rain", "heavy_rain"]),
  event: z.enum(["none", "festival", "public_holiday", "local_event", "sports_event", "payday"]),
}).strict();

/** Context is all-or-nothing so a partial URL cannot silently change meaning. */
export function contextFromUrl(url: URL): SelectedContext | undefined {
  const keys = ["dayOfWeek", "timeOfDay", "weather", "event"] as const;
  const present = keys.filter((key) => url.searchParams.has(key));
  if (present.length === 0) return undefined;
  if (present.length !== keys.length) throw new M2MInputError("Pass all context fields, or none.");
  const parsed = schema.safeParse(Object.fromEntries(keys.map((key) => [key, url.searchParams.get(key)])));
  if (!parsed.success) throw new M2MInputError("Context contains an unsupported value.");
  return parsed.data as SelectedContext;
}

export function contextFromValue(value: unknown): SelectedContext {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new M2MInputError("Context contains an unsupported value.");
  return parsed.data as SelectedContext;
}
