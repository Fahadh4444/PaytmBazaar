/**
 * Deterministic mode: Bazaar with no LLM, no Cognee, no n8n and no voice.
 *
 * What must hold: the figures are unchanged, the wording is written from the
 * fact table and answers the question that was asked, an approved action is
 * recorded rather than sent, and nothing claims a service that is switched off.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { answerFromFacts, detectTopic } from "@/merchant-intelligence/answers";
import { askBazaar } from "@/merchant-intelligence/chat";
import { buildFacts } from "@/merchant-intelligence/facts";
import { unsupportedFigures } from "@/merchant-intelligence/insight";
import { executeApprovedAction, getMerchantBasics } from "@/merchant-intelligence";
import { CURRENT, deps, fakeLlm, InMemoryActionStore } from "@/merchant-intelligence/__tests__/fakes";
import { recordedExecutor } from "@/lib/n8n";
import { analyzeMerchant } from "@/m2m-engine";
import { analyzeRelevance } from "@/relevance-engine";

const MODE = process.env.BAZAAR_MODE;
afterEach(() => {
  if (MODE === undefined) delete process.env.BAZAAR_MODE;
  else process.env.BAZAAR_MODE = MODE;
});

async function merchantFacts() {
  const d = deps();
  const m2m = await analyzeMerchant(d.dataSource, { merchantId: "TARGET", current: CURRENT });
  return { facts: buildFacts(m2m, analyzeRelevance(m2m), [], null), m2m };
}

/** Deterministic deps: no model, nothing remembered, approvals recorded. */
function offlineDeps() {
  const { llm } = fakeLlm("should never be called", false);
  return deps({
    mode: "deterministic",
    llm,
    executor: recordedExecutor,
    memory: {
      name: "off",
      isConfigured: () => false,
      async remember() {},
      async recall() {
        return [];
      },
    } as never,
    actions: new InMemoryActionStore(),
  });
}

describe("the mode switch", () => {
  it("is deterministic unless BAZAAR_MODE says otherwise", async () => {
    const { bazaarMode, isDeterministic, publicBazaarMode } = await import("@/lib/mode");
    delete process.env.BAZAAR_MODE;
    assert.equal(bazaarMode(), "deterministic");
    assert.equal(isDeterministic(), true);
    process.env.BAZAAR_MODE = "anything-else";
    assert.equal(bazaarMode(), "deterministic", "only an exact 'full' switches the integrations on");
    process.env.BAZAAR_MODE = "full";
    assert.equal(bazaarMode(), "full");
    assert.equal(publicBazaarMode(), "deterministic", "the browser label stays conservative until it is set too");
  });

  it("switches off every provider that would call out, and records actions instead", async () => {
    delete process.env.BAZAAR_MODE;
    // Keys present: the mode must still win, so a deployment cannot leak into a paid provider.
    process.env.SARVAM_API_KEY = "sk-test";
    process.env.COGNEE_API_KEY = "ck-test";
    process.env.COGNEE_TENANT_ID = "tenant";
    process.env.N8N_BASE_URL = "https://example.app.n8n.cloud";
    process.env.N8N_EMAIL_FROM = "a@example.com";
    process.env.N8N_EMAIL_RECIPIENT = "b@example.com";

    const { getLlmProvider, getLlmStatus } = await import("@/lib/llm");
    const { getMemoryProvider } = await import("@/lib/cognee");
    const { getActionExecutor } = await import("@/lib/n8n");
    const { getSpeechProvider } = await import("@/lib/speech");

    assert.equal(getLlmProvider().isConfigured(), false, "no model");
    assert.equal(getLlmStatus().model, "deterministic");
    assert.equal(getMemoryProvider().isConfigured(), false, "no memory");
    assert.equal(getSpeechProvider().isConfigured(), false, "no voice");

    const executor = getActionExecutor();
    assert.equal(executor.name, "bazaar-recorded");
    assert.equal(executor.isConfigured(), true, "an approval can always be recorded");
    const run = await executor.execute({
      actionId: "a1",
      merchantId: "TARGET",
      merchantName: "Target Shop",
      bazaarName: "Bazaar One",
      type: "SCHEDULE_PROMOTION",
      parameters: { targetSegment: "evening", durationDays: 7, channel: "email" },
      description: "Run a 7-day evening promotion on Paytm.",
    });
    assert.equal(run.status, "executed");
    assert.match(run.detail!, /Nothing was sent outside/);

    for (const key of ["SARVAM_API_KEY", "COGNEE_API_KEY", "COGNEE_TENANT_ID", "N8N_BASE_URL", "N8N_EMAIL_FROM", "N8N_EMAIL_RECIPIENT"]) {
      delete process.env[key];
    }
  });
});

