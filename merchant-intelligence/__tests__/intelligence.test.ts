import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { cogneeProvider, extractMemories, merchantDataset, serializeMemory } from "@/lib/cognee/cognee";
import type { MerchantMemory } from "@/lib/cognee/types";
import { openRouterProvider } from "@/lib/llm/openrouter";
import { LlmError } from "@/lib/llm/types";
import { n8nWebhookExecutor, n8nWebhookUrl } from "@/lib/n8n/webhook";
import { ActionNotFoundError } from "@/lib/paytm/adapter/actions";
import { PaytmSupabaseAdapter } from "@/lib/paytm/adapter";
import { createFakeSupabase } from "@/lib/paytm/adapter/__tests__/fake-supabase";
import { analyzeMerchant } from "@/m2m-engine";
import { bazaars, dailyMetrics, events, merchants } from "@/m2m-engine/__tests__/fixtures";
import {
  analyzeMerchantIntelligence,
  executeApprovedAction,
  IntelligenceError,
  measureActionOutcome,
  parseInsight,
  unsupportedFigures,
  type Fact,
} from "@/merchant-intelligence";
import { cached, invalidateMerchant } from "@/merchant-intelligence/cache";
import { answerMerchantQuestion } from "@/merchant-intelligence/chat";
import { explainMerchant, getMerchantBasics } from "@/merchant-intelligence/service";
import { analyzeRelevance } from "@/relevance-engine";

import {
  CURRENT,
  deps,
  fakeExecutor,
  fakeLlm,
  fakeMemory,
  groundedReply,
  InMemoryActionStore,
  promptFacts,
} from "./fakes";

const analyze = (d = deps()) => analyzeMerchantIntelligence(d, { merchantId: "TARGET", current: CURRENT });

// --- fetch mocking for provider tests ---------------------------------------------

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
const env = { ...process.env };

function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

// --- 1, 12. orchestration ---------------------------------------------------------------

describe("merchant intelligence orchestration", () => {
  it("1/12. runs M2M → Relevance → memory → LLM → proposal end to end", async () => {
    const memory = fakeMemory();
    const store = new InMemoryActionStore();
    const { llm, requests } = fakeLlm(groundedReply);
    const result = await analyze(deps({ memory: memory.memory, actions: store, llm }));

    assert.equal(result.merchant.mid, "TARGET");
    assert.equal(result.m2m.merchantMetrics.current.growth, -18);
    assert.equal(result.relevance.prioritySignals[0].id, "cohort_gap");
    assert.equal(result.history.status, "recalled");
    assert.equal(result.insight.status, "generated");
    assert.equal(requests.length, 1);

    assert.equal(result.recommendation.status, "proposed");
    if (result.recommendation.status !== "proposed") return;
    assert.equal(result.recommendation.persistence, "saved");
    // The fixture's evening gap rests on only 20 transactions: Relevance keeps it in the
    // background, so the promotion targets the whole day rather than evenings.
    assert.equal(result.recommendation.action.parameters.targetSegment, "all_day");
    assert.equal(result.recommendation.action.basis.opportunityType, "CLOSE_NETWORK_GAP");
    assert.equal(store.records.size, 1);
    assert.equal(memory.stored[0].kind, "insight");
  });

  it("reuses an open proposal instead of duplicating it", async () => {
    const store = new InMemoryActionStore();
    const d = deps({ actions: store });
    const first = await analyze(d);
    const second = await analyze(d);
    assert.equal(store.records.size, 1);
    assert.ok(second.recommendation.status === "proposed" && second.recommendation.persistence === "reused");
    assert.ok(first.recommendation.status === "proposed" && second.recommendation.status === "proposed");
    assert.equal(first.recommendation.actionId, second.recommendation.actionId);
  });

  it("defaults to the merchant's latest 7 days when no period is given", async () => {
    const result = await analyzeMerchantIntelligence(deps(), { merchantId: "TARGET" });
    assert.deepEqual(result.period.current, { from: "2026-09-14", to: "2026-09-20" });
  });

  it("keeps context simulations read-only until the merchant explicitly chooses an action", async () => {
    const store = new InMemoryActionStore();
    const result = await getMerchantBasics(deps({ actions: store }), {
      merchantId: "TARGET",
      current: CURRENT,
      context: { dayOfWeek: "friday", timeOfDay: "evening", weather: "rain", event: "none" },
    });
    assert.equal(result.m2m.contextImpact?.status, "meaningful_change");
    assert.equal(result.recommendation.status, "none");
    assert.equal(store.records.size, 0);
  });
});

