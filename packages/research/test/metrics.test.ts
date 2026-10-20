import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResultVersion,
  compareRuns,
  extractMetrics,
  renderComparisonSvg,
  renderResultReport,
} from "../src/metrics.js";
import type { ExperimentSpec, MetricRecord, RunRecord } from "../src/types.js";

function run(id: string, name: string, overrides: Partial<RunRecord> = {}, specOverrides: Partial<ExperimentSpec> = {}): RunRecord {
  const spec: ExperimentSpec = {
    name,
    kind: "target",
    planId: "pln_1",
    admissionId: "adm_1",
    description: name,
    program: "python",
    args: [],
    cwd: ".",
    env: {},
    config: { dataset: "demo", split: "test", prediction_length: "24" },
    data: { version: "v1", split: "test", preprocessing: "official", license: "CC-BY" },
    seed: [1, 2, 3],
    metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
    resourceLimits: { timeoutSeconds: 60 },
    expectedArtifacts: ["metrics.json"],
    snapshotFiles: [],
    skillVersions: [],
    ...specOverrides,
  };
  return {
    id,
    projectId: "prj_1",
    taskId: "tsk_1",
    requestId: `req_${id}`,
    planId: "pln_1",
    admissionId: "adm_1",
    kind: "target",
    name,
    description: name,
    status: "succeeded",
    verificationStatus: "verified",
    configFingerprint: "fingerprint",
    spec,
    snapshotPath: "snapshot.json",
    logPath: "stdout.log",
    pid: 1,
    processStartedAt: null,
    processToken: null,
    exitCode: 0,
    error: null,
    unknownReason: null,
    timeoutSeconds: 60,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function metric(r: RunRecord, key = "mae", value = 1.2): MetricRecord {
  return {
    id: `met_${r.id}_${key}`,
    projectId: r.projectId,
    runId: r.id,
    key,
    label: key,
    value,
    direction: "lower",
    source: {
      file: "metrics.json",
      pointer: `/${key}`,
      sha256: "hash",
      importedAt: new Date().toISOString(),
      runId: r.id,
      conditionFingerprint: "conditions",
    },
    conditions: {
      "data.version": r.spec.data.version,
      "data.split": r.spec.data.split,
      "data.preprocessing": r.spec.data.preprocessing,
    },
    warnings: [],
  };
}

test("metrics import keeps runId, file, pointer and hash", () => {
  const r = run("run_a", "baseline");
  const result = extractMetrics({
    run: r,
    metricFileContent: JSON.stringify({ mae: 1.25, note: "ignored" }),
    fileSha256: "abc",
    specs: r.spec.metrics,
    idFactory: (key) => `met_${key}`,
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.metrics.length, 1);
  assert.equal(result.metrics[0]!.value, 1.25);
  assert.equal(result.metrics[0]!.source.runId, "run_a");
  assert.equal(result.metrics[0]!.source.pointer, "/mae");
  assert.equal(result.metrics[0]!.source.sha256, "abc");
});

test("missing and non-numeric metrics are rejected", () => {
  const r = run("run_a", "baseline");
  const missing = extractMetrics({
    run: r,
    metricFileContent: "{}",
    fileSha256: "abc",
    specs: r.spec.metrics,
    idFactory: () => "id",
  });
  assert.ok(missing.errors.some((error) => error.includes("not found")));

  const string = extractMetrics({
    run: r,
    metricFileContent: JSON.stringify({ mae: "1.2" }),
    fileSha256: "abc",
    specs: r.spec.metrics,
    idFactory: () => "id",
  });
  assert.ok(string.errors.some((error) => error.includes("not a finite number")));

  const invalid = extractMetrics({
    run: r,
    metricFileContent: "not json",
    fileSha256: "abc",
    specs: r.spec.metrics,
    idFactory: () => "id",
  });
  assert.ok(invalid.errors[0]!.includes("not valid JSON"));
});

test("different splits make runs incomparable and suppress the chart", () => {
  const a = run("run_a", "baseline");
  const b = run("run_b", "modified", {}, {
    data: { version: "v1", split: "validation", preprocessing: "official", license: "CC-BY" },
  });
  const comparison = compareRuns([
    { run: a, metrics: [metric(a, "mae", 1.2)] },
    { run: b, metrics: [metric(b, "mae", 1.0)] },
  ]);
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.keyDifferences.some((diff) => diff.includes("data.split")));
  assert.equal(renderComparisonSvg(comparison, ["mae"], "MAE"), null);
});

test("identical conditions with three seeds are comparable", () => {
  const a = run("run_a", "baseline");
  const b = run("run_b", "modified");
  const comparison = compareRuns([
    { run: a, metrics: [metric(a, "mae", 1.2)] },
    { run: b, metrics: [metric(b, "mae", 1.0)] },
  ]);
  assert.equal(comparison.comparable, true);
  assert.ok(comparison.table.every((row) => row.values.mae?.source === "metrics.json#/mae"));
  const svg = renderComparisonSvg(comparison, ["mae"], "MAE comparison");
  assert.ok(svg?.includes("<svg"));
});

test("fewer than three seeds and smoke runs are warned about", () => {
  const a = run("run_a", "smoke", { kind: "smoke", spec: run("x", "x", {}, { seed: [1] }).spec });
  const comparison = compareRuns([{ run: a, metrics: [metric(a)] }]);
  assert.ok(comparison.warnings.some((warning) => warning.includes("smoke")));
  assert.ok(comparison.warnings.some((warning) => warning.includes("fewer than three seeds")));
  assert.equal(comparison.comparable, false);
});

test("unverified or failed runs are not declared comparable", () => {
  const a = run("run_a", "baseline", { verificationStatus: "partial" });
  const b = run("run_b", "modified", { status: "failed", exitCode: 1 });
  const comparison = compareRuns([
    { run: a, metrics: [metric(a)] },
    { run: b, metrics: [metric(b)] },
  ]);
  assert.equal(comparison.comparable, false);
  assert.ok(comparison.warnings.some((warning) => warning.includes("not verified")));
  assert.ok(comparison.warnings.some((warning) => warning.includes("did not succeed")));
});

test("result versions retain sources and report limitations", () => {
  const a = run("run_a", "baseline");
  const comparison = compareRuns([{ run: a, metrics: [metric(a)] }]);
  const version = buildResultVersion({
    id: "res_1",
    projectId: "prj_1",
    taskId: "tsk_1",
    title: "Baseline MAE",
    comparison,
    chartPath: "charts/chart.svg",
    reportPath: "results/report.md",
    now: new Date("2026-10-20T00:00:00Z"),
  });
  assert.equal(version.status, "current");
  const report = renderResultReport(version, ["mae"]);
  assert.ok(report.includes("run_a"));
  assert.ok(report.includes("metrics.json#/mae"));
  assert.ok(report.includes("successful exit code alone is not reproduction success"));
});
