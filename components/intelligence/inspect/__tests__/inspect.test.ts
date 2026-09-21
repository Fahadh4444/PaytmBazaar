import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { flowStages, flowState, FLOW_STAGES } from "@/components/intelligence/inspect/flow";
import { buildTrace, type InspectSource } from "@/components/intelligence/inspect/source";
import type { TraceModel, TraceStage } from "@/components/intelligence/inspect/trace";
import { explainMerchant, getBazaarIntelligence, getCityIntelligence, getMerchantBasics, loadNetwork } from "@/merchant-intelligence";
import { CURRENT, deps, fakeExecutor, fakeLlm, InMemoryActionStore } from "@/merchant-intelligence/__tests__/fakes";

const stage = (model: TraceModel, id: string): TraceStage => {
  const found = model.stages.find((s) => s.id === id);
  assert.ok(found, `stage ${id} is present`);
  return found;
};
const row = (s: TraceStage, label: string) => s.rows?.find((r) => r.label === label)?.value;

async function merchantSource(overrides: Parameters<typeof deps>[0] = {}, merchantId = "TARGET"): Promise<InspectSource & { scope: "merchant" }> {
  const d = deps(overrides);
  const basics = await getMerchantBasics(d, { merchantId, current: CURRENT });
  const explanation = await explainMerchant(d, basics);
  return { scope: "merchant", basics, explanation, basicsLoading: false, explanationLoading: false, error: null };
}

const SCENE = { day: "Fri", hour: 19, weather: "Rain", event: "Festival" };

describe("Merchant trace: the backend's own figures", () => {
  it("shows the metrics, their inputs and the backend's results", async () => {
    const source = await merchantSource();
    const { m2m } = source.basics!;
    const trace = buildTrace(source, "fallback title", SCENE);

    assert.equal(trace.subject, source.basics!.merchant.name);
    const metrics = stage(trace, "metrics");
    const [aov, growth] = metrics.calcs!;
    // TARGET: ₹8,200 from 41 orders; ₹10,000 the week before (fixture).
    assert.equal(m2m.merchantMetrics.current.aov, 200);
    assert.equal(aov.working, "₹8,200 ÷ 41");
    assert.equal(aov.result, "₹200");
    assert.equal(growth.working, "(₹8,200 − ₹10,000) ÷ ₹10,000 × 100");
    assert.equal(growth.result, "-18.0%");
    assert.equal(growth.tone, "down");
  });

  it("shows the cohort, the gap and the pattern exactly as M2M reported them", async () => {
    const source = await merchantSource();
    const { m2m } = source.basics!;
    const trace = buildTrace(source, "t");

    const cohort = stage(trace, "cohort");
    assert.equal(row(cohort, "Comparable shops"), String(m2m.cohort.size));
    assert.equal(row(cohort, "Status"), "Reportable");
    const gap = cohort.calcs!.find((c) => c.label === "This shop vs similar shops")!;
    const cmp = m2m.comparisons.find((c) => c.against === "cohort")!;
    assert.equal(gap.working, "-18.0% − (+14.0%)");
    assert.equal(gap.result, `${cmp.growthGap!.toFixed(1)} pts`);

    const analysis = stage(trace, "m2m");
    assert.equal(analysis.summary, "Pattern detected: Shop is declining while similar shops grow.");
    assert.equal(analysis.groups!.length, m2m.patterns.length);
    assert.equal(row(analysis, "Bazaar growth · gap")?.startsWith("+9.5%"), true);
  });

  it("shows relevance scoring, the opportunity and the deterministic recommendation", async () => {
    const source = await merchantSource();
    const { relevance, recommendation } = source.basics!;
    const trace = buildTrace(source, "t");

    const lead = relevance.prioritySignals[0];
    const rel = stage(trace, "relevance");
    assert.ok(rel.summary.includes(`score ${lead.score}`));
    assert.ok(rel.groups![0].rows.some((r) => r.label === "Score working" && r.value.endsWith(`→ ${lead.score}`)));

    assert.ok(stage(trace, "opportunity").summary.startsWith(relevance.relevantOpportunities[0].opportunity.title));
    assert.equal(recommendation.status, "proposed");
    assert.equal(stage(trace, "recommendation").summary, recommendation.status === "proposed" ? recommendation.action.description : "");
    assert.equal(row(stage(trace, "action"), "Approval required"), "Yes");
  });

  it("describes the LLM input as structured facts, never transactions", async () => {
    const source = await merchantSource();
    const insight = source.explanation!.insight;
    assert.equal(insight.status, "generated");
    const explanation = stage(buildTrace(source, "t"), "explanation");
    assert.equal(explanation.status, "done");
    assert.equal(row(explanation, "Raw transactions sent"), "None");
    assert.ok(explanation.summary.includes(`${insight.status === "generated" ? insight.facts.length : -1} structured facts`));
  });

  it("reports an unconfigured LLM as unavailable instead of pretending it ran", async () => {
    const source = await merchantSource({ llm: fakeLlm("", false).llm });
    const trace = buildTrace(source, "t");
    assert.notEqual(stage(trace, "explanation").summary.includes("explained the result"), true);
    assert.equal(flowState(source).llm.status, "unavailable");
  });
});