// --- 2. integration: real Data Adapter → M2M → Relevance ----------------------------------

describe("Data Adapter → M2M → Relevance (real pipeline)", () => {
  it("2. the real Supabase adapter feeds M2M and Relevance end to end", async () => {
    const rows = {
      bazaars: bazaars.map((b) => ({ id: b.id, name: b.name, city: b.city, created_at: b.createdAt })),
      merchants: merchants.map((m) => ({
        mid: m.mid, bazaar_id: m.bazaarId, name: m.name, category: m.category,
        email: m.email, phone_number: m.phoneNumber, created_at: m.createdAt,
      })),
      merchant_daily_metrics: dailyMetrics.map((d) => ({
        mid: d.mid, business_date: d.businessDate, successful_transactions: d.successfulTransactions,
        pending_transactions: d.pendingTransactions, failed_transactions: d.failedTransactions,
        gross_sales_inr: d.grossSalesInr, refunds_inr: d.refundsInr, net_sales_inr: d.netSalesInr,
      })),
      payment_events: events.map((e) => ({
        txn_id: e.txnId, mid: e.mid, order_id: e.orderId, transaction_type: e.transactionType, status: e.status,
        response_code: e.responseCode, amount_inr: e.amountInr, refund_amount_inr: e.refundAmountInr, txn_at: e.txnAt,
        payment_mode: e.paymentMode, settlement_status: e.settlementStatus, settlement_at: e.settlementAt,
        weather_condition: e.context.weather, event_name: e.context.event?.name ?? null,
        event_type: e.context.event?.type ?? null, created_at: e.createdAt,
      })),
    };
    const adapter = new PaytmSupabaseAdapter(createFakeSupabase(rows).client);
    const m2m = await analyzeMerchant(adapter, { merchantId: "TARGET", current: CURRENT });
    const relevance = analyzeRelevance(m2m);

    assert.equal(m2m.merchantMetrics.current.growth, -18);
    assert.equal(m2m.cohortMetrics.current?.growth, 14);
    assert.equal(relevance.topPriority, "high");
    assert.equal(relevance.prioritySignals[0].id, "cohort_gap");
    const evening = relevance.backgroundSignals.find((s) => s.id === "context:timeOfDay:evening");
    assert.ok(evening?.reasons.includes("LIMITED_SEGMENT_SUPPORT"));
  });
});

// --- 3. Cognee provider ---------------------------------------------------------------------

const memoryRecord = (merchantId: string, recordedAt = "2026-09-17T12:00:00.000Z"): MerchantMemory => ({
  merchantId,
  kind: "action_outcome",
  recordedAt,
  situation: { period: CURRENT, topPriority: "high", cohortBasis: "bazaar_category", signals: [], patterns: ["MERCHANT_DOWN_NETWORK_UP"] },
  action: { actionId: "a1", type: "SCHEDULE_PROMOTION", parameters: {}, status: "executed" },
  outcome: { status: "executed" },
});

