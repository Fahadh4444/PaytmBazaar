"use client";

import { PLATE_H, PLATE_W } from "./CityEnvironment";
import styles from "./city.module.css";

/** The BENGALURU boulder, as painted on the city plate. */
const ROCK = { cx: 1442, cy: 842, rx: 112, ry: 58 };

type CityRockProps = {
  onOpen: () => void;
};

/**
 * The city's own landmark doubles as the way into whole-city analysis. It
 * lights the same way the Bazaars do, from the middle outward, but in the
 * rock's warm stone rather than in white, so it reads as a different kind of
 * thing.
 */
export default function CityRock({ onOpen }: CityRockProps) {
  return (
    <svg
      className={styles.landmarks}
      viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <radialGradient id="rockGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd592" stopOpacity="0.9" />
          <stop offset="42%" stopColor="#f0ac5c" stopOpacity="0.58" />
          <stop offset="76%" stopColor="#b8703a" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6e4424" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g
        className={styles.rock}
        role="button"
        tabIndex={0}
        aria-label="Bengaluru — whole city analysis"
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <ellipse
          className={styles.rockGlow}
          cx={ROCK.cx}
          cy={ROCK.cy}
          rx={ROCK.rx * 1.45}
          ry={ROCK.ry * 1.75}
        />
        <ellipse
          className={styles.regionHit}
          cx={ROCK.cx}
          cy={ROCK.cy}
          rx={ROCK.rx}
          ry={ROCK.ry}
        />
      </g>
    </svg>
  );
}
