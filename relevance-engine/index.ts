/**
 * Paytm Bazaar Relevance Engine.
 *
 * Responsibility: decide which of the M2M engine's findings matter to this
 * merchant now, rank them, and say why, so the future Cognee/LLM layer
 * receives a few important signals rather than everything M2M computed.
 *
 * Constraints (see docs/relevance-engine.md):
 *   - input is an `M2MIntelligence`; nothing else is read
 *   - no Supabase, LLM, Cognee, n8n, or network access
 *   - no new business figures: every number comes from M2M
 *   - deterministic, and every score is explained by its factors and reasons
 */

export * from "./types";
export * from "./config";
export { analyzeRelevance, linkedSignalIds, rankSignals } from "./analyze";
export { extractSignals, magnitudeOf, priorityOf, scoreOf } from "./signals";
