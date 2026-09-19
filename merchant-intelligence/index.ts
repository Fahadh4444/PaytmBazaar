/**
 * Merchant Intelligence service.
 *
 * Orchestrates Data Adapter → M2M → Relevance → Cognee → LLM → action for one
 * merchant, and the approve → n8n → outcome → Supabase + Cognee loop.
 *
 * Responsibilities stay where they belong: the Data Adapter reads and writes
 * Supabase, M2M calculates, Relevance prioritises, Cognee remembers, the LLM
 * words, n8n executes. This module only wires them and decides what to do
 * when an optional one is missing. See docs/architecture.md.
 */

export * from "./types";
export * from "./errors";
export { analyzeMerchantIntelligence, DEFAULT_PERIOD_DAYS, explainMerchant, getMerchantBasics } from "./service";
export {
  contextActionSupported,
  executeApprovedAction,
  measureActionOutcome,
  proposeAction,
  proposeScenarioAction,
  PROMOTION_DAYS,
} from "./actions";
export { buildFacts } from "./facts";
export { getBazaarIntelligence, getCityIntelligence, loadNetwork, primaryCity, type NetworkSnapshot } from "./area";
export { askBazaar, type AskAction, type AskIntent, type AskResult, type AskTrace } from "./chat";
export { buildInsightPrompt, capConfidence, generateInsight, insightSchema, parseInsight, unsupportedFigures } from "./insight";