describe("Cognee memory provider", () => {
  beforeEach(() => {
    process.env.COGNEE_API_KEY = "test-key";
    process.env.COGNEE_TENANT_ID = "tenant-1";
    process.env.COGNEE_BASE_URL = "https://cognee.test";
  });

  it("3. stores a structured memory in the merchant's own dataset, then cognifies it", async () => {
    mockFetch(() => json({ ok: true }));
    await cogneeProvider.remember(memoryRecord("TARGET"));

    assert.deepEqual(calls.map((c) => c.url), ["https://cognee.test/api/v1/add", "https://cognee.test/api/v1/cognify"]);
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Api-Key"], "test-key");
    assert.equal(headers["X-Tenant-Id"], "tenant-1");
    const form = calls[0].init.body as FormData;
    assert.equal(form.get("datasetName"), merchantDataset("TARGET"));
    assert.deepEqual(form.getAll("node_set"), ["action_outcome"]);
    const file = form.get("data") as File;
    const text = await file.text();
    assert.ok(text.includes('"merchantId":"TARGET"'));
    assert.ok(text.startsWith("Merchant TARGET, period 2026-09-10 to 2026-09-16."));
    const cognify = JSON.parse(calls[1].init.body as string);
    assert.deepEqual(cognify.datasets, [merchantDataset("TARGET")]);
    assert.equal(cognify.run_in_background, true);
    assert.match(cognify.custom_prompt, /Ignore identifiers/);
  });

  it("recalls only this merchant's records, from this merchant's dataset", async () => {
    mockFetch(() => json([{ text: `${serializeMemory(memoryRecord("TARGET"))}\n${serializeMemory(memoryRecord("PEER-R1"))}` }]));
    const recalled = await cogneeProvider.recall("TARGET", "similar situations");
    const body = JSON.parse(calls[0].init.body as string);
    assert.deepEqual(body.datasets, [merchantDataset("TARGET")]);
    assert.equal(body.search_type, "CHUNKS");
    assert.equal(recalled.length, 1);
    assert.equal(recalled[0].merchantId, "TARGET");
  });

  it("treats a missing dataset as no history, and reports configuration honestly", async () => {
    mockFetch(() => json({ detail: "no dataset" }, 404));
    assert.deepEqual(await cogneeProvider.recall("TARGET", "q"), []);
    delete process.env.COGNEE_TENANT_ID;
    assert.equal(cogneeProvider.isConfigured(), false);
    assert.deepEqual(extractMemories({ nested: ["not a memory"] }, "TARGET"), []);
  });
});

// --- 4. LLM provider ------------------------------------------------------------------------

describe("LLM provider (OpenRouter)", () => {
  it("4. sends the configured model, token limit and JSON mode", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    process.env.OPENROUTER_MODEL = "test/model";
    mockFetch(() => json({ choices: [{ message: { content: "{}" } }] }));
    const reply = await openRouterProvider.complete({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 100,
      responseFormat: "json_object",
      reasoning: false,
    });
    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(reply.provider, "openrouter");
    assert.equal(body.model, "test/model");
    assert.equal(body.max_tokens, 100);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.deepEqual(body.reasoning, { enabled: false });
  });

  it("fails with LlmError, never a fake completion, when unconfigured or erroring", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(openRouterProvider.complete({ messages: [] }), LlmError);
    process.env.OPENROUTER_API_KEY = "test-key";
    mockFetch(() => json({ error: { message: "rate limited" } }, 429));
    await assert.rejects(openRouterProvider.complete({ messages: [] }), LlmError);
  });
});

// --- 5–7. structured output validation ------------------------------------------------------

const FACTS: Fact[] = [
  { id: "merchant.gmv.growth", label: "", value: -18, unit: "percent" },
  { id: "cohort.gmv.growth", label: "", value: 14, unit: "percent" },
  { id: "merchant.gmv.current", label: "", value: 8200, unit: "inr" },
  { id: "network.gap", label: "", value: -32, unit: "points" },
];
const validInsight = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "Sales fell 18% while similar shops grew 14%.",
    whatIsHappening: "GMV was ₹8,200 this week.",
    whyItMatters: "You are 32 points behind your network.",
    opportunity: { title: "Catch up", reason: "Your network is growing." },
    recommendation: { action: "Run a 7-day evening promotion.", expectedOutcome: "More evening orders.", confidence: "high" },
    evidence: [{ factId: "merchant.gmv.growth", note: "Your growth" }],
    historicalContext: null,
    ...patch,
  });

