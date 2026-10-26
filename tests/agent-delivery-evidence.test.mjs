import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, "../docs/verification/agent-implementation");
const read = file => JSON.parse(readFileSync(path.join(root, file), "utf8"));

function validate(e) {
  assert.match(e.protocol, /^[a-f0-9]{64}$/);
  assert.equal(e.evaluation.protocol, e.protocol);
  assert.equal(e.evaluation.execution, "fresh-model");
  assert.equal(e.permissionProfile, "isolated-read-only-no-tools");
  assert.equal(e.calls.length, 12);
  for (const call of e.calls) {
    assert.deepEqual(call.actualModel, e.model);
    assert.ok(call.latencyMs >= 0);
    assert.ok(call.outputTokens === null || call.outputTokens <= 512);
  }
  const { development: d, holdout: h, final: f } = e.evaluation;
  const passed = [d, h, f].every(group => group.total === 2 && group.candidate === 2 && group.candidate >= group.baseline);
  assert.equal(e.evaluation.passed, passed, "must retain the predeclared criterion");
  assert.equal(e.candidate.status, passed ? "validated" : "rejected");
  assert.equal(e.restart.automaticMessages, 0); assert.equal(e.restart.runs, 0);
  assert.doesNotMatch(JSON.stringify(e), /sk-[A-Za-z0-9_-]{10,}|Bearer [A-Za-z0-9._-]{15,}|privateSamples/);
}
test("IG07 real evidence preserves measured outcomes, actual models, budget and honest rejection", () => {
  const evidence = read("real-evaluation.json"); validate(evidence);
  assert.throws(() => validate({ ...evidence, evaluation: { ...evidence.evaluation, passed: !evidence.evaluation.passed } }));
  assert.throws(() => validate({ ...evidence, calls: [] }));
  assert.throws(() => validate({ ...evidence, restart: { automaticMessages: 1, runs: 0 } }));
});
test("IG07 dynamic tools, restart and responsive browser evidence remain independently traceable", () => {
  const dynamic = read("real-capabilities.json");
  assert.deepEqual(dynamic.tools, ["activate_capability", "list_method_candidates", "recall_memory"]);
  assert.ok(dynamic.requestBudgets.every(b => b.after <= b.limit && b.estimated));
  const browser = read("browser/WT14-real-api.json");
  assert.equal(browser.toolCalls, 1); assert.equal(browser.sessionReopened, true); assert.equal(browser.automaticResubmission, false);
  for (const width of [1440, 390]) assert.ok(statSync(path.join(root, `browser/memory-methods-${width}.png`)).size > 10000);
  const validation = read("validation.json");
  assert.ok(validation.commands.every(c => c.exitCode === 0));
  assert.equal(validation.scientificAcceptance.startsWith("not performed"), true);
});
