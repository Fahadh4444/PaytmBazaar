"use client";

import { useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";

import SceneDialog from "@/components/bazaar/SceneDialog";

import IntelligenceTrace from "./IntelligenceTrace";
import SystemFlow from "./SystemFlow";
import type { InspectSource } from "./source";
import type { SceneContext } from "./trace";
import styles from "./inspect.module.css";

type Layer = "trace" | "flow";

type DialogToolsProps = {
  /** The exact state the dialog underneath is rendering. */
  source: InspectSource;
  /** The dialog's subject: the city, Bazaar or merchant name. */
  subject: string;
  /** The scene's Day / Time / Weather / Event controls, when the screen has them. */
  scene?: SceneContext;
};

const NOUN = { city: "city", bazaar: "Bazaar", merchant: "merchant" } as const;

/**
 * The Trace and Flow keys in a dialog's header, and the smaller inspection
 * layer each one opens over it. The dialog underneath stays open and keeps
 * its state; Escape or the layer's own close button returns to it.
 */
export default function DialogTools({ source, subject, scene }: DialogToolsProps) {
  const [layer, setLayer] = useState<Layer | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const noun = NOUN[source.scope];

  const open = (event: MouseEvent<HTMLButtonElement>, next: Layer) => {
    opener.current = event.currentTarget;
    setLayer(next);
  };

  // Switching layers replaces the dialog that held focus, so hand focus back
  // to the key that opened the first one.
  const close = () => {
    setLayer(null);
    opener.current?.focus();
  };

  return (
    <>
      <button
        type="button"
        className={styles.tool}
        onClick={(event) => open(event, "trace")}
        aria-haspopup="dialog"
        aria-label={`Intelligence Trace: what the system did for this ${noun}`}
        title={`Intelligence Trace: what the system did for this ${noun}`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />
        </svg>
        <span className={styles.toolLabel}>Trace</span>
      </button>
      <button
        type="button"
        className={styles.tool}
        onClick={(event) => open(event, "flow")}
        aria-haspopup="dialog"
        aria-label="System Flow: how Paytm Bazaar is built"
        title="System Flow: how Paytm Bazaar is built"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="6" height="6" />
          <rect x="15" y="15" width="6" height="6" />
          <path d="M9 6h4a2 2 0 0 1 2 2v7" />
        </svg>
        <span className={styles.toolLabel}>Flow</span>
      </button>

      {layer &&
        createPortal(
          <SceneDialog
            key={layer}
            open
            inspector
            onClose={close}
            eyebrow={layer === "trace" ? "Intelligence Trace" : "System Flow"}
            title={layer === "trace" ? subject : "How Paytm Bazaar works"}
          >
            {layer === "trace" ? (
              <IntelligenceTrace source={source} subject={subject} scene={scene} onOpenFlow={() => setLayer("flow")} />
            ) : (
              <SystemFlow source={source} onOpenTrace={() => setLayer("trace")} />
            )}
          </SceneDialog>,
          document.body,
        )}
    </>
  );
}
