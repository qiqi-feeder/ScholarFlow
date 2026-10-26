import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { openDatabase } from "@scholarflow/experiment-worker";
import { Repositories } from "../src/repos.js";
import { EventHub } from "../src/events.js";
import { MemoryService } from "../src/memory.js";

export function memoryHarness() {
  const root = mkdtempSync(path.join(tmpdir(), "sf-memory-"));
  const file = path.join(root, "state.sqlite");
  const db = openDatabase(file), repos = new Repositories(db), events = new EventHub();
  const memory = new MemoryService(db, repos, events);
  const project = repos.createProject({ name: "Memory", dataDir: root });
  const task = repos.createTask({ projectId: project.id, title: "Origin", objective: "Remember with evidence" });
  const otherTask = repos.createTask({ projectId: project.id, title: "Destination", objective: "Recall" });
  const foreign = repos.createProject({ name: "Foreign", dataDir: root });
  const foreignTask = repos.createTask({ projectId: foreign.id, title: "Foreign", objective: "Isolated" });
  const p = { projectId: project.id, taskId: task.id, actor: "user" as const };
  const source = (text: string, type = "user_message") => repos.appendEvent(project.id, task.id, type, { text, toolName: "read_artifact" });
  const ingest = (text: string, extra: Record<string, unknown> = {}, type = "user_message") => memory.ingest(p, { sourceEventSeq: source(text, type).seq, subject: "experiment", predicate: "seed", scope: "project", ...extra });
  return { root, file, db, repos, memory, project, task, otherTask, foreign, foreignTask, p, source, ingest, close: () => { db.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("RT07: persisted source identity, idempotency and scope apply to every memory access path", () => {
  const h = memoryHarness();
  try {
    const event = h.source("assistant suggestion", "assistant_message");
    const input = { sourceEventSeq: event.seq, subject: "experiment", predicate: "seed", scope: "project" as const };
    const m = h.memory.ingest({ ...h.p, actor: "agent" }, input);
    assert.equal(m.status, "candidate"); assert.equal(m.authority.role, "assistant"); assert.equal(m.kind, "hypothesis");
    assert.equal(h.memory.ingest(h.p, input).id, m.id); assert.equal(h.memory.history(h.p, m.id).length, 1);
    assert.throws(() => h.memory.revise({ ...h.p, actor: "agent" }, m.id, 1, { action: "confirm", reason: "self confidence" }), /only the user/);
    const bad = { projectId: h.foreign.id, taskId: h.foreignTask.id, actor: "user" as const };
    for (const action of [() => h.memory.get(bad, m.id), () => h.memory.history(bad, m.id), () => h.memory.changes(bad, m.id), () => h.memory.revise(bad, m.id, 1, { action: "withdraw", reason: "forged" }), () => h.memory.ingest(bad, input)]) assert.throws(action, /scope|source event/);
    assert.deepEqual(h.memory.list(bad), []);
    const privateMemory = h.ingest("private", { scope: "task" });
    const destination = { ...h.p, taskId: h.otherTask.id };
    assert.throws(() => h.memory.get(destination, privateMemory.id), /scope/);
    assert.equal(h.memory.get(destination, m.id).id, m.id);
    assert.throws(() => h.memory.ingest({ ...h.p, projectId: "" }, input), /scope/);
  } finally { h.close(); }
});

test("RT08: revisions, contradictory evidence, independent conditions and transaction rollback", () => {
  const h = memoryHarness();
  try {
    let a = h.ingest("seed=1");
    a = h.memory.revise(h.p, a.id, a.revision, { action: "confirm", reason: "user review" });
    assert.equal(a.kind, "confirmed_decision");
    let b = h.ingest("seed=2");
    b = h.memory.revise(h.p, b.id, 1, { action: "confirm", reason: "conflicting confirmation" });
    assert.equal(b.status, "disputed"); assert.equal(h.memory.get(h.p, a.id).status, "disputed");
    const candidate = h.ingest("seed=3", {}, "assistant_message");
    assert.equal(candidate.status, "candidate");
    const separate = h.ingest("seed=9", { conditions: { dataset: "different" } });
    assert.equal(h.memory.revise(h.p, separate.id, 1, { action: "confirm", reason: "different condition" }).status, "active");
    const current = h.memory.get(h.p, a.id);
    assert.throws(() => h.memory.revise(h.p, a.id, 1, { action: "correct", reason: "stale", value: "overwrite" }), /revision changed/);
    assert.equal(h.memory.get(h.p, a.id).revision, current.revision);
    const tool = h.ingest("observed metric=0.8", { predicate: "metric" }, "tool_end");
    assert.throws(() => h.memory.revise(h.p, tool.id, 1, { action: "correct", reason: "wishful", value: 1 }), /raw observations/);
    assert.equal(tool.validFrom, undefined);
    assert.throws(() => h.ingest("bad time", { validFrom: "yesterday" }), /ISO/);
    const before = h.memory.list(h.p).length;
    h.db.exec("CREATE TRIGGER fail_memory BEFORE INSERT ON memory_ingestions BEGIN SELECT RAISE(ABORT, 'injected disk failure'); END");
    assert.throws(() => h.ingest("failure", { predicate: "failed write" }), /injected disk failure/);
    assert.equal(h.memory.list(h.p).length, before, "record and change rolled back together");
    assert.ok(h.memory.changes(h.p, a.id).every(c => c.newVersion.sourceRefs.length > 0));
  } finally { h.close(); }
});
