import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import AdmZip from "adm-zip";
import { ExperimentWorker } from "@scholarflow/experiment-worker";
import { createApp, type CreatedApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { CrossrefSearch } from "../src/search.js";

interface Harness {
  root: string;
  app: CreatedApp;
  base: string;
  worker?: ExperimentWorker;
  close: () => Promise<void>;
}

const resourcesDir = path.resolve(import.meta.dirname, "..", "..", "..", "resources");

function fakeSearch(): CrossrefSearch {
  return {
    search: async (query: string) => ({
      query,
      channel: "crossref" as const,
      retrievedAt: new Date().toISOString(),
      responseHash: "fakehash",
      hits: [
        {
          title: "A Reproducible Baseline",
          doi: "10.1234/example.2024",
          url: "https://doi.org/10.1234/example.2024",
          authors: ["Ada Example"],
          year: 2024,
          source: "crossref" as const,
          retrievedAt: new Date().toISOString(),
          raw: { DOI: "10.1234/example.2024" },
          license: "CC-BY-4.0",
        },
      ],
      note: "Multiple records returned; confirm by DOI.",
    }),
    fetchDoi: async (doi: string) => ({
      title: "A Reproducible Baseline",
      doi,
      url: `https://doi.org/${doi}`,
      authors: ["Ada Example"],
      year: 2024,
      source: "crossref" as const,
      retrievedAt: new Date().toISOString(),
      raw: { DOI: doi },
      license: "CC-BY-4.0",
      abstract: "We report a baseline.",
    }),
  } as unknown as CrossrefSearch;
}

async function start(options: { worker?: boolean; withAgent?: boolean; pdflatexPath?: string } = {}): Promise<Harness> {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-server-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  config.maxTargetRunsPerTask = 3;
  if (options.pdflatexPath) config.pdflatexPath = options.pdflatexPath;
  let worker: ExperimentWorker | undefined;
  const app = await createApp({
    config,
    search: fakeSearch(),
    resourcesDir,
    webDist: path.join(root, "webdist"),
    ...(options.worker
      ? {
          workerFactory: (db: import("node:sqlite").DatabaseSync) => {
            worker = new ExperimentWorker({ db, pollMs: 30 });
            return worker;
          },
        }
      : {}),
    ...(options.withAgent === false ? { agent: { sendMessage: async () => undefined, stop: async () => ({ stopped: true }), isRunning: () => false, dispose: async () => undefined } } : {}),
  });
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no test port");
  return {
    root,
    app,
    base: `http://127.0.0.1:${address.port}`,
    worker,
    close: async () => {
      if (worker) await worker.stop();
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function api<T = any>(harness: Harness, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${harness.base}${url}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as T) : (undefined as T) };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for condition");
}

test("projects/tasks are isolated and traversal paths are rejected", async () => {
  const harness = await start({ withAgent: false });
  try {
    const a = await api(harness, "POST", "/api/projects", { name: "Project A", description: "first" });
    const b = await api(harness, "POST", "/api/projects", { name: "Project B" });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    const projectA = a.body.project.id as string;
    const projectB = b.body.project.id as string;
    assert.notEqual(projectA, projectB);

    const task = await api(harness, "POST", `/api/projects/${projectA}/tasks`, {
      title: "Task A",
      objective: "Reproduce a baseline",
    });
    assert.equal(task.status, 201);
    const taskA = task.body.task.id as string;

    const cross = await api(harness, "GET", `/api/projects/${projectB}/tasks/${taskA}`);
    assert.equal(cross.status, 404);
    const crossContext = await api(harness, "GET", `/api/projects/${projectB}/tasks/${taskA}/context`);
    assert.equal(crossContext.status, 404);

    const imported = await api(harness, "POST", `/api/projects/${projectA}/materials`, {
      path: "workspace/notes.md",
    });
    // The file does not exist yet; this fails without touching another project.
    assert.equal(imported.status, 500);
    const traversal = await api(harness, "POST", `/api/projects/${projectA}/materials`, { path: "../../config/config.json" });
    assert.equal(traversal.status, 400);

    const fakePath = await api(harness, "POST", `/api/projects/${projectA}/materials`, { path: "/etc/passwd" });
    assert.equal(fakePath.status, 400);

    const search = await api(harness, "POST", `/api/projects/${projectA}/search`, { query: "baseline", taskId: taskA });
    assert.equal(search.status, 200);
    assert.equal(search.body.hits.length, 1);

    const doiImport = await api(harness, "POST", `/api/projects/${projectA}/materials`, {
      doi: "10.1234/example.2024",
      taskId: taskA,
    });
    assert.equal(doiImport.status, 201);
    assert.equal(doiImport.body.material.projectId, projectA);
    assert.ok(doiImport.body.material.sha256.length === 64);

    const duplicate = await api(harness, "POST", `/api/projects/${projectA}/materials`, {
      doi: "https://doi.org/10.1234/EXAMPLE.2024",
      taskId: taskA,
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.material.id, doiImport.body.material.id);

    const materials = await api(harness, "GET", `/api/projects/${projectA}/materials`);
    assert.equal(materials.body.materials.length, 1);

    const bib = await fetch(`${harness.base}/api/projects/${projectA}/materials/bibtex`);
    assert.equal(bib.status, 200);
    assert.match(bib.headers.get("content-type") ?? "", /bibtex/);
    const bibtex = await bib.text();
    assert.match(bibtex, /@(article|misc)\{/);
    assert.match(bibtex, /10\.1234\/example\.2024/);
    assert.match(bibtex, /A Reproducible Baseline/);

    const events = await api(harness, "GET", `/api/projects/${projectA}/tasks/${taskA}/events`);
    assert.ok(events.body.events.some((event: any) => event.type === "material_imported"));
  } finally {
    await harness.close();
  }
});

test("agent configuration failure is visible and duplicate client messages do not re-submit", async () => {
  const harness = await start();
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "No key project" });
    const task = await api(harness, "POST", `/api/projects/${project.body.project.id}/tasks`, {
      title: "Chat",
      objective: "Ask for help",
    });
    const taskId = task.body.task.id as string;
    const url = `/api/projects/${project.body.project.id}/tasks/${taskId}/messages`;
    const first = await api(harness, "POST", url, { text: "hello", clientId: "client-message-0001" });
    assert.equal(first.status, 202);
    const duplicate = await api(harness, "POST", url, { text: "hello", clientId: "client-message-0001" });
    assert.equal(duplicate.body.duplicate, true);
    const error = await waitFor(async () => {
      const response = await api(harness, "GET", `/api/projects/${project.body.project.id}/tasks/${taskId}/events`);
      return (response.body.events as any[]).find((event) => event.type === "error");
    });
    assert.match(error.data.message, /DeepSeek is not configured|API key/i);
    const events = await api(harness, "GET", `/api/projects/${project.body.project.id}/tasks/${taskId}/events`);
    const text = JSON.stringify(events.body);
    assert.equal(/sk-[A-Za-z0-9_-]{10,}/.test(text), false);
  } finally {
    await harness.close();
  }
});

test("settings store the key outside project data and never return it", async () => {
  const harness = await start({ withAgent: false });
  try {
    const secret = "sk-test-should-never-be-returned-123456";
    const updated = await api(harness, "PUT", "/api/settings", {
      deepseekApiKey: secret,
      searchEmail: "researcher@example.org",
      defaultInterpreter: "C:\\Python311\\python.exe",
    });
    assert.equal(updated.status, 200);
    assert.equal(JSON.stringify(updated.body).includes(secret), false);
    const settings = await api(harness, "GET", "/api/settings");
    assert.equal(JSON.stringify(settings.body).includes(secret), false);
    assert.equal(settings.body.model.configured, true);
    const health = await api(harness, "GET", "/api/health");
    assert.equal(JSON.stringify(health.body).includes(secret), false);
    const project = await api(harness, "POST", "/api/projects", { name: "Secret test" });
    const overview = await api(harness, "GET", `/api/projects/${project.body.project.id}/overview`);
    assert.equal(JSON.stringify(overview.body).includes(secret), false);
  } finally {
    await harness.close();
  }
});

test("plan confirmation, approval, worker execution, verification and result provenance", async () => {
  const harness = await start({ worker: true });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "Experiment project" });
    const projectId = project.body.project.id as string;
    const task = await api(harness, "POST", `/api/projects/${projectId}/tasks`, {
      title: "Baseline",
      objective: "Reproduce the baseline on the official split",
    });
    const taskId = task.body.task.id as string;
    const projectRoot = harness.app.services.repositories.getProject(projectId)!.dataDir;
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(path.join(projectRoot, "workspace"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, "workspace", "experiment.mjs"),
      "import { writeFileSync } from 'node:fs'; console.log('real child stdout'); writeFileSync('metrics.json', JSON.stringify({ mae: 1.25 }));\n",
      "utf8",
    );

    const plan = await api(harness, "POST", `/api/projects/${projectId}/plans`, {
      taskId,
      objective: "Reproduce baseline",
      hypotheses: ["Official config reaches the reported range"],
      design: "One official training/evaluation run",
      conditions: { dataset: "demo", split: "test" },
      metrics: [{ key: "mae", label: "MAE", direction: "lower", sourceLocation: "Table 2" }],
      seed: [1, 2, 3],
      budget: { maxMinutes: 30, maxRuns: 2 },
      resources: "local CPU",
      risks: ["data drift"],
    });
    assert.equal(plan.status, 201);
    const planId = plan.body.plan.id as string;
    const confirmed = await api(harness, "POST", `/api/projects/${projectId}/plans/${planId}/confirm`);
    assert.equal(confirmed.body.plan.status, "confirmed");

    const admission = await api(harness, "POST", `/api/projects/${projectId}/admissions`, {
      taskId,
      input: {
        paper: { title: "A Reproducible Baseline", doi: "10.1234/example.2024", identityConfirmed: true, identityEvidence: "DOI" },
        repository: { url: "https://github.com/example/baseline", commit: "abc1234", official: true, evidence: "paper link" },
        scripts: { path: "scripts/train.sh", configPath: "configs/base.yaml", explicitParameters: true, evidence: "appendix" },
        data: { available: true, license: "CC-BY-4.0", acquisition: "official URL", reproducibleSplit: true },
        priorReproductions: [
          { id: "r1", group: "Group 1", title: "Replication 1", url: "https://example.org/1", isOriginalPaper: false, reportedResult: "77.9", evidenceLocation: "Table 3", independent: true },
          { id: "r2", group: "Group 2", title: "Replication 2", url: "https://example.org/2", isOriginalPaper: false, reportedResult: "78.2", evidenceLocation: "Table 4", independent: true },
        ],
        target: { name: "MAE", sourceLocation: "Table 2", metric: "mae", tolerance: "卤0.1", toleranceBasis: "independent range" },
      },
    });
    assert.equal(admission.status, 201);
    assert.equal(admission.body.admission.status, "sufficient");
    const admissionId = admission.body.admission.id as string;

    const proposal = await api(harness, "POST", `/api/projects/${projectId}/runs/proposals`, {
      taskId,
      requestId: "request-baseline-0001",
      name: "baseline",
      kind: "target",
      planId,
      admissionId,
      program: process.execPath,
      args: ["experiment.mjs"],
      cwd: "workspace",
      config: { dataset: "demo", split: "test" },
      data: { version: "v1", split: "test", preprocessing: "none", license: "CC-BY-4.0" },
      seed: [1, 2, 3],
      metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
      timeoutSeconds: 30,
      expectedArtifacts: ["metrics.json"],
      snapshotFiles: ["workspace/experiment.mjs"],
    });
    assert.equal(proposal.status, 201);
    assert.equal(proposal.body.status, "pending");
    const approvalId = proposal.body.approvalId as string;

    const run = await api(harness, "POST", `/api/projects/${projectId}/approvals/${approvalId}/approve`);
    assert.equal(run.status, 202);
    const runId = run.body.run.id as string;
    assert.equal(run.body.run.status, "queued");
    harness.worker!.start();

    const finished = await waitFor(async () => {
      const response = await api(harness, "GET", `/api/projects/${projectId}/runs/${runId}`);
      return response.body.run.status === "succeeded" ? response.body.run : undefined;
    });
    assert.equal(finished.verificationStatus, "unverified");
    assert.equal(finished.kind, "target");

    const duplicateApproval = await api(harness, "POST", `/api/projects/${projectId}/approvals/${approvalId}/approve`);
    assert.equal(duplicateApproval.body.run.id, runId);
    assert.equal(duplicateApproval.body.deduplicated, true);

    const verified = await api(harness, "POST", `/api/projects/${projectId}/runs/${runId}/verify`, {
      status: "verified",
      note: "Compared against the snapshot and metric artifact.",
    });
    assert.equal(verified.body.run.verificationStatus, "verified");

    const analysis = await api(harness, "POST", `/api/projects/${projectId}/results/analyze`, {
      taskId,
      runIds: [runId],
      title: "Baseline MAE",
    });
    assert.equal(analysis.status, 201);
    assert.equal(analysis.body.result.comparability.comparable, true);
    assert.match(analysis.body.result.reportPath, /results\/res_/);
    const report = await fetch(`${harness.base}/api/projects/${projectId}/manuscript/download?path=${encodeURIComponent(analysis.body.result.reportPath)}`);
    assert.equal(report.status, 200);
    assert.match(await report.text(), /metrics\.json#\/mae/);

    const evidence = await api(harness, "GET", `/api/projects/${projectId}/runs/${runId}/evidence`);
    assert.equal(evidence.body.snapshot.spec.data.split, "test");
    assert.equal(evidence.body.metrics[0].source.runId, runId);
    assert.match(evidence.body.logTail, /real child stdout/);

    const runLog = await api(harness, "GET", `/api/projects/${projectId}/runs/${runId}/log`);
    assert.match(runLog.body.log, /real child stdout/);

    const context = await api(harness, "GET", `/api/projects/${projectId}/tasks/${taskId}/context`);
    assert.ok(context.body.entries.some((entry: any) => entry.kind === "run_result" && entry.sourceId === runId));
    assert.ok(context.body.entries.some((entry: any) => entry.kind === "result_analysis"));
    assert.match(context.body.markdown, new RegExp(runId));

    const replacement = await api(harness, "POST", `/api/projects/${projectId}/results/analyze`, {
      taskId,
      runIds: [runId],
      title: "Baseline MAE replacement",
      supersedes: analysis.body.result.id,
    });
    assert.equal(replacement.status, 201);
    const results = await api(harness, "GET", `/api/projects/${projectId}/results`);
    const old = results.body.results.find((result: any) => result.id === analysis.body.result.id);
    const next = results.body.results.find((result: any) => result.id === replacement.body.result.id);
    assert.equal(old.status, "superseded");
    assert.ok(old.reportPath);
    assert.ok(next.affectedArtifacts.some((item: string) => item.includes("manuscript/main.tex")));
    assert.ok(next.affectedArtifacts.includes(old.reportPath));
  } finally {
    await harness.close();
  }
});

