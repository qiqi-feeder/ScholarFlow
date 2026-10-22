import assert from "node:assert/strict";
import test from "node:test";
import { closeObject, emptyWorkspace, openObject, readStored, selectView, validWorkspace, writeStored, type StorageLike } from "../src/workspace.js";
test("workspace tabs deduplicate, preserve fixed objects, compare and close safely", () => {
  const a = { kind: "material" as const, id: "a", title: "A", pinned: true };
  let state = openObject(emptyWorkspace(), a);
  state = openObject(state, { kind: "run", id: "b", title: "B" });
  state = openObject(state, { ...a, version: "v2" });
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs.at(-1)?.version, "v2");
  assert.equal(state.selectedRunId, "b");
  state = { ...state, secondary: "run:b", layout: "split" };
  assert.ok(validWorkspace(state));
  state = closeObject(state, "run:b");
  assert.equal(state.secondary, null);
  assert.equal(state.active, "material:a");
});
test("view changes never highlight an unrelated object or discard fixed tabs", () => {
  let state = openObject(emptyWorkspace(), { kind: "material", id: "paper", title: "Paper", pinned: true });
  state = openObject(state, { kind: "manuscript", id: "main.tex", title: "main.tex" });
  state = selectView(state, "materials");
  assert.equal(state.active, "material:paper");
  state = selectView(state, "results");
  assert.equal(state.active, null);
  assert.equal(state.tabs.length, 2);
  state = selectView(state, "manuscript");
  assert.equal(state.active, "manuscript:main.tex");
  state = closeObject(state, "manuscript:main.tex");
  assert.equal(state.active, null);
  assert.equal(state.tabs[0]?.pinned, true);
});
test("storage rejects malformed, old, cross-owner and missing-object state without corrupting memory", () => {
  let raw: string | null = null;
  const storage: StorageLike = { getItem: () => raw, setItem: (_k, v) => { raw = v; }, removeItem: () => { raw = null; } };
  const fallback = emptyWorkspace();
  const warnings: string[] = [];
  const key = "p1/t1";
  for (const value of ["{", JSON.stringify({ schema: 0 }), JSON.stringify({ schema: 1, owner: "p2/t2", value: fallback }), JSON.stringify({ schema: 1, owner: key, value: { ...fallback, active: "material:deleted" } })]) {
    raw = value;
    assert.deepEqual(readStored(storage, key, fallback, validWorkspace, (w) => warnings.push(w)), fallback);
  }
  assert.equal(warnings.length, 4);
  const state = openObject(fallback, { kind: "material", id: "a", title: "A" });
  assert.ok(writeStored(storage, key, state));
  assert.deepEqual(readStored(storage, key, fallback, validWorkspace), state);
  storage.setItem = () => { throw new Error("quota exceeded"); };
  assert.equal(writeStored(storage, key, state, (w) => warnings.push(w)), false);
  assert.equal(state.tabs.length, 1);
  storage.getItem = () => { throw new Error("storage disabled"); };
  assert.deepEqual(readStored(storage, key, fallback, validWorkspace), fallback);
});
