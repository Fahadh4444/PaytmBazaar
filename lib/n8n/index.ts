/**
 * n8n boundary — action and workflow orchestration.
 *
 * n8n executes approved merchant actions (notifications, campaigns, follow-ups)
 * after intelligence has run. It does not compute intelligence: cohorting,
 * comparison and pattern detection stay in the M2M engine.
 *
 * No workflow is wired up yet — there is no approved action to execute. The
 * first action slice adds the trigger call here.
 *
 * n8n is optional: if it is unavailable the insight still exists and is still
 * shown; only the action execution fails, and it must fail on its own.
 */

export function isN8nConfigured(): boolean {
  return Boolean(process.env.N8N_BASE_URL);
}