describe("LLM output validation", () => {
  it("5. accepts a schema-valid reply that cites known facts, including in a code fence", () => {
    assert.equal(parseInsight(validInsight(), FACTS).recommendation.confidence, "high");
    assert.ok(parseInsight("```json\n" + validInsight() + "\n```", FACTS));
  });

  it("6. rejects non-JSON, wrong shapes and extra keys", () => {
    assert.throws(() => parseInsight("Sure! Here is your insight.", FACTS), { reason: "INVALID_JSON" });
    assert.throws(() => parseInsight(validInsight({ summary: undefined }), FACTS), { reason: "SCHEMA_MISMATCH" });
    assert.throws(() => parseInsight(validInsight({ secret: "x" }), FACTS), { reason: "SCHEMA_MISMATCH" });
    assert.throws(
      () => parseInsight(validInsight({ recommendation: { action: "x", expectedOutcome: "y", confidence: "certain" } }), FACTS),
      { reason: "SCHEMA_MISMATCH" },
    );
  });

  it("7. rejects invented figures and unknown fact IDs", () => {
    assert.throws(() => parseInsight(validInsight({ summary: "Sales fell 23.4% this week." }), FACTS), { reason: "UNSUPPORTED_FIGURE" });
    assert.throws(() => parseInsight(validInsight({ whatIsHappening: "GMV was ₹1,20,000." }), FACTS), { reason: "UNSUPPORTED_FIGURE" });
    assert.throws(() => parseInsight(validInsight({ whatIsHappening: "GMV was about 8.2k." }), FACTS), { reason: "UNSUPPORTED_FIGURE" });
    assert.throws(() => parseInsight(validInsight({ evidence: [{ factId: "made.up", note: "x" }] }), FACTS), { reason: "UNKNOWN_FACT" });
    // Wording numbers, years and dates are not business figures.
    assert.deepEqual(unsupportedFigures("Over 7 days in September 2026 (2026-09-10), 5 shops", FACTS), []);
    // Suggested offer amounts are advice, not reported figures.
    assert.deepEqual(unsupportedFigures("Try a 10% cashback on Saturdays, or ₹25 off combos.", FACTS), []);
    assert.deepEqual(unsupportedFigures("A free cookie on orders above ₹250.", FACTS), []);
  });

  it("asks the model once to correct an unsupported figure in the summary", async () => {
    let turn = 0;
    const { llm, requests } = fakeLlm((request) => (++turn === 1 ? validInsight({ summary: "Up 99.9%!" }) : groundedReply(request)));
    const result = await analyze(deps({ llm }));
    assert.equal(result.insight.status, "generated");
    assert.equal(requests.length, 2);
  });

  it("a reply that stays invalid is replaced by a summary built from the facts, and nothing is executed", async () => {
    const executor = fakeExecutor();
    const result = await analyze(deps({ llm: fakeLlm(validInsight({ summary: "Up 99.9%!" })).llm, executor: executor.executor }));
    assert.ok(result.insight.status === "generated");
    if (result.insight.status !== "generated") return;
    assert.equal(result.insight.source, "rules");
    assert.equal(result.insight.aiIssue, "UNSUPPORTED_FIGURE");
    assert.equal(result.insight.insight.summary, "Your sales fell 18% this week, while similar shops near you rose 14%.");
    assert.deepEqual(unsupportedFigures(JSON.stringify(result.insight.insight), result.insight.facts), [], "fallback uses only facts");
    assert.equal(result.m2m.merchantMetrics.current.growth, -18);
    assert.equal(executor.calls.length, 0);
  });

  it("caps model confidence by cohort quality", async () => {
    const reply = (r: Parameters<typeof groundedReply>[0]) => groundedReply(r);
    const result = await analyzeMerchantIntelligence(deps({ llm: fakeLlm(reply).llm }), { merchantId: "CAFE-0", current: CURRENT });
    if (result.insight.status === "generated") assert.notEqual(result.insight.insight.recommendation.confidence, "high");
  });
});

// --- 8, 10. n8n executor -----------------------------------------------------------------------

const request = {
  actionId: "a1",
  merchantId: "TARGET",
  merchantName: "Target Cafe",
  bazaarName: "Indiranagar Bazaar",
  type: "SCHEDULE_PROMOTION" as const,
  parameters: { targetSegment: "evening" as const, durationDays: 7, channel: "email" as const },
  description: "Run a 7-day evening promotion on Paytm.",
};

