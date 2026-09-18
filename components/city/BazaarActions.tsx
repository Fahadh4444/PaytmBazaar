"use client";

import type { Bazaar } from "@/data/bazaars";

import styles from "./city.module.css";

export type ActionsPlacement = { left: number; top: number };

type BazaarActionsProps = {
  bazaar: Bazaar;
  placement: ActionsPlacement;
  onAnalyze: () => void;
  onZoomIn: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

/**
 * Hangs over the block it belongs to: the name, then the two things you can do
 * with it. Tilted and drifting, with a shadow falling on the city beneath, so
 * it sits above the block rather than flat on the screen.
 */
export default function BazaarActions({
  bazaar,
  placement,
  onAnalyze,
  onZoomIn,
  onMouseEnter,
  onMouseLeave,
}: BazaarActionsProps) {
  return (
    <div
      className={styles.actionsAnchor}
      style={{ left: placement.left, top: placement.top }}
    >
      <div className={styles.actionsLift}>
        <div
          className={styles.actions}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <p className={styles.actionsName}>{bazaar.name}</p>

          <div className={styles.actionsRow}>
            <button type="button" className={styles.action} onClick={onAnalyze}>
              Analyze Bazaar
            </button>
            <button type="button" className={styles.action} onClick={onZoomIn}>
              Zoom into Bazaar
            </button>
          </div>
        </div>

        <div className={styles.actionsShadow} aria-hidden="true" />
      </div>
    </div>
  );
}
