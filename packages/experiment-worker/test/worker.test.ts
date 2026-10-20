import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import type { ExperimentSpec, RunRecord } from "@scholarflow/research";
import { openDatabase } from "../src/db.js";
import { RequestConflictError, RunStore } from "../src/store.js";
import { ExperimentWorker } from "../src/worker.js";

function makeProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-worker-"));
  mkdirSync(path.join(root, "workspace"), { recursive: true });
  writeFileSync(
    path.join(root, "workspace", "experiment.mjs"),
    [
      "import { writeFileSync } from 'node:fs';",
      "const delay = Number(process.argv[2] ?? 0);",
      "const fail = process.argv[3] === 'fail';",
      "const started = new Date().toISOString();",
      "await new Promise(r => setTimeout(r, delay));",
      "writeFileSync('metrics.json', JSON.stringify({ mae: 1.23, started, ended: new Date().toISOString() }));",
      "console.log('experiment stdout');",
      "if (fail) process.exit(2);",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function spec(overrides: Partial<ExperimentSpec> = {}): ExperimentSpec {
  return {
    name: "baseline",
    kind: "smoke",
    planId: "pln_1",
    admissionId: null,
    description: "worker test",
    program: process.execPath,
    args: ["experiment.mjs", "60"],
    cwd: "workspace",
    env: { TEST_VALUE: "yes" },
    config: { dataset: "demo", split: "test" },
    data: { version: "v1", split: "test", preprocessing: "none", license: "CC0" },
    seed: [1, 2, 3],
    metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
    resourceLimits: { timeoutSeconds: 20 },
    expectedArtifacts: ["metrics.json"],
    snapshotFiles: ["workspace/experiment.mjs"],
    skillVersions: [],
    ...overrides,
  };
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 15000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

test("same requestId returns the same run and never starts a second process", () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  try {
    const first = store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-baseline-0001",
      projectDir: root,
      spec: spec(),
      runId: "run_1",
    });
    assert.equal(first.deduplicated, false);
    const second = store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-baseline-0001",
      projectDir: root,
      spec: spec(),
      runId: "run_2",
    });
    assert.equal(second.deduplicated, true);
    assert.equal(second.run.id, "run_1");
    assert.equal(store.list("prj_1").length, 1);
    const snapshot = JSON.parse(readFileSync(path.join(root, "runs", "run_1", "snapshot.json"), "utf8"));
    assert.equal(snapshot.spec.config.split, "test");
    assert.equal(snapshot.spec.snapshotFiles.length, 1);
    assert.equal(snapshot.code.files[0].sha256.length, 64);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("same requestId with a different configuration is a conflict", () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-baseline-0002",
      projectDir: root,
      spec: spec(),
      runId: "run_1",
    });
    assert.throws(
      () =>
        store.createRun({
          projectId: "prj_1",
          taskId: "tsk_1",
          requestId: "request-baseline-0002",
          projectDir: root,
          spec: spec({ seed: [99] }),
          runId: "run_2",
        }),
      RequestConflictError,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("worker executes queued runs one at a time and records logs/metrics", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const finished: string[] = [];
  const worker = new ExperimentWorker({ db, pollMs: 25, onRunFinished: (run) => finished.push(run.id) });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-serial-0001",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "250"] }),
      runId: "run_a",
    });
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-serial-0002",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "50"] }),
      runId: "run_b",
    });
    worker.start();
    await waitFor(() => (finished.length === 2 ? true : undefined));
    const a = store.get("run_a")!;
    const b = store.get("run_b")!;
    assert.equal(a.status, "succeeded");
    assert.equal(b.status, "succeeded");
    assert.ok(a.startedAt && a.finishedAt && b.startedAt);
    assert.ok(Date.parse(b.startedAt) >= Date.parse(a.finishedAt), "second run must start after the first finishes");
    assert.match(readFileSync(a.logPath, "utf8"), /experiment stdout/);
    assert.equal(JSON.parse(readFileSync(path.join(root, "workspace", "metrics.json"), "utf8")).mae, 1.23);
  } finally {
    await worker.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("nonzero exit is a failed run but exit zero with missing artifacts is marked partial", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const worker = new ExperimentWorker({ db, pollMs: 25 });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-fail-0001",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "10", "fail"] }),
      runId: "run_fail",
    });
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-missing-0001",
      projectDir: root,
      spec: spec({ expectedArtifacts: ["metrics.json", "missing.json"] }),
      runId: "run_missing",
    });
    worker.start();
    await waitFor(() => {
      const a = store.get("run_fail");
      const b = store.get("run_missing");
      return a?.status === "failed" && b?.status === "succeeded" ? true : undefined;
    });
    assert.equal(store.get("run_fail")!.exitCode, 2);
    const missing = store.get("run_missing")!;
    assert.equal(missing.status, "succeeded");
    assert.equal(missing.verificationStatus, "partial");
    assert.match(missing.error ?? "", /missing/);
  } finally {
    await worker.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("timeout kills the process tree and records failure", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const worker = new ExperimentWorker({ db, pollMs: 25 });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-timeout-0001",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "10000"], resourceLimits: { timeoutSeconds: 1 } }),
      runId: "run_timeout",
    });
    worker.start();
    await waitFor(() => {
      const run = store.get("run_timeout");
      return run && run.status !== "queued" && run.status !== "running" ? run : undefined;
    }, 20000);
    const run = store.get("run_timeout")!;
    assert.equal(run.status, "failed");
    assert.match(readFileSync(run.logPath, "utf8"), /timeout/);
  } finally {
    await worker.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("worker restart marks a running row unknown and never reruns it", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-recover-0001",
      projectDir: root,
      spec: spec(),
      runId: "run_orphan",
    });
    const claimed = store.claimNext();
    assert.equal(claimed?.status, "running");
    const worker = new ExperimentWorker({ db, pollMs: 25 });
    worker.start();
    const run = store.get("run_orphan")!;
    assert.equal(run.status, "unknown");
    assert.match(run.unknownReason ?? "", /will not be restarted automatically/);
    await worker.stop();
    assert.equal(store.get("run_orphan")!.status, "unknown");
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancel refuses to kill when the recorded PID identity does not match", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  try {
    const created = store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-cancel-pid-0001",
      projectDir: root,
      spec: spec(),
      runId: "run_pid",
    });
    const claimed = store.claimNext()!;
    store.markRunning(claimed, 424242, "2026-01-01T00:00:00.000Z");
    const worker = new ExperimentWorker({
      db,
      pollMs: 25,
      identityLookup: () => ({ pid: 424242, startedAt: "2026-01-01T00:00:00.000Z", commandLine: null, alive: false }),
    });
    const result = await worker.cancel("run_pid");
    assert.equal(result.cancelled, false);
    assert.match(result.reason, /identity/);
    assert.equal(store.get("run_pid")!.status, "running");
    assert.ok(created.run.id);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancelling a running process verifies identity and records cancellation", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const worker = new ExperimentWorker({ db, pollMs: 25 });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-cancel-running-0001",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "10000"], resourceLimits: { timeoutSeconds: 30 } }),
      runId: "run_cancel",
    });
    worker.start();
    await waitFor(() => (store.get("run_cancel")?.status === "running" ? true : undefined));
    const result = await worker.cancel("run_cancel");
    assert.equal(result.cancelled, true);
    await waitFor(() => {
      const run = store.get("run_cancel");
      return run && run.status !== "running" ? run : undefined;
    });
    const run = store.get("run_cancel")!;
    assert.equal(run.status, "cancelled");
  } finally {
    await worker.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("queued cancel does not start a process", async () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const worker = new ExperimentWorker({ db, pollMs: 100000 });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-cancel-queued-0001",
      projectDir: root,
      spec: spec(),
      runId: "run_queued",
    });
    const result = await worker.cancel("run_queued");
    assert.equal(result.cancelled, true);
    assert.equal(store.get("run_queued")!.status, "cancelled");
    assert.equal(existsSync(path.join(root, "workspace", "metrics.json")), false);
  } finally {
    await worker.stop();
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("paths with spaces and Chinese characters execute with an explicit program", async () => {
  const parent = mkdtempSync(path.join(tmpdir(), "scholarflow-worker-"));
  const root = path.join(parent, "研究 项目 ü");
  mkdirSync(path.join(root, "workspace 空间"), { recursive: true });
  writeFileSync(
    path.join(root, "workspace 空间", "实验.mjs"),
    "import { writeFileSync } from 'node:fs'; writeFileSync('metrics.json', JSON.stringify({ mae: 2.5 }));\n",
    "utf8",
  );
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  const worker = new ExperimentWorker({ db, pollMs: 25 });
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-unicode-path-0001",
      projectDir: root,
      spec: spec({
        program: process.execPath,
        args: ["实验.mjs"],
        cwd: "workspace 空间",
        snapshotFiles: ["workspace 空间/实验.mjs"],
      }),
      runId: "run_unicode",
    });
    worker.start();
    await waitFor(() => {
      const run = store.get("run_unicode");
      return run && run.status !== "queued" && run.status !== "running" ? run : undefined;
    });
    assert.equal(store.get("run_unicode")!.status, "succeeded");
    assert.equal(JSON.parse(readFileSync(path.join(root, "workspace 空间", "metrics.json"), "utf8")).mae, 2.5);
  } finally {
    await worker.stop();
    db.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("invalid or secret-bearing configuration is rejected before a process starts", () => {
  const root = makeProject();
  const db = openDatabase(path.join(root, "db.sqlite"));
  const store = new RunStore(db);
  try {
    assert.throws(
      () =>
        store.createRun({
          projectId: "prj_1",
          taskId: "tsk_1",
          requestId: "request-invalid-0001",
          projectDir: root,
          spec: spec({ env: { API_KEY: "sk-literal-secret" } }),
          runId: "run_bad",
        }),
      /looks secret/,
    );
    assert.throws(
      () =>
        store.createRun({
          projectId: "prj_1",
          taskId: "tsk_1",
          requestId: "request-invalid-0002",
          projectDir: root,
          spec: spec({ cwd: ".." }),
          runId: "run_escape",
        }),
      /escapes project root/,
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("the worker also runs as an independent process against the shared database", { timeout: 30000 }, async () => {
  const root = makeProject();
  const dbPath = path.join(root, "db.sqlite");
  const db = openDatabase(dbPath);
  const store = new RunStore(db);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    store.createRun({
      projectId: "prj_1",
      taskId: "tsk_1",
      requestId: "request-process-0001",
      projectDir: root,
      spec: spec({ args: ["experiment.mjs", "100"] }),
      runId: "run_process",
    });
    child = spawn(
      process.execPath,
      ["--import", "tsx", path.resolve(import.meta.dirname, "..", "src", "main.ts")],
      {
        cwd: path.resolve(import.meta.dirname, "..", "..", ".."),
        env: { ...process.env, SCHOLARFLOW_DB: dbPath, SCHOLARFLOW_WORKER_POLL_MS: "40" },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const run = await waitFor(() => {
      const current = store.get("run_process");
      return current && current.status !== "queued" && current.status !== "running" ? current : undefined;
    }, 25000);
    assert.equal(run.status, "succeeded");
    assert.match(readFileSync(run.logPath, "utf8"), /experiment stdout/);
    assert.ok(existsSync(path.join(root, "runs", "run_process", "snapshot.json")));

    // The standalone worker must remain alive after draining the queue so later
    // approvals are still picked up without a manual restart.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(child.exitCode, null, "idle worker exited instead of waiting for the next run");
  } finally {
    if (child && child.exitCode === null) {
      if (process.platform === "win32") {
        child.kill();
      } else {
        child.kill("SIGTERM");
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
