import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSnapshotComplete,
  canonicalJson,
  experimentConfigFingerprint,
  resolveEnvReferences,
  validateExperimentEnv,
} from "../src/snapshot.js";
import type { ExperimentSpec, RunSnapshot } from "../src/types.js";

function spec(overrides: Partial<ExperimentSpec> = {}): ExperimentSpec {
  return {
    name: "baseline",
    kind: "target",
    planId: "pln_1",
    admissionId: "adm_1",
    description: "baseline run",
    program: "C:\\Python\\python.exe",
    args: ["train.py", "--config", "base.yaml"],
    cwd: "workspace",
    env: { PYTHONHASHSEED: "0" },
    config: { dataset: "demo", split: "test" },
    data: { version: "v1", split: "test", preprocessing: "official", license: "CC-BY-4.0" },
    seed: [1, 2, 3],
    metrics: [{ key: "accuracy", label: "Accuracy", direction: "higher", file: "metrics.json", pointer: "/accuracy" }],
    resourceLimits: { timeoutSeconds: 60 },
    expectedArtifacts: ["metrics.json"],
    snapshotFiles: ["train.py"],
    skillVersions: [{ name: "experiment-design", sha256: "abc" }],
    ...overrides,
  };
}

test("canonical JSON is stable across key order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
});

test("config fingerprint ignores name and request metadata but changes with configuration", () => {
  const a = experimentConfigFingerprint(spec());
  const b = experimentConfigFingerprint(spec({ name: "different name" }));
  const c = experimentConfigFingerprint(spec({ seed: [1, 2, 4] }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("secret literals are rejected while environment references are accepted", () => {
  assert.equal(validateExperimentEnv({ API_KEY: "sk-secret" }).length, 1);
  assert.equal(validateExperimentEnv({ API_KEY: "$ENV:MY_API_KEY" }).length, 0);
  assert.deepEqual(resolveEnvReferences({ TOKEN: "$ENV:TEST_TOKEN" }, { TEST_TOKEN: "value" }), {
    TOKEN: "value",
  });
  assert.throws(() => resolveEnvReferences({ TOKEN: "$ENV:MISSING_TOKEN" }, {}), /MISSING_TOKEN/);
});

function snapshot(): RunSnapshot {
  return {
    schema: 1,
    runId: "run_1",
    requestId: "req_1",
    projectId: "prj_1",
    taskId: "tsk_1",
    planId: "pln_1",
    admissionId: "adm_1",
    createdAt: new Date().toISOString(),
    spec: spec(),
    configFingerprint: experimentConfigFingerprint(spec()),
    code: {
      commit: "abc",
      branch: "main",
      dirty: false,
      diffPath: null,
      files: [{ path: "train.py", sha256: "hash", bytes: 10 }],
    },
    environment: {
      platform: "win32",
      node: "v24",
      interpreter: "C:\\Python\\python.exe",
      interpreterVersion: "3.11",
      conda: "not-configured",
      description: "test",
    },
    limits: { timeoutSeconds: 60 },
    provenance: { createdBy: "test", planVersion: 1, skillVersions: [{ name: "s", sha256: "h" }] },
  };
}

test("complete snapshots carry every required reproducibility field", () => {
  assert.deepEqual(assertSnapshotComplete(snapshot()), []);
});

test("snapshot without metrics or with unlisted metric files is rejected", () => {
  const missing = snapshot();
  missing.spec.metrics = [];
  assert.ok(assertSnapshotComplete(missing).some((item) => item.includes("no metrics")));

  const unlisted = snapshot();
  unlisted.spec.expectedArtifacts = [];
  assert.ok(assertSnapshotComplete(unlisted).some((item) => item.includes("not listed")));
});

test("dirty code must be captured as diff or files", () => {
  const dirty = snapshot();
  dirty.code.dirty = true;
  dirty.code.files = [];
  assert.ok(assertSnapshotComplete(dirty).some((item) => item.includes("dirty code")));
  dirty.code.diffPath = "snapshot/diff.patch";
  assert.deepEqual(assertSnapshotComplete(dirty), []);
});