test("failed runs produce a negative result report rather than a fabricated success", async () => {
  const harness = await start({ worker: true });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "Negative project" });
    const projectId = project.body.project.id as string;
    const task = await api(harness, "POST", `/api/projects/${projectId}/tasks`, {
      title: "Negative result",
      objective: "Keep a failed run as evidence",
    });
    const taskId = task.body.task.id as string;
    const projectRoot = harness.app.services.repositories.getProject(projectId)!.dataDir;
    const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
    mkdirSync(path.join(projectRoot, "workspace"), { recursive: true });
    writeFileSync(
      path.join(projectRoot, "workspace", "negative.mjs"),
      "import { writeFileSync } from 'node:fs'; writeFileSync('metrics.json', JSON.stringify({ mae: 9.9 })); process.exit(3);\n",
      "utf8",
    );
    const plan = await api(harness, "POST", `/api/projects/${projectId}/plans`, {
      taskId,
      objective: "Negative smoke",
      hypotheses: [],
      design: "Fail on purpose",
      conditions: { dataset: "demo", split: "test" },
      metrics: [{ key: "mae", label: "MAE", direction: "lower", sourceLocation: "none" }],
      seed: [1, 2, 3],
      budget: { maxMinutes: 5, maxRuns: 1 },
      resources: "local",
      risks: [],
    });
    await api(harness, "POST", `/api/projects/${projectId}/plans/${plan.body.plan.id}/confirm`);
    const proposal = await api(harness, "POST", `/api/projects/${projectId}/runs/proposals`, {
      taskId,
      name: "negative-smoke",
      kind: "smoke",
      planId: plan.body.plan.id,
      program: process.execPath,
      args: ["negative.mjs"],
      cwd: "workspace",
      metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
      expectedArtifacts: ["metrics.json"],
      timeoutSeconds: 20,
    });
    const approved = await api(harness, "POST", `/api/projects/${projectId}/approvals/${proposal.body.approvalId}/approve`);
    harness.worker!.start();
    const runId = approved.body.run.id as string;
    await waitFor(async () => {
      const run = await api(harness, "GET", `/api/projects/${projectId}/runs/${runId}`);
      return run.body.run.status === "failed" ? run : undefined;
    });
    const analyzed = await api(harness, "POST", `/api/projects/${projectId}/results/analyze`, {
      taskId,
      runIds: [runId],
      title: "Negative result",
    });
    assert.equal(analyzed.status, 201);
    assert.equal(analyzed.body.result.comparability.comparable, false);
    assert.ok(analyzed.body.warnings.some((warning: string) => /did not succeed|smoke/.test(warning)));
    const report = readFileSync(path.join(projectRoot, analyzed.body.result.reportPath), "utf8");
    assert.match(report, /failed/);
    assert.match(report, /not reproduction success/);
  } finally {
    await harness.close();
  }
});

