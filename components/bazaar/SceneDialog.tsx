"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import styles from "./dialog.module.css";

/** Matches the .closing animation in dialog.module.css. */
const CLOSE_MS = 200;

type SceneDialogProps = {
  open: boolean;
  onClose: () => void;
  eyebrow: string;
  title: string;
  /** Roomier panel, for content that needs side-by-side space. */
  wide?: boolean;
  /** Full dashboard width for analysis and conversational workspaces. */
  workspace?: boolean;
  children: ReactNode;
};

/**
 * The window that opens inside the Bazaar.
 *
 * Built on native <dialog>: the platform gives us the top layer, the focus
 * trap, focus restoration and Escape, so the only things left to do by hand
 * are the exit animation and the backdrop click.
 */
export default function SceneDialog({
  open,
  onClose,
  eyebrow,
  title,
  wide = false,
  workspace = false,
  children,
}: SceneDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  const titleId = useId();

  // Play the exit animation before handing the close back to the platform.
  const requestClose = useCallback(() => {
    const dialog = ref.current;
    if (!dialog?.open || timer.current !== undefined) return;

    setClosing(true);
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setClosing(false);
      dialog.close();
      onClose();
    }, CLOSE_MS);
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Escape fires "cancel"; take it over so the dialog can animate out.
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };

    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [requestClose]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={[
        styles.dialog,
        wide && styles.wide,
        workspace && styles.workspace,
        closing && styles.closing,
      ]
        .filter(Boolean)
        .join(" ")}
      // A click that lands on the dialog itself came from the backdrop.
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
    >
      <div className={styles.panel}>
        <button type="button" className={styles.close} onClick={requestClose} aria-label="Close">
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className={styles.scroll}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>

          {children}
        </div>
      </div>
    </dialog>
  );
}
