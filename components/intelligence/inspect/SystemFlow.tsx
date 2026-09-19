"use client";

import { useId, useState } from "react";

import { FLOW_LOOP, FLOW_STAGES, flowState, type FlowStageId, type FlowStatus } from "./flow";
import type { InspectSource } from "./source";
import styles from "./inspect.module.css";

const MARK: Record<FlowStatus, string> = { ran: "✓", running: "●", waiting: "○", not_used: "–", unavailable: "!" };
const STATUS: Record<FlowStatus, string> = {
  ran: "Ran",
  running: "Running",
  waiting: "Waiting",
  not_used: "Not used",
  unavailable: "Unavailable",
};
const NOUN = { city: "city", bazaar: "Bazaar", merchant: "merchant" } as const;

type SystemFlowProps = {
  source: InspectSource;
  onOpenTrace: () => void;
};

/**
 * How Paytm Bazaar is built, with each stage marked by what it did for the
 * analysis underneath. Select a stage to read what it uses, what it does and
 * what it never does.
 */
export default function SystemFlow({ source, onOpenTrace }: SystemFlowProps) {
  const state = flowState(source);
  const [selected, setSelected] = useState<FlowStageId | null>("m2m");
  const base = useId();
  const noun = NOUN[source.scope];

  return (
    <div className={styles.inspect}>
      <p className={styles.lede}>
        How Paytm Bazaar is built. Each stage is marked with what it did for this {noun}.
      </p>

      <ul className={styles.legend} aria-label="Legend">
        {(Object.keys(STATUS) as FlowStatus[]).map((status) => (
          <li key={status} data-status={status}>
            <span aria-hidden="true">{MARK[status]}</span> {STATUS[status]}
          </li>
        ))}
      </ul>

      <ol className={styles.flow}>
        {FLOW_STAGES.map((stage) => {
          const now = state[stage.id];
          const expanded = selected === stage.id;
          const panel = `${base}-${stage.id}`;
          return (
            <li key={stage.id} className={styles.flowItem} data-status={now.status} data-selected={expanded || undefined}>
              <button
                type="button"
                className={styles.node}
                aria-expanded={expanded}
                aria-controls={panel}
                onClick={() => setSelected(expanded ? null : stage.id)}
              >
                <span className={styles.nodeMark} aria-hidden="true">
                  {MARK[now.status]}
                </span>
                <span className={styles.nodeBody}>
                  <span className={styles.nodeName}>
                    {stage.name}
                    <span className={styles.nodeKind}>{stage.kind}</span>
                  </span>
                  <span className={styles.nodeTagline}>{stage.tagline}</span>
                  <span className={styles.nodeState}>
                    <span className={styles.srOnly}>{STATUS[now.status]}: </span>
                    {now.detail}
                  </span>
                </span>
              </button>

              {expanded && (
                <div id={panel} className={styles.nodeDetail}>
                  <div>
                    <p className={styles.detailLabel}>Uses</p>
                    <ul>{stage.uses.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <p className={styles.detailLabel}>Does</p>
                    <ul>{stage.does.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <p className={styles.detailLabel}>Never</p>
                    <ul>{stage.doesNot.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className={styles.loop}>
        <span aria-hidden="true">↺</span> {FLOW_LOOP}
      </p>

      <p className={styles.switch}>
        This is how it is built.{" "}
        <button type="button" onClick={onOpenTrace}>
          See what it did for this {noun} →
        </button>
      </p>
    </div>
  );
}
