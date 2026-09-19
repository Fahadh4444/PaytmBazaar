"use client";

import { useEffect, useState } from "react";

import type { AreaIntelligence } from "@/m2m-engine";

import { GrowthBars, PerformanceStrip, TrendLine } from "./Charts";
import { areaStateMessage, formatGrowth, formatRupees, growthTone, type LoadState } from "./present";
import styles from "./intelligence.module.css";

export type AreaScope = { kind: "city" } | { kind: "bazaar"; id: string };

export function areaEndpoint(scope: AreaScope): string {
  return scope.kind === "city" ? "/api/city/intelligence" : `/api/bazaars/${encodeURIComponent(scope.id)}/intelligence`;
}

/** What the panel is showing, so the dialog's Trace and Flow read the same response. */
export type AreaResult = { endpoint: string; state: LoadState; data: AreaIntelligence | null };

/**
 * What is happening across the city, or in one Bazaar: a headline, four
 * numbers and a few small charts, all from the backend. Nothing is computed
 * here.
 */
export default function AreaIntelligencePanel({
  scope,
  onResult,
}: {
  scope: AreaScope;
  onResult?: (result: AreaResult) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const url = areaEndpoint(scope);
  const key = `${url}#${attempt}`;
  const [result, setResult] = useState<{ key: string; state: LoadState; data: AreaIntelligence | null }>({
    key,
    state: "loading",
    data: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch(key.split("#")[0], { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const data = (await response.json()) as AreaIntelligence;
        const state = data.metrics.current.growth === null ? "empty" : "ready";
        setResult({ key, state, data });
        onResult?.({ endpoint: url, state, data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResult({ key, state: "error", data: null });
        onResult?.({ endpoint: url, state: "error", data: null });
      });
    return () => controller.abort();
  }, [key, url, onResult]);

  const state = result.key === key ? result.state : "loading";
  const data = result.key === key ? result.data : null;
  const kind = scope.kind;

  if (state === "loading") {
    return (
      <div className={styles.panel} aria-busy="true">
        <p className={styles.stateLine}>{areaStateMessage(kind, "loading")}</p>
        <div className={styles.skeletonHeadline} />
        <div className={styles.tiles}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonTile} />
          ))}
        </div>
        <div className={styles.skeletonChart} />
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className={styles.panel}>
        <div className={styles.stateBox}>
          <p style={{ margin: 0 }}>{areaStateMessage(kind, "error")}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => {
              setAttempt((n) => n + 1);
              onResult?.({ endpoint: url, state: "loading", data: null });
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { metrics, period } = data;
  const weekly = period.days === 7;
  const byBazaar = data.breakdowns.find((b) => b.dimension === "bazaar");
  const byCategory = data.breakdowns.find((b) => b.dimension === "category");
  const hiddenNote = (hidden: number) =>
    hidden > 0 ? `${hidden} shop type${hidden > 1 ? "s" : ""} hidden: too few shops to show without identifying them.` : null;

  return (
    <div className={styles.panel}>
      <section className={styles.headline} data-tone={growthTone(metrics.current.growth)}>
        <p className={styles.kicker}>{kind === "city" ? "City signal" : "Bazaar signal"}</p>
        <p className={styles.headlineText}>{state === "empty" ? areaStateMessage(kind, "empty") : data.headline}</p>
        {data.detail && <p className={styles.headlineDetail}>{data.detail}</p>}
        <p className={styles.period}>
          {period.current.from} → {period.current.to}, compared with the {weekly ? "week" : "period"} before
        </p>
      </section>

      <dl className={styles.tiles}>
        <div className={styles.tile}>
          <dt>Sales</dt>
          <dd>{formatRupees(metrics.current.gmv)}</dd>
        </div>
        <div className={styles.tile}>
          <dt>Orders</dt>
          <dd>{metrics.current.transactions.toLocaleString("en-IN")}</dd>
        </div>
        <div className={styles.tile}>
          <dt>Average bill</dt>
          <dd>{metrics.current.aov == null ? "—" : formatRupees(metrics.current.aov)}</dd>
        </div>
        <div className={styles.tile} data-tone={growthTone(metrics.current.growth)}>
          <dt>vs {weekly ? "last week" : "before"}</dt>
          <dd>{formatGrowth(metrics.current.growth)}</dd>
        </div>
      </dl>

      {data.impact && (
        <section className={styles.impact}>
          <p className={styles.kicker}>Bazaar impact</p>
          <div className={styles.impactRow}>
            <span>
              {data.name} <strong data-tone={growthTone(data.impact.bazaarGrowth)}>{formatGrowth(data.impact.bazaarGrowth)}</strong>
            </span>
            <span className={styles.vs}>vs</span>
            <span>
              {data.city} <strong data-tone={growthTone(data.impact.cityGrowth)}>{formatGrowth(data.impact.cityGrowth)}</strong>
            </span>
            <span className={styles.vs}>·</span>
            <span>
              Orders <strong data-tone={growthTone(data.impact.demandGrowth)}>{formatGrowth(data.impact.demandGrowth)}</strong>
            </span>
          </div>
        </section>
      )}

      <div className={styles.charts}>
        <TrendLine series={data.trend} caption={`Daily sales, last ${data.trend.length} days`} />
        {byBazaar && byBazaar.bars.length > 1 && (
          <GrowthBars bars={byBazaar.bars} caption="Growth by Bazaar this week" footnote={hiddenNote(byBazaar.hiddenGroups)} />
        )}
        {byCategory && byCategory.bars.length > 1 && (
          <GrowthBars bars={byCategory.bars} caption="Growth by type of shop" footnote={hiddenNote(byCategory.hiddenGroups)} />
        )}
        {data.performance && <PerformanceStrip counts={data.performance} />}
      </div>

      {data.weekPattern && (
        <p className={styles.contextLine}>
          <span className={styles.kicker}>Pattern</span>{" "}
          {data.weekPattern.weekendLiftPct > 0
            ? `Weekends bring ${data.weekPattern.weekendLiftPct}% more sales per day than weekdays.`
            : `Weekdays bring ${Math.abs(data.weekPattern.weekendLiftPct)}% more sales per day than weekends.`}
        </p>
      )}
    </div>
  );
}