test("manuscript compile, undefined citation failure, and export are real", async () => {
  const harness = await start({ withAgent: false });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "Writing project" });
    const projectId = project.body.project.id as string;
    const manuscript = await api(harness, "GET", `/api/projects/${projectId}/manuscript`);
    assert.equal(manuscript.status, 200);
    assert.ok(manuscript.body.files.some((file: any) => file.path === "main.tex"));

    const built = await api(harness, "POST", `/api/projects/${projectId}/manuscript/build`, {});
    if (built.status !== 200) {
      // A missing TeX installation must be reported, not hidden. This machine has
      // pdflatex; record the actual diagnostic if the environment lacks packages.
      assert.equal(built.status, 422);
      assert.ok(Array.isArray(built.body.diagnostics));
      return;
    }
    assert.equal(built.body.ok, true);
    const pdf = await fetch(`${harness.base}/api/projects/${projectId}/manuscript/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");

    const source = await api(harness, "GET", `/api/projects/${projectId}/manuscript/file?path=main.tex`);
    const broken = `${source.body.content}\n% broken citation\n\\cite{does-not-exist}\n`;
    await api(harness, "PUT", `/api/projects/${projectId}/manuscript/file`, { path: "main.tex", content: broken });
    const stale = await fetch(`${harness.base}/api/projects/${projectId}/manuscript/pdf`);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, "STALE_BUILD");
    const failed = await api(harness, "POST", `/api/projects/${projectId}/manuscript/build`, {});
    assert.equal(failed.status, 422);
    assert.ok(failed.body.diagnostics.some((item: string) => item.includes("does-not-exist")));

    await api(harness, "PUT", `/api/projects/${projectId}/manuscript/file`, { path: "main.tex", content: source.body.content });
    const rebuilt = await api(harness, "POST", `/api/projects/${projectId}/manuscript/build`, {});
    assert.equal(rebuilt.status, 200);
    const exported = await api(harness, "POST", `/api/projects/${projectId}/manuscript/export`, {});
    assert.equal(exported.status, 201);
    assert.ok(existsSync(exported.body.path));
    const header = readFileSync(exported.body.path).subarray(0, 2).toString();
    assert.equal(header, "PK");

    const zip = new AdmZip(exported.body.path);
    const entries = zip.getEntries().map((entry) => entry.entryName);
    for (const required of ["main.tex", "refs.bib", "main.pdf", "MANIFEST.json", "README.txt"]) {
      assert.ok(entries.includes(required), `export missing ${required}`);
    }
    const extractDir = path.join(harness.root, "unzipped");
    zip.extractAllTo(extractDir, true);
    const manifest = JSON.parse(readFileSync(path.join(extractDir, "MANIFEST.json"), "utf8"));
    assert.ok(Array.isArray(manifest.limitations));
    assert.equal(JSON.stringify(manifest).includes("deepseekApiKey"), false);
    execFileSync("pdflatex", ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: extractDir, stdio: "pipe", windowsHide: true });
    execFileSync("bibtex", ["main"], { cwd: extractDir, stdio: "pipe", windowsHide: true });
    execFileSync("pdflatex", ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: extractDir, stdio: "pipe", windowsHide: true });
    execFileSync("pdflatex", ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "main.tex"], { cwd: extractDir, stdio: "pipe", windowsHide: true });
    assert.equal(readFileSync(path.join(extractDir, "main.pdf")).subarray(0, 4).toString(), "%PDF");

    const beforeRestore = await api(harness, "GET", `/api/projects/${projectId}/manuscript`);
    const builtVersion = beforeRestore.body.versions.find((version: any) => version.version === 2);
    assert.ok(builtVersion?.snapshotPath, "built version must have a source snapshot");
    await api(harness, "PUT", `/api/projects/${projectId}/manuscript/file`, {
      path: "main.tex",
      content: `${source.body.content}\n% changed after the build\n`,
    });
    const restored = await api(harness, "POST", `/api/projects/${projectId}/manuscript/versions/2/restore`, {});
    assert.equal(restored.status, 200);
    assert.equal(restored.body.manuscript.version, 6);
    const restoredSource = await api(harness, "GET", `/api/projects/${projectId}/manuscript/file?path=main.tex`);
    assert.equal(restoredSource.body.content, source.body.content);
  } finally {
    await harness.close();
  }
});

test("current results generate manuscript tables/charts and a real PDF", async () => {
  const harness = await start({ withAgent: false });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "Result writing" });
    const projectId = project.body.project.id as string;
    const task = await api(harness, "POST", `/api/projects/${projectId}/tasks`, { title: "Write results", objective: "Synthesize metrics" });
    const taskId = task.body.task.id as string;
    harness.app.services.repositories.createResult({
      id: "res_testresult0000000001",
      projectId,
      taskId,
      title: "Smoke & baseline",
      runIds: ["run_test"],
      table: [{
        runId: "run_test",
        runName: "smoke_1",
        status: "succeeded",
        values: { score: { value: 1.5, unit: "%", source: "metrics.json#/score" } },
        conditions: {},
        comparableGroup: "group-1",
      }],
      comparability: { comparable: true, keyDifferences: [], warnings: [], missingConditions: [] },
      chartPath: null,
      reportPath: "results/res_test/report.md",
      supersedes: null,
      status: "current",
      affectedArtifacts: [],
      createdAt: new Date().toISOString(),
    });

    const synced = await api(harness, "POST", `/api/projects/${projectId}/manuscript/results/sync`, { taskId });
    assert.equal(synced.status, 200);
    assert.deepEqual(synced.body.resultIds, ["res_testresult0000000001"]);
    assert.ok(synced.body.files.includes("generated/results.tex"));
    assert.ok(synced.body.files.includes("generated/res_testresult0000000001.tex"));
    assert.ok(synced.body.files.includes("generated/res_testresult0000000001.pdf"), JSON.stringify(synced.body.warnings));

    const manuscript = await api(harness, "GET", `/api/projects/${projectId}/manuscript`);
    assert.ok(manuscript.body.files.some((entry: any) => entry.path === "generated/results.tex"));
    const resultsSection = await api(harness, "GET", `/api/projects/${projectId}/manuscript/file?path=sections/results.tex`);
    assert.match(resultsSection.body.content, /\\input\{generated\/results\}/);
    const generated = await api(harness, "GET", `/api/projects/${projectId}/manuscript/file?path=generated/res_testresult0000000001.tex`);
    assert.match(generated.body.content, /\\begin\{table\}/);
    assert.match(generated.body.content, /smoke\\_1/);

    const built = await api(harness, "POST", `/api/projects/${projectId}/manuscript/build`, {});
    if (built.status === 200) {
      assert.equal(built.body.ok, true);
      const pdf = await fetch(`${harness.base}/api/projects/${projectId}/manuscript/pdf`);
      assert.equal(pdf.status, 200);
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
    } else {
      assert.equal(built.status, 422);
      assert.ok(Array.isArray(built.body.diagnostics));
    }
  } finally {
    await harness.close();
  }
});

test("configured pdflatex path is used and a missing binary is reported", async () => {
  const missing = "scholarflow-missing-pdflatex";
  const harness = await start({ withAgent: false, pdflatexPath: missing });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "Configured TeX" });
    const projectId = project.body.project.id as string;
    const built = await api(harness, "POST", `/api/projects/${projectId}/manuscript/build`, {});
    assert.equal(built.status, 422);
    assert.equal(built.body.ok, false);
    assert.ok(built.body.diagnostics.some((item: string) => item.includes(missing)));
    assert.equal(built.body.version.build.status, "failed");
  } finally {
    await harness.close();
  }
});

test("SSE replays persisted events with cursor ids", async () => {
  const harness = await start({ withAgent: false });
  try {
    const project = await api(harness, "POST", "/api/projects", { name: "SSE project" });
    const task = await api(harness, "POST", `/api/projects/${project.body.project.id}/tasks`, {
      title: "Stream",
      objective: "See events",
    });
    const taskId = task.body.task.id as string;
    const controller = new AbortController();
    const response = await fetch(
      `${harness.base}/api/projects/${project.body.project.id}/tasks/${taskId}/events/stream?after=0`,
      { signal: controller.signal },
    );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("event: task_created") && text.length < 20000) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
      if (text.includes("event: task_created")) break;
    }
    controller.abort();
    assert.match(text, /id: \d+/);
    assert.match(text, /event: task_created/);
  } finally {
    await harness.close();
  }
});


test("projects, tasks and events survive a host restart", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-restart-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  const fakeAgent = {
    sendMessage: async () => undefined,
    stop: async () => ({ stopped: true }),
    isRunning: () => false,
    dispose: async () => undefined,
  };
  let base = "";
  try {
    const first = await createApp({ config, agent: fakeAgent, resourcesDir, webDist: path.join(root, "webdist") });
    await new Promise<void>((resolve) => first.server.listen(0, "127.0.0.1", () => resolve()));
    const address = first.server.address() as import("node:net").AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
    const project = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Restart project" }),
    }).then((response) => response.json()) as any;
    const task = await fetch(`${base}/api/projects/${project.project.id}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Restart task", objective: "Keep the session pointer" }),
    }).then((response) => response.json()) as any;
    await first.close();

    const second = await createApp({ config, agent: fakeAgent, resourcesDir, webDist: path.join(root, "webdist") });
    await new Promise<void>((resolve) => second.server.listen(0, "127.0.0.1", () => resolve()));
    const secondAddress = second.server.address() as import("node:net").AddressInfo;
    base = `http://127.0.0.1:${secondAddress.port}`;
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as any;
    assert.ok(projects.projects.some((item: any) => item.id === project.project.id));
    const detail = await fetch(`${base}/api/projects/${project.project.id}/tasks/${task.task.id}`).then((response) => response.json()) as any;
    assert.equal(detail.task.title, "Restart task");
    assert.ok(detail.events.some((event: any) => event.type === "task_created"));
    await second.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
