import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

test("RT16: real dynamic activation and scoped recall in one Pi turn", { skip: process.env.SCHOLARFLOW_REAL_CAPABILITY_TEST !== "1" ? "opt-in real capability check" : false, timeout: 120000 }, async () => {
  const host = loadConfig(), root = mkdtempSync(path.join(tmpdir(), "sf-real-capability-"));
  assert.ok(host.deepseekApiKey || process.env.DEEPSEEK_API_KEY);
  const config = loadConfig({ home: root, configFile: path.join(root, "config.json"), dataDir: path.join(root, "data"), env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: host.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "" } });
  config.workerEnabled = false; config.modelId = "deepseek-flash";
  const app = await createApp({ config });
  let unsubscribe = () => {};
  try {
    const { repositories: repos, skills, memory } = app.services;
    const project = repos.createProject({ name: "Dynamic real API", dataDir: path.join(root, "project") }); mkdirSync(project.dataDir, { recursive: true }); skills.installDefaults(project.id, project.dataDir);
    const origin = repos.createTask({ projectId: project.id, title: "Origin", objective: "Save scoped source reasoning" });
    const task = repos.createTask({ projectId: project.id, title: "Dynamic recall", objective: "Recall source reasoning only. No experiments or publication." });
    const p = { projectId: project.id, taskId: origin.id, actor: "user" as const };
    const source = repos.appendEvent(project.id, origin.id, "user_message", { text: "source reasoning: preserve source versions and conditions" });
    const candidate = memory.ingest(p, { sourceEventSeq: source.seq, scope: "project", subject: "source reasoning", predicate: "method" });
    const m = memory.revise(p, candidate.id, 1, { action: "confirm", reason: "fixed software fixture" });
    let calls = 0;
    unsubscribe = app.services.events.subscribe(task.id, e => { if (e.type === "tool_start" && ++calls > 5) void app.agent.stop(task.id); });
    await app.agent.sendMessage(project, task, "Bounded software test. Call activate_capability with id methods exactly once, then call list_method_candidates exactly once, then call recall_memory with query source reasoning exactly once. Finally reply RECALL_OK and the recalled memory ID. Use no other tools. Do not evaluate methods, create candidates, start experiments or write files.", "real-capability-once");
    const records = repos.listEvents(task.id);
    const tools = records.filter(e => e.type === "tool_start").map(e => (e.data as any).toolName);
    assert.deepEqual(tools, ["activate_capability", "list_method_candidates", "recall_memory"]);
    const answer = records.filter(e => e.type === "assistant_message").map(e => (e.data as any).text).join("\n");
    assert.match(answer, /RECALL_OK/); assert.ok(answer.includes(m.id));
    const budgets = records.filter(e => e.type === "input_budget").map(e => e.data as any);
    assert.ok(budgets.every(b => b.after <= b.limit));
    assert.equal(repos.listRunRecords().length, 0);
    if (process.env.SCHOLARFLOW_AGENT_EVIDENCE_DIR) writeFileSync(path.join(process.env.SCHOLARFLOW_AGENT_EVIDENCE_DIR, "real-capabilities.json"), JSON.stringify({ date: "2026-10-27", model: config.modelId, taskId: task.id, sourceMemory: { id: m.id, revision: m.revision }, tools, requestBudgets: budgets, witnessMatched: true, runs: 0 }, null, 2) + "\n");
  } finally { unsubscribe(); await app.close(); rmSync(root, { recursive: true, force: true }); }
});

