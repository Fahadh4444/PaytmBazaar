"use client";

import type { Bazaar } from "@/data/bazaars";

import { PLATE_H, PLATE_W } from "./CityEnvironment";
import styles from "./city.module.css";

type Point = readonly [number, number];

/** Corner radius in plate units. */
const CORNER = 34;
/** Samples used to round each corner. */
const PER_CORNER = 6;

/** The footprint, with its corners rounded, as a closed ring of points. */
function footprint(outline: Bazaar["outline"]): Point[] {
  const corners = outline.map(([x, y]) => [x * PLATE_W, y * PLATE_H] as Point);
  const count = corners.length;
  const points: Point[] = [];

  for (let i = 0; i < count; i += 1) {
    const previous = corners[(i - 1 + count) % count];
    const current = corners[i];
    const next = corners[(i + 1) % count];

    const cut = (from: Point): Point => {
      const dx = from[0] - current[0];
      const dy = from[1] - current[1];
      const length = Math.hypot(dx, dy) || 1;
      const amount = Math.min(CORNER, length / 2) / length;
      return [current[0] + dx * amount, current[1] + dy * amount];
    };

    const entry = cut(previous);
    const exit = cut(next);

    points.push(entry);
    for (let step = 1; step < PER_CORNER; step += 1) {
      const t = step / PER_CORNER;
      const u = 1 - t;
      points.push([
        u * u * entry[0] + 2 * u * t * current[0] + t * t * exit[0],
        u * u * entry[1] + 2 * u * t * current[1] + t * t * exit[1],
      ]);
    }
    points.push(exit);
  }

  return points;
}

const toPath = (points: Point[]) =>
  `${points
    .map((p, i) => `${i ? "L" : "M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ")} Z`;

type BazaarRegionsProps = {
  bazaars: readonly Bazaar[];
  activeId: string | null;
  onEnter: (id: string, element: SVGGElement) => void;
  onLeave: () => void;
};

/**
 * The six entry points.
 *
 * The boundaries are part of the render itself, so this layer draws no line of
 * its own. Each Bazaar is a hit area shaped to its painted boundary, with a
 * circle of light that blooms out of the middle of the block when the pointer
 * arrives.
 */
export default function BazaarRegions({
  bazaars,
  activeId,
  onEnter,
  onLeave,
}: BazaarRegionsProps) {
  return (
    <svg
      className={styles.regions}
      viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/* Painted on a circle, not on the block, so the light spreads out of
            the middle instead of taking the shape of a rectangle. */}
        <radialGradient id="bazaarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="75%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {bazaars.map((bazaar) => {
        const points = bazaar.outline.map(
          ([x, y]) => [x * PLATE_W, y * PLATE_H] as Point,
        );
        const xs = points.map((p) => p[0]);
        const ys = points.map((p) => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const radius = (Math.max(...xs) - Math.min(...xs)) * 0.4;

        return (
          <g
            key={bazaar.id}
            className={styles.region}
            data-active={activeId === bazaar.id}
            role="button"
            tabIndex={0}
            aria-label={`${bazaar.name} Bazaar, ${bazaar.category}`}
            onMouseEnter={(event) => onEnter(bazaar.id, event.currentTarget)}
            onMouseLeave={onLeave}
            onFocus={(event) => onEnter(bazaar.id, event.currentTarget)}
            onBlur={onLeave}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onEnter(bazaar.id, event.currentTarget);
              }
            }}
            // Touch has no hover, so a tap opens the same actions.
            onPointerDown={(event) => {
              if (event.pointerType === "touch") onEnter(bazaar.id, event.currentTarget);
            }}
          >
            <circle className={styles.regionGlow} cx={cx} cy={cy} r={radius} />
            <path className={styles.regionHit} d={toPath(footprint(bazaar.outline))} />
          </g>
        );
      })}
    </svg>
  );
}
