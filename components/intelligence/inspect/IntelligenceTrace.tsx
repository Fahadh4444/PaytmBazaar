"use client";

import { useId } from "react";

import { buildTrace, type InspectSource } from "./source";
import type { SceneContext, StageStatus, TraceRow } from "./trace";
import styles from "./inspect.module.css";

const MARK: Record<StageStatus, string> = { done: "✓", pending: "●", not_used: "–", unavailable: "!" };
const STATUS: Record<StageStatus, string> = {
  done: "Done",
  pending: "Running",
  not_used: "Not used",
  unavailable: "Unavailable",
};
const NOUN = { city: "city", bazaar: "Bazaar", merchant: "merchant" } as const;

function Rows({ rows }: { rows: TraceRow[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`} className={styles.row}>
          <dt>{row.label}</dt>
          <dd data-tone={row.tone}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type IntelligenceTraceProps = {
  source: InspectSource;
  subject: string;
  scene?: SceneContext;
  onOpenFlow: () => void;
};

/**
 * What the system actually did for the City, Bazaar or merchant underneath:
 * each stage's conclusion, the figures behind it, and how the key figures
 * were derived. Rebuilt from the dialog's own state on every render, so it
 * always matches what the dialog shows.
 */
export default function IntelligenceTrace({ source, subject, scene, onOpenFlow }: IntelligenceTraceProps) {
  const model = buildTrace(source, subject, scene);
  const base = useId();
  const anchor = (id: string) => `${base}-${id}`;
  const noun = NOUN[model.scope];

  const jump = (id: string) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(anchor(id))?.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className={styles.inspect}>
      <p className={styles.lede}>
        What the system actually did for this {noun}. Every figure comes from the same analysis the dialog shows.
      </p>
      {model.window && <p className={styles.stamp}>{model.window}</p>}
      {model.unavailable && (
        <p className={styles.unavailable} role="status">
          {model.unavailable}
        </p>
      )}

      <ol className={styles.progress} aria-label="Stages">
        {model.stages.map((stage) => (
          <li key={stage.id} data-status={stage.status}>
            <button type="button" onClick={() => jump(stage.id)}>
              <span aria-hidden="true">{MARK[stage.status]}</span> {stage.label}
              <span className={styles.srOnly}>: {STATUS[stage.status]}</span>
            </button>
          </li>
        ))}
      </ol>

      <ol className={styles.stages}>
        {model.stages.map((stage, index) => (
          // Keyed by status too, so a stage that just completed fades in again.
          <li
            key={`${stage.id}:${stage.status}`}
            id={anchor(stage.id)}
            className={styles.stage}
            data-status={stage.status}
            style={{ "--i": Math.min(index, 8) } as React.CSSProperties}
          >
            <div className={styles.stageHead}>
              <span className={styles.dot} aria-hidden="true" />
              <h3 className={styles.stageLabel}>{stage.label}</h3>
              <span className={styles.status}>{STATUS[stage.status]}</span>
            </div>
            <p className={styles.summary}>{stage.summary}</p>

            {stage.rows && stage.rows.length > 0 && <Rows rows={stage.rows} />}

            {stage.calcs?.map((calc) => (
              <div key={calc.label} className={styles.calc}>
                <p className={styles.calcLabel}>{calc.label}</p>
                <p className={styles.formula}>{calc.formula}</p>
                <p className={styles.working}>{calc.working}</p>
                <p className={styles.result} data-tone={calc.tone}>
                  = {calc.result}
                </p>
              </div>
            ))}

            {stage.groups?.map((group, i) => (
              <section key={`${group.title}-${i}`} className={styles.group}>
                <p className={styles.groupTitle}>
                  {group.title}
                  {group.badge && <span className={styles.badge}>{group.badge}</span>}
                </p>
                {group.rows.length > 0 && <Rows rows={group.rows} />}
                {group.note && <p className={styles.note}>{group.note}</p>}
              </section>
            ))}

            {stage.note && <p className={styles.note}>{stage.note}</p>}
          </li>
        ))}
      </ol>

      <p className={styles.switch}>
        This is what ran for this {noun}.{" "}
        <button type="button" onClick={onOpenFlow}>
          See how the system is built →
        </button>
      </p>
    </div>
  );
}
