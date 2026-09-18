"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./city.module.css";

export type ControlOption = { value: string; label: string };

type ContextControlProps = {
  label: string;
  value: string;
  options: readonly ControlOption[];
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
};

/**
 * One floating environment control. A listbox rather than a native select, so
 * it can carry the city's visual language, with the keyboard behaviour the
 * native element would have given us written out by hand.
 */
export default function ContextControl({
  label,
  value,
  options,
  icon,
  open,
  onOpenChange,
  onChange,
}: ContextControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Nothing is "focused" until the pointer or the keyboard moves; until then
  // the selected option is, so this stays derived rather than synced.
  const [focusedOverride, setFocusedOverride] = useState<number | null>(null);
  const focusedIndex = focusedOverride ?? selectedIndex;

  const setOpen = (next: boolean) => {
    setFocusedOverride(null);
    onOpenChange(next);
  };

  // The parent rebuilds onOpenChange every render; keeping it behind a ref lets
  // the outside-click listener depend on `open` alone instead of resubscribing.
  const latestOpenChange = useRef(onOpenChange);
  useEffect(() => {
    latestOpenChange.current = onOpenChange;
  });

  // Keep the focused option in view when the list is long (24 hours).
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, focusedIndex]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setFocusedOverride(null);
      latestOpenChange.current(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const commit = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }

    if (!open) {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedOverride((i) => ((i ?? selectedIndex) + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedOverride((i) => ((i ?? selectedIndex) - 1 + options.length) % options.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      setFocusedOverride(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setFocusedOverride(options.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(focusedIndex);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  const current = options.find((option) => option.value === value);

  return (
    <div className={styles.control} ref={rootRef}>
      <button
        type="button"
        className={styles.controlButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? value}`}
        onClick={() => setOpen(!open)}
        onKeyDown={onKeyDown}
      >
        <span className={styles.controlIcon} aria-hidden="true">
          {icon}
        </span>
        <span className={styles.controlText}>
          <span className={styles.controlLabel}>{label}</span>
          <span className={styles.controlValue}>{current?.label ?? value}</span>
        </span>
        <svg
          className={styles.controlChevron}
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <ul className={styles.menu} role="listbox" aria-label={label} ref={listRef}>
          {options.map((option, index) => (
            <li
              key={option.value}
              className={styles.option}
              role="option"
              aria-selected={option.value === value}
              data-focused={index === focusedIndex}
              onMouseEnter={() => setFocusedOverride(index)}
              onClick={() => commit(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
