"use client";

import SceneDialog from "./SceneDialog";
import styles from "./dialog.module.css";

/**
 * Four beats, each with the plain-English version underneath. Step 3 carries a
 * concrete example, because that is where the idea usually clicks.
 */
const FLOW = [
  {
    n: "01",
    title: "Your business",
    note: "Your sales, your footfall, your busiest hours.",
  },
  {
    n: "02",
    title: "The Bazaar aggregates",
    note: "Pooled with thousands of comparable merchants, stripped of identity.",
  },
  {
    n: "03",
    title: "A pattern appears",
    note: "Say footfall on your street is down this week — and it is not just you.",
  },
  {
    n: "04",
    title: "Your business learns",
    note: "It comes back as one thing you can actually do something about.",
  },
];

const CELLS = Array.from({ length: 12 }, (_, i) => i);

type IdeaDialogProps = {
  open: boolean;
  onClose: () => void;
};

export default function IdeaDialog({ open, onClose }: IdeaDialogProps) {
  return (
    <SceneDialog open={open} onClose={onClose} eyebrow="Paytm Bazaar" title="Our Idea" wide>
      <hr className={styles.rule} />

      <p className={styles.statement}>The power of many, for every merchant.</p>
      <p className={styles.lede}>
        A merchant can see their own shop. They cannot see the street.
      </p>

      <div className={styles.compare}>
        <div className={styles.compareCell}>
          <p className={styles.compareLabel}>On your own</p>
          <div className={styles.grid} aria-hidden="true">
            {CELLS.map((i) => (
              <span key={i} className={i === 4 ? styles.cellSelf : styles.cell} />
            ))}
          </div>
          <p className={styles.compareNote}>One shop. Your own numbers, and nothing else.</p>
        </div>

        <div className={styles.compareCell}>
          <p className={styles.compareLabel}>In the Bazaar</p>
          <div className={`${styles.grid} ${styles.gridLive}`} aria-hidden="true">
            {CELLS.map((i) => (
              <span key={i} className={i === 4 ? styles.cellSelf : styles.cellOn} />
            ))}
          </div>
          <p className={styles.compareNote}>
            Everyone like you. The shape of the whole street.
          </p>
        </div>
      </div>

      <p className={styles.sectionLabel}>How it works</p>

      <ol className={styles.flow}>
        {FLOW.map((step) => (
          <li key={step.n} className={styles.step}>
            <span className={styles.stepNum}>{step.n}</span>
            <span className={styles.stepBody}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={styles.stepNote}>{step.note}</span>
            </span>
          </li>
        ))}
      </ol>

      <p className={styles.loopBack}>
        <span aria-hidden="true">&#8634;</span> And what you do next feeds the pattern the
        street reads tomorrow.
      </p>

      <p className={styles.privacy}>
        Individual merchant data stays private. Insights come from aggregated, anonymized
        patterns.
      </p>
    </SceneDialog>
  );
}