describe("answers written from the facts", () => {
  it("routes a question to the topic it is about", () => {
    assert.equal(detectTopic("How do I compare with shops nearby?"), "COMPARISON");
    assert.equal(detectTopic("Which time of day is weakest for me?"), "TIME_OF_DAY");
    assert.equal(detectTopic("What is my strongest day?"), "DAY_OF_WEEK");
    assert.equal(detectTopic("What offer would help most this week?"), "OFFER");
    assert.equal(detectTopic("How much did I refund?"), "REFUNDS");
    assert.equal(detectTopic("Tell me about my shop"), "OVERVIEW");
  });

  it("answers each question differently, using only figures the engines calculated", async () => {
    const { facts } = await merchantFacts();
    const questions = [
      "How are my sales doing?",
      "How do I compare with shops nearby?",
      "Which time of day is weakest for me?",
      "What offer would help most this week?",
      "How many orders did I get?",
    ];
    const answers = questions.map((q) => answerFromFacts(q, facts));

    for (const [i, written] of answers.entries()) {
      assert.equal(unsupportedFigures(written.answer, facts).length, 0, `${questions[i]} invented a figure`);
      assert.ok(written.answer.includes("**Try this:**"), `${questions[i]} has no suggestion`);
      assert.ok(written.factIds.length > 0, `${questions[i]} cites no fact`);
    }
    assert.equal(new Set(answers.map((a) => a.answer)).size, answers.length, "every topic reads differently");

    // The comparison answer carries the cohort gap the engines reported.
    const comparison = answers[1];
    assert.match(comparison.answer, /32 points behind/, "the word carries the direction, not a second minus sign");
    assert.ok(comparison.factIds.includes("gap.cohort"));
  });

  it("quotes the deterministic proposal when there is one, so chat and offer card agree", async () => {
    const d = offlineDeps();
    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    assert.equal(basics.recommendation.status, "proposed");
    const action = basics.recommendation.status === "proposed" ? basics.recommendation.action : null;
    const { facts } = await merchantFacts();
    const written = answerFromFacts("What should I do this week?", facts, action);
    assert.ok(written.answer.includes(action!.description));
  });

  it("says what it can answer instead of guessing at an unknown question", async () => {
    const { facts } = await merchantFacts();
    const written = answerFromFacts("Tell me something interesting about my shop", facts);
    assert.equal(unsupportedFigures(written.answer, facts).length, 0);
    assert.match(written.answer, /You can also ask me:|Ask me about/);
  });
});

describe("Ask Bazaar in deterministic mode", () => {
  const question = (content: string) => [{ role: "user" as const, content }];

  it("answers the question asked, with no apology and no model", async () => {
    const d = offlineDeps();
    const result = await askBazaar(d, { merchantId: "TARGET", messages: question("How do I compare with shops nearby?") });

    assert.equal(result.status, "answered");
    assert.equal(result.source, "summary");
    assert.equal(result.provider, "rules");
    assert.equal(result.model, "deterministic");
    assert.equal(result.intent, "COMPARISON");
    assert.ok(!/unavailable/i.test(result.answer), "nothing is apologised for");
    assert.match(result.answer, /similar shops near you/);
    assert.ok(result.evidence.length > 0, "cites the facts it used");
  });

  it("offers the approvable action when asked what to do", async () => {
    const d = offlineDeps();
    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    const result = await askBazaar(d, { merchantId: "TARGET", basics, messages: question("What offer would help most this week?") });
    assert.equal(result.intent, "RECOMMENDATION");
    assert.ok(result.action, "the deterministic proposal is offered for approval");
    assert.equal(result.action!.requiresApproval, true);
  });

  it("still apologises when a model was expected but could not be reached", async () => {
    const { llm } = fakeLlm(new Error("down"));
    const result = await askBazaar(deps({ llm }), { merchantId: "TARGET", messages: question("How am I doing?") });
    assert.equal(result.source, "summary");
    assert.match(result.answer, /unavailable for a moment/);
  });
});

describe("approving an offer with no workflow", () => {
  it("records the approval, reports it honestly, and stays measurable", async () => {
    const d = offlineDeps();
    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    const actionId = basics.recommendation.status === "proposed" ? basics.recommendation.actionId! : "";

    const outcome = await executeApprovedAction(d, { merchantId: "TARGET", actionId, approved: true });
    assert.equal(outcome.execution?.status, "executed");
    assert.equal(outcome.pendingReason, null);
    assert.match(outcome.execution!.detail!, /Recorded in Bazaar/);
    assert.equal(outcome.action.status, "executed");
    assert.ok(outcome.action.executedAt, "recorded with a time, so the outcome can be measured later");
    assert.equal(outcome.memory, "unavailable", "nothing is remembered");
  });

  it("reports the deployment in services, so the UI never claims a service that is off", async () => {
    const basics = await getMerchantBasics(offlineDeps(), { merchantId: "TARGET", current: CURRENT });
    assert.equal(basics.services.mode, "deterministic");
    assert.equal(basics.services.llm.configured, false);
    assert.equal(basics.services.memory.configured, false);
    assert.equal(basics.services.speech.configured, false);
    // The numbers are the same ones the engines always produced.
    assert.equal(basics.m2m.merchantMetrics.current.growth, -18);
    assert.equal(basics.relevance.topPriority, "high");
  });
});