describe("Merchant trace: execution state", () => {
  it("marks memory and explanation as running while only the numbers have arrived", async () => {
    const full = await merchantSource();
    const trace = buildTrace({ ...full, explanation: null, explanationLoading: true }, "t");
    assert.equal(stage(trace, "memory").status, "pending");
    assert.equal(stage(trace, "explanation").status, "pending");
    assert.equal(stage(trace, "metrics").status, "done");
  });

  it("shows every stage as pending before the first response, with no figures", () => {
    const trace = buildTrace(
      { scope: "merchant", basics: null, explanation: null, basicsLoading: true, explanationLoading: true, error: null },
      "Shop",
    );
    assert.ok(trace.stages.every((s) => s.status === "pending" && !s.rows && !s.calcs));
    assert.equal(trace.unavailable, null);
  });

  it("degrades to 'Trace details unavailable' when the request failed", () => {
    const trace = buildTrace(
      { scope: "merchant", basics: null, explanation: null, basicsLoading: false, explanationLoading: false, error: "Your numbers could not be loaded." },
      "Shop",
    );
    assert.match(trace.unavailable!, /^Trace details unavailable/);
    assert.ok(trace.stages.every((s) => s.status === "unavailable"));
  });

  it("follows the dialog's state: a different merchant or period gives a different trace", async () => {
    const d = deps();
    const a = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    const b = await getMerchantBasics(d, { merchantId: "PEER-R1", current: CURRENT });
    const earlier = await getMerchantBasics(d, { merchantId: "TARGET", current: { from: "2026-09-03", to: "2026-09-09" } });
    const trace = (basics: typeof a) =>
      buildTrace({ scope: "merchant", basics, explanation: null, basicsLoading: false, explanationLoading: false, error: null }, "t");
    assert.notEqual(trace(a).subject, trace(b).subject);
    assert.notDeepEqual(stage(trace(a), "metrics").calcs, stage(trace(b), "metrics").calcs);
    assert.notEqual(trace(a).window, trace(earlier).window);
  });

  it("reflects an approval made in the dialog, and does not call a pending approval executed", async () => {
    const d = deps({ executor: fakeExecutor({}, false).executor, actions: new InMemoryActionStore() });
    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    const base = { scope: "merchant" as const, basics, explanation: null, basicsLoading: false, explanationLoading: false, error: null };
    assert.equal(flowState(base).approval.status, "waiting");

    const record = { id: "a1" } as never;
    const pending = { ...base, live: { approval: { action: record, execution: null, pendingReason: "ACTION_EXECUTOR_NOT_CONFIGURED" as const, memory: "unavailable" as const }, measured: null } };
    assert.equal(row(stage(buildTrace(pending, "t"), "action"), "Status"), "Approved, pending");
    assert.equal(flowState(pending).approval.status, "ran");
    assert.notEqual(flowState(pending).n8n.status, "ran");
  });
});

