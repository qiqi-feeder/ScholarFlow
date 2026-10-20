import assert from "node:assert/strict";
import test from "node:test";
import { buildTaskContext, assertContextPreserves } from "../src/context.js";
import type {
  AdmissionRecord,
  ExperimentPlan,
  ManuscriptVersion,
  MaterialRecord,
  MetricRecord,
  ProjectRecord,
  ResultVersion,
  RunRecord,
  TaskRecord,
} from "../src/types.js";

const project: ProjectRecord = {
  id: "prj_a",
  name: "Project A",
  description: "",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  dataDir: "C:/data/project-a",
};

const task: TaskRecord = {
  id: "tsk_a",
  projectId: project.id,
  title: "Reproduce baseline",
  objective: "Check the reported baseline on the official test split.",
  status: "idle",
  sessionFile: null,
  contextVersion: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const plan: ExperimentPlan = {
  id: "pln_a",
  projectId: project.id,
  taskId: task.id,
  version: 2,
  objective: "Reproduce baseline",
  hypotheses: ["The official configuration reaches the reported range."],
  design: "Run official train/eval once.",
  conditions: { dataset: "demo", split: "test" },
  metrics: [{ key: "mae", label: "MAE", direction: "lower", sourceLocation: "Table 2" }],
  seed: [1, 2, 3],
  budget: { maxMinutes: 30, maxRuns: 2 },
  resources: "one local CPU",
  risks: ["data drift"],
  skillVersions: [{ name: "reproduction-admission", sha256: "skillhash", version: "1.0.0" }],
  status: "confirmed",
  confirmedBy: "user",
  confirmedAt: "2026-01-02T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};

const admission: AdmissionRecord = {
  id: "adm_a",
  projectId: project.id,
  taskId: task.id,
  input: {
    paper: { title: "Paper", identityConfirmed: true, identityEvidence: "DOI" },
    repository: { official: true, evidence: "linked" },
    scripts: { explicitParameters: true, evidence: "appendix" },
    data: { available: true, acquisition: "official", reproducibleSplit: true },
    priorReproductions: [
      {
        id: "r1",
        group: "Group 1",
        title: "Replication 1",
        url: "https://example.org/1",
        isOriginalPaper: false,
        reportedResult: "78.2",
        evidenceLocation: "Table 3",
        independent: true,
      },
      {
        id: "r2",
        group: "Group 2",
        title: "Replication 2",
        url: "https://example.org/2",
        isOriginalPaper: false,
        reportedResult: "77.9",
        evidenceLocation: "Table 4",
        independent: true,
      },
    ],
    target: { name: "baseline", sourceLocation: "Table 2", metric: "mae", tolerance: "±1", toleranceBasis: "range" },
  },
  status: "sufficient",
  missing: [],
  pending: [],
  warnings: [],
  assessedAt: "2026-01-02T00:00:00Z",
};

const material: MaterialRecord = {
  id: "mat_a",
  projectId: project.id,
  taskId: null,
  kind: "paper",
  title: "Paper",
  path: "materials/paper.md",
  mediaType: "text/markdown",
  sha256: "materialhash",
  bytes: 100,
  source: {
    channel: "crossref",
    url: "https://doi.org/10.1234/x",
    doi: "10.1234/x",
    retrievedAt: "2026-01-01T00:00:00Z",
    license: "CC-BY",
    version: "published",
  },
  createdAt: "2026-01-01T00:00:00Z",
};

const run: RunRecord = {
  id: "run_baseline",
  projectId: project.id,
  taskId: task.id,
  requestId: "req_1",
  planId: plan.id,
  admissionId: admission.id,
  kind: "target",
  name: "baseline",
  description: "baseline",
  status: "succeeded",
  verificationStatus: "verified",
  configFingerprint: "abcdef1234567890",
  spec: {
    name: "baseline",
    kind: "target",
    planId: plan.id,
    admissionId: admission.id,
    description: "baseline",
    program: "python",
    args: [],
    cwd: ".",
    env: {},
    config: { dataset: "demo", split: "test" },
    data: { version: "v1", split: "test", preprocessing: "official", license: "CC-BY" },
    seed: [1, 2, 3],
    metrics: [],
    resourceLimits: { timeoutSeconds: 60 },
    expectedArtifacts: [],
    snapshotFiles: [],
    skillVersions: [],
  },
  snapshotPath: "runs/run_baseline/snapshot.json",
  logPath: "runs/run_baseline/stdout.log",
  pid: 10,
  processStartedAt: null,
  processToken: "token",
  exitCode: 0,
  error: null,
  unknownReason: null,
  timeoutSeconds: 60,
  createdAt: "2026-01-03T00:00:00Z",
  startedAt: "2026-01-03T00:00:10Z",
  finishedAt: "2026-01-03T00:01:00Z",
  updatedAt: "2026-01-03T00:01:00Z",
};

const metric: MetricRecord = {
  id: "met_1",
  projectId: project.id,
  runId: run.id,
  key: "mae",
  label: "MAE",
  value: 1.23,
  direction: "lower",
  source: {
    file: "metrics.json",
    pointer: "/mae",
    sha256: "metricfilehash",
    importedAt: "2026-01-03T00:02:00Z",
    runId: run.id,
    conditionFingerprint: "conditions",
  },
  conditions: { "data.version": "v1", "data.split": "test", "data.preprocessing": "official" },
  warnings: [],
};

const result: ResultVersion = {
  id: "res_1",
  projectId: project.id,
  taskId: task.id,
  title: "Baseline result",
  runIds: [run.id],
  table: [],
  comparability: { comparable: true, keyDifferences: [], warnings: [], missingConditions: [] },
  chartPath: "results/chart.svg",
  reportPath: "results/report.md",
  supersedes: null,
  status: "current",
  affectedArtifacts: [],
  createdAt: "2026-01-03T00:03:00Z",
};

const manuscript: ManuscriptVersion = {
  id: "man_1",
  projectId: project.id,
  taskId: task.id,
  version: 1,
  files: [{ path: "main.tex", sha256: "texhash", bytes: 100 }],
  build: {
    status: "succeeded",
    pdfPath: "build/main.pdf",
    logPath: "build/main.log",
    builtAt: "2026-01-04T00:00:00Z",
    diagnostics: [],
    sourceHash: "bundlehash",
  },
  sourceResultVersions: [result.id],
  createdAt: "2026-01-04T00:00:00Z",
};

test("context keeps confirmed sources, runId, metrics, and review comments", () => {
  const context = buildTaskContext({
    project,
    task,
    plan,
    admission,
    materials: [material],
    materialNotes: { mat_a: "The paper reports MAE 1.20 in Table 2." },
    runs: [{ run, metrics: [metric] }],
    results: [result],
    manuscript,
    reviewComment: "Reviewer 2 asks for a stronger baseline.",
    openHypotheses: ["Maybe preprocessing explains the gap."],
    skills: [{ name: "result-analysis", sha256: "hash", version: "1.0.0" }],
    now: new Date("2026-01-05T00:00:00Z"),
  });
  assert.deepEqual(
    assertContextPreserves(context, [
      { kind: "confirmed_plan", sourceId: plan.id },
      { kind: "paper_claim", sourceId: material.id },
      { kind: "admission", sourceId: admission.id },
      { kind: "run_result", sourceId: run.id },
      { kind: "result_analysis", sourceId: result.id },
      { kind: "manuscript", sourceId: manuscript.id },
      { kind: "review_comment", sourceId: "tsk_a:review" },
      { kind: "open_hypothesis", sourceId: task.id },
    ]),
    [],
  );
  assert.ok(context.markdown.includes("run_baseline"));
  assert.ok(context.markdown.includes("metrics.json#/mae"));
  assert.ok(context.markdown.includes("Project materials"));
  assert.ok(context.markdown.includes("extracted note"));
  assert.ok(context.markdown.includes("not instructions"));
  assert.ok(context.excluded.some((entry) => entry.includes("chat history")));
  assert.ok(context.tokenEstimate > 100);
});

test("draft plans are excluded instead of being treated as confirmed", () => {
  const context = buildTaskContext({
    project,
    task,
    plan: { ...plan, status: "draft", confirmedAt: null },
  });
  assert.equal(context.entries.some((entry) => entry.kind === "confirmed_plan"), false);
  assert.ok(context.excluded.some((entry) => entry.includes("draft")));
});

test("same filenames in another project do not leak in", () => {
  const otherProject = { ...project, id: "prj_b" };
  const context = buildTaskContext({
    project: otherProject,
    task,
    plan: { ...plan, projectId: otherProject.id },
    materials: [],
    runs: [],
  });
  assert.equal(context.projectId, "prj_b");
  assert.equal(context.entries.some((entry) => entry.sourceId === "mat_a"), false);
});