describe("n8n ActionExecutor", () => {
  beforeEach(() => {
    process.env.N8N_BASE_URL = "https://n8n.test/";
    process.env.N8N_WEBHOOK_SECRET = "s3cret";
    process.env.N8N_EMAIL_FROM = "bazaar@example.com";
    process.env.N8N_EMAIL_RECIPIENT = "customer@example.com";
    delete process.env.N8N_WEBHOOK_URL;
  });

  it("8. posts the structured action to the workflow webhook and records its confirmation", async () => {
    assert.equal(n8nWebhookUrl(), "https://n8n.test/webhook/bazaar-merchant-action");
    mockFetch(() => json({ status: "executed", reference: 42, detail: "Promotion scheduled" }));
    const result = await n8nWebhookExecutor.execute(request);
    assert.equal(result.status, "executed");
    assert.equal(result.reference, "42");
    assert.deepEqual(JSON.parse(calls[0].init.body as string), {
      ...request,
      delivery: { channel: "email", recipient: "customer@example.com", from: "bazaar@example.com" },
    });
    assert.equal((calls[0].init.headers as Record<string, string>)["X-Bazaar-Secret"], "s3cret");
  });

  it("10. reports failure for errors, non-2xx and unconfirmed replies — never success", async () => {
    mockFetch(() => json({ message: "boom" }, 500));
    assert.equal((await n8nWebhookExecutor.execute(request)).status, "failed");
    mockFetch(() => json({ ok: true }));
    assert.equal((await n8nWebhookExecutor.execute(request)).status, "failed");
    mockFetch(() => {
      throw new TypeError("network down");
    });
    assert.equal((await n8nWebhookExecutor.execute(request)).status, "failed");
    delete process.env.N8N_BASE_URL;
    assert.equal(n8nWebhookExecutor.isConfigured(), false);
  });
});

// --- 9–11. approval, execution, outcome ---------------------------------------------------------

async function proposed(d = deps()) {
  const result = await analyze(d);
  assert.ok(result.recommendation.status === "proposed" && result.recommendation.actionId);
  return result.recommendation.actionId as string;
}

describe("approval and execution", () => {
  it("9. never runs without explicit approval", async () => {
    const store = new InMemoryActionStore();
    const executor = fakeExecutor();
    const d = deps({ actions: store, executor: executor.executor });
    const actionId = await proposed(d);

    for (const approved of [undefined, false, "true", 1]) {
      await assert.rejects(executeApprovedAction(d, { merchantId: "TARGET", actionId, approved }), (e: unknown) =>
        e instanceof IntelligenceError && e.code === "approval_required",
      );
    }
    assert.equal(executor.calls.length, 0);
    assert.equal((await store.get(actionId)).status, "proposed");
  });

  it("10. records an n8n failure as failed, and an unconfigured executor as pending", async () => {
    const store = new InMemoryActionStore();
    const memory = fakeMemory();
    const failing = deps({ actions: store, memory: memory.memory, executor: fakeExecutor({ status: "failed", reference: null, detail: "n8n returned 500." }).executor });
    const id = await proposed(failing);
    const outcome = await executeApprovedAction(failing, { merchantId: "TARGET", actionId: id, approved: true });
    assert.equal(outcome.action.status, "failed");
    assert.equal(memory.stored.at(-1)?.outcome?.status, "failed");

    const pending = deps({ actions: new InMemoryActionStore(), executor: fakeExecutor({}, false).executor });
    const id2 = await proposed(pending);
    const result = await executeApprovedAction(pending, { merchantId: "TARGET", actionId: id2, approved: true });
    assert.equal(result.execution, null);
    assert.equal(result.pendingReason, "ACTION_EXECUTOR_NOT_CONFIGURED");
    assert.equal(result.action.status, "approved");
  });

  it("11. persists the execution and its measured outcome to the store and memory", async () => {
    const store = new InMemoryActionStore();
    const memory = fakeMemory();
    const d = deps({ actions: store, memory: memory.memory });
    const id = await proposed(d);

    const executed = await executeApprovedAction(d, { merchantId: "TARGET", actionId: id, approved: true });
    assert.equal(executed.action.status, "executed");
    assert.equal(executed.action.executionReference, "exec-1");
    assert.equal(executed.memory, "remembered");
    assert.equal(memory.stored.at(-1)?.kind, "action_outcome");

    await assert.rejects(executeApprovedAction(d, { merchantId: "TARGET", actionId: id, approved: true }), (e: unknown) =>
      e instanceof IntelligenceError && e.code === "invalid_action_state",
    );

    // Re-opening the merchant does not propose the same offer again.
    const again = await analyze(d);
    assert.ok(again.recommendation.status === "proposed");
    if (again.recommendation.status === "proposed") {
      assert.equal(again.recommendation.actionId, id);
      assert.equal(again.recommendation.actionStatus, "executed");
    }
    assert.equal(store.records.size, 1);

    const pending = await measureActionOutcome(d, { merchantId: "TARGET", actionId: id });
    assert.equal(pending.status, "pending_data");

    const measured = await measureActionOutcome(d, { merchantId: "TARGET", actionId: id, days: 1 });
    assert.equal(measured.status, "measured");
    if (measured.status !== "measured") return;
    assert.deepEqual(measured.outcome.window, { from: "2026-09-11", to: "2026-09-11" });
    assert.ok((await store.get(id)).outcome);
    assert.equal(memory.stored.at(-1)?.kind, "measured_outcome");
  });

  it("12. the next analysis recalls what happened before", async () => {
    const memory = fakeMemory();
    const d = deps({ memory: memory.memory, actions: new InMemoryActionStore() });
    const id = await proposed(d);
    await executeApprovedAction(d, { merchantId: "TARGET", actionId: id, approved: true });

    const { llm, requests } = fakeLlm(groundedReply);
    const later = await analyze({ ...d, llm });
    assert.ok(later.history.status === "recalled" && later.history.memories.length >= 2);
    const payload = JSON.parse(requests[0].messages[1].content);
    assert.ok(payload.history.some((h: { kind: string }) => h.kind === "action_outcome"));
  });
});

