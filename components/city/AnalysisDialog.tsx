"use client";

import { useState } from "react";

import SceneDialog from "@/components/bazaar/SceneDialog";
import AreaIntelligencePanel, {
  areaEndpoint,
  type AreaResult,
  type AreaScope,
} from "@/components/intelligence/AreaIntelligencePanel";
import DialogTools from "@/components/intelligence/inspect/DialogTools";
import type { SceneContext } from "@/components/intelligence/inspect/trace";

type AnalysisDialogProps = {
  /** What is being analysed: "Bazaar Analysis", "City Analysis". */
  eyebrow: string;
  title: string;
  scope: AreaScope;
  open: boolean;
  onClose: () => void;
  /** The screen's Day / Time / Weather / Event controls, shown in the Trace. */
  sceneContext?: SceneContext;
};

/**
 * The window the M2M engine reports into, for a single Bazaar or for the
 * whole city. Everything shown comes from the intelligence API; the panel is
 * only mounted while open, so it loads fresh each time. The Trace and Flow
 * read the panel's own result, never a second request.
 */
export default function AnalysisDialog({ eyebrow, title, scope, open, onClose, sceneContext }: AnalysisDialogProps) {
  const [result, setResult] = useState<AreaResult | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening loads afresh: forget the last opening's result on close.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setResult(null);
  }
  // A result for another scope is not this one's.
  const current = open && result?.endpoint === areaEndpoint(scope) ? result : null;

  return (
    <SceneDialog
      open={open}
      onClose={onClose}
      eyebrow={eyebrow}
      title={title}
      workspace
      tools={
        open ? (
          <DialogTools
            subject={title}
            scene={sceneContext}
            source={{ scope: scope.kind, state: current?.state ?? "loading", data: current?.data ?? null }}
          />
        ) : null
      }
    >
      {open && <AreaIntelligencePanel scope={scope} onResult={setResult} />}
    </SceneDialog>
  );
}
