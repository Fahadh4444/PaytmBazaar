/**
 * How much of Bazaar is switched on.
 *
 *   deterministic (default)  Supabase, the Data Adapter, M2M and Relevance
 *                            only. Wording comes from the fact table by fixed
 *                            rules; no LLM, no Cognee, no n8n, no voice.
 *   full                     Every configured integration is used as well.
 *
 * One environment variable decides:
 *
 *   BAZAAR_MODE=full
 *
 * Deterministic is the default so a deployment cannot quietly start calling a
 * paid provider because a key happens to be present in the environment. To go
 * back to the full pipeline, set `BAZAAR_MODE=full` and provide the keys.
 *
 * Nothing about the *numbers* changes between modes: every figure Bazaar shows
 * is computed by the M2M and Relevance engines in both. The mode only decides
 * who does the wording, whether history is remembered, and whether an approved
 * action leaves the system.
 */

export type BazaarMode = "deterministic" | "full";

export function bazaarMode(): BazaarMode {
  return process.env.BAZAAR_MODE === "full" ? "full" : "deterministic";
}

export function isDeterministic(): boolean {
  return bazaarMode() === "deterministic";
}

/**
 * The mode as the browser sees it, for labels in the Trace and System Flow.
 *
 * `NEXT_PUBLIC_BAZAAR_MODE` is inlined at build time, so set it alongside
 * `BAZAAR_MODE`. If it is forgotten the labels stay deterministic, which
 * understates what is switched on rather than overstating it. Anything the
 * server actually reports (`services.mode`) is preferred over this.
 */
export function publicBazaarMode(): BazaarMode {
  return process.env.NEXT_PUBLIC_BAZAAR_MODE === "full" ? "full" : "deterministic";
}
