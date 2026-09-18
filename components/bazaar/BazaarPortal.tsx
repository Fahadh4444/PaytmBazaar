"use client";

import styles from "./bazaar.module.css";

type BazaarPortalProps = {
  onEnter: () => void;
};

/**
 * The entrance. The circle carries the branding and the "Enter" button's
 * ::after stretches across it, so the whole portal is clickable while the
 * heading stays outside the button's content model.
 */
export default function BazaarPortal({ onEnter }: BazaarPortalProps) {
  return (
    <div className={styles.portalWrap}>
      <div className={styles.portal}>
        <svg
          className={styles.portalIcon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.2 8.7 4.7 4.4a1 1 0 0 1 .95-.7h12.7a1 1 0 0 1 .95.7l1.5 4.3" />
          <path d="M3.2 8.7a2.35 2.35 0 0 0 4.7 0 2.35 2.35 0 0 0 4.1 0 2.35 2.35 0 0 0 4.1 0 2.35 2.35 0 0 0 4.7 0" />
          <path d="M4.9 11v9.3h14.2V11" />
          <path d="M9.9 20.3v-4.8a2.1 2.1 0 0 1 4.2 0v4.8" />
        </svg>

        <h1 className={styles.brand}>
          <span>Paytm</span>
          <span className={styles.brandBazaar}>Bazaar</span>
        </h1>

        <span className={styles.divider} aria-hidden="true" />

        <button type="button" className={styles.enter} onClick={onEnter}>
          Enter
          <svg
            className={styles.enterArrow}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12h15" />
            <path d="m13.5 6.5 6 5.5-6 5.5" />
          </svg>
          <span className={styles.srOnly}> the Bazaar</span>
        </button>
      </div>
    </div>
  );
}
