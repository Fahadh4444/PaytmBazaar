"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const MIN_SCALE = 1;
export const MAX_SCALE = 3.6;
const STEP = 1.35;
const DRAG_THRESHOLD = 4;

export type Transform = { scale: number; x: number; y: number };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Wheel zoom, drag pan and the button controls, shared by the city and the
 * Bazaar street. Both screens are the same thing: one plate with an SVG
 * interaction layer welded to it, so they share the transform rather than
 * keeping two copies of this in step.
 *
 * The world is sized to *cover* the viewport, so it never scales below 1 —
 * anything less pulls the plate's own edges into frame.
 */
export function useMapTransform(plateWidth: number, plateHeight: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [animating, setAnimating] = useState(true);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    moved: number;
    captured: boolean;
  } | null>(null);

  const cover = size.w && size.h ? Math.max(size.w / plateWidth, size.h / plateHeight) : 1;
  const worldW = plateWidth * cover;
  const worldH = plateHeight * cover;

  const clampTransform = useCallback(
    (next: Transform): Transform => ({
      scale: next.scale,
      x: clamp(next.x, size.w - worldW * next.scale, 0),
      y: clamp(next.y, size.h - worldH * next.scale, 0),
    }),
    [size.w, size.h, worldW, worldH],
  );

  // Measure the viewport and recentre the world in the same pass.
  useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });

      const fit = Math.max(width / plateWidth, height / plateHeight);
      const fullW = plateWidth * fit;
      const fullH = plateHeight * fit;

      setTransform((current) => ({
        scale: current.scale,
        x: (width - fullW * current.scale) / 2,
        y: (height - fullH * current.scale) / 2,
      }));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [plateWidth, plateHeight]);

  const zoomAround = useCallback(
    (factor: number, px: number, py: number, animate: boolean) => {
      setAnimating(animate);
      setTransform((current) => {
        const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
        const ratio = scale / current.scale;
        return clampTransform({
          scale,
          x: px - (px - current.x) * ratio,
          y: py - (py - current.y) * ratio,
        });
      });
    },
    [clampTransform],
  );

  // Wheel must be non-passive to stop the gesture reaching the page.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomAround(factor, event.clientX - rect.left, event.clientY - rect.top, false);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  const zoomFromCentre = (factor: number) => zoomAround(factor, size.w / 2, size.h / 2, true);

  /** Frame a point given in plate coordinates (0-1), for the fly-in. */
  const focusOn = useCallback(
    (nx: number, ny: number, scale: number) => {
      setAnimating(false);
      setTransform(
        clampTransform({
          scale,
          x: size.w / 2 - nx * worldW * scale,
          y: size.h / 2 - ny * worldH * scale,
        }),
      );
    },
    [clampTransform, size.w, size.h, worldW, worldH],
  );

  const pointerHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // Capture is deferred until the pointer actually travels. Capturing on
      // press retargets the click to the viewport, which swallows clicks on
      // anything inside the world — the merchant buildings, for instance.
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: 0,
        captured: false,
      };
      setDragging(true);
      setAnimating(false);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;

      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      state.moved += Math.abs(dx) + Math.abs(dy);
      state.x = event.clientX;
      state.y = event.clientY;

      if (!state.captured && state.moved > DRAG_THRESHOLD) {
        state.captured = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      setTransform((current) =>
        clampTransform({ ...current, x: current.x + dx, y: current.y + dy }),
      );
    },
    onPointerUp: (event: React.PointerEvent) => {
      const state = drag.current;
      if (!state || state.id !== event.pointerId) return;
      // A drag that travelled must not also read as a click on a building.
      if (state.moved > DRAG_THRESHOLD) {
        event.preventDefault();
        event.stopPropagation();
      }
      drag.current = null;
      setDragging(false);
    },
    onPointerCancel: (event: React.PointerEvent) => {
      drag.current = null;
      setDragging(false);
      void event;
    },
  };

  return {
    viewportRef,
    size,
    worldW,
    worldH,
    transform,
    animating,
    dragging,
    pointerHandlers,
    focusOn,
    zoomIn: () => zoomFromCentre(STEP),
    zoomOut: () => zoomFromCentre(1 / STEP),
    canZoomIn: transform.scale < MAX_SCALE - 0.001,
    canZoomOut: transform.scale > MIN_SCALE + 0.001,
  };
}
