"use client";

import type { Shop } from "@/data/shops";

import styles from "./bazaar-screen.module.css";

export const PLATE_W = 1671;
export const PLATE_H = 941;

type MerchantLayerProps = {
  shops: readonly Shop[];
  onOpen: (shop: Shop) => void;
};

const points = (shop: Shop) =>
  shop.outline.map(([x, y]) => `${x * PLATE_W},${y * PLATE_H}`).join(" ");

/**
 * Invisible hit areas over the storefronts. Nothing is labelled and nothing is
 * outlined: hovering a building simply lights it from the middle, which is
 * enough to say it opens.
 */
export default function MerchantLayer({ shops, onOpen }: MerchantLayerProps) {
  return (
    <svg
      className={styles.merchants}
      viewBox={`0 0 ${PLATE_W} ${PLATE_H}`}
      preserveAspectRatio="none"
    >
      <defs>
        <radialGradient id="merchantGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.46" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.24" />
          <stop offset="78%" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {shops.map((shop) => {
        const xs = shop.outline.map(([x]) => x * PLATE_W);
        const ys = shop.outline.map(([, y]) => y * PLATE_H);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const radius = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.6;

        return (
          <g
            key={shop.id}
            className={styles.merchant}
            role="button"
            tabIndex={0}
            aria-label={shop.name}
            onClick={() => onOpen(shop)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen(shop);
              }
            }}
          >
            <circle className={styles.merchantGlow} cx={cx} cy={cy} r={radius} />
            <polygon className={styles.merchantHit} points={points(shop)} />
          </g>
        );
      })}
    </svg>
  );
}