describe("City and Bazaar trace", () => {
  it("city trace uses the city response's totals and hides merchant-level stages", async () => {
    const d = deps();
    const city = getCityIntelligence(await loadNetwork(d));
    const trace = buildTrace({ scope: "city", state: "ready", data: city }, "Bengaluru", SCENE);

    const metrics = stage(trace, "metrics");
    assert.equal(metrics.calcs![1].result, `${city.metrics.current.growth! > 0 ? "+" : ""}${city.metrics.current.growth!.toFixed(1)}%`);
    assert.equal(row(stage(trace, "data"), "Shops in scope"), city.metrics.merchantCount.toLocaleString("en-IN"));
    assert.equal(stage(trace, "headline").summary, city.headline);
    assert.equal(stage(trace, "not-used").status, "not_used");
    for (const id of ["cohort", "relevance", "explanation", "action"]) {
      assert.equal(trace.stages.some((s) => s.id === id), false, `${id} is not in a city trace`);
    }
  });

  it("bazaar trace shows Bazaar vs City from the impact the backend computed", async () => {
    const d = deps();
    const bazaar = await getBazaarIntelligence(d, await loadNetwork(d), "B1");
    const trace = buildTrace({ scope: "bazaar", state: "ready", data: bazaar }, "Bazaar One");
    const impact = stage(trace, "impact");
    assert.equal(impact.calcs![0].result, `${bazaar.impact!.gapToCity! > 0 ? "+" : ""}${bazaar.impact!.gapToCity!.toFixed(1)} pts`);
    assert.ok(stage(trace, "performance").rows!.length === bazaar.performance!.length);
  });

  it("shows loading and error states without inventing figures", () => {
    const loading = buildTrace({ scope: "city", state: "loading", data: null }, "Bengaluru");
    assert.ok(loading.stages.every((s) => s.status === "pending" && !s.rows));
    const failed = buildTrace({ scope: "bazaar", state: "error", data: null }, "Bazaar One");
    assert.match(failed.unavailable!, /^Trace details unavailable/);
  });
});

describe("Scene context", () => {
  it("shows the scene controls and says plainly that they are not engine inputs yet", async () => {
    const trace = buildTrace(await merchantSource(), "t", SCENE);
    const context = stage(trace, "context");
    assert.equal(row(context, "Scene weather"), "Rain");
    assert.equal(row(context, "Scene time"), "19:00");
    assert.match(context.note!, /not yet sent to the engine/);
  });
});

describe("Privacy", () => {
  it("never exposes another merchant, contact details or transactions", async () => {
    const d = deps();
    const network = await loadNetwork(d);
    const traces = [
      buildTrace(await merchantSource(), "t", SCENE),
      buildTrace({ scope: "city", state: "ready", data: getCityIntelligence(network) }, "c"),
      buildTrace({ scope: "bazaar", state: "ready", data: await getBazaarIntelligence(d, network, "B1") }, "b"),
    ];
    const text = JSON.stringify(traces);
    for (const leak of ["PEER-", "MYS-", "CAFE-0", "KIRANA-0", "Name of PEER", "@example.com", "+9190000", "txnAt", "phoneNumber"]) {
      assert.ok(!text.includes(leak), `trace leaks ${leak}`);
    }
  });
});

