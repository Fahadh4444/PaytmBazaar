"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AnalysisDialog from "@/components/city/AnalysisDialog";
import CityHeader from "@/components/city/CityHeader";
import MapControls from "@/components/city/MapControls";
import { DEFAULT_CONTEXT, daylightPhase, type CityContext } from "@/components/city/context";
import { useMapTransform } from "@/components/city/useMapTransform";
import type { Bazaar } from "@/data/bazaars";
import { shops, type Shop } from "@/data/shops";

import MerchantDialog from "./MerchantDialog";
import MerchantLayer, { PLATE_H, PLATE_W } from "./MerchantLayer";
import styles from "./bazaar-screen.module.css";

const PLATE = "/bazaar/bazaar-plate.webp?v=1";
/** Matches the climb back out to the city. */
const DEPARTURE_MS = 1500;
const REDUCED_MS = 280;

export default function BazaarScreen({ bazaar }: { bazaar: Bazaar }) {
  const router = useRouter();
  const {
    viewportRef,
    worldW,
    worldH,
    transform,
    animating,
    dragging,
    pointerHandlers,
    zoomIn,
    zoomOut,
    canZoomIn,
    canZoomOut,
  } = useMapTransform(PLATE_W, PLATE_H);

  const [context, setContext] = useState<CityContext>(DEFAULT_CONTEXT);
  const [openShop, setOpenShop] = useState<Shop | null>(null);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [plateFailed, setPlateFailed] = useState(false);
  const exitTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    router.prefetch("/city");
  }, [router]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  // Start preparing every merchant's numbers and AI summary in the background,
  // so opening a shop is near-instant. Fire and forget.
  useEffect(() => {
    fetch(`/api/bazaars/${encodeURIComponent(bazaar.id)}/warm`, { method: "POST" }).catch(() => {});
  }, [bazaar.id]);

  /** Pull up out of the street, let the clouds close, then back to the city. */
  const backToCity = () => {
    if (leaving) return;
    setLeaving(true);
    setOpenShop(null);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    exitTimer.current = window.setTimeout(
      () => router.push("/city"),
      reduced ? REDUCED_MS : DEPARTURE_MS,
    );
  };

  return (
    <main
      className={styles.screen}
      data-phase={daylightPhase(context.hour)}
      data-weather={context.weather}
      data-leaving={leaving || undefined}
      data-dialog={openShop ? "open" : undefined}
    >
      <div
        className={styles.viewport}
        ref={viewportRef}
        data-dragging={dragging}
        {...pointerHandlers}
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
          {!plateFailed && (
            /* eslint-disable-next-line @next/next/no-img-element -- pre-sized
               plate, served as-is so the hit areas stay aligned with it. */
            <img
              className={styles.plate}
              src={PLATE}
              alt=""
              draggable={false}
              onError={() => setPlateFailed(true)}
            />
          )}
          <div className={styles.tint} />
          <MerchantLayer shops={shops} onOpen={setOpenShop} />
        </div>
      </div>

      <CityHeader
        context={context}
        onContextChange={setContext}
        onExit={backToCity}
        backLabel="Back to City"
        backHref="/city"
      />

      <button type="button" className={styles.pulseButton} onClick={() => setPulseOpen(true)}>
        <span className={styles.pulseDot} aria-hidden="true" />
        {bazaar.name} pulse
      </button>

      <MapControls
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        canZoomIn={canZoomIn}
        canZoomOut={canZoomOut}
      />

      <div className={styles.departure} aria-hidden="true">
        <div className={`${styles.departCloud} ${styles.departLeft}`} />
        <div className={`${styles.departCloud} ${styles.departRight}`} />
        <div className={styles.departWash} />
      </div>

      <AnalysisDialog
        eyebrow="Bazaar Analysis"
        title={bazaar.name}
        scope={{ kind: "bazaar", id: bazaar.id }}
        open={pulseOpen}
        onClose={() => setPulseOpen(false)}
        sceneContext={context}
      />

      <MerchantDialog
        key={openShop?.id ?? "closed"}
        shop={openShop}
        bazaarId={bazaar.id}
        bazaarName={`${bazaar.name} Bazaar`}
        open={openShop !== null}
        onClose={() => setOpenShop(null)}
        sceneContext={context}
      />
    </main>
  );
}
