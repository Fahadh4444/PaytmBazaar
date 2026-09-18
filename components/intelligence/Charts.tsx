"use client";

import type { GrowthBar, PerformanceCount, TrendPoint } from "@/m2m-engine";

import { BAND_LABEL, barGeometry, formatGrowth, formatRupees, lineGeometry, shortDate } from "./present";
import styles from "./intelligence.module.css";

const W = 320;
const H = 96;

/** How sales moved day by day. One question: is business rising or falling? */
export function TrendLine({ series, caption }: { series: TrendPoint[]; caption: string }) {
  const geometry = lineGeometry(series, W, H);
  if (!geometry) return <p className={styles.note}>Not enough days of data to draw a trend yet.</p>;
  const first = series[0];
  const last = series.at(-1)!;
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>{caption}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.trend} role="img" aria-label={`${caption}: from ${formatRupees(first.gmv)} on ${shortDate(first.date)} to ${formatRupees(last.gmv)} on ${shortDate(last.date)}`}>
        <path d={geometry.area} className={styles.trendArea} />
        <path d={geometry.path} className={styles.trendLine} />
        <circle cx={geometry.points.at(-1)!.x} cy={geometry.points.at(-1)!.y} r={3.5} className={styles.trendDot} />
      </svg>
      <div className={styles.axis}>
        <span>{shortDate(first.date)}</span>
        <span>
          {formatRupees(geometry.min)} – {formatRupees(geometry.max)} a day
        </span>
        <span>{shortDate(last.date)}</span>
      </div>
    </figure>
  );
}

/** Growth side by side. One question: who is moving faster? */
export function GrowthBars({
  bars,
  caption,
  highlight,
  footnote,
}: {
  bars: Pick<GrowthBar, "label" | "growth">[];
  caption: string;
  highlight?: string;
  footnote?: string | null;
}) {
  const rows = barGeometry(bars);
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>{caption}</figcaption>
      <ul className={styles.bars}>
        {rows.map((row) => (
          <li key={row.label} className={styles.barRow} data-highlight={row.label === highlight || undefined}>
            <span className={styles.barLabel}>{row.label}</span>
            <span className={styles.barTrack}>
              <span
                className={styles.barFill}
                data-tone={row.tone}
                style={{ left: `${row.start * 100}%`, width: `${Math.max(row.width * 100, row.growth === null ? 0 : 1)}%` }}
              />
            </span>
            <span className={styles.barValue} data-tone={row.tone}>
              {formatGrowth(row.growth)}
            </span>
          </li>
        ))}
      </ul>
      {footnote && <p className={styles.note}>{footnote}</p>}
    </figure>
  );
}

/** How many shops are growing or slowing. Counts only: no shop is named. */
export function PerformanceStrip({ counts }: { counts: PerformanceCount[] }) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) return null;
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>How the shops here are doing</figcaption>
      <div className={styles.strip} role="img" aria-label={counts.map((c) => `${c.count} ${BAND_LABEL[c.band]}`).join(", ")}>
        {counts
          .filter((c) => c.count > 0)
          .map((c) => (
            <span key={c.band} className={styles.stripPart} data-band={c.band} style={{ flexGrow: c.count }}>
              {c.count}
            </span>
          ))}
      </div>
      <ul className={styles.legend}>
        {counts.map((c) => (
          <li key={c.band} data-band={c.band}>
            {BAND_LABEL[c.band]} · {c.count}
          </li>
        ))}
      </ul>
    </figure>
  );
}
