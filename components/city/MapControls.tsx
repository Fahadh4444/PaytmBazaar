"use client";

import styles from "./city.module.css";

type MapControlsProps = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

export default function MapControls({
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
}: MapControlsProps) {
  return (
    <div className={styles.mapControls}>
      <div className={styles.zoomGroup}>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={onZoomIn}
          disabled={!canZoomIn}
          aria-label="Zoom in"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={onZoomOut}
          disabled={!canZoomOut}
          aria-label="Zoom out"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      <div className={styles.compass} role="img" aria-label="North is up">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.4 15.2 13 12 11.1 8.8 13z" fill="currentColor" />
          <path d="M12 12.9 15.2 13 12 20.6 8.8 13z" fill="currentColor" opacity="0.32" />
        </svg>
      </div>
    </div>
  );
}