// --- 13. failure path -----------------------------------------------------------------------------

describe("degraded operation", () => {
  it("13. still returns structured intelligence when LLM, memory, executor and storage all fail", async () => {
    const result = await analyze(
      deps({
        llm: fakeLlm(new Error("503")).llm,
        memory: fakeMemory({ failing: true }).memory,
        executor: fakeExecutor({}, false).executor,
        actions: null,
      }),
    );
    assert.ok(result.insight.status === "generated" && result.insight.source === "rules" && result.insight.aiIssue === "LLM_ERROR");
    assert.equal(result.history.status, "failed");
    assert.equal(result.relevance.topPriority, "high");
    assert.ok(result.recommendation.status === "proposed");
    if (result.recommendation.status !== "proposed") return;
    assert.equal(result.recommendation.actionId, null);
    assert.equal(result.recommendation.persistence, "unavailable");
    assert.equal(result.recommendation.executorConfigured, false);
  });

  it("without an LLM, still gives a summary from the facts and says why", async () => {
    const result = await analyze(deps({ llm: fakeLlm("", false).llm, memory: fakeMemory({ configured: false }).memory }));
    assert.ok(result.insight.status === "generated" && result.insight.source === "rules" && result.insight.aiIssue === "LLM_NOT_CONFIGURED");
    assert.deepEqual(result.history, { status: "unavailable", reason: "MEMORY_NOT_CONFIGURED" });
  });

  it("retries the model once after a network error before falling back", async () => {
    let calls = 0;
    const flaky = fakeLlm((request) => {
      if (++calls === 1) throw new Error("socket hang up");
      return groundedReply(request);
    });
    const result = await analyze(deps({ llm: flaky.llm }));
    assert.ok(result.insight.status === "generated" && result.insight.source === "ai");
    assert.equal(calls, 2);
  });

  it("never fails a chat: corrects once, trims unsupported sentences, or answers from the facts", async () => {
    const ask = (llm: ReturnType<typeof fakeLlm>["llm"]) =>
      answerMerchantQuestion(deps({ llm }), { merchantId: "TARGET", messages: [{ role: "user", content: "How am I doing?" }] });

    const stubborn = fakeLlm("Your sales grew 55.5% last week.");
    const answer = await ask(stubborn.llm);
    assert.equal(answer.status, "answered");
    assert.equal(answer.source, "summary");
    assert.match(answer.message, /Here is what your numbers show/);
    assert.equal(stubborn.requests.length, 2, "one correction attempt");
    assert.match(stubborn.requests[1].messages.at(-1)!.content, /not in the facts: 55.5%/);

    let turn = 0;
    const learns = fakeLlm(() => (++turn === 1 ? "Your sales grew 55.5% last week." : "Your sales are behind similar shops this week; try a weekend cashback."));
    const fixed = await ask(learns.llm);
    assert.equal(fixed.source, "ai");

    const mixed = fakeLlm(
      "Your sales are behind similar shops nearby this week, so there is room to grow. Your sales grew 55.5% on Mondays. Try a weekend cashback to bring regulars back.",
    );
    const trimmed = await ask(mixed.llm);
    assert.equal(trimmed.source, "ai_trimmed");
    assert.ok(!trimmed.message.includes("55.5%"));
    assert.match(trimmed.message, /weekend cashback/);

    const down = await ask(fakeLlm(new Error("503")).llm);
    assert.equal(down.source, "summary");
    const off = await ask(fakeLlm("", false).llm);
    assert.equal(off.source, "summary");
  });
});

