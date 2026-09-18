"use client";

import SceneDialog from "@/components/bazaar/SceneDialog";
import AreaIntelligencePanel, { type AreaScope } from "@/components/intelligence/AreaIntelligencePanel";

type AnalysisDialogProps = {
  /** What is being analysed: "Bazaar Analysis", "City Analysis". */
  eyebrow: string;
  title: string;
  scope: AreaScope;
  open: boolean;
  onClose: () => void;
};

/**
 * The window the M2M engine reports into, for a single Bazaar or for the
 * whole city. Everything shown comes from the intelligence API; the panel is
 * only mounted while open, so it loads fresh each time.
 */
export default function AnalysisDialog({ eyebrow, title, scope, open, onClose }: AnalysisDialogProps) {
  return (
    <SceneDialog open={open} onClose={onClose} eyebrow={eyebrow} title={title} workspace>
      {open && <AreaIntelligencePanel scope={scope} />}
    </SceneDialog>
  );
}