describe("System Flow", () => {
  it("lists the implemented pipeline in order", () => {
    assert.deepEqual(
      FLOW_STAGES.map((s) => s.id),
      ["data", "adapter", "m2m", "relevance", "recommendation", "cognee", "llm", "approval", "n8n", "outcome"],
    );
    const m2m = FLOW_STAGES.find((s) => s.id === "m2m")!;
    assert.ok(m2m.doesNot.some((d) => /LLM/.test(d)), "M2M is distinguished from the LLM");
  });

  it("marks only the stages a City or Bazaar analysis actually uses", async () => {
    const d = deps();
    const city = getCityIntelligence(await loadNetwork(d));
    const state = flowState({ scope: "city", state: "ready", data: city });
    assert.deepEqual(
      FLOW_STAGES.filter((s) => state[s.id].status === "ran").map((s) => s.id),
      ["data", "adapter", "m2m"],
    );
    for (const id of ["relevance", "cognee", "llm", "n8n"] as const) assert.equal(state[id].status, "not_used");
    assert.equal(flowState({ scope: "bazaar", state: "loading", data: null }).m2m.status, "running");
  });

  it("marks what ran for a merchant, and leaves approval and n8n waiting", async () => {
    const state = flowState(await merchantSource());
    for (const id of ["data", "adapter", "m2m", "relevance", "recommendation", "cognee", "llm"] as const) {
      assert.equal(state[id].status, "ran", id);
    }
    assert.equal(state.approval.status, "waiting");
    assert.equal(state.n8n.status, "waiting");
  });
});

describe("Deterministic deployment", () => {
  const offline = async () => {
    const { llm } = fakeLlm("never called", false);
    const d = deps({ mode: "deterministic", llm, executor: fakeExecutor({}, true).executor, actions: new InMemoryActionStore() });
    const basics = await getMerchantBasics(d, { merchantId: "TARGET", current: CURRENT });
    const explanation = await explainMerchant(d, basics);
    return { scope: "merchant" as const, basics, explanation, basicsLoading: false, explanationLoading: false, error: null };
  };

  it("names the rules as the author and never claims a model ran", async () => {
    const source = await offline();
    const trace = buildTrace(source, "t");
    const explanation = stage(trace, "explanation");
    assert.equal(explanation.label, "Explanation");
    assert.match(explanation.summary, /No AI model was called/);
    assert.match(row(explanation, "Written by")!, /rules/i);
    assert.equal(row(explanation, "Raw transactions sent"), "None");
  });

  it("shows memory as off rather than broken, and keeps every figure", async () => {
    const source = await offline();
    const trace = buildTrace(source, "t");
    assert.equal(stage(trace, "memory").status, "not_used");
    assert.match(stage(trace, "memory").summary, /Off in this deployment/);
    // The numbers are still the engines' own.
    assert.equal(stage(trace, "metrics").calcs![1].result, "-18.0%");
    const state = flowState(source);
    assert.equal(state.cognee.status, "not_used");
    assert.equal(state.llm.status, "ran");
    assert.match(state.llm.detail, /No model was called/);
    assert.equal(state.m2m.status, "ran", "the calculating half still runs");
  });

  it("describes the executor as recording, not sending", async () => {
    const source = await offline();
    assert.equal(row(stage(buildTrace(source, "t"), "action"), "Executor"), "Recorded in Bazaar · no external workflow");
    const stages = flowStages("deterministic");
    const executor = stages.find((s) => s.id === "n8n")!;
    assert.equal(executor.name, "Action executor");
    assert.ok(executor.doesNot.some((d) => /n8n or send an email/.test(d)));
    // Full mode is untouched, so switching back needs no other change.
    assert.equal(flowStages("full").find((s) => s.id === "n8n")!.name, "n8n workflow");
    assert.deepEqual(flowStages("full"), FLOW_STAGES);
  });
});

describe("Wiring", () => {
  it("every City, Bazaar and Merchant dialog carries the Trace and Flow keys", () => {
    for (const file of ["components/city/AnalysisDialog.tsx", "components/bazaar-screen/MerchantDialog.tsx"]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /<DialogTools[\s\S]*source=/, `${file} renders DialogTools`);
    }
    const screens = ["components/city/CityScreen.tsx", "components/bazaar-screen/BazaarScreen.tsx"].map((f) => readFileSync(f, "utf8"));
    assert.ok(screens.every((s) => /<AnalysisDialog/.test(s)), "City and Bazaar analyses use AnalysisDialog");
  });

  it("the inspection layer is the shared dialog, not a second modal implementation", () => {
    const tools = readFileSync("components/intelligence/inspect/DialogTools.tsx", "utf8");
    assert.match(tools, /<SceneDialog[\s\S]*inspector/);
    assert.ok(!/<dialog/.test(tools));
  });
});
