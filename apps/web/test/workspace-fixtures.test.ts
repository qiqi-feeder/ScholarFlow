import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visit(key, entry);
      walk(entry, visit);
    }
  }
}

test("legacy task fixture has no model columns and keeps a relative session path", () => {
  const task = fixture("legacy-task.json");
  assert.equal(task.projectId, "prj_fixture_a");
  assert.equal(task.status, "idle");
  assert.equal(Object.hasOwn(task, "modelProvider"), false);
  assert.equal(Object.hasOwn(task, "modelId"), false);
  assert.match(task.sessionFile, /^tasks\/tsk_legacy_fixture\/pi\/[^/]+\.jsonl$/);
  assert.equal(task.sessionFile.includes("\\"), false);
});

test("workspace state fixture is schema-versioned, project/task isolated and secret-free", () => {
  const state = fixture("workspace-state-v1.json");
  assert.equal(state.schema, 1);
  assert.equal(state.prefs.chatWidth, 360);
  assert.deepEqual(Object.keys(state.projects).sort(), ["prj_fixture_a", "prj_fixture_b"]);
  const clientIds = new Set<string>();
  for (const [projectId, project] of Object.entries<any>(state.projects)) {
    assert.ok(project.tasks[project.activeTaskId], `${projectId} active task must exist`);
    for (const [taskId, task] of Object.entries<any>(project.tasks)) {
      assert.ok(taskId.startsWith("tsk_"), "task ids stay explicit");
      assert.ok(["reading", "plan", "experiments", "analysis", "writing", "review"].includes(task.view));
      assert.ok(["single", "split", "list-detail"].includes(task.layout));
      assert.ok(task.tabs.every((tab: any) => tab.objectType && tab.objectId && tab.version));
      assert.ok(task.tabs.some((tab: any) => `${tab.objectType}:${tab.objectId}` === task.activeObjectKey));
      assert.ok(!clientIds.has(task.composer.clientId), "composer client ids must not be reused across tasks");
      clientIds.add(task.composer.clientId);
      assert.ok(task.composer.references.every((ref: any) => ref.objectType && ref.objectId && ref.version));
    }
  }
  assert.equal(JSON.stringify(state).includes("prj_fixture_b:mat_a1"), false);
  walk(state, (key, value) => {
    assert.doesNotMatch(key, /api.?key|token|secret|password/i);
    if (typeof value === "string") assert.doesNotMatch(value, /\bsk-[A-Za-z0-9_-]{10,}\b|C:\\Users\\/i);
  });
});

test("model option fixture exposes availability without credentials", () => {
  const snapshot = fixture("model-options.json");
  assert.equal(snapshot.busyPolicy, "disable-selection-until-idle");
  const available = snapshot.options.filter((model: any) => model.available);
  assert.ok(available.length >= 1);
  assert.ok(available.some((model: any) => model.provider === snapshot.default.provider && model.id === snapshot.default.id));
  for (const model of snapshot.options) {
    assert.equal(typeof model.provider, "string");
    assert.equal(typeof model.id, "string");
    if (!model.available) assert.ok(model.reason, "unavailable models need a reason");
    assert.equal(Object.hasOwn(model, "apiKey"), false);
    assert.equal(Object.hasOwn(model, "token"), false);
  }
});

test("run fixtures never promote unknown or exit-zero to verified success", () => {
  const snapshot = fixture("run-transitions.json");
  const unknown = snapshot.runs.find((run: any) => run.event === "worker_restart");
  assert.equal(unknown.to, "unknown");
  assert.equal(unknown.terminal, false);
  assert.equal(unknown.verification, "unverified");
  for (const run of snapshot.runs) {
    assert.equal(run.to === "succeeded" && run.verification === "verified", false);
    if (run.terminal) assert.ok(["succeeded", "failed", "cancelled"].includes(run.to));
  }
});
