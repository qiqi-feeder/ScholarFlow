import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PathGuardError, relativeInsideRoot, resolveInsideRoot, sha256 } from "../src/paths.js";

test("paths inside the project resolve; traversal and absolute paths do not", () => {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-paths-"));
  try {
    mkdirSync(path.join(root, "materials"));
    writeFileSync(path.join(root, "materials", "paper.md"), "text");
    assert.equal(resolveInsideRoot(root, "materials/paper.md"), path.join(root, "materials", "paper.md"));
    assert.equal(resolveInsideRoot(root, "new/artifact.json"), path.join(root, "new", "artifact.json"));
    assert.throws(() => resolveInsideRoot(root, "../outside.txt"), PathGuardError);
    assert.throws(() => resolveInsideRoot(root, "materials/../../outside.txt"), PathGuardError);
    assert.throws(() => resolveInsideRoot(root, path.join(root, "materials", "paper.md")), PathGuardError);
    assert.throws(() => resolveInsideRoot(root, "bad\0name"), PathGuardError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("relativeInsideRoot never returns absolute or escaping paths", () => {
  const root = "C:\\data\\project";
  assert.equal(relativeInsideRoot(root, "C:\\data\\project\\results\\a.json"), "results/a.json");
  assert.throws(() => relativeInsideRoot(root, "C:\\data\\other\\a.json"), PathGuardError);
});

test("sha256 is stable and content-addressed", () => {
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});
