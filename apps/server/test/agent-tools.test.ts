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
    let active: string[] = [];
    const fakePi = {
      registerTool: (tool: any) => tools.set(tool.name, tool),
      getAllTools: () => [...tools.values()],
      getActiveTools: () => active,
      setActiveTools: (names: string[]) => { active = names; },
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
    assert.ok(active.includes("analyze_results"), "same-message load enables tools");
    const otherTask = app.services.repositories.createTask({ projectId: project.id, title: "isolated", objective: "isolated" });
    assert.equal(app.services.repositories.listEvents(otherTask.id).filter(e => e.type === "capability_activated").length, 0);
    const catalog = await call("discover_capabilities", {});
    assert.match(catalog.content[0].text, /sha256/);
    await assert.rejects(() => call("activate_capability", { id: "unknown" }), /unknown capability/);
    await call("unload_capability", { id: "analysis" });
    assert.ok(!active.includes("analyze_results"));
    assert.ok(active.includes("query_run") && active.includes("cancel_run"));
    const oldActive = [...active];
    const setTools = fakePi.setActiveTools;
    fakePi.setActiveTools = (names: string[]) => setTools.call(fakePi, names.filter(n => n !== "search_literature"));
    await assert.rejects(() => call("activate_capability", { id: "literature" }), /complete requested tool set/);
    assert.deepEqual(active, oldActive, "failed assembly rolls back");
    fakePi.setActiveTools = setTools;
    const savedSkill = { ...app.services.repositories.getSkill(project.id, "literature-review")!, projectId: project.id };
    app.services.repositories.upsertSkill({ ...savedSkill, requires: ["missing-scholarflow-tool-rt03"] });
    await assert.rejects(() => call("activate_capability", { id: "literature" }), /missing dependency/);
    assert.deepEqual(active, oldActive);
    app.services.repositories.upsertSkill(savedSkill);
    assert.throws(() => app.services.skills.readForTask("wrong-project", task.id, "literature-review"), /scope mismatch/);
    const firstPage = await call("read_artifact", { path: "workspace/notes.txt", limit: 5 });
    const page = JSON.parse(firstPage.content[0].text);
    assert.equal(page.complete, false); assert.equal(page.nextOffset, 5);
    const secondPage = JSON.parse((await call("read_artifact", { path: "workspace/notes.txt", offset: 5 })).content[0].text);
    assert.equal(page.version, secondPage.version);
    assert.equal(page.text + secondPage.text, "Readable notes");
    await assert.rejects(() => call("read_research_record", { kind: "run", id: "foreign" }), /not found in this project/);

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
    const saved = await call("save_manuscript_file", { path: "main.tex", content: "\\documentclass{article}\\begin{document}Versioned source\\end{document}" });
    assert.match(saved.content[0].text, /Saved main.tex/);
    const artifact = app.services.repositories.listEvents(task.id).find((e) => e.type === "artifact_created")!;
    const reference = (artifact.data as any).reference;
    assert.equal(reference.kind, "manuscript");
    assert.equal(reference.file, "main.tex");
    assert.equal(app.services.repositories.getManuscript(reference.id)?.files.find((f) => f.path === "main.tex")?.sha256, reference.version);

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
