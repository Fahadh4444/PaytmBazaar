/**
 * Cognee boundary — contextual memory and knowledge retrieval.
 *
 * Cognee answers "what relevant context do we remember?": past situations,
 * insights, recommendations, actions and their outcomes. It is not the
 * database, not the M2M engine, and not an LLM provider. Raw transactions stay
 * in Postgres; deterministic analytics stay in the engine.
 *
 * No client is implemented yet, on purpose. We have credits but have not yet
 * confirmed the API surface against real credentials, and inventing method
 * names would be worse than an honest gap. The first feature that genuinely
 * needs recall implements this file against the real SDK.
 *
 * Cognee is optional: every caller must work when this returns false.
 */

export function isCogneeConfigured(): boolean {
  return Boolean(process.env.COGNEE_API_KEY);
}
