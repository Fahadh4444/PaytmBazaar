/**
 * The executor used in deterministic mode: it records an approved action
 * inside Bazaar and nothing leaves the system.
 *
 * Bazaar still runs the whole approval path — the merchant approves, the
 * action is stored with a reference and a time, and the outcome is measured
 * later by M2M against the days that follow. The only missing step is the
 * external one: no webhook is called, no email is sent.
 *
 * It says so plainly in `detail`, which the UI and the Intelligence Trace
 * both show, so nobody can mistake a recorded action for a delivered one.
 * Swap it back for the n8n executor with `BAZAAR_MODE=full` (see lib/mode.ts).
 */

import type { ActionExecutionRequest, ActionExecutionResult, ActionExecutor } from "./types";

export const RECORDED_DETAIL = "Recorded in Bazaar. Nothing was sent outside the demo.";

export const recordedExecutor: ActionExecutor = {
  name: "bazaar-recorded",

  /** Always available: recording an approval needs nothing but Bazaar itself. */
  isConfigured() {
    return true;
  },

  async execute(request: ActionExecutionRequest): Promise<ActionExecutionResult> {
    return {
      status: "executed",
      reference: `recorded-${request.actionId}`,
      detail: RECORDED_DETAIL,
      finishedAt: new Date().toISOString(),
    };
  },
};