test("RT16: bounded real paired method evaluation, provenance and restart", { skip: process.env.SCHOLARFLOW_REAL_AGENT_TEST !== "1" ? "opt-in real API evaluation" : false, timeout: 360000 }, async () => {
  const host = loadConfig();
  assert.ok(host.deepseekApiKey || process.env.DEEPSEEK_API_KEY, "configured DeepSeek is required");
  const root = mkdtempSync(path.join(tmpdir(), "sf-real-agent-"));
  const config = loadConfig({ home: root, configFile: path.join(root, "config.json"), dataDir: path.join(root, "data"), env: { PATH: process.env.PATH ?? "", DEEPSEEK_API_KEY: host.deepseekApiKey || process.env.DEEPSEEK_API_KEY || "" } });
  config.workerEnabled = false; config.modelProvider = "deepseek"; config.modelId = "deepseek-flash";
  let app = await createApp({ config });
  try {
    const { repositories: repos, skills, memory, methods } = app.services;
    const project = repos.createProject({ name: "Bounded real evaluation", dataDir: path.join(root, "project") }); mkdirSync(project.dataDir, { recursive: true }); skills.installDefaults(project.id, project.dataDir);
    const task = repos.createTask({ projectId: project.id, title: "Fixed lightweight protocol", objective: "Evaluate method instructions only. No experiments or publication." });
    const p = { projectId: project.id, taskId: task.id, actor: "user" as const };
    const source = repos.appendEvent(project.id, task.id, "user_message", { text: "For lightweight source-based reasoning, preserve source IDs, conditions, temporal scope and explicit uncertainty." });
    let m = memory.ingest(p, { sourceEventSeq: source.seq, scope: "project", subject: "source reasoning", predicate: "method", conditions: { evaluation: "lightweight-software-only" } });
    m = memory.revise(p, m.id, 1, { action: "confirm", reason: "explicit test fixture, not a scientific claim" });
    let experience = methods.experience(p, { cue: "source-based reasoning", lesson: "Read exact identifiers and conditions. Follow the requested structured output. Treat missing authority and unresolved evidence explicitly.", memoryIds: [m.id] });
    experience = methods.reviewExperience(p, experience.id, true, "reviewed fixed software fixture");
    const baseline = methods.resolve(project.id, "result-analysis");
    const candidate = methods.propose(p, { skillId: baseline.name, baselineVersion: baseline.hash, sourceExperienceIds: [experience.id], body: `${baseline.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")}\nFor structured source questions, follow the requested JSON schema exactly. Preserve identifiers, distinguish effective time from knowledge time, and retain all unresolved evidence. Do not infer authorization or verification from missing records.\n`, budget: { maxAttempts: 1, maxRequests: 12, maxOutputTokens: 512, maxMinutes: 5 } });
    const evaluation = await methods.evaluate(p, candidate.id, { provider: config.modelProvider, id: config.modelId });
    assert.equal(evaluation.status, "completed", evaluation.reasons.join("; "));
    assert.equal(methods.candidate(p, candidate.id).budgetUsed.requests, 12);
    assert.equal(methods.candidate(p, candidate.id).status, evaluation.passed ? "validated" : "rejected");
    assert.equal(methods.head(project.id, baseline.name).hash, baseline.hash, "real evaluation cannot automatically publish");
    const privateRecord = JSON.parse(String(methods.db.prepare("SELECT data_json FROM method_evaluations WHERE id=?").get(evaluation.id)!.data_json));
    const calls = privateRecord.privateSamples.map((s: any) => ({ split: s.split, variant: s.variant, inputTokens: s.execution.inputTokens, outputTokens: s.execution.outputTokens, latencyMs: s.execution.latencyMs, actualModel: s.execution.actualModel }));
    const report = { date: "2026-10-27", commitUnderTest: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(), runtime: process.version, protocol: evaluation.protocol, model: evaluation.model, permissionProfile: evaluation.permissionProfile, evaluation, calls, candidate: { id: candidate.id, baselineVersion: candidate.baselineVersion, candidateVersion: candidate.candidateVersion, status: methods.candidate(p, candidate.id).status, budgetUsed: methods.candidate(p, candidate.id).budgetUsed }, price: "unknown", humanInterventions: "fixture setup only; no answers or per-sample holdout feedback supplied to proposer", scientificAcceptance: "not evaluated" };
    await app.close(); app = await createApp({ config });
    assert.equal(app.services.methods.candidate(p, candidate.id).status, report.candidate.status);
    const next = app.services.repositories.createTask({ projectId: project.id, title: "Recall after restart", objective: "Read persisted provenance" });
    const recall = app.services.memory.recall({ ...p, taskId: next.id }, { query: "source reasoning" });
    assert.equal(recall.memories[0]!.id, m.id);
    assert.equal(app.services.methods.resolve(project.id, baseline.name, task.id).hash, baseline.hash);
    assert.equal(app.services.repositories.listRunRecords().length, 0);
    assert.equal(app.services.repositories.listEvents(next.id).filter(e => e.type === "user_message").length, 0, "restart never sends automatically");
    const evidenceDir = process.env.SCHOLARFLOW_AGENT_EVIDENCE_DIR;
    if (evidenceDir) { mkdirSync(evidenceDir, { recursive: true }); writeFileSync(path.join(evidenceDir, "real-evaluation.json"), JSON.stringify({ ...report, restart: { persisted: true, sharedRecall: true, automaticMessages: 0, runs: 0 } }, null, 2) + "\n"); }
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
