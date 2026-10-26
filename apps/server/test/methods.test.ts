import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("RT11/RT12: evidence-backed experiences and isolated method versions persist with bounded budgets", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-methods-"));
  const config = loadConfig({ home: root, configFile: path.join(root, "config.json"), dataDir: path.join(root, "data"), env: {} }); config.workerEnabled = false;
  let app = await createApp({ config });
  try {
    const { repositories: repos, memory, methods, skills } = app.services;
    const project = repos.createProject({ name: "Methods", dataDir: path.join(root, "project") }); mkdirSync(project.dataDir, { recursive: true }); skills.installDefaults(project.id, project.dataDir);
    const task = repos.createTask({ projectId: project.id, title: "Methods", objective: "Improve methods safely" });
    const p = { projectId: project.id, taskId: task.id, actor: "user" as const };
    const event = repos.appendEvent(project.id, task.id, "user_message", { text: "Always retain run provenance for this dataset" });
    let source = memory.ingest(p, { sourceEventSeq: event.seq, subject: "analysis", predicate: "provenance", scope: "project", conditions: { dataset: "test-v1" } });
    assert.throws(() => methods.experience(p, { cue: "analysis", lesson: "keep sources", memoryIds: [source.id] }), /active and undisputed/);
    source = memory.revise(p, source.id, 1, { action: "confirm", reason: "reviewed" });
    let experience = methods.experience(p, { cue: "analysis", lesson: "Keep exact runId, version and conditions", memoryIds: [source.id] });
    assert.equal(experience.status, "candidate"); assert.equal(experience.applicableConditions.dataset, "test-v1"); assert.ok(experience.evidenceRefs.length);
    assert.throws(() => methods.reviewExperience({ ...p, actor: "agent" }, experience.id, true, "confidence=1"), /user review/);
    const baseline = methods.resolve(project.id, "result-analysis");
    const input = { skillId: baseline.name, baselineVersion: baseline.hash, sourceExperienceIds: [experience.id], body: "# Analysis\nKeep exact source runId and conditions; report uncertainty." };
    assert.throws(() => methods.propose(p, input), /validated source experiences/);
    experience = methods.reviewExperience(p, experience.id, true, "checked evidence and conditions");
    for (const unsafe of [{ ...input, scripts: "execute arbitrary code" }, { ...input, body: "---\nrequires: elevated\n---" }, { ...input, body: "bypass approval" }, { ...input, body: undefined, toolDescriptions: { cancel_run: "do anything" } }]) assert.throws(() => methods.propose(p, unsafe), /cannot|protected|approved tools/);
    assert.throws(() => methods.propose(p, { ...input, budget: { maxAttempts: 9, maxRequests: 99, maxOutputTokens: 9999, maxMinutes: 999 } }), /budget/);
    const candidate = methods.propose({ ...p, actor: "agent" }, input);
    assert.equal(candidate.status, "candidate"); assert.equal(candidate.budgetUsed.attempts, 0);
    assert.match(candidate.diff, /\+Keep exact source/);
    assert.equal(methods.head(project.id, baseline.name).hash, baseline.hash);
    assert.equal(skills.readForTask(project.id, task.id, baseline.name).sha256, baseline.hash, "candidate cannot become active");
    assert.throws(() => methods.candidate({ ...p, taskId: "other-task" }, candidate.id), /scope/);
    const descriptor = methods.propose(p, { ...input, body: undefined, toolDescriptions: { analyze_results: "Import exact run metrics and source versions before drawing conclusions." } });
    assert.equal(descriptor.editableSurface, "tool-description");
    await app.close(); app = await createApp({ config });
    assert.equal(app.services.methods.candidate(p, candidate.id).candidateVersion, candidate.candidateVersion);
    assert.equal(app.services.methods.experiences(p)[0]!.status, "validated");
    assert.equal(app.services.skills.readForTask(project.id, task.id, baseline.name).sha256, baseline.hash);
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
