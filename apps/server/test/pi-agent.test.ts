import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import http from "node:http";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { PiAgentService } from "../src/agent.js";
import { CrossrefSearch } from "../src/search.js";

test("RT03/RT04: real Pi loop changes tools on the next request and reopens with core only", { timeout: 30000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-pi-dynamic-"));
  const requests: any[] = [];
  const provider = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push(JSON.parse(Buffer.concat(chunks).toString()));
    const turn = requests.length;
    const message = turn === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "load-1", type: "function", function: { name: "load_skill", arguments: JSON.stringify({ name: "result-analysis" }) } }] } : { role: "assistant", content: "Methods loaded." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = message.tool_calls ? { role: "assistant", tool_calls: message.tool_calls.map(t => ({ index: 0, ...t })) } : { role: "assistant", content: message.content };
    res.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", model: "local-test", choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "test", choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 200, completion_tokens: 20, total_tokens: 220 } })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  const config = loadConfig({ home: root, configFile: path.join(root, "config", "config.json"), dataDir: path.join(root, "data"), env: {} });
  config.workerEnabled = false; config.deepseekApiKey = "dummy-local-key";
  mkdirSync(path.join(root, "config", "pi-agent"), { recursive: true });
  writeFileSync(path.join(root, "config", "pi-agent", "models.json"), JSON.stringify({ providers: { deepseek: { baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, api: "openai-completions", apiKey: "dummy", models: [{ id: config.modelId }] } } }));
  const app = await createApp({ config });
  try {
    const project = app.services.repositories.createProject({ name: "Dynamic", dataDir: path.join(root, "project") });
    mkdirSync(project.dataDir, { recursive: true }); app.services.skills.installDefaults(project.id, project.dataDir);
    const task = app.services.repositories.createTask({ projectId: project.id, title: "Dynamic", objective: "Load methods" });
    await app.agent.sendMessage(project, task, "Load analysis", "dynamic-1");
    assert.equal(requests.length, 2);
    assert.ok(!requests[0].tools.some((t: any) => t.function.name === "analyze_results"));
    assert.ok(requests[1].tools.some((t: any) => t.function.name === "analyze_results"));
    assert.match(JSON.stringify(requests[1].messages), /Import metrics/);
    await app.agent.dispose();
    await app.agent.sendMessage(project, app.services.repositories.getTask(task.id)!, "Reopen", "dynamic-2");
    assert.ok(!requests[2].tools.some((t: any) => t.function.name === "analyze_results"));
    assert.ok(requests[2].tools.some((t: any) => t.function.name === "cancel_run"));
  } finally { await app.close(); await new Promise<void>(resolve => provider.close(() => resolve())); rmSync(root, { recursive: true, force: true }); }
});

test("Pi session wires project skills and research tools even when the model call fails", { timeout: 60000 }, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-pi-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  config.deepseekApiKey = "sk-dummy-local-test-key-000000";
  mkdirSync(path.join(root, "config", "pi-agent"), { recursive: true });
  writeFileSync(
    path.join(root, "config", "pi-agent", "models.json"),
    JSON.stringify({
      providers: {
        deepseek: {
          baseUrl: "http://127.0.0.1:9/v1",
          api: "openai-completions",
          apiKey: "dummy",
          models: [{ id: "deepseek-flash" }],
        },
      },
    }),
    "utf8",
  );
  const app = await createApp({
    config,
    resourcesDir: path.resolve(import.meta.dirname, "..", "..", "..", "resources"),
    search: {
      search: async () => ({ query: "", channel: "crossref", retrievedAt: new Date().toISOString(), responseHash: "x", hits: [] }),
      fetchDoi: async () => {
        throw new Error("not used");
      },
    } as unknown as CrossrefSearch,
  });
  try {
    assert.ok(app.agent instanceof PiAgentService);
    const project = app.services.repositories.createProject({
      name: "Pi project",
      dataDir: path.join(root, "data", "projects", "pi-project"),
    });
    mkdirSync(project.dataDir, { recursive: true });
    app.services.skills.installDefaults(project.id, project.dataDir);
    app.services.manuscript.initialize(project);
    const task = app.services.repositories.createTask({ projectId: project.id, title: "Pi task", objective: "Inspect tools" });

    await app.agent.sendMessage(project, task, "hello", "pi-client-0001");
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const inspect = (app.agent as PiAgentService).inspectTask(task.id);
      if (inspect) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const inspect = (app.agent as PiAgentService).inspectTask(task.id);
    assert.ok(inspect, "Pi session should be created");
    for (const name of ["get_research_context", "discover_capabilities", "load_skill", "query_run", "read_artifact", "cancel_run"]) {
      assert.ok(inspect.tools.includes(name), `Pi active tool missing: ${name}`);
    }
    for (const name of ["search_literature", "propose_experiment", "analyze_results", "compile_manuscript"]) assert.ok(!inspect.tools.includes(name), "domain tools start inactive");
    for (const name of ["write", "edit", "powershell", "bash"]) {
      assert.equal(inspect.tools.includes(name), false, `host write/shell tool must not be active: ${name}`);
    }
    assert.ok(inspect.sessionFile, "Pi session file must be persisted");
    assert.ok(app.services.skills.list(project.id).some((skill) => skill.name === "result-analysis"));

    let errorEvent: any;
    for (let attempt = 0; attempt < 200 && !errorEvent; attempt += 1) {
      errorEvent = app.services.repositories
        .listEvents(task.id)
        .find((event) => event.type === "error");
      if (!errorEvent) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(errorEvent, "a failed model call must be visible as an error event");
    assert.equal(JSON.stringify(errorEvent).includes("sk-dummy-local-test-key"), false);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
