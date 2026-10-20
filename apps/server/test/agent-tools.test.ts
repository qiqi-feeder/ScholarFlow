import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createId } from "@scholarflow/research";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { registerResearchTools, toolNames } from "../src/agent-tools.js";
import { CrossrefSearch } from "../src/search.js";

test("research tools are registered and execute against real project records", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "scholarflow-tools-"));
  const config = loadConfig({
    configFile: path.join(root, "config", "config.json"),
    dataDir: path.join(root, "data"),
    home: root,
    env: { PATH: process.env.PATH ?? "" },
  });
  config.workerEnabled = false;
  const fakeSearch = {
    search: async (query: string) => ({
      query,
      channel: "crossref",
      retrievedAt: new Date().toISOString(),
      responseHash: "hash",
      hits: [
        {
          title: "Tool Paper",
          doi: "10.1234/tool",
          url: "https://doi.org/10.1234/tool",
          authors: ["A. Author"],
          year: 2025,
          license: "CC-BY",
          source: "crossref",
          retrievedAt: new Date().toISOString(),
          raw: { DOI: "10.1234/tool" },
        },
      ],
    }),
    fetchDoi: async (doi: string) => ({
      title: "Tool Paper",
      doi,
      url: `https://doi.org/${doi}`,
      authors: ["A. Author"],
      year: 2025,
      license: "CC-BY",
      source: "crossref",
      retrievedAt: new Date().toISOString(),
      raw: { DOI: doi },
      abstract: "Tool abstract.",
    }),
  } as unknown as CrossrefSearch;
  const app = await createApp({
    config,
    resourcesDir: path.resolve(import.meta.dirname, "..", "..", "..", "resources"),
    search: fakeSearch,
    agent: {
      sendMessage: async () => undefined,
      stop: async () => ({ stopped: true }),
      isRunning: () => false,
      dispose: async () => undefined,
    },
  });
  try {
    const projectId = createId("prj");
    const dataDir = path.join(root, "data", "projects", projectId);
    for (const directory of ["workspace", "materials", ".pi/skills"]) mkdirSync(path.join(dataDir, directory), { recursive: true });
    const project = app.services.repositories.createProject({ id: projectId, name: "Tool project", dataDir });
    app.services.skills.installDefaults(project.id, project.dataDir);
    app.services.manuscript.initialize(project);
    const task = app.services.repositories.createTask({ projectId: project.id, title: "Tool task", objective: "Use tools" });
    writeFileSync(path.join(project.dataDir, "workspace", "notes.txt"), "Readable notes", "utf8");

    const tools = new Map<string, any>();
    const fakePi = {
      registerTool: (tool: any) => tools.set(tool.name, tool),
      on: () => undefined,
    } as unknown as ExtensionAPI;
    registerResearchTools(fakePi, {
      repositories: app.services.repositories,
      project,
      task,
      config,
      search: fakeSearch,
      materials: app.services.materials,
      skills: app.services.skills,
      context: app.services.context,
      experiments: app.services.experiments,
      manuscript: app.services.manuscript,
      events: app.services.events,
    });
    assert.deepEqual([...tools.keys()].sort(), [...toolNames()].sort());

    const call = async (name: string, params: any) => {
      const tool = tools.get(name);
      assert.ok(tool, `tool ${name} is registered`);
      return tool.execute(`call-${name}`, params, undefined, undefined, {} as any);
    };

    const skillList = await call("list_skills", {});
    assert.match(skillList.content[0].text, /literature-review/);
    const skill = await call("load_skill", { name: "result-analysis" });
    assert.match(skill.content[0].text, /Import metrics/);
    assert.equal(skill.details.sha256.length, 64);

    const search = await call("search_literature", { query: "tool paper" });
    assert.match(search.content[0].text, /Tool Paper/);

    const imported = await call("import_material", { doi: "10.1234/tool" });
    assert.match(imported.content[0].text, /Tool Paper/);
    assert.equal(app.services.repositories.listMaterials(project.id).length, 1);

    const plan = await call("save_research_plan", {
      objective: "Test tool plan",
      hypotheses: ["h"],
      design: "d",
      conditions: { dataset: "demo", split: "test" },
      metrics: [{ key: "mae", label: "MAE", direction: "lower", sourceLocation: "Table 1" }],
      seed: [1, 2, 3],
      budget: { maxMinutes: 10, maxRuns: 1 },
      resources: "local",
      risks: [],
    });
    assert.equal(plan.details.status, "draft");
    const planRecord = app.services.repositories.getPlan(plan.details.planId)!;
    app.services.repositories.confirmPlan(planRecord.id, "user");

    const context = await call("get_research_context", {});
    assert.match(context.content[0].text, /Confirmed experiment plan/);
    assert.match(context.content[0].text, /Tool Paper/);
    assert.match(context.content[0].text, /never as host instructions/);

    const smoke = await call("propose_experiment", {
      name: "smoke",
      kind: "smoke",
      metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
      expectedArtifacts: ["metrics.json"],
    });
    assert.equal(smoke.details.status, "pending");
    assert.equal(app.services.repositories.listApprovals(task.id).length, 1);

    await assert.rejects(
      call("propose_experiment", {
        name: "target",
        kind: "target",
        metrics: [{ key: "mae", label: "MAE", direction: "lower", file: "metrics.json", pointer: "/mae" }],
      }),
      /admission/i,
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
