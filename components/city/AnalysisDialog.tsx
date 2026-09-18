"use client";

import SceneDialog from "@/components/bazaar/SceneDialog";

import type { CityContext } from "./context";
import { formatHour } from "./context";
import styles from "./city.module.css";

type AnalysisDialogProps = {
  /** What is being analysed: "Bazaar Analysis", "City Analysis". */
  eyebrow: string;
  title: string;
  /** One line saying what the analysis will read. */
  lede: string;
  context: CityContext;
  open: boolean;
  onClose: () => void;
};

/**
 * The window the M2M engine will eventually report into, for a single Bazaar
 * or for the whole city.
 *
 * Intentionally empty. It shows what is being analysed and the contextual
 * state it would run under, and nothing else — no numbers are invented here,
 * because none have been computed.
 */
export default function AnalysisDialog({
  eyebrow,
  title,
  lede,
  context,
  open,
  onClose,
}: AnalysisDialogProps) {
  const inputs: Array<[string, string]> = [
    ["Time", formatHour(context.hour)],
    ["Day", context.day],
    ["Weather", context.weather],
    ["Event", context.event],
  ];

  return (
    <SceneDialog open={open} onClose={onClose} eyebrow={eyebrow} title={title}>
      <hr className={styles.dialogRule} />

      <p className={styles.dialogLede}>{lede}</p>

      <dl className={styles.inputs}>
        {inputs.map(([label, value]) => (
          <div key={label} className={styles.input}>
            <dt className={styles.inputLabel}>{label}</dt>
            <dd className={styles.inputValue}>{value}</dd>
          </div>
        ))}
      </dl>

      <p className={styles.empty}>Analysis will appear here.</p>
    </SceneDialog>
  );
}
