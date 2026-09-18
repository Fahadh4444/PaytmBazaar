/**
 * Test doubles for every external dependency of the Merchant Intelligence
 * service. The data source is the M2M fixture network (TARGET: -18% while its
 * cohort grows +14%), extended with the two reads the service adds.
 */

import { randomUUID } from "node:crypto";

import type { MemoryProvider, MerchantMemory } from "@/lib/cognee";
import type { LlmProvider, LlmRequest } from "@/lib/llm";
import type { ActionExecutionRequest, ActionExecutionResult, ActionExecutor } from "@/lib/n8n";
import {
  ActionNotFoundError,
  type MerchantActionPatch,
  type MerchantActionRecord,
  type MerchantActionStore,
  type NewMerchantAction,
} from "@/lib/paytm/adapter/actions";
import { NotFoundError } from "@/lib/paytm/adapter/errors";
import type { PaytmDataSource } from "@/m2m-engine";
import { bazaars, dailyMetrics, fakeDataSource, merchants } from "@/m2m-engine/__tests__/fixtures";

import type { Fact, IntelligenceDeps } from "../types";

export function dataSource(): PaytmDataSource {
  const base = fakeDataSource();
  return {
    ...base,
    async getMerchant(mid) {
      const found = merchants.find((m) => m.mid === mid);
      if (!found) throw new NotFoundError("merchant", [mid]);
      return found;
    },
    async getMerchantWithBazaar(mid) {
      const merchant = await this.getMerchant(mid);
      return { ...merchant, bazaar: bazaars.find((b) => b.id === merchant.bazaarId)! };
    },
    async getBazaar(id) {
      const found = bazaars.find((b) => b.id === id);
      if (!found) throw new NotFoundError("bazaar", [id]);
      return found;
    },
    async getDailyMetrics(query = {}) {
      return dailyMetrics.filter((d) => !query.mids || query.mids.includes(d.mid));
    },
    async getMerchantDailyMetrics(mid, range) {
      return dailyMetrics.filter(
        (d) => d.mid === mid && (!range || (d.businessDate >= range.from && d.businessDate <= range.to)),
      );
    },
  } as PaytmDataSource;
}

// --- LLM ----------------------------------------------------------------------

type Reply = string | ((request: LlmRequest) => string) | Error;

export function fakeLlm(reply: Reply, configured = true) {
  const requests: LlmRequest[] = [];
  const llm: LlmProvider = {
    name: "fake-llm",
    isConfigured: () => configured,
    async complete(request) {
      requests.push(request);
      if (reply instanceof Error) throw reply;
      return { text: typeof reply === "function" ? reply(request) : reply, provider: "fake-llm" };
    },
  };
  return { llm, requests };
}

/** The facts the service sent in its prompt. */
export function promptFacts(request: LlmRequest): Fact[] {
  return JSON.parse(request.messages[1].content).facts as Fact[];
}

/** A well-behaved model: cites real fact IDs and copies their values exactly. */
export function groundedReply(request: LlmRequest): string {
  const facts = promptFacts(request);
  const value = (id: string) => facts.find((f) => f.id === id)!.value;
  return JSON.stringify({
    summary: `Your sales moved ${value("merchant.gmv.growth")}% while similar shops grew ${value("cohort.gmv.growth")}%.`,
    whatIsHappening: `GMV went from ₹${value("merchant.gmv.previous")} to ₹${value("merchant.gmv.current")}.`,
    whyItMatters: `You are ${Math.abs(value("gap.cohort"))} points behind comparable merchants, so demand is there.`,
    opportunity: { title: "Catch up with your network", reason: "Comparable merchants are growing." },
    recommendation: {
      action: "Run the proposed 7-day promotion.",
      expectedOutcome: "Win back customers who are already buying from similar shops.",
      confidence: "high",
    },
    evidence: [
      { factId: "merchant.gmv.growth", note: "Your growth" },
      { factId: "cohort.gmv.growth", note: "Comparable merchants' growth" },
    ],
    historicalContext: null,
  });
}

// --- Memory ---------------------------------------------------------------------

export function fakeMemory(options: { configured?: boolean; failing?: boolean } = {}) {
  const stored: MerchantMemory[] = [];
  const recalls: { merchantId: string; query: string }[] = [];
  const memory: MemoryProvider = {
    name: "fake-memory",
    isConfigured: () => options.configured ?? true,
    async remember(record) {
      if (options.failing) throw new Error("memory down");
      stored.push(record);
    },
    async recall(merchantId, query) {
      recalls.push({ merchantId, query });
      if (options.failing) throw new Error("memory down");
      return stored.filter((m) => m.merchantId === merchantId);
    },
  };
  return { memory, stored, recalls };
}

// --- Executor -------------------------------------------------------------------

export function fakeExecutor(result: Partial<ActionExecutionResult> | Error = {}, configured = true) {
  const calls: ActionExecutionRequest[] = [];
  const executor: ActionExecutor = {
    name: "fake-n8n",
    isConfigured: () => configured,
    async execute(request) {
      calls.push(request);
      if (result instanceof Error) throw result;
      return { status: "executed", reference: "exec-1", detail: "Promotion scheduled", finishedAt: "2026-09-11T10:00:00.000Z", ...result };
    },
  };
  return { executor, calls };
}

// --- Action store -----------------------------------------------------------------

export class InMemoryActionStore implements MerchantActionStore {
  readonly records = new Map<string, MerchantActionRecord>();

  async create(action: NewMerchantAction): Promise<MerchantActionRecord> {
    const record: MerchantActionRecord = {
      id: randomUUID(),
      ...action,
      status: "proposed",
      approvedAt: null,
      executedAt: null,
      executionReference: null,
      executionDetail: null,
      outcome: null,
      createdAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return { ...record };
  }
  async get(actionId: string) {
    const record = this.records.get(actionId);
    if (!record) throw new ActionNotFoundError(actionId);
    return { ...record };
  }
  async listForMerchant(merchantId: string) {
    return [...this.records.values()].filter((r) => r.merchantId === merchantId).reverse();
  }
  async update(actionId: string, patch: MerchantActionPatch) {
    const record = { ...(await this.get(actionId)), ...patch };
    this.records.set(actionId, record);
    return { ...record };
  }
}

export function deps(overrides: Partial<IntelligenceDeps> = {}): IntelligenceDeps {
  return {
    dataSource: dataSource(),
    llm: fakeLlm(groundedReply).llm,
    llmModel: "test-model",
    memory: fakeMemory().memory,
    executor: fakeExecutor().executor,
    actions: new InMemoryActionStore(),
    now: () => new Date("2026-09-17T12:00:00.000Z"),
    ...overrides,
  };
}

export const CURRENT = { from: "2026-09-10", to: "2026-09-16" };
