import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { ExperimentWorker } from "@scholarflow/experiment-worker";
import { createApp, type CreatedApp } from "../../server/src/app.js";
import { loadConfig } from "../../server/src/config.js";
import { CrossrefSearch } from "../../server/src/search.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const webDist = path.join(repoRoot, "apps", "web", "dist");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

async function startServer(app: CreatedApp): Promise<string> {
  await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

async function seed(base: string): Promise<{ projectId: string; taskId: string; dataDir: string }> {
  const projectResponse = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Browser Lab", description: "End-to-end browser verification" }),
  });
  const project = (await projectResponse.json()) as any;
  const taskResponse = await fetch(`${base}/api/projects/${project.project.id}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Chart baseline", objective: "Run a smoke experiment and inspect provenance" }),
  });
  const task = (await taskResponse.json()) as any;
  mkdirSync(path.join(project.project.dataDir, "workspace"), { recursive: true });
  writeFileSync(path.join(project.project.dataDir, "workspace", "notes.txt"), "Readable local notes for the browser test.\n", "utf8");
  writeFileSync(
    path.join(project.project.dataDir, "workspace", "smoke.mjs"),
    "import { writeFileSync } from 'node:fs'; console.log('browser smoke stdout'); writeFileSync('metrics.json', JSON.stringify({ value: 1.5 }));\n",
    "utf8",
  );
  return { projectId: project.project.id, taskId: task.task.id, dataDir: project.project.dataDir };
}

test("browser flow: projects, tasks, failure visibility, materials, plan, run, results, manuscript, settings", { timeout: 180000 }, async () => {
  assert.ok(existsSync(path.join(webDist, "index.html")), "run `npm run build` before the browser test");
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("Chrome or Edge is required for the browser verification");
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-browser-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  config.maxTargetRunsPerTask = 3;
  let worker: ExperimentWorker | undefined;
  const app = await createApp({
    config,
    resourcesDir: path.join(repoRoot, "resources"),
    search: {
      search: async () => ({ query: "", channel: "crossref", retrievedAt: new Date().toISOString(), responseHash: "x", hits: [] }),
      fetchDoi: async () => {
        throw new Error("not used");
      },
    } as unknown as CrossrefSearch,
    workerFactory: (db) => {
      worker = new ExperimentWorker({ db, pollMs: 40 });
      return worker;
    },
  });
  const base = await startServer(app);
  await seed(base);
  const browser: Browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept("Browser test verified the run against its snapshot and metrics artifact."));
  worker!.start();

  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Browser Lab" }).waitFor();
    await page.getByRole("button", { name: /Chart baseline/ }).click();
    await page.getByRole("heading", { name: "Chart baseline" }).waitFor();
    await page.getByText("事件流已连接").waitFor();

    // Refresh restores the selected task, not a new session.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Chart baseline" }).waitFor();

    // A missing API key must be visible as a failure, never a fake answer.
    await page.getByLabel("消息").fill("Please summarize the project.");
    await page.getByRole("button", { name: "发送" }).click();
    await page.locator(".message.error").waitFor({ timeout: 20000 });
    assert.match(await page.locator(".message.error").innerText(), /DeepSeek|API key/i);

    // Import a readable local material with source provenance.
    await page.getByRole("tab", { name: "材料" }).click();
    await page.getByLabel("材料路径").fill("workspace/notes.txt");
    await page.getByRole("button", { name: "导入路径" }).click();
    await page.getByText("notes.txt").first().waitFor();

    // Create and confirm a plan in the UI.
    await page.getByRole("tab", { name: "方案与准入" }).click();
    await page.getByText("手动创建方案").click();
    await page.getByPlaceholder("目标").fill("Smoke-test the local experiment lifecycle");
    await page.getByPlaceholder("设计").fill("One smoke run with a recorded metric");
    await page.getByPlaceholder("dataset").fill("demo-data");
    await page.getByPlaceholder("preprocessing").fill("none");
    await page.getByPlaceholder("data license").fill("CC0");
    await page.getByPlaceholder("指标在论文中的位置").fill("Not a paper; smoke only");
    await page.getByRole("button", { name: "保存草稿" }).click();
    await page.getByRole("button", { name: "确认方案" }).waitFor();
    await page.getByRole("button", { name: "确认方案" }).click();
    await page.getByText("已确认").first().waitFor();

    // Propose and explicitly approve a smoke run.
    await page.getByRole("tab", { name: "实验" }).click();
    await page.getByText("手动提议 smoke 运行（调试管线）").click();
    await page.getByPlaceholder("名称").fill("ui-smoke");
    await page.getByPlaceholder("参数（空格分隔）").fill("smoke.mjs");
    await page.getByPlaceholder("cwd（项目内）").fill("workspace");
    await page.getByPlaceholder("/value").fill("/value");
    await page.getByRole("button", { name: "创建待批准提案" }).click();
    await page.getByRole("button", { name: "批准并排队" }).click();
    const runRow = page.locator("tr", { hasText: "ui-smoke" }).first();
    await runRow.waitFor({ timeout: 20000 });
    await runRow.locator(".status-succeeded").waitFor({ timeout: 30000 });

    // Verification is separate from process success; then analyze the artifact.
    await runRow.getByRole("button", { name: "核验" }).click();
    await runRow.locator(".status-verified").waitFor({ timeout: 15000 });
    await page.getByRole("tab", { name: "结果" }).click();
    await page.locator(".run-select input[type=checkbox]").first().check();
    await page.getByPlaceholder("结果标题").fill("UI smoke result");
    await page.getByRole("button", { name: "分析所选运行" }).click();
    await page.getByRole("heading", { name: "UI smoke result" }).waitFor({ timeout: 20000 });
    const resultCard = page.locator(".result").first();
    assert.match(await resultCard.innerText(), /不可直接比较|条件可比/);
    assert.match(await resultCard.innerText(), /metrics\.json#\/value/);
    assert.match(await resultCard.innerText(), /smoke/i);

    // Manuscript panel and real build action (server tests cover both success and failure).
    await page.getByRole("tab", { name: "稿件" }).click();
    await page.getByRole("button", { name: /main\.tex/ }).waitFor();
    const editor = page.getByLabel("编辑 main.tex");
    await editor.waitFor();
    assert.match(await editor.inputValue(), /documentclass/);
    await page.getByRole("button", { name: "构建 PDF" }).click();
    await page.getByText(/最近构建|构建诊断/).first().waitFor({ timeout: 60000 });

    // Settings persist outside project data and never echo the secret.
    await page.getByRole("tab", { name: "设置" }).click();
    await page.getByPlaceholder("you@example.org").fill("browser@example.org");
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "设置" }).click();
    assert.equal(await page.getByPlaceholder("you@example.org").inputValue(), "browser@example.org");
    assert.equal(await page.locator('input[type="password"]').inputValue(), "");

    // A new project is independent; switching back restores the task for the first project.
    await page.getByRole("button", { name: "＋ 新建项目" }).click();
    await page.getByLabel("项目名称").fill("Second Project");
    await page.getByRole("button", { name: "创建" }).click();
    await page.getByRole("heading", { name: "Second Project" }).waitFor();
    await page.getByRole("button", { name: /Browser Lab/ }).click();
    await page.getByRole("heading", { name: "Chart baseline" }).waitFor();

    assert.deepEqual(pageErrors, []);
    assert.equal(await page.evaluate(() => document.body.innerText.includes("sk-test")), false);
  } finally {
    await browser.close();
    await worker?.stop();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
