"use client";

import Link from "next/link";
import { useState } from "react";

import ContextControl, { type ControlOption } from "./ContextControl";
import { DAYS, EVENTS, HOURS, WEATHERS, formatHour, type CityContext } from "./context";
import styles from "./city.module.css";

type CityHeaderProps = {
  context: CityContext;
  onContextChange: (next: CityContext) => void;
  onExit: () => void;
};

const toOptions = (values: readonly string[]): ControlOption[] =>
  values.map((value) => ({ value, label: value }));

const HOUR_OPTIONS: ControlOption[] = HOURS.map((hour) => ({
  value: String(hour),
  label: formatHour(hour),
}));

const DAY_OPTIONS = toOptions(DAYS);
const WEATHER_OPTIONS = toOptions(WEATHERS);
const EVENT_OPTIONS = toOptions(EVENTS);

export default function CityHeader({ context, onContextChange, onExit }: CityHeaderProps) {
  // Only one menu open at a time.
  const [openControl, setOpenControl] = useState<string | null>(null);
  const opener = (id: string) => (open: boolean) => setOpenControl(open ? id : null);

  return (
    <>
      {/* Stays a real link, so middle-click and the keyboard still work; a
          plain click plays the climb out first. */}
      <Link
        className={styles.exit}
        href="/"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onExit();
        }}
      >
        <span className={styles.exitArrow} aria-hidden="true">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="m11 6-6 6 6 6" />
          </svg>
        </span>
        Exit Paytm Bazaar
      </Link>

      <div className={styles.brand}>
        <p className={styles.brandName}>
          pay<em>tm</em> Bazaar
        </p>
        <p className={styles.brandTag}>Explore. Discover. Grow Together.</p>
        <div className={styles.brandRule} />
      </div>

      <div className={styles.controls}>
        <ContextControl
          label="Time"
          value={String(context.hour)}
          options={HOUR_OPTIONS}
          open={openControl === "time"}
          onOpenChange={opener("time")}
          onChange={(value) => onContextChange({ ...context, hour: Number(value) })}
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="#0b57d0" strokeWidth="1.8" />
              <path
                d="M12 7.6V12l3 1.8"
                stroke="#0b57d0"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <ContextControl
          label="Day"
          value={context.day}
          options={DAY_OPTIONS}
          open={openControl === "day"}
          onOpenChange={opener("day")}
          onChange={(value) =>
            onContextChange({ ...context, day: value as CityContext["day"] })
          }
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect
                x="3.5"
                y="5"
                width="17"
                height="15"
                rx="3"
                stroke="#0b57d0"
                strokeWidth="1.8"
              />
              <path
                d="M3.5 9.6h17M8.4 3.4v3.2M15.6 3.4v3.2"
                stroke="#0b57d0"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <ContextControl
          label="Weather"
          value={context.weather}
          options={WEATHER_OPTIONS}
          open={openControl === "weather"}
          onOpenChange={opener("weather")}
          onChange={(value) =>
            onContextChange({ ...context, weather: value as CityContext["weather"] })
          }
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="4.2" fill="#f5a623" />
              <path
                d="M12 2.6v2.4M12 19v2.4M2.6 12H5M19 12h2.4M5.4 5.4 7 7M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"
                stroke="#f5a623"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          }
        />

        <ContextControl
          label="Events"
          value={context.event}
          options={EVENT_OPTIONS}
          open={openControl === "events"}
          onOpenChange={opener("events")}
          onChange={(value) =>
            onContextChange({ ...context, event: value as CityContext["event"] })
          }
          icon={
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m12 3.6 2.6 5.5 5.9.8-4.3 4.2 1.05 5.9L12 17.2l-5.25 2.8L7.8 14.1 3.5 9.9l5.9-.8z"
                fill="#f5a623"
              />
            </svg>
          }
        />
      </div>
    </>
  );
}
