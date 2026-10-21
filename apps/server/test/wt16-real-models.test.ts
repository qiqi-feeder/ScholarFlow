import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { CrossrefSearch } from "../src/search.js";

const enabled = process.env.SCHOLARFLOW_REAL_MODEL_TEST === "1";
const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

async function api(base: string, method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("timed out waiting for real model response");
}

test(
  "WT16: two configured models each answer one bounded real request and history keeps the actual model",
  { skip: enabled ? false : "set SCHOLARFLOW_REAL_MODEL_TEST=1 to run the bounded real-model check", timeout: 240000 },
  async () => {
    const host = loadConfig();
    assert.ok(host.deepseekApiKey || process.env.DEEPSEEK_API_KEY, "a real DeepSeek credential is required");
    const root = mkdtempSync(path.join(tmpdir(), "scholarflow-wt16-"));
    const config = loadConfig({
      configFile: path.join(root, "config", "config.json"),
      dataDir: path.join(root, "data"),
      home: root,
      env: {
        PATH: process.env.PATH ?? "",
        DEEPSEEK_API_KEY: host.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "",
      },
    });
    config.workerEnabled = false;
    const app = await createApp({
      config,
      resourcesDir: path.join(repoRoot, "resources"),
      webDist: path.join(root, "webdist"),
      search: {
        search: async () => ({ query: "", channel: "crossref", retrievedAt: new Date().toISOString(), responseHash: "x", hits: [] }),
        fetchDoi: async () => { throw new Error("not used"); },
      } as unknown as CrossrefSearch,
    });
    try {
      await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      const base = `http://127.0.0.1:${address.port}`;
      const catalog = await api(base, "GET", "/api/models");
      assert.equal(catalog.status, 200);
      const models = catalog.body.models.filter((model: any) => model.provider === "deepseek");
      assert.ok(models.length >= 2, `expected two real DeepSeek models, got ${JSON.stringify(models)}`);
      const selected = models.slice(0, 2) as Array<{ provider: string; id: string; name: string }>;
      const project = await api(base, "POST", "/api/projects", { name: "WT16 real models" });
      const projectId = project.body.project.id as string;
      const task = await api(base, "POST", `/api/projects/${projectId}/tasks`, {
        title: "Real model history",
        objective: "Verify two real models are selectable and each answer records its actual model.",
      });
      const taskId = task.body.task.id as string;
      const completed: Array<{ model: string; provider: string; seq: number; textLength: number }> = [];
      for (const model of selected) {
        const switched = await api(base, "PUT", `/api/projects/${projectId}/tasks/${taskId}/model`, {
          provider: model.provider,
          modelId: model.id,
        });
        assert.equal(switched.status, 200, JSON.stringify(switched.body));
        const sent = await api(base, "POST", `/api/projects/${projectId}/tasks/${taskId}/messages`, {
          text: `Reply with the single word OK. Do not use tools. This is a bounded model check for ${model.id}.`,
          clientId: `wt16-${model.id}-${Date.now()}`,
        });
        assert.equal(sent.status, 202, JSON.stringify(sent.body));
        const answer = await waitFor(async () => {
          const events = await api(base, "GET", `/api/projects/${projectId}/tasks/${taskId}/events`);
          const found = (events.body.events as any[]).find(
            (event) => event.type === "assistant_message" && event.data.model === model.id,
          );
          if (found) return found;
          const error = (events.body.events as any[]).find(
            (event) => event.type === "error" && event.seq > sent.body.latestSeq,
          );
          if (error) throw new Error(`real model call failed: ${error.data.message}`);
          return undefined;
        }, 120000);
        completed.push({
          model: String(answer.data.model),
          provider: String(answer.data.provider),
          seq: Number(answer.seq),
          textLength: String(answer.data.text ?? "").length,
        });
        for (let attempt = 0; attempt < 120 && app.agent.isRunning(taskId); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        assert.equal(app.agent.isRunning(taskId), false);
      }
      assert.deepEqual(completed.map((entry) => entry.model), selected.map((model) => model.id));
      assert.ok(completed.every((entry) => entry.textLength > 0 && entry.textLength < 2000));
      const detail = await api(base, "GET", `/api/projects/${projectId}/tasks/${taskId}`);
      assert.equal(detail.body.task.modelId, selected[1]!.id);
      const history = (detail.body.events as any[]).filter((event) => event.type === "assistant_message");
      assert.deepEqual(history.map((event) => event.data.model).slice(-2), selected.map((model) => model.id));
      console.log(JSON.stringify({ models: selected, completed, events: history.length }));
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
