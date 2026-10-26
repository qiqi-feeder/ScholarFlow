import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { ExperimentWorker } from "@scholarflow/experiment-worker";
import { sha256 } from "@scholarflow/research";
import { createApp } from "../apps/server/src/app.js";
import { loadConfig } from "../apps/server/src/config.js";
import { seedDemo } from "./seed-demo.js";

// Explicit authoring command: real model calls + one approved CPU smoke fixture.
// Never touches the user's projects or injects assistant responses into the UI.
const host = loadConfig();
assert.ok(host.deepseekApiKey || process.env.DEEPSEEK_API_KEY, "DeepSeek configuration is required to capture genuine conversations");
const repo = path.resolve(import.meta.dirname, "..");
const output = path.join(repo, "docs", "assets"); mkdirSync(output, { recursive: true });
const root = mkdtempSync(path.join(tmpdir(), "scholarflow-readme-")), frames = path.join(root, "frames"); mkdirSync(frames);
const config = loadConfig({ home: root, configFile: path.join(root, "config.json"), dataDir: path.join(root, "data"), env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: host.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "" } });
config.workerEnabled = false; config.modelId = "deepseek-flash";
const app = await createApp({ config, workerFactory: db => new ExperimentWorker({ db, pollMs: 50 }) });
app.worker!.start();
await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/`;
const request = async (route: string, body?: unknown): Promise<any> => {
  const response = await fetch(new URL(route, base), { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const result = await response.json() as any; if (!response.ok) throw new Error(result.error ?? JSON.stringify(result)); return result;
};
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
assert.ok(chrome, "Chrome or Edge required");
const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on("dialog", dialog => void dialog.accept());
const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
const stages: Array<{ frame: string; stage: string }> = [];
const assets: Array<{ path: string; sha256: string; bytes: number }> = [];
const registerAsset = (name: string) => { const bytes = readFileSync(path.join(output, name)); assets.push({ path: name, sha256: sha256(bytes), bytes: bytes.length }); };
const capture = async (stage: string, name?: string) => {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const frame = `frame-${String(stages.length + 1).padStart(2, "0")}.png`;
  await page.screenshot({ path: path.join(frames, frame) }); stages.push({ frame, stage });
  if (name) { copyFileSync(path.join(frames, frame), path.join(output, name)); registerAsset(name); }
};
const send = async (taskId: string, text: string) => {
  await page.getByLabel("消息", { exact: true }).fill(text);
  const accepted = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/messages"));
  await page.getByRole("button", { name: "发送", exact: true }).click(); assert.equal((await accepted).status(), 202);
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const task = app.services.repositories.getTask(taskId)!;
    if (!app.agent.isRunning(taskId) && ["idle", "error"].includes(task.status)) {
      assert.equal(task.status, "idle", "real model call failed");
      await page.locator(".message.assistant").last().waitFor(); return;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("model did not settle within the media capture budget");
};
const chooseTask = async (title: string) => {
  const selector = page.locator(".task-switcher");
  if (await selector.getAttribute("open") === null) await selector.locator("summary").click();
  await selector.getByRole("button", { name: new RegExp(title) }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
};
const guards: Array<() => void> = [];
const guard = (taskId: string) => { let count = 0; guards.push(app.services.events.subscribe(taskId, e => { if (e.type === "tool_start" && ++count > 6) void app.agent.stop(taskId); })); };
try {
  const seeded = await seedDemo(base, config.dataDir), project = app.services.repositories.getProject(seeded.project.id)!, task = seeded.task;
  guard(task.id);
  await page.goto(base, { waitUntil: "domcontentloaded" }); await chooseTask(task.title);
  await page.getByRole("tab", { name: "材料", exact: true }).click();
  await page.locator(".object-library").getByRole("button", { name: "first-source.txt", exact: true }).click();
  await page.getByTitle("原文 first-source.txt", { exact: true }).waitFor();
  await capture("Open the included local source", "source.png");
  await page.getByRole("button", { name: "引用当前内容", exact: true }).click();
  await page.getByLabel("本条消息引用", { exact: true }).waitFor();
  await capture("Attach a host-validated source version");
  await send(task.id, "请使用 read_artifact 读取 workspace/first-source.txt，只调用这一次工具。用中文简要说明这是哪种验证，并完整列出 witness 与来源路径。不要实验或修改文件。");
  assert.match(await page.locator(".message.assistant").last().innerText(), /SCHOLARFLOW_SOURCE_CHECK/);
  await capture("Read the source through a real Pi tool loop");

  const smokeCode = `import {writeFileSync} from 'node:fs';\nconst data=Array.from({length:128},(_,i)=>Math.sin(i/8)+i/100);\nconst mae=data.slice(1).reduce((sum,value,i)=>sum+Math.abs(value-data[i]),0)/(data.length-1);\nconsole.log('Synthetic persistence forecast; CPU smoke only; seed 42');\nawait new Promise(r=>setTimeout(r,500));\nwriteFileSync('metrics.json',JSON.stringify({mae,samples:data.length,seed:42,kind:'smoke'},null,2));\nconsole.log('metrics.json saved; no scientific reproduction claimed');\n`;
  writeFileSync(path.join(project.dataDir, "workspace", "smoke.mjs"), smokeCode);
  const { plan } = await request(`/api/projects/${project.id}/plans`, { taskId: task.id, objective: "Validate a traceable forecasting workflow. Synthetic smoke only; not paper reproduction.", hypotheses: ["The persistence forecast emits a finite metric with provenance."], design: "One CPU-only run on 128 deterministic synthetic samples; inspect the original artifact.", conditions: { dataset: "synthetic-trend-v1", split: "software-check", preprocessing: "none", "data.license": "generated fixture" }, metrics: [{ key: "mae", label: "MAE", direction: "lower", sourceLocation: "Local synthetic software fixture" }], seed: [42], budget: { maxMinutes: 1, maxRuns: 1 }, resources: "CPU only; one bounded smoke run", risks: ["Smoke is not reproduction evidence; no generalization claim."] });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await chooseTask(task.title); await page.getByRole("tab", { name: "方案与准入", exact: true }).click();
  await page.getByRole("button", { name: "确认方案", exact: true }).waitFor(); await capture("Review a bounded smoke plan");
  await page.getByRole("button", { name: "确认方案", exact: true }).click(); await capture("Explicitly confirm the plan");
  const proposal = await request(`/api/projects/${project.id}/runs/proposals`, { taskId: task.id, name: "Synthetic forecast · smoke", requestId: "readme-smoke-once", kind: "smoke", planId: plan.id, args: ["smoke.mjs"], cwd: "workspace", metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }], timeoutSeconds: 15, snapshotFiles: ["workspace/smoke.mjs"], expectedArtifacts: ["metrics.json"] });
  await page.getByRole("tab", { name: "实验", exact: true }).click();
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await chooseTask(task.title);
  await page.getByRole("button", { name: "批准并排队", exact: true }).waitFor(); await capture("Review the exact command before approval");
  await page.getByRole("button", { name: "批准并排队", exact: true }).click();
  const row = page.locator("tr", { hasText: "Synthetic forecast · smoke" }).first();
  await row.locator(".status-succeeded").waitFor({ timeout: 30000 });
  const run = app.services.experiments.list(project.id)[0]!;
  assert.equal(run.kind, "smoke"); assert.equal(run.status, "succeeded");
  await capture("A real CPU child process finishes and persists its logs");
  app.services.experiments.verify(project, app.services.repositories.getTask(task.id)!, run.id, "verified", "Software artifact check only: metrics file and process identity verified. Not scientific reproduction.", "user");
  await request(`/api/projects/${project.id}/results/analyze`, { taskId: task.id, runIds: [run.id], title: "Synthetic forecast: traceable smoke result" });
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await page.getByRole("tab", { name: "结果", exact: true }).click();
  await page.getByRole("heading", { name: "Synthetic forecast: traceable smoke result", exact: true }).waitFor(); await capture("Inspect a metric tied to its run and file", "results.png");

  app.services.manuscript.saveFile(project, task.id, "refs.bib", "@misc{walkthrough2026, title={ScholarFlow software walkthrough fixture}, author={{ScholarFlow contributors}}, year={2026}, note={Local synthetic software fixture; not a scientific publication}}\n");
  app.services.manuscript.saveFile(project, task.id, "main.tex", String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage{booktabs,graphicx,hyperref}
\title{A Traceable Forecasting Smoke Test}
\author{ScholarFlow Walkthrough}
\date{}
\begin{document}\maketitle
\begin{abstract}This local software walkthrough demonstrates source reading, explicit approval, a CPU child process, artifact-linked analysis, and a versioned manuscript. It does not reproduce a research paper.\end{abstract}
\section{Scope and evidence}
The fixture contains 128 deterministic synthetic samples. A persistence forecast emits a measured mean absolute error. The source, command, run identifier and metric location are saved with the project. The fixture is described in \cite{walkthrough2026}.
\section{Traceable outputs}
\input{sections/results}
\section{Limits}
One smoke run cannot establish reproducibility, statistical significance or scientific performance. Research claims require an approved target and independent evidence.
\bibliographystyle{plain}\bibliography{refs}
\end{document}`);
  app.services.manuscript.saveFile(project, task.id, "sections/results.tex", "\\section{Results}\nThe following table and chart come from the saved smoke result.\n");
  const synced = app.services.manuscript.syncResults(project, task.id); assert.ok(synced.resultIds.length);
  const built = app.services.manuscript.build(project, task.id); assert.ok(built.ok, built.diagnostics.join("; "));
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await page.getByRole("tab", { name: "稿件", exact: true }).click();
  await page.getByLabel("稿件视图").selectOption("compare");
  await page.locator('.pdf-preview:visible canvas[data-rendered="true"]').first().waitFor(); await capture("Build an actual PDF from versioned manuscript sources");
  const pdf = app.services.manuscript.pdfFor(project); copyFileSync(pdf.path, path.join(project.dataDir, "workspace", "traceable-smoke-report.pdf"));
  const { material: report } = await request(`/api/projects/${project.id}/materials`, { taskId: task.id, path: "workspace/traceable-smoke-report.pdf" });
  await send(task.id, `请只调用一次 query_run，读取运行 ${run.id}。用中文给出三条简短结论：进程状态、MAE 及原始文件位置、为什么不能宣称论文复现成功。最多150字，不调用其他工具。`);
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await page.getByRole("tab", { name: "材料", exact: true }).click();
  await page.locator(".object-library").getByRole("button", { name: report.title, exact: true }).click();
  await page.locator('.pdf-preview:visible canvas[data-rendered="true"]').first().waitFor(); await capture("Read the generated report alongside a grounded model answer", "workspace.png");

  const confirmation = app.services.repositories.listEvents(task.id).find(e => e.type === "plan_confirmed")!;
  const { memory } = await request(`/api/projects/${project.id}/tasks/${task.id}/memories`, { sourceEventSeq: confirmation.seq, scope: "project", subject: "smoke scope", predicate: "confirmed constraints" });
  const { task: next } = await request(`/api/projects/${project.id}/tasks`, { title: "Continue with the confirmed evidence", objective: "Recover the confirmed synthetic smoke scope and budget. Do not restart or expand the experiment." }); guard(next.id);
  await page.getByRole("button", { name: "刷新", exact: true }).click(); await chooseTask(next.title); await page.getByRole("tab", { name: "任务", exact: true }).click();
  const memoryPanel = page.getByLabel("研究记忆", { exact: true }); await memoryPanel.locator("summary").first().click(); await memoryPanel.locator("article[data-memory-id]").first().waitFor();
  await capture("A new task sees the source-labelled confirmed project memory");
  await send(next.id, "请只调用一次 recall_memory，query 为 smoke scope。用中文简要说明原任务确认的实验范围、预算和结论边界，并给出记忆版本。不要重新提交实验或修改文件。");
  await memoryPanel.getByLabel("记忆查询", { exact: true }).fill("smoke scope"); await memoryPanel.getByRole("button", { name: "查询记忆依据", exact: true }).click();
  await capture("Recall prior conditions without resubmitting the experiment", "memory.png");
  assert.equal(stages.length, 12); assert.equal(app.services.experiments.list(project.id).length, 1); assert.deepEqual(errors, []);
  const tools = [task.id, next.id].flatMap(id => app.services.repositories.listEvents(id).filter(e => e.type === "tool_start").map(e => (e.data as any).toolName));
  assert.deepEqual(tools, ["read_artifact", "query_run", "recall_memory"]);
  const usage = [task.id, next.id].flatMap(id => app.services.repositories.listEvents(id).filter(e => e.type === "assistant_message").map(e => ({ provider: (e.data as any).provider, model: (e.data as any).model, usage: (e.data as any).usage })));
  const python = process.env.SCHOLARFLOW_MEDIA_PYTHON ?? "python";
  const animation = JSON.parse(execFileSync(python, [path.join(repo, "scripts", "encode-walkthrough.py"), frames, path.join(output, "walkthrough.gif")], { encoding: "utf8", windowsHide: true })); registerAsset("walkthrough.gif"); registerAsset("brand-mark.svg");
  const manifest = { schema: 1, capturedAt: new Date().toISOString(), timezone: "Asia/Taipei", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), sourceTree: "base commit plus README authoring changes", viewport: { width: 1440, height: 900 }, realApplication: true, realModel: true, syntheticData: true, scientificReproduction: false, model: "deepseek-flash", tools, usage, seedSource: { path: "examples/first-source.txt", sha256: sha256(readFileSync(path.join(repo, "examples", "first-source.txt"))) }, run: { id: run.id, kind: run.kind, status: app.services.experiments.get(run.id)!.status, requestId: run.requestId, approvalId: proposal.approvalId, metrics: app.services.repositories.listMetrics([run.id]).map(m => ({ key: m.key, value: m.value, source: m.source })), scriptSha256: sha256(smokeCode) }, manuscript: { built: built.ok, version: built.version.version, sourceHash: built.version.build.sourceHash }, memory: { id: memory.id, revision: memory.revision, sharedAcrossTasks: true }, animation: { ...animation, sampledFrames: true, timingAdjusted: true }, stages, assets, pageErrors: errors, credentialsExported: false, price: "unknown" };
  writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ assets: assets.map(a => a.path), tools, stages: stages.length, run: run.id, metric: manifest.run.metrics[0]?.value }));
} finally { guards.forEach(close => close()); await browser.close(); await app.worker?.stop(); await app.close(); rmSync(root, { recursive: true, force: true }); }
