/**
 * The six Bazaars shown on the city screen.
 *
 * Kept out of the UI so the regions stay data-driven: when Bazaar activity,
 * merchant density or M2M signals arrive, they attach to these records rather
 * than to JSX. Nothing here is transaction data and nothing here is derived
 * from the M2M engine.
 *
 * `outline` is the boundary in coordinates normalised to the city plate (0-1
 * on each axis), so it survives any viewport size or zoom level. The
 * boundaries themselves are painted into the plate; these are the hit areas
 * over them, squared to the street grid.
 */

export type BazaarId =
  | "koramangala"
  | "indiranagar"
  | "marathahalli"
  | "hsr-layout"
  | "jayanagar"
  | "electronic-city";

export interface Bazaar {
  id: BazaarId;
  /** Area name. Deliberately never painted on the map — discovered on hover. */
  name: string;
  /** The merchant ecosystem this Bazaar represents. */
  category: string;
  /** Boundary colour, matching the region as drawn on the reference render. */
  color: string;
  outline: ReadonlyArray<readonly [number, number]>;
}

export const bazaars: readonly Bazaar[] = [
  {
    id: "koramangala",
    name: "Koramangala",
    category: "Food & Beverage",
    color: "#f5a623",
    outline: [
      [0.1017, 0.3823],
      [0.3751, 0.2997],
      [0.3846, 0.4201],
      [0.1112, 0.5027],
    ],
  },
  {
    id: "indiranagar",
    name: "Indiranagar",
    category: "Retail & Lifestyle",
    color: "#ff2e93",
    outline: [
      [0.4055, 0.3764],
      [0.6173, 0.3124],
      [0.6226, 0.3802],
      [0.4108, 0.4442],
    ],
  },
  {
    id: "marathahalli",
    name: "Marathahalli",
    category: "Healthcare",
    color: "#16c95f",
    outline: [
      [0.6256, 0.4584],
      [0.8344, 0.3953],
      [0.8427, 0.5001],
      [0.6339, 0.5632],
    ],
  },
  {
    id: "hsr-layout",
    name: "HSR Layout",
    category: "Technology & Electronics",
    color: "#a855f7",
    outline: [
      [0.3547, 0.5929],
      [0.6078, 0.5165],
      [0.6154, 0.6132],
      [0.3623, 0.6897],
    ],
  },
  {
    id: "jayanagar",
    name: "Jayanagar",
    category: "Services",
    color: "#2f8fe0",
    outline: [
      [0.0580, 0.6564],
      [0.2786, 0.5898],
      [0.2865, 0.6900],
      [0.0659, 0.7566],
    ],
  },
  {
    id: "electronic-city",
    name: "Electronic City",
    category: "Business & B2B",
    color: "#22b8e6",
    outline: [
      [0.5502, 0.7006],
      [0.8292, 0.6164],
      [0.8367, 0.7117],
      [0.5578, 0.7960],
    ],
  },
] as const;

export function bazaarById(id: string): Bazaar | undefined {
  return bazaars.find((bazaar) => bazaar.id === id);
}