// --- 14. privacy ----------------------------------------------------------------------------------

describe("privacy boundaries", () => {
  it("14. no peer identity, contact detail or transaction reaches the API result, the LLM or memory", async () => {
    const memory = fakeMemory();
    const { llm, requests } = fakeLlm(groundedReply);
    const result = await analyze(deps({ llm, memory: memory.memory }));

    const everything = JSON.stringify(result) + JSON.stringify(requests) + JSON.stringify(memory.stored);
    for (const leak of ["PEER-", "MYS-", "CAFE-0", "KIRANA-0", "Name of PEER", "@example.com", "+9190000"]) {
      assert.ok(!everything.includes(leak), `leaked ${leak}`);
    }
    assert.deepEqual(Object.keys(result.merchant).sort(), ["bazaar", "category", "mid", "name"]);

    // The LLM gets aggregates and facts, never transactions.
    const prompt = JSON.parse(requests[0].messages[1].content);
    assert.ok(!JSON.stringify(prompt).includes("txnId"));
    assert.ok(promptFacts(requests[0]).every((f) => typeof f.value === "number"));
  });

  it("does not let one merchant run another merchant's action", async () => {
    const d = deps({ actions: new InMemoryActionStore() });
    const id = await proposed(d);
    await assert.rejects(executeApprovedAction(d, { merchantId: "CAFE-0", actionId: id, approved: true }), ActionNotFoundError);
  });
});

// --- responsiveness and grounded outlooks ---------------------------------------------------------

describe("responsiveness and outlook", () => {
  it("defers memory writes when the host provides defer(), so responses do not wait on Cognee", async () => {
    const deferred: (() => Promise<unknown>)[] = [];
    const memory = fakeMemory();
    const d = deps({ memory: memory.memory, actions: new InMemoryActionStore(), defer: (task) => void deferred.push(task) });

    const id = await proposed(d);
    assert.equal(memory.stored.length, 0, "insight memory not written before the response");
    const executed = await executeApprovedAction(d, { merchantId: "TARGET", actionId: id, approved: true });
    assert.equal(executed.memory, "scheduled");

    for (const task of deferred) await task();
    assert.deepEqual(memory.stored.map((m) => m.kind), ["insight", "action_outcome"]);
  });

  it("adds the merchant's weekday and time-of-day pattern from M2M to the facts", async () => {
    const { llm, requests } = fakeLlm(groundedReply);
    await analyze(deps({ llm }));
    const ids = promptFacts(requests[0]).map((f) => f.id);
    assert.ok(ids.includes("pattern.timeOfDay.evening.merchant_gmv"));
    assert.ok(ids.includes("pattern.dayOfWeek.friday.merchant_share"));
  });

  it("gives chat today's weekday and asks for a grounded outlook instead of a refusal", async () => {
    const { llm, requests } = fakeLlm("Fridays have been a solid day for you; expect a similar pattern.");
    const d = deps({ llm, now: () => new Date("2026-09-18T06:00:00.000Z") });
    const answer = await answerMerchantQuestion(d, { merchantId: "TARGET", messages: [{ role: "user", content: "Will sales work today?" }] });
    assert.equal(answer.status, "answered");
    const system = requests[0].messages[0].content;
    assert.ok(system.includes("Today is friday, 2026-09-18"));
    assert.ok(system.includes("do not refuse"));
    assert.ok(system.includes("pattern.dayOfWeek.friday"));
  });
});

