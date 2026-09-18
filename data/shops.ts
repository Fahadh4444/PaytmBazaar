/**
 * The merchants of a Bazaar street.
 *
 * Every Bazaar shares the same street render in this prototype, so this layout
 * is shared too: the selected Bazaar supplies the name and id, the shops below
 * supply the buildings. Outlines are normalised to the street plate (0-1 on
 * each axis) and traced from the storefronts, so they scale with any zoom.
 *
 * No merchant data here beyond a name. Anything real arrives from the M2M
 * engine later.
 */

export interface Shop {
  id: string;
  name: string;
  outline: ReadonlyArray<readonly [number, number]>;
}

export const shops: readonly Shop[] = [
  {
    id: "filter-kapi",
    name: "Filter Kapi",
    outline: [
      [0.1005, 0.2285],
      [0.2065, 0.2179],
      [0.2107, 0.3401],
      [0.1047, 0.3560],
    ],
  },
  {
    id: "freshkart",
    name: "FreshKart",
    outline: [
      [0.3142, 0.1615],
      [0.4297, 0.1509],
      [0.4345, 0.3029],
      [0.3190, 0.3188],
    ],
  },
  {
    id: "sharma-electronics",
    name: "Sharma Electronics",
    outline: [
      [0.4979, 0.1382],
      [0.6284, 0.1296],
      [0.6332, 0.3082],
      [0.5027, 0.3188],
    ],
  },
  {
    id: "trends-fashion",
    name: "Trends Fashion",
    outline: [
      [0.6631, 0.2253],
      [0.7840, 0.2147],
      [0.7887, 0.3592],
      [0.6679, 0.3741],
    ],
  },
  {
    id: "apollo-pharmacy",
    name: "Apollo Pharmacy",
    outline: [
      [0.8211, 0.3146],
      [0.9455, 0.3039],
      [0.9503, 0.4548],
      [0.8259, 0.4697],
    ],
  },
  {
    id: "udupi-darshini",
    name: "Udupi Darshini",
    outline: [
      [0.1885, 0.4166],
      [0.3471, 0.4038],
      [0.3531, 0.5866],
      [0.1945, 0.6079],
    ],
  },
  {
    id: "sri-lakshmi-textiles",
    name: "Sri Lakshmi Textiles",
    outline: [
      [0.4057, 0.4315],
      [0.5416, 0.4208],
      [0.5464, 0.5632],
      [0.4105, 0.5781],
    ],
  },
  {
    id: "bakers-point",
    name: "Bakers Point",
    outline: [
      [0.6032, 0.4846],
      [0.7481, 0.4718],
      [0.7528, 0.6440],
      [0.6080, 0.6610],
    ],
  },
  {
    id: "mobile-hub",
    name: "The Mobile Hub",
    outline: [
      [0.8031, 0.5972],
      [0.9156, 0.5866],
      [0.9204, 0.7311],
      [0.8079, 0.7460],
    ],
  },
  {
    id: "quick-bites",
    name: "Quick Bites",
    outline: [
      [0.1424, 0.7630],
      [0.2454, 0.7503],
      [0.2501, 0.8990],
      [0.1472, 0.9139],
    ],
  },
  {
    id: "healthkart",
    name: "HealthKart",
    outline: [
      [0.3489, 0.6823],
      [0.4638, 0.6716],
      [0.4686, 0.8247],
      [0.3537, 0.8395],
    ],
  },
  {
    id: "stationery-mart",
    name: "Stationery Mart",
    outline: [
      [0.5524, 0.7885],
      [0.6792, 0.7758],
      [0.6840, 0.9309],
      [0.5572, 0.9458],
    ],
  },
] as const;
