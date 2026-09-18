"use client";

import { useState } from "react";

import styles from "./city.module.css";

/** Natural size of the city plate; every overlay uses these units. */
export const PLATE_W = 1672;
export const PLATE_H = 941;

/* Bumped whenever the plate is regenerated. The filename never changes, so
   without this a browser keeps serving the copy it cached earlier. */
const PLATE_VERSION = "5";
const PLATE = `/bazaar/city-plate.webp?v=${PLATE_VERSION}`;

const BIRD_FLIGHTS = [
  { d: "M -60 196 C 280 150, 620 214, 980 168 S 1500 122, 1760 150", dur: 46, delay: 0, scale: 1 },
  { d: "M 1740 116 C 1420 158, 1120 104, 800 146 S 260 190, -60 152", dur: 62, delay: 9, scale: 0.78 },
  { d: "M -60 262 C 340 232, 700 276, 1060 238 S 1520 200, 1760 226", dur: 74, delay: 22, scale: 0.6 },
];

/**
 * The city itself: the plate, the contextual tint, and the light ambient
 * layers that keep it from feeling like a screenshot. Everything here is
 * decorative and non-interactive — it sits under the Bazaar regions.
 */
export default function CityEnvironment() {
  const [plateFailed, setPlateFailed] = useState(false);

  return (
    <>
      {!plateFailed && (
        /* eslint-disable-next-line @next/next/no-img-element -- pre-sized plate,
           served as-is so the region overlay stays pixel-aligned with it. */
        <img
          className={styles.plate}
          src={PLATE}
          alt=""
          draggable={false}
          onError={() => setPlateFailed(true)}
        />
      )}

      <div className={styles.tint} />

      <div className={styles.ambient} aria-hidden="true">
        <div className={`${styles.cloud} ${styles.cloudA}`} />
        <div className={`${styles.cloud} ${styles.cloudB}`} />
        <div className={`${styles.cloud} ${styles.cloudC}`} />
        <div className={`${styles.cloud} ${styles.cloudD}`} />

        <svg
          className={styles.ambientSvg}
          viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
          preserveAspectRatio="none"
        >
          {BIRD_FLIGHTS.map((flight, i) => (
            <g
              key={`bird-${i}`}
              className={styles.birdPath}
              style={{
                offsetPath: `path("${flight.d}")`,
                animationDuration: `${flight.dur}s`,
                animationDelay: `-${flight.delay}s`,
              }}
            >
              <g transform={`scale(${flight.scale})`}>
                <path
                  className={styles.bird}
                  d="M -11 0 q 5.5 -6 11 0 M 0 0 q 5.5 -6 11 0"
                  style={{ animationDelay: `-${i * 0.3}s` }}
                />
              </g>
            </g>
          ))}
        </svg>
      </div>
    </>
  );
}
