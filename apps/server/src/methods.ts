import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, createId, sha256, validateEditableMethod, type MethodVersion, type EvolutionCandidate, type ExperienceRecord } from "@scholarflow/research";
import type { Repositories } from "./repos.js";
import { MemoryError, type MemoryPrincipal, type MemoryService } from "./memory.js";
import type { EventHub } from "./events.js";
import { CAPABILITIES } from "./capabilities.js";

export class MethodService {
  constructor(readonly db: DatabaseSync, private readonly repos: Repositories, private readonly memory: MemoryService, private readonly events: EventHub) {}
  install(projectId: string, name: string) {
    const skill = this.repos.getSkill(projectId, name); if (!skill) throw new Error("skill not found");
    const version: MethodVersion = { ...skill, hash: skill.sha256, toolDescriptions: {} };
    this.saveVersion(projectId, version);
    this.db.prepare("INSERT INTO method_heads VALUES (?, ?, ?, 0) ON CONFLICT(project_id, name) DO UPDATE SET hash=excluded.hash, revision=method_heads.revision+1").run(projectId, name, version.hash);
  }
  private saveVersion(projectId: string, version: MethodVersion) {
    this.db.prepare("INSERT OR IGNORE INTO method_versions VALUES (?, ?, ?, ?)").run(projectId, version.name, version.hash, JSON.stringify(version));
  }
  head(projectId: string, name: string): { hash: string; revision: number } {
    const head = this.db.prepare("SELECT hash, revision FROM method_heads WHERE project_id=? AND name=?").get(projectId, name);
    if (!head) { this.install(projectId, name); return this.head(projectId, name); }
    return { hash: String(head.hash), revision: Number(head.revision) };
  }
  version(projectId: string, name: string, hash: string): MethodVersion {
    const row = this.db.prepare("SELECT data_json FROM method_versions WHERE project_id=? AND name=? AND hash=?").get(projectId, name, hash);
    if (!row) throw new MemoryError("method version not found in this project", "METHOD_SCOPE", 404);
    return JSON.parse(String(row.data_json));
  }
  resolve(projectId: string, name: string, taskId?: string): MethodVersion {
    let hash = this.head(projectId, name).hash;
    if (taskId) {
      if (this.repos.getTask(taskId)?.projectId !== projectId) throw new MemoryError("method task scope mismatch", "METHOD_SCOPE", 404);
      this.db.prepare("INSERT OR IGNORE INTO task_method_bindings VALUES (?, ?, ?, ?)").run(projectId, taskId, name, hash);
      hash = String(this.db.prepare("SELECT hash FROM task_method_bindings WHERE project_id=? AND task_id=? AND name=?").get(projectId, taskId, name)!.hash);
    }
    return this.version(projectId, name, hash);
  }
  bindings(p: MemoryPrincipal) {
    this.memory.authorize(p);
    return this.repos.listSkills(p.projectId).map(s => { const v = this.resolve(p.projectId, s.name, p.taskId); return { name: v.name, hash: v.hash, version: v.version }; });
  }
  experiences(p: MemoryPrincipal): ExperienceRecord[] {
    this.memory.authorize(p);
    return this.db.prepare("SELECT data_json FROM experiences WHERE project_id=? AND task_id=? ORDER BY rowid DESC").all(p.projectId, p.taskId).map(r => JSON.parse(String(r.data_json)));
  }
  experience(p: MemoryPrincipal, input: { cue: string; lesson: string; memoryIds: string[] }): ExperienceRecord {
    this.memory.authorize(p);
    if (!input.cue?.trim() || !input.lesson?.trim() || input.cue.length > 1000 || input.lesson.length > 3000 || !Array.isArray(input.memoryIds) || !input.memoryIds.length || input.memoryIds.length > 8) throw new MemoryError("experience requires a cue, lesson and 1–8 evidence memories");
    const evidence = [...new Set(input.memoryIds)].map(id => this.memory.get(p, id));
    if (evidence.some(m => m.status !== "active")) throw new MemoryError("experience evidence must be active and undisputed");
    const conditions: Record<string, string> = {};
    for (const m of evidence) for (const [key, value] of Object.entries(m.conditions)) {
      if (key in conditions && conditions[key] !== value) throw new MemoryError("experience sources have incompatible conditions"); conditions[key] = value;
    }
    const record: ExperienceRecord = { id: createId("exp"), projectId: p.projectId, sourceTaskId: p.taskId, cue: input.cue.trim(), lesson: input.lesson.trim(), applicableConditions: conditions, evidenceRefs: evidence.flatMap(m => m.sourceRefs), sourceMemoryVersions: evidence.map(m => ({ id: m.id, revision: m.revision })), methodVersions: this.bindings(p).map(v => ({ name: v.name, hash: v.hash })), status: "candidate", recordedAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO experiences VALUES (?, ?, ?, ?)").run(record.id, p.projectId, p.taskId, JSON.stringify(record));
    this.publish(p, "experience_created", { id: record.id, status: record.status }); return record;
  }
  reviewExperience(p: MemoryPrincipal, id: string, accept: boolean, reason: string) {
    this.memory.authorize(p);
    if (p.actor !== "user" || !reason?.trim()) throw new MemoryError("experience requires user review and a reason", "METHOD_AUTHORITY", 403);
    const record = this.experiences(p).find(r => r.id === id); if (!record || record.status !== "candidate") throw new MemoryError("experience candidate not found or already reviewed", "METHOD_CONFLICT", 409);
    if (record.sourceMemoryVersions.some(v => { const m = this.memory.get(p, v.id); return m.status !== "active" || m.revision !== v.revision; })) throw new MemoryError("experience evidence changed; review a new candidate");
    record.status = accept ? "validated" : "rejected"; record.reviewReason = reason;
    this.db.prepare("UPDATE experiences SET data_json=? WHERE id=?").run(JSON.stringify(record), id); this.publish(p, "experience_reviewed", { id, status: record.status, reason }); return record;
  }
  candidates(p: MemoryPrincipal): EvolutionCandidate[] {
    this.memory.authorize(p);
    return this.db.prepare("SELECT data_json FROM evolution_candidates WHERE project_id=? AND task_id=? ORDER BY rowid DESC").all(p.projectId, p.taskId).map(r => JSON.parse(String(r.data_json)));
  }
  candidate(p: MemoryPrincipal, id: string) {
    const record = this.candidates(p).find(c => c.id === id); if (!record) throw new MemoryError("candidate not found in this task", "METHOD_SCOPE", 404); return record;
  }
  propose(p: MemoryPrincipal, input: { skillId: string; baselineVersion: string; sourceExperienceIds: string[]; body?: string; toolDescriptions?: Record<string, string>; budget?: EvolutionCandidate["budget"] }) {
    this.memory.authorize(p);
    if (typeof input.skillId !== "string" || typeof input.baselineVersion !== "string" || !Array.isArray(input.sourceExperienceIds) || !input.sourceExperienceIds.length || input.sourceExperienceIds.length > 8) throw new MemoryError("method, baseline and 1–8 source experiences are required");
    const allowedKeys = ["skillId", "baselineVersion", "sourceExperienceIds", "body", "toolDescriptions", "budget"];
    if (Object.keys(input).some(k => !allowedKeys.includes(k))) throw new MemoryError("host configuration, scripts and validators cannot be changed by a method candidate");
    const baseline = this.resolve(p.projectId, input.skillId);
    if (baseline.hash !== input.baselineVersion) throw new MemoryError("baseline version changed; reload", "METHOD_CONFLICT", 409);
    const experiences = input.sourceExperienceIds?.map(id => this.experiences(p).find(e => e.id === id));
    if (!experiences?.length || experiences.some(e => !e || e.status !== "validated")) throw new MemoryError("method changes require validated source experiences");
    if (experiences.some(e => e!.sourceMemoryVersions.some(v => { const m = this.memory.get(p, v.id); return m.status !== "active" || m.revision !== v.revision; }))) throw new MemoryError("source experience evidence changed; review again");
    const allowedTools = CAPABILITIES.filter(c => (c.skills as readonly string[]).includes(input.skillId) && c.id !== "methods").flatMap(c => [...c.tools]);
    try { validateEditableMethod(input.body, input.toolDescriptions, allowedTools); } catch (e) { this.publish(p, "method_proposal_rejected", { skillId: input.skillId, reason: (e as Error).message }); throw new MemoryError((e as Error).message); }
    if ((input.body === undefined) === (input.toolDescriptions === undefined)) throw new MemoryError("choose exactly one editable surface");
    const header = baseline.content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
    const content = input.body === undefined ? baseline.content : `${header?.[0] ?? ""}\n${input.body}\n`;
    const descriptions = input.toolDescriptions ?? baseline.toolDescriptions;
    const hash = sha256(canonicalJson({ content, toolDescriptions: descriptions }));
    if (content === baseline.content && canonicalJson(descriptions) === canonicalJson(baseline.toolDescriptions)) throw new MemoryError("candidate must change the method");
    const budget = input.budget ?? { maxAttempts: 2, maxRequests: 16, maxOutputTokens: 1024, maxMinutes: 5 };
    if (Object.keys(budget).some(k => !["maxAttempts", "maxRequests", "maxOutputTokens", "maxMinutes"].includes(k)) || ![budget.maxAttempts, budget.maxRequests, budget.maxOutputTokens, budget.maxMinutes].every(v => Number.isInteger(v) && v > 0) || budget.maxAttempts > 2 || budget.maxRequests > 16 || budget.maxOutputTokens > 1024 || budget.maxMinutes > 5) throw new MemoryError("method evaluation budget exceeds the fixed lightweight envelope");
    const version: MethodVersion = { ...baseline, hash, version: `method-${hash.slice(0, 12)}`, content, toolDescriptions: descriptions };
    const candidate: EvolutionCandidate = { id: createId("evc"), projectId: p.projectId, taskId: p.taskId, skillId: input.skillId, baselineVersion: baseline.hash, candidateVersion: hash, diff: `--- ${baseline.hash}\n+++ ${hash}\n-${(input.body === undefined ? JSON.stringify(baseline.toolDescriptions) : baseline.content).replaceAll("\n", "\n-")}\n+${(input.body === undefined ? JSON.stringify(descriptions) : content).replaceAll("\n", "\n+")}`, sourceExperienceIds: [...new Set(input.sourceExperienceIds)], editableSurface: input.body === undefined ? "tool-description" : "skill-body", status: "candidate", budget, budgetUsed: { attempts: 0, requests: 0, outputTokens: 0, elapsedMs: 0, price: "unknown" }, rejectionReasons: [], createdAt: new Date().toISOString() };
    this.db.exec("BEGIN IMMEDIATE");
    try { this.saveVersion(p.projectId, version); this.saveCandidate(candidate); this.db.exec("COMMIT"); } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    this.publish(p, "method_candidate_created", { id: candidate.id, baselineVersion: baseline.hash, candidateVersion: hash }); return candidate;
  }
  protected saveCandidate(candidate: EvolutionCandidate) {
    this.db.prepare("INSERT INTO evolution_candidates VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(candidate.id, candidate.projectId, candidate.taskId, JSON.stringify(candidate));
  }
  protected publish(p: MemoryPrincipal, type: string, data: unknown) { this.events.publish(this.repos.appendEvent(p.projectId, p.taskId, type, data)); }
}
