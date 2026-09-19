/**
 * What a dialog hands to its Trace and Flow: the exact state it is rendering,
 * never a copy fetched separately. When the dialog's data changes, the Trace
 * and Flow change with it.
 */

import type { AreaIntelligence } from "@/m2m-engine";
import type { ActionExecutionOutcome, MeasuredOutcome, MerchantBasics, MerchantExplanation } from "@/merchant-intelligence";

import type { LoadState } from "../present";
import { buildAreaTrace, buildMerchantTrace, type SceneContext, type TraceModel } from "./trace";

export interface LiveAction {
  approval: ActionExecutionOutcome | null;
  measured: MeasuredOutcome | null;
}

export type InspectSource =
  | { scope: "city" | "bazaar"; state: LoadState; data: AreaIntelligence | null }
  | {
      scope: "merchant";
      basics: MerchantBasics | null;
      explanation: MerchantExplanation | null;
      basicsLoading: boolean;
      explanationLoading: boolean;
      error: string | null;
      /** What the merchant did in the dialog since it loaded: the approval response and any measured result. */
      live?: LiveAction;
    };

export function buildTrace(source: InspectSource, title: string, scene?: SceneContext): TraceModel {
  return source.scope === "merchant"
    ? buildMerchantTrace({ ...source, title, scene })
    : buildAreaTrace({ scope: source.scope, title, state: source.state, data: source.data, scene });
}
