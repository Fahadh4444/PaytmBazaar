/**
 * The contextual dimensions the city runs under.
 *
 * These are not decorative filters. Time, day, weather and event are the
 * inputs the M2M engine will eventually read alongside Bazaar transaction data
 * to produce network insight. Nothing consumes them yet, so this file only
 * owns the vocabulary and the defaults; no calculation belongs here.
 *
 * The engine keeps its own `Weather` vocabulary in m2m-engine/types.ts. These
 * are the city screen's control values and are mapped across at the boundary
 * when the two are wired together, so neither side has to distort for the
 * other.
 */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEATHERS = ["Clear", "Cloudy", "Rain", "Heavy Rain"] as const;
export const EVENTS = ["None", "Festival", "Public Holiday", "Local Event", "Sports Event", "Payday"] as const;

/** Whole hours are enough resolution for the demo. */
export const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export type Day = (typeof DAYS)[number];
export type Weather = (typeof WEATHERS)[number];
export type CityEvent = (typeof EVENTS)[number];

export interface CityContext {
  /** 0-23. Rendered as HH:00. */
  hour: number;
  day: Day;
  weather: Weather;
  event: CityEvent;
}

export const DEFAULT_CONTEXT: CityContext = {
  hour: 12,
  day: "Mon",
  weather: "Clear",
  event: "None",
};

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Maps display controls to the canonical values used by the intelligence domain. */
export function intelligenceContext(context: CityContext) {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const weather = { Clear: "clear", Cloudy: "cloudy", Rain: "rain", "Heavy Rain": "heavy_rain" } as const;
  const event = {
    None: "none", Festival: "festival", "Public Holiday": "public_holiday",
    "Local Event": "local_event", "Sports Event": "sports_event", Payday: "payday",
  } as const;
  const timeOfDay = context.hour >= 5 && context.hour < 12 ? "morning"
    : context.hour < 17 ? "afternoon" : context.hour < 21 ? "evening" : "night";
  return { dayOfWeek: days[DAYS.indexOf(context.day)], timeOfDay, weather: weather[context.weather], event: event[context.event] };
}

export function contextQuery(context: CityContext): string {
  return new URLSearchParams(intelligenceContext(context)).toString();
}

export type DaylightPhase = "dawn" | "day" | "dusk" | "night";

/** Only used to tint the environment; the engine derives its own buckets. */
export function daylightPhase(hour: number): DaylightPhase {
  if (hour < 6 || hour >= 20) return "night";
  if (hour < 9) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}