// --- speed and plain language ---------------------------------------------------------------------

describe("fast basics, cached explanations, plain words", () => {
  it("returns numbers without calling the LLM or memory, then explains separately", async () => {
    const { llm, requests } = fakeLlm(groundedReply);
    const memory = fakeMemory();
    const d = deps({ llm, memory: memory.memory });

    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    assert.equal(basics.m2m.merchantMetrics.current.growth, -18);
    assert.equal(requests.length, 0);
    assert.equal(memory.recalls.length, 0);

    const explanation = await explainMerchant(d, basics);
    assert.equal(explanation.insight.status, "generated");
    assert.equal(requests.length, 1);
  });

  it("caches in-flight work, drops failures and unwanted results, and invalidates per merchant", async () => {
    let runs = 0;
    const work = async () => ++runs;
    const [a, b] = await Promise.all([cached("t:M1:x", 60_000, work), cached("t:M1:x", 60_000, work)]);
    assert.equal(a, 1);
    assert.equal(b, 1, "concurrent callers share one run");

    await cached("t:M1:skip", 60_000, work, () => false);
    await new Promise((r) => setImmediate(r));
    assert.equal(await cached("t:M1:skip", 60_000, work, () => false), 3, "unwanted results are not kept");

    await assert.rejects(cached("t:M1:fail", 60_000, async () => { throw new Error("x"); }));
    await new Promise((r) => setImmediate(r));
    assert.equal(await cached("t:M1:fail", 60_000, work), 4, "failures are not kept");

    invalidateMerchant("M1");
    assert.equal(await cached("t:M1:x", 60_000, work), 5, "invalidated entries recompute");
  });

  it("labels every fact in plain shop words, with no jargon", async () => {
    const { llm, requests } = fakeLlm(groundedReply);
    await analyze(deps({ llm }));
    const labels = promptFacts(requests[0]).map((f) => f.label).join(" | ");
    for (const jargon of ["GMV", "AOV", "cohort", "percentage points", "Comparable merchants"]) {
      assert.ok(!labels.includes(jargon), `fact labels mention ${jargon}`);
    }
    assert.ok(labels.includes("Your sales this week"));
    const system = requests[0].messages[0].content;
    assert.ok(system.includes("Never use jargon"));
  });
});

// --- conversation robustness ----------------------------------------------------------------------

describe("long conversations and transient failures", () => {
  it("accepts long assistant replies as context (shortened), but still limits the merchant's own messages", async () => {
    const { validChatMessages } = await import("@/merchant-intelligence/chat");
    const longReply = "x".repeat(3000);
    const ok = validChatMessages([
      { role: "user", content: "How are my sales?" },
      { role: "assistant", content: longReply },
      { role: "user", content: "Now compare with the market" },
    ]);
    assert.ok(ok);
    assert.equal(ok![1].content.length, 1200);
    assert.equal(validChatMessages([{ role: "user", content: "y".repeat(801) }]), null);
    assert.equal(validChatMessages([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]), null, "must end with a question");
  });

  it("retries a briefly unreachable data source, but not a missing merchant", async () => {
    const { withRetry } = await import("@/merchant-intelligence/retry");
    const { DataSourceError, NotFoundError } = await import("@/lib/paytm/adapter/errors");
    let calls = 0;
    const value = await withRetry(async () => {
      if (++calls < 3) throw new DataSourceError("blip");
      return "ok";
    }, 3, 1);
    assert.equal(value, "ok");
    assert.equal(calls, 3);

    let missing = 0;
    await assert.rejects(withRetry(async () => { missing++; throw new NotFoundError("merchant", ["X"]); }, 3, 1), NotFoundError);
    assert.equal(missing, 1);
  });

  it("offers follow-up questions that were not already asked", async () => {
    const { followUpQuestions } = await import("@/components/intelligence/present");
    assert.deepEqual(followUpQuestions(["How do I compare with shops nearby?"], false), [
      "Which time of day is weakest for me?",
      "What offer would help most this week?",
      "How did my weekend go?",
    ]);
    assert.equal(followUpQuestions([], true)[0], "Tell me about the suggested offer");
  });
});
