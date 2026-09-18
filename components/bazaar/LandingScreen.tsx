"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import BazaarEnvironment from "./BazaarEnvironment";
import BazaarPortal from "./BazaarPortal";
import IdeaDialog from "./IdeaDialog";
import TeamDialog from "./TeamDialog";
import styles from "./bazaar.module.css";

/** Long enough to read as a descent, short enough not to feel like a wait. */
const DESCENT_MS = 1550;
const REDUCED_MS = 260;

type Phase = "idle" | "entering";
type OpenDialog = null | "team" | "idea";

export default function LandingScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const timer = useRef<number | undefined>(undefined);

  // The city should already be in the client cache when the descent lands.
  useEffect(() => {
    router.prefetch("/city");
  }, [router]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enterBazaar = () => {
    if (phase === "entering") return;
    setPhase("entering");

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    timer.current = window.setTimeout(
      () => router.push("/city"),
      reduced ? REDUCED_MS : DESCENT_MS,
    );
  };

  return (
    <main
      className={styles.scene}
      data-phase={phase}
      data-dialog={dialog ? "open" : undefined}
    >
      <BazaarEnvironment />

      <div className={styles.hud}>
        <BazaarPortal onEnter={enterBazaar} />

        <p className={styles.srOnly}>Bazaar Se Seekho. Business Badhao.</p>

        <button
          type="button"
          className={`${styles.trigger} ${styles.triggerLeft}`}
          onClick={() => setDialog("team")}
        >
          <svg
            className={styles.triggerIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 3 3 10.4l7.3 2.9L13.4 21z" />
            <path d="M21 3 10.3 13.3" />
          </svg>
          <span className={styles.triggerLabel}>Our Team</span>
        </button>

        <button
          type="button"
          className={`${styles.trigger} ${styles.triggerRight}`}
          onClick={() => setDialog("idea")}
        >
          <svg
            className={styles.triggerIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9.4 16.1a5.6 5.6 0 1 1 5.2 0v1.7a1 1 0 0 1-1 1h-3.2a1 1 0 0 1-1-1z" />
            <path d="M10.2 21h3.6" />
            <path d="M12 1.6v1.3M4.6 5.1l.9.9M19.4 5.1l-.9.9M2.4 12.2h1.3M20.3 12.2h1.3" />
          </svg>
          <span className={styles.triggerLabel}>Our Idea</span>
        </button>
      </div>

      <TeamDialog open={dialog === "team"} onClose={() => setDialog(null)} />
      <IdeaDialog open={dialog === "idea"} onClose={() => setDialog(null)} />
    </main>
  );
}
