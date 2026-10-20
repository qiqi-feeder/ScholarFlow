import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { PiAgentService } from "../src/agent.js";
import { CrossrefSearch } from "../src/search.js";

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
    for (const name of ["read", "write", "edit", "grep", "find", "ls", "get_research_context", "search_literature", "propose_experiment", "analyze_results", "compile_manuscript"]) {
      assert.ok(inspect.tools.includes(name), `Pi active tool missing: ${name}`);
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
