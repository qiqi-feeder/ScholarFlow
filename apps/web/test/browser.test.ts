import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { ExperimentWorker } from "@scholarflow/experiment-worker";
import { createApp, type CreatedApp } from "../../server/src/app.js";
import type { AgentServiceLike } from "../../server/src/agent.js";
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

// Capture a real server snapshot, then explicitly release it out of order.
async function holdResponse(page: Page, url: string) {
  let captured!: () => void;
  let release!: () => void;
  let finished!: () => void;
  const ready = new Promise<void>((resolve) => { captured = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const done = new Promise<void>((resolve) => { finished = resolve; });
  let first = true;
  let heldRequest: ReturnType<Route["request"]>;
  const handler = async (route: Route) => {
    if (!first) return route.continue();
    first = false;
    heldRequest = route.request();
    const response = await route.fetch();
    const body = await response.body();
    captured();
    await gate;
    await route.fulfill({ response, body });
    finished();
  };
  await page.route(url, handler);
  return { ready, release: async () => {
    const delivered = page.waitForEvent("requestfinished", { predicate: (request) => request === heldRequest });
    release();
    await done;
    await delivered;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.unroute(url, handler);
  } };
}

async function expectModel(page: Page, id: string) {
  await page.waitForFunction((value) => {
    const select = document.querySelector<HTMLSelectElement>('[aria-label="当前任务模型"]');
    return select?.value === `deepseek:${value}` && !select.disabled;
  }, id);
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

test("browser flow: projects, tasks, failure visibility, materials, plan, run, results, manuscript, settings", { timeout: 180000 }, async (t) => {
  assert.ok(existsSync(path.join(webDist, "index.html")), "run `npm run build` before the browser test");
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("Chrome or Edge is required for the browser verification");
  // Pi reads process.env independently of loadConfig. Isolate this test's
  // no-credentials case, including unrelated providers on the developer host.
  // This affects only this test process; never print credential values.
  const credentialEnv = Object.entries(process.env).filter(([name]) =>
    /(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BEARER_TOKEN|OAUTH_TOKEN|CREDENTIALS)$|^AWS_/i.test(name),
  );
  for (const [name] of credentialEnv) delete process.env[name];
  t.after(() => { for (const [name, value] of credentialEnv) process.env[name] = value; });
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

    // W01 shell: the right-hand session survives central view changes.
    const modelSelect = page.getByLabel("当前任务模型");
    await modelSelect.waitFor();
    assert.equal(await modelSelect.isDisabled(), true);
    assert.match(await page.locator(".model-hint").innerText(), /继承默认/);
    await page.getByRole("tab", { name: "材料" }).click();
    await page.getByLabel("消息").waitFor();
    assert.equal(await page.locator(".message.error").isVisible(), true);
    await page.getByRole("tab", { name: "任务" }).click();
    await page.getByRole("heading", { name: "Chart baseline" }).waitFor();

    // Import a readable local material with source provenance.
    await page.getByRole("tab", { name: "材料" }).click();
    await page.getByLabel("材料路径").fill("workspace/notes.txt");
    await page.getByRole("button", { name: "导入路径" }).click();
    await page.getByText("notes.txt").first().waitFor();

    // Create and confirm a plan in the UI.
    await page.getByRole("tab", { name: "方案与准入" }).click();
    await page.getByText("手动创建方案").click();
    await page.getByPlaceholder("目标", { exact: true }).fill("Smoke-test the local experiment lifecycle");
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
    await page.getByRole("button", { name: "同步结果图表/表格" }).click();
    await page.getByText("generated/results.tex").first().waitFor({ timeout: 60000 });
    await page.getByRole("button", { name: "构建 PDF" }).click();
    await page.getByText(/最近构建|构建诊断/).first().waitFor({ timeout: 60000 });

    // Settings persist outside project data and never echo the secret.
    await page.getByRole("tab", { name: "设置" }).click();
    await page.getByPlaceholder("you@example.org").fill("browser@example.org");
    await page.getByRole("button", { name: "保存设置" }).click();
    await page.waitForFunction(async () => {
      const response = await fetch("/api/settings");
      const settings = await response.json() as any;
      return settings.search?.contactEmail === "browser@example.org";
    });
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

test("workspace shell: persistent session, task isolation, stale-stream guard and task-level model", { timeout: 120000 }, async () => {
  assert.ok(existsSync(path.join(webDist, "index.html")), "run `npm run build` before the browser test");
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error("Chrome or Edge is required for the browser verification");
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-shell-browser-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  let app!: CreatedApp;
  const running = new Set<string>();
  const stopped: string[] = [];
  let finishTour: (() => void) | undefined;
  const seen: Array<{ taskId: string; modelId: string | null }> = [];
  const models = [
    { provider: "deepseek", id: "deepseek-flash", name: "DeepSeek Flash", available: true, reason: null },
    { provider: "deepseek", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", available: true, reason: null },
  ];
  const publish = (projectId: string, taskId: string, type: string, data: Record<string, unknown>) => {
    const event = app.services.repositories.appendEvent(projectId, taskId, type, data);
    app.services.events.publish(event);
    return event;
  };
  const agent: AgentServiceLike = {
    listModels: async () => models,
    switchModel: async (project, taskId, provider, modelId) => {
      if (!models.some((model) => model.provider === provider && model.id === modelId)) {
        throw new Error("model unavailable");
      }
      const updated = app.services.repositories.updateTask(taskId, { modelProvider: provider, modelId });
      publish(project.id, taskId, "model_changed", { provider, id: modelId, name: modelId, previous: null });
      return updated;
    },
    sendMessage: async (project, task, text, clientId) => {
      const repositories = app.services.repositories;
      const selectedModel = repositories.getTask(task.id)?.modelId ?? app.config.modelId;
      seen.push({ taskId: task.id, modelId: selectedModel });
      running.add(task.id);
      repositories.updateTask(task.id, { status: "running" });
      publish(project.id, task.id, "user_message", { text, clientId });
      publish(project.id, task.id, "agent_status", { status: "running" });
      if (text === "panel tour") {
        publish(project.id, task.id, "assistant_delta", { text: "tour streaming" });
        await new Promise<void>((resolve) => { finishTour = resolve; });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
      publish(project.id, task.id, "assistant_message", { text: `echo: ${text}`, model: selectedModel, provider: "deepseek" });
      running.delete(task.id);
      repositories.updateTask(task.id, { status: "idle" });
      publish(project.id, task.id, "agent_status", { status: "idle" });
    },
    stop: async (taskId) => {
      stopped.push(taskId);
      running.delete(taskId);
      return { stopped: true };
    },
    isRunning: (taskId) => running.has(taskId),
    dispose: async () => undefined,
  };
  const base = await startServer(await (async () => {
    app = await createApp({
      config,
      agent,
      resourcesDir: path.join(repoRoot, "resources"),
      webDist,
      search: { search: async () => ({ hits: [] }), fetchDoi: async () => { throw new Error("not used"); } } as unknown as CrossrefSearch,
    });
    return app;
  })());
  const project = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Shell Lab", description: "W01 shell verification" }),
  }).then((response) => response.json()) as any;
  const projectId = project.project.id as string;
  const createTask = async (title: string, targetProject = projectId) => {
    const response = await fetch(`${base}/api/projects/${targetProject}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, objective: `${title} objective` }),
    }).then((result) => result.json()) as any;
    return response.task.id as string;
  };
  const taskA = await createTask("Task A");
  const taskB = await createTask("Task B");
  const otherProject = await fetch(`${base}/api/projects`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Other Lab" }),
  }).then((response) => response.json()) as any;
  const otherId = otherProject.project.id as string;
  const taskC = await createTask("Task C", otherId);
  const taskD = await createTask("Task D", otherId);
  app.services.repositories.updateTask(taskA, { sessionFile: "tasks/task-a/session.jsonl" });
  const browser: Browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript((id) => localStorage.setItem("scholarflow.project", id), projectId);
  const waitForIdle = async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = await fetch(`${base}/api/projects/${projectId}/tasks/${taskA}`).then((response) => response.json()) as any;
      if (detail.task.status === "idle") return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("task did not return to idle");
  };
  try {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();

    const modelSelect = page.getByLabel("当前任务模型");
    await modelSelect.selectOption("deepseek:deepseek-v4-pro");
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const detail = await fetch(`${base}/api/projects/${projectId}/tasks/${taskA}`).then((response) => response.json()) as any;
      if (detail.task.modelId === "deepseek-v4-pro") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(await modelSelect.inputValue(), "deepseek:deepseek-v4-pro");

    // Switching central content while an answer streams must not unmount the right-hand session.
    await page.getByLabel("消息").fill("A stream");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByRole("tab", { name: "材料" }).click();
    await page.getByText("echo: A stream").waitFor({ timeout: 15000 });
    await page.getByLabel("消息").waitFor();
    await waitForIdle();

    // A message on Task A must never be written into Task B's session.
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    await page.getByLabel("消息").fill("B stream");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByText("echo: B stream").waitFor({ timeout: 15000 });
    assert.equal(await page.getByText("echo: A stream").count(), 0);

    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();
    await page.getByText("echo: A stream").waitFor();
    assert.equal(await page.getByText("echo: B stream").count(), 0);
    assert.equal(await page.getByLabel("当前任务模型").inputValue(), "deepseek:deepseek-v4-pro");

    // Switch away before a delayed answer settles; the old stream must not leak into Task B.
    await page.getByLabel("消息").fill("A late");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(await page.getByText("echo: A late").count(), 0);
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();
    await page.getByText("echo: A late").waitFor({ timeout: 15000 });

    const detail = await fetch(`${base}/api/projects/${projectId}/tasks/${taskA}`).then((response) => response.json()) as any;
    assert.equal(detail.task.id, taskA);
    assert.equal(detail.task.modelId, "deepseek-v4-pro");
    assert.equal(detail.sessionFile, "tasks/task-a/session.jsonl");
    assert.deepEqual(seen.filter((entry) => entry.taskId === taskA).map((entry) => entry.modelId), ["deepseek-v4-pro", "deepseek-v4-pro"]);
    assert.deepEqual(seen.filter((entry) => entry.taskId === taskB).map((entry) => entry.modelId), ["deepseek-flash"]);

    // WT02: every central panel remains usable during one controlled answer.
    const callsBeforeTour = seen.length;
    await page.getByLabel("消息").fill("panel tour");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByText("tour streaming", { exact: true }).waitFor();
    for (const name of ["材料", "实验", "结果", "稿件", "设置"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      assert.equal(await page.getByRole("complementary", { name: "任务会话" }).isVisible(), true);
      assert.equal(await page.getByText("tour streaming", { exact: true }).isVisible(), true);
      assert.equal(await modelSelect.isDisabled(), true);
    }
    finishTour!();
    await page.getByText("echo: panel tour", { exact: true }).waitFor();
    await expectModel(page, "deepseek-v4-pro");
    assert.equal(seen.length, callsBeforeTour + 1);
    const tourDetail = await fetch(`${base}/api/projects/${projectId}/tasks/${taskA}`).then((response) => response.json()) as any;
    assert.equal(tourDetail.sessionFile, detail.sessionFile);

    // Reconnect with a replayed duplicate: render one message and never submit
    // another model call. The second subscription resumes from the cursor.
    const replay = tourDetail.events.find((event: any) => event.type === "assistant_message" && event.data.text === "echo: panel tour");
    let subscriptions = 0;
    let resumedAfter = 0;
    const streamUrl = `${base}/api/projects/${projectId}/tasks/${taskA}/events/stream*`;
    const reconnect = async (route: Route) => {
      subscriptions += 1;
      if (subscriptions > 1) {
        resumedAfter = Number(new URL(route.request().url()).searchParams.get("after"));
        return route.continue();
      }
      const block = `id: ${replay.seq}\nevent: ${replay.type}\ndata: ${JSON.stringify(replay.data)}\n\n`;
      await route.fulfill({ contentType: "text/event-stream", body: block + block });
    };
    await page.route(streamUrl, reconnect);
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    const reconnected = page.waitForResponse((response) => response.url().includes(`${taskA}/events/stream`) && subscriptions >= 2);
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();
    await reconnected;
    assert.ok(resumedAfter >= replay.seq);
    assert.equal(await page.getByText("echo: panel tour", { exact: true }).count(), 1);
    assert.equal(seen.length, callsBeforeTour + 1);
    await page.unroute(streamUrl, reconnect);

    // R01: while B's detail is delayed, A's draft and controls are removed.
    await page.getByLabel("消息").fill("A private draft");
    const taskUrl = (project: string, task: string) => `${base}/api/projects/${project}/tasks/${task}`;
    const heldB = await holdResponse(page, taskUrl(projectId, taskB));
    await page.getByRole("button", { name: /Task B/ }).click();
    await heldB.ready;
    assert.equal(await page.getByLabel("消息").count(), 0);
    assert.equal(await modelSelect.count(), 0);
    assert.equal(await page.getByRole("button", { name: "停止回答" }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Task A" }).count(), 0);
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByLabel("消息").waitFor();
    await heldB.release();
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");
    assert.equal(await page.getByRole("heading", { name: "Task B" }).count(), 0);

    const failB = async (route: Route) => route.fulfill({ status: 503, json: { code: "DETAIL_UNAVAILABLE", error: "controlled detail failure" } });
    await page.route(taskUrl(projectId, taskB), failB);
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByText("任务加载失败，请重试或选择其他任务。").waitFor();
    assert.equal(await page.getByLabel("消息").count(), 0);
    await page.unroute(taskUrl(projectId, taskB), failB);
    await page.getByRole("button", { name: "重试加载任务" }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByLabel("消息").waitFor();
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");

    // Two projects, two tasks each: slow C must not resurrect after selecting D
    // or after returning to the first project.
    await page.getByRole("button", { name: /Other Lab/ }).click();
    await page.getByRole("button", { name: /Task C/ }).waitFor();
    const heldC = await holdResponse(page, taskUrl(otherId, taskC));
    await page.getByRole("button", { name: /Task C/ }).click();
    await heldC.ready;
    assert.equal(await page.getByLabel("消息").count(), 0);
    await page.getByRole("button", { name: /Task D/ }).click();
    await page.getByRole("heading", { name: "Task D" }).waitFor();
    await modelSelect.selectOption("deepseek:deepseek-v4-pro");
    await expectModel(page, "deepseek-v4-pro");
    await page.getByLabel("消息").fill("D target check");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByRole("button", { name: "停止回答" }).click();
    assert.equal(stopped.at(-1), taskD);
    assert.deepEqual(seen.at(-1), { taskId: taskD, modelId: "deepseek-v4-pro" });
    await page.getByRole("button", { name: /Shell Lab/ }).click();
    await page.getByLabel("消息").waitFor();
    await heldC.release();
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");
    assert.equal(await page.getByRole("heading", { name: "Task C" }).count(), 0);

    // R02: release the earlier Flash refresh after Pro has been confirmed.
    const staleModel = await holdResponse(page, taskUrl(projectId, taskA));
    await modelSelect.selectOption("deepseek:deepseek-flash");
    await staleModel.ready;
    await expectModel(page, "deepseek-flash");
    await modelSelect.selectOption("deepseek:deepseek-v4-pro");
    await expectModel(page, "deepseek-v4-pro");
    await staleModel.release();
    await expectModel(page, "deepseek-v4-pro");

    // A -> B -> A also invalidates a detail refresh from the old A epoch.
    const oldEpoch = await holdResponse(page, taskUrl(projectId, taskA));
    await modelSelect.selectOption("deepseek:deepseek-flash");
    await oldEpoch.ready;
    await expectModel(page, "deepseek-flash");
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();
    await modelSelect.selectOption("deepseek:deepseek-v4-pro");
    await expectModel(page, "deepseek-v4-pro");
    await oldEpoch.release();
    await expectModel(page, "deepseek-v4-pro");

    // A delayed PUT response must also be ignored after A -> B -> A.
    const oldWrite = await holdResponse(page, `${taskUrl(projectId, taskA)}/model`);
    await modelSelect.selectOption("deepseek:deepseek-flash");
    await oldWrite.ready;
    await page.getByRole("button", { name: /Task B/ }).click();
    await page.getByRole("heading", { name: "Task B" }).waitFor();
    await fetch(`${taskUrl(projectId, taskA)}/model`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "deepseek", modelId: "deepseek-v4-pro" }),
    });
    await page.getByRole("button", { name: /Task A/ }).click();
    await page.getByRole("heading", { name: "Task A" }).waitFor();
    await oldWrite.release();
    await expectModel(page, "deepseek-v4-pro");

    // Model failures retain both the selection and the unsent draft.
    const rejectModel = async (route: Route) => route.fulfill({ status: 400, json: { code: "MODEL_UNAVAILABLE", error: "controlled unavailable model" } });
    await page.route(`${taskUrl(projectId, taskA)}/model`, rejectModel);
    await modelSelect.selectOption("deepseek:deepseek-flash");
    await page.getByRole("alert").filter({ hasText: "MODEL_UNAVAILABLE" }).waitFor();
    await expectModel(page, "deepseek-v4-pro");
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");
    await page.unroute(`${taskUrl(projectId, taskA)}/model`, rejectModel);

    // R03: keyboard and touch entry points at 390px; toggling keeps the
    // same task, draft and model and does not recreate the session.
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNav = page.getByRole("navigation", { name: "工作区与会话" });
    await mobileNav.getByRole("button", { name: "会话", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("消息").waitFor({ state: "visible" });
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");
    await modelSelect.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expectModel(page, "deepseek-flash");
    await mobileNav.getByRole("button", { name: "工作区", exact: true }).tap();
    await page.getByRole("button", { name: /Task A/ }).waitFor({ state: "visible" });
    await mobileNav.getByRole("button", { name: "会话", exact: true }).tap();
    assert.equal(await page.getByLabel("消息").inputValue(), "A private draft");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByLabel("消息").fill("narrow model check");
    await page.getByRole("button", { name: "发送" }).click();
    await page.getByText("echo: narrow model check").waitFor();
    assert.deepEqual(seen.at(-1), { taskId: taskA, modelId: "deepseek-flash" });
    const finalDetail = await fetch(taskUrl(projectId, taskA)).then((response) => response.json()) as any;
    assert.equal(finalDetail.task.modelId, "deepseek-flash");
    assert.equal(finalDetail.sessionFile, detail.sessionFile);
    assert.equal(finalDetail.events.at(-2).data.model, "deepseek-flash");
    await page.reload({ waitUntil: "domcontentloaded" });
    await mobileNav.getByRole("button", { name: "会话", exact: true }).tap();
    await expectModel(page, "deepseek-flash");
    await page.getByText("echo: narrow model check", { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
