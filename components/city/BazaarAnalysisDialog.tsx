"use client";

import type { Bazaar } from "@/data/bazaars";
import SceneDialog from "@/components/bazaar/SceneDialog";

import type { CityContext } from "./context";
import { formatHour } from "./context";
import styles from "./city.module.css";

type BazaarAnalysisDialogProps = {
  bazaar: Bazaar | null;
  context: CityContext;
  open: boolean;
  onClose: () => void;
};

/**
 * The window the M2M engine will eventually open onto a Bazaar.
 *
 * Intentionally empty. It shows which Bazaar and which contextual state the
 * analysis would run against, and nothing else — no numbers are invented here,
 * because none have been computed.
 */
export default function BazaarAnalysisDialog({
  bazaar,
  context,
  open,
  onClose,
}: BazaarAnalysisDialogProps) {
  const inputs: Array<[string, string]> = [
    ["Time", formatHour(context.hour)],
    ["Day", context.day],
    ["Weather", context.weather],
    ["Event", context.event],
  ];

  return (
    <SceneDialog
      open={open}
      onClose={onClose}
      eyebrow="Bazaar Analysis"
      title={bazaar ? bazaar.name : "Bazaar"}
    >
      <hr className={styles.dialogRule} />

      <p className={styles.dialogLede}>
        This is the window the M2M engine reports into. It will read the Bazaar&apos;s
        activity under the contextual state below.
      </p>

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
