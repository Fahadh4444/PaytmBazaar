"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { bazaars, type Bazaar } from "@/data/bazaars";

import BazaarActions, { type ActionsPlacement } from "./BazaarActions";
import AnalysisDialog from "./AnalysisDialog";
import BazaarRegions from "./BazaarRegions";
import CityRock from "./CityRock";
import CityEnvironment, { PLATE_H, PLATE_W } from "./CityEnvironment";
import CityHeader from "./CityHeader";
import MapControls from "./MapControls";
import { DEFAULT_CONTEXT, daylightPhase, type CityContext } from "./context";
import styles from "./city.module.css";

/** Mirrors the landing descent, played backwards. */
const DEPARTURE_MS = 1500;
/** Flying down into a Bazaar. */
const DIVE_MS = 1500;
const DIVE_SCALE = 3.2;
const REDUCED_MS = 280;

const MIN_SCALE = 1;
const MAX_SCALE = 3.6;
const STEP = 1.35;
/** Grace period so the pointer can travel from a Bazaar to its actions. */
const HOVER_GRACE_MS = 220;
const DRAG_THRESHOLD = 4;

type Transform = { scale: number; x: number; y: number };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function CityScreen() {
  const router = useRouter();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [context, setContext] = useState<CityContext>(DEFAULT_CONTEXT);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const [animating, setAnimating] = useState(true);
  const [dragging, setDragging] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<ActionsPlacement | null>(null);
  const [analyzing, setAnalyzing] = useState<Bazaar | null>(null);
  const [cityAnalysis, setCityAnalysis] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [diving, setDiving] = useState(false);
  const exitTimer = useRef<number | undefined>(undefined);

  const activeEl = useRef<SVGGElement | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    moved: number;
    captured: boolean;
  } | null>(null);

  // The world is the plate scaled to cover the viewport; overlays share its box,
  // so region coordinates stay welded to the buildings under them.
  const cover = size.w && size.h ? Math.max(size.w / PLATE_W, size.h / PLATE_H) : 1;
  const worldW = PLATE_W * cover;
  const worldH = PLATE_H * cover;

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

      const fit = Math.max(width / PLATE_W, height / PLATE_H);
      const fullW = PLATE_W * fit;
      const fullH = PLATE_H * fit;

      setTransform((current) => ({
        scale: current.scale,
        x: (width - fullW * current.scale) / 2,
        y: (height - fullH * current.scale) / 2,
      }));
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  const zoomFromCentre = (factor: number) =>
    zoomAround(factor, size.w / 2, size.h / 2, true);

  /** Hang the actions just above the block, kept inside the viewport. */
  const positionActions = useCallback(() => {
    const element = activeEl.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    setPlacement({
      left: clamp(rect.left + rect.width / 2, 150, window.innerWidth - 150),
      top: clamp(rect.top - 8, 150, window.innerHeight - 30),
    });
  }, []);

  useLayoutEffect(() => {
    if (activeId) positionActions();
  }, [activeId, transform, positionActions]);

  const openActions = (id: string, element: SVGGElement) => {
    window.clearTimeout(hoverTimer.current);
    activeEl.current = element;
    setActiveId(id);
  };

  const scheduleClose = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      setActiveId(null);
      activeEl.current = null;
    }, HOVER_GRACE_MS);
  };

  const keepOpen = () => window.clearTimeout(hoverTimer.current);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // Prefetch the landing so the climb lands on it without a pause.
  useEffect(() => {
    router.prefetch("/");
  }, [router]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  /** Lift away from the city, let the clouds close over, then go back. */
  const exitBazaar = () => {
    if (leaving) return;
    setLeaving(true);
    setActiveId(null);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = window.setTimeout(
      () => router.push("/"),
      reduced ? REDUCED_MS : DEPARTURE_MS,
    );
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // Capture is deferred until the pointer travels; capturing on press
    // retargets the click away from anything inside the world.
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: 0,
      captured: false,
    };
    setDragging(true);
    setAnimating(false);
  };

  const onPointerMove = (event: React.PointerEvent) => {
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

    setTransform((current) => clampTransform({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const endDrag = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    // A drag that travelled must not also read as a click on a Bazaar.
    if (state.moved > DRAG_THRESHOLD) {
      event.preventDefault();
      event.stopPropagation();
    }
    drag.current = null;
    setDragging(false);
  };

  const activeBazaar = bazaars.find((bazaar) => bazaar.id === activeId) ?? null;

  /** Fly down toward the Bazaar, let the clouds close over, then land in it. */
  const zoomIntoBazaar = (bazaar: Bazaar) => {
    if (diving || leaving) return;
    setActiveId(null);
    setDiving(true);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!reduced) {
      // Frame the Bazaar as the camera drops toward it.
      const xs = bazaar.outline.map(([x]) => x);
      const ys = bazaar.outline.map(([, y]) => y);
      const nx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const ny = (Math.min(...ys) + Math.max(...ys)) / 2;

      setAnimating(false);
      setTransform(
        clampTransform({
          scale: DIVE_SCALE,
          x: size.w / 2 - nx * worldW * DIVE_SCALE,
          y: size.h / 2 - ny * worldH * DIVE_SCALE,
        }),
      );
    }

    exitTimer.current = window.setTimeout(
      () => router.push(`/bazaar/${bazaar.id}`),
      reduced ? REDUCED_MS : DIVE_MS,
    );
  };

  const analyzeBazaar = (bazaar: Bazaar) => {
    setActiveId(null);
    setAnalyzing(bazaar);
  };

  return (
    <main
      className={styles.screen}
      data-phase={daylightPhase(context.hour)}
      data-weather={context.weather}
      data-event={context.event}
      data-day={context.day}
      data-leaving={leaving || undefined}
      data-diving={diving || undefined}
    >
      <div
        className={styles.viewport}
        ref={viewportRef}
        data-dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className={styles.world}
          data-animate={animating && !dragging}
          style={{
            width: worldW,
            height: worldH,
            transform: `translate3d(${transform.x}px, ${transform.y}px, 0) scale(${transform.scale})`,
          }}
        >
          <CityEnvironment />
          <BazaarRegions
            bazaars={bazaars}
            activeId={activeId}
            onEnter={openActions}
            onLeave={scheduleClose}
          />
          <CityRock onOpen={() => setCityAnalysis(true)} />
        </div>
      </div>

      <CityHeader context={context} onContextChange={setContext} onExit={exitBazaar} />

      <MapControls
        onZoomIn={() => zoomFromCentre(STEP)}
        onZoomOut={() => zoomFromCentre(1 / STEP)}
        canZoomIn={transform.scale < MAX_SCALE - 0.001}
        canZoomOut={transform.scale > MIN_SCALE + 0.001}
      />

      {activeBazaar && placement && (
        <BazaarActions
          bazaar={activeBazaar}
          placement={placement}
          onAnalyze={() => analyzeBazaar(activeBazaar)}
          onZoomIn={() => zoomIntoBazaar(activeBazaar)}
          onMouseEnter={keepOpen}
          onMouseLeave={scheduleClose}
        />
      )}

      <div className={styles.departure} aria-hidden="true">
        <div className={`${styles.departCloud} ${styles.departLeft}`} />
        <div className={`${styles.departCloud} ${styles.departRight}`} />
        <div className={styles.departWash} />
      </div>

      <AnalysisDialog
        eyebrow="Bazaar Analysis"
        title={analyzing ? analyzing.name : "Bazaar"}
        scope={{ kind: "bazaar", id: analyzing?.id ?? "" }}
        open={analyzing !== null}
        onClose={() => setAnalyzing(null)}
        sceneContext={context}
      />

      <AnalysisDialog
        eyebrow="City Analysis"
        title="Bengaluru"
        scope={{ kind: "city" }}
        open={cityAnalysis}
        onClose={() => setCityAnalysis(false)}
        sceneContext={context}
      />
    </main>
  );
}
