import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, createId, sha256, validateEditableMethod, type MethodVersion, type EvolutionCandidate, type ExperienceRecord, type MethodPublication } from "@scholarflow/research";
import type { Repositories } from "./repos.js";
import { MemoryError, type MemoryPrincipal, type MemoryService } from "./memory.js";
import type { EventHub } from "./events.js";
import { CAPABILITIES } from "./capabilities.js";
import { evaluationCards, gradeMethodAnswer, EVALUATION_PROTOCOL, type MethodExecutor, type MethodEvaluation } from "./method-evaluation.js";

export class MethodService {
  private executor?: MethodExecutor;
  private readonly cancellations = new Map<string, AbortController>();
  constructor(readonly db: DatabaseSync, private readonly repos: Repositories, private readonly memory: MemoryService, private readonly events: EventHub) {
    for (const row of db.prepare("SELECT data_json FROM method_evaluations").all()) {
      const e = JSON.parse(String(row.data_json)) as MethodEvaluation;
      if (e.status === "running") {
        e.status = "interrupted"; e.passed = false; e.finishedAt = new Date().toISOString(); e.reasons.push("host restarted during evaluation; consumed budget retained, no automatic retry"); this.saveEvaluation(e);
        const row = db.prepare("SELECT data_json FROM evolution_candidates WHERE id=?").get(e.candidateId);
        if (row) { const c = JSON.parse(String(row.data_json)) as EvolutionCandidate; c.status = "evaluated"; c.rejectionReasons.push(...e.reasons); c.budgetUsed.elapsedMs = Math.min(c.budget.maxMinutes * 60000, c.budgetUsed.elapsedMs + Math.max(0, Date.now() - Date.parse(e.startedAt))); this.saveCandidate(c); }
      }
    }
  }
  setExecutor(executor: MethodExecutor) { this.executor = executor; }
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
    const candidate: EvolutionCandidate = { id: createId("evc"), projectId: p.projectId, taskId: p.taskId, skillId: input.skillId, baselineVersion: baseline.hash, candidateVersion: hash, baselineHeadRevision: this.head(p.projectId, input.skillId).revision, diff: `--- ${baseline.hash}\n+++ ${hash}\n-${(input.body === undefined ? JSON.stringify(baseline.toolDescriptions) : baseline.content).replaceAll("\n", "\n-")}\n+${(input.body === undefined ? JSON.stringify(descriptions) : content).replaceAll("\n", "\n+")}`, sourceExperienceIds: [...new Set(input.sourceExperienceIds)], editableSurface: input.body === undefined ? "tool-description" : "skill-body", status: "candidate", budget, budgetUsed: { attempts: 0, requests: 0, outputTokens: 0, elapsedMs: 0, price: "unknown" }, rejectionReasons: [], createdAt: new Date().toISOString() };
    this.db.exec("BEGIN IMMEDIATE");
    try { this.saveVersion(p.projectId, version); this.saveCandidate(candidate); this.db.exec("COMMIT"); } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    this.publish(p, "method_candidate_created", { id: candidate.id, baselineVersion: baseline.hash, candidateVersion: hash }); return candidate;
  }
  private saveEvaluation(e: MethodEvaluation) {
    this.db.prepare("INSERT INTO method_evaluations VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(e.id, e.projectId, e.candidateId, JSON.stringify(e));
  }
  evaluations(p: MemoryPrincipal, candidateId: string) {
    this.candidate(p, candidateId);
    return this.db.prepare("SELECT data_json FROM method_evaluations WHERE project_id=? AND candidate_id=? ORDER BY rowid").all(p.projectId, candidateId).map(row => {
      const { privateSamples: _sealed, ...summary } = JSON.parse(String(row.data_json)) as MethodEvaluation;
      return summary;
    });
  }
  private assertEvidence(p: MemoryPrincipal, candidate: EvolutionCandidate) {
    for (const id of candidate.sourceExperienceIds) {
      const experience = this.experiences(p).find(e => e.id === id);
      if (!experience || experience.status !== "validated" || experience.sourceMemoryVersions.some(v => { const m = this.memory.get(p, v.id); return m.revision !== v.revision || m.status !== "active"; })) throw new MemoryError("method evidence changed; review a new candidate");
    }
  }
  async evaluate(p: MemoryPrincipal, id: string, model: { provider: string; id: string }) {
    let candidate = this.candidate(p, id);
    if (!this.executor) throw new MemoryError("model evaluation executor is unavailable", "METHOD_NOT_CONFIGURED", 503);
    if (["published", "validated"].includes(candidate.status) || this.evaluations(p, id).some(e => e.status === "running")) throw new MemoryError("candidate is already validated or evaluating", "METHOD_CONFLICT", 409);
    const head = this.head(p.projectId, candidate.skillId);
    if (head.hash !== candidate.baselineVersion || head.revision !== candidate.baselineHeadRevision) throw new MemoryError("baseline moved; create a new candidate", "METHOD_CONFLICT", 409);
    this.assertEvidence(p, candidate);
    const rounds = this.db.prepare("SELECT data_json FROM method_evaluations WHERE project_id=?").all(p.projectId).map(r => JSON.parse(String(r.data_json)) as MethodEvaluation).filter(e => e.baselineVersion === candidate.baselineVersion && e.baselineHeadRevision === candidate.baselineHeadRevision);
    if (rounds.length >= 2) throw new MemoryError("independent evaluation round budget exhausted for this formal baseline revision", "METHOD_BUDGET", 409);
    if (candidate.budgetUsed.attempts >= candidate.budget.maxAttempts || candidate.budgetUsed.requests + 12 > candidate.budget.maxRequests || candidate.budgetUsed.elapsedMs >= candidate.budget.maxMinutes * 60000) throw new MemoryError("evaluation budget exhausted; baseline retained", "METHOD_BUDGET", 409);
    const evaluation: MethodEvaluation = { id: createId("eva"), candidateId: id, projectId: p.projectId, protocol: EVALUATION_PROTOCOL, model, execution: "fresh-model", permissionProfile: "isolated-read-only-no-tools", baselineVersion: candidate.baselineVersion, candidateVersion: candidate.candidateVersion, baselineHeadRevision: candidate.baselineHeadRevision, status: "running", development: { total: 2, baseline: 0, candidate: 0, feedback: [] }, holdout: { total: 2, baseline: 0, candidate: 0 }, final: { total: 2, baseline: 0, candidate: 0 }, passed: false, reasons: [], startedAt: new Date().toISOString(), privateSamples: [] };
    candidate.budgetUsed.attempts++; candidate.status = "evaluated";
    this.saveCandidate(candidate); this.saveEvaluation(evaluation);
    this.publish(p, "method_evaluation_started", { id, evaluationId: evaluation.id, model });
    const controller = new AbortController(); this.cancellations.set(id, controller);
    const start = Date.now();
    const remainingMs = candidate.budget.maxMinutes * 60000 - candidate.budgetUsed.elapsedMs;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, remainingMs))]);
    try {
      for (const card of evaluationCards()) {
        const feedback = { id: card.id, baselinePassed: false, candidatePassed: false };
        for (const variant of ["baseline", "candidate"] as const) {
          signal.throwIfAborted();
          candidate.budgetUsed.requests++; this.saveCandidate(candidate); // Persist intent before each external call.
          const version = this.version(p.projectId, candidate.skillId, variant === "baseline" ? candidate.baselineVersion : candidate.candidateVersion);
          const execution = await this.executor(version, card.prompt, { model, maxOutputTokens: candidate.budget.maxOutputTokens, signal });
          if (execution.actualModel.provider !== model.provider || execution.actualModel.id !== model.id) throw new Error("paired evaluation model changed");
          const passed = gradeMethodAnswer(card.id, execution.text);
          candidate.budgetUsed.outputTokens += execution.outputTokens ?? 0; this.saveCandidate(candidate);
          evaluation.privateSamples.push({ id: card.id, split: card.split, variant, passed, execution });
          evaluation[card.split][variant] += Number(passed);
          if (variant === "baseline") feedback.baselinePassed = passed; else feedback.candidatePassed = passed;
          this.saveEvaluation(evaluation);
        }
        if (card.split === "development") evaluation.development.feedback.push(feedback);
      }
      evaluation.status = "completed";
      evaluation.passed = evaluation.development.candidate === 2 && evaluation.holdout.candidate === 2 && evaluation.final.candidate === 2 && evaluation.development.candidate >= evaluation.development.baseline && evaluation.holdout.candidate >= evaluation.holdout.baseline;
      if (!evaluation.passed) evaluation.reasons.push("candidate did not meet all predeclared checks or regressed; baseline retained");
      candidate.status = evaluation.passed ? "validated" : "rejected";
    } catch (e) {
      evaluation.status = signal.aborted ? "interrupted" : "failed"; evaluation.passed = false;
      evaluation.reasons.push(signal.aborted ? "evaluation cancelled or timed out; baseline retained" : `execution failed: ${(e as Error).message.replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]").slice(0, 300)}`);
      candidate.status = "evaluated";
    } finally {
      candidate = { ...candidate, budgetUsed: { ...candidate.budgetUsed, elapsedMs: candidate.budgetUsed.elapsedMs + Date.now() - start }, developmentEvaluationRef: evaluation.id, holdoutEvaluationRef: evaluation.id, rejectionReasons: [...candidate.rejectionReasons, ...evaluation.reasons] };
      evaluation.finishedAt = new Date().toISOString(); this.saveCandidate(candidate); this.saveEvaluation(evaluation); this.cancellations.delete(id);
    }
    this.publish(p, "method_evaluated", { id, evaluationId: evaluation.id, status: candidate.status, passed: evaluation.passed });
    return this.evaluations(p, id).at(-1)!;
  }
  cancelEvaluation(p: MemoryPrincipal, id: string) { this.candidate(p, id); const controller = this.cancellations.get(id); controller?.abort(); return { requested: !!controller }; }
  publications(p: MemoryPrincipal): MethodPublication[] {
    this.memory.authorize(p);
    return this.db.prepare("SELECT data_json FROM method_publications WHERE project_id=? ORDER BY rowid DESC").all(p.projectId).map(r => JSON.parse(String(r.data_json)));
  }
  publishCandidate(p: MemoryPrincipal, id: string, input: { confirmed: boolean; candidateVersion: string; expectedBaselineVersion: string; expectedHeadRevision: number; reason: string }): MethodPublication {
    const candidate = this.candidate(p, id);
    if (p.actor !== "user" || input.confirmed !== true || !input.reason?.trim() || input.candidateVersion !== candidate.candidateVersion) throw new MemoryError("explicit user confirmation of this exact candidate is required", "METHOD_AUTHORITY", 403);
    this.assertEvidence(p, candidate);
    const evaluations = this.evaluations(p, id).filter(e => e.passed && e.status === "completed" && e.protocol === EVALUATION_PROTOCOL && e.baselineVersion === candidate.baselineVersion && e.candidateVersion === candidate.candidateVersion);
    if (candidate.status !== "validated" || !evaluations.length) throw new MemoryError("candidate has no complete independent evaluation", "METHOD_NOT_VALIDATED", 409);
    if (input.expectedBaselineVersion !== candidate.baselineVersion || input.expectedHeadRevision !== candidate.baselineHeadRevision) throw new MemoryError("candidate baseline confirmation is stale", "METHOD_CONFLICT", 409);
    return this.movePointer(p, candidate.skillId, input.expectedBaselineVersion, input.expectedHeadRevision, candidate.candidateVersion, input.reason, evaluations.map(e => e.id), undefined, () => { candidate.status = "published"; this.saveCandidate(candidate); });
  }
  rollback(p: MemoryPrincipal, publicationId: string, input: { confirmed: boolean; expectedBaselineVersion: string; expectedHeadRevision: number; reason: string }) {
    if (p.actor !== "user" || input.confirmed !== true || !input.reason?.trim()) throw new MemoryError("user rollback confirmation and reason required", "METHOD_AUTHORITY", 403);
    const publication = this.publications(p).find(r => r.id === publicationId); if (!publication) throw new MemoryError("publication not found", "METHOD_SCOPE", 404);
    if (input.expectedBaselineVersion !== publication.publishedVersion) throw new MemoryError("rollback must name the current publication", "METHOD_CONFLICT", 409);
    return this.movePointer(p, publication.skillId, input.expectedBaselineVersion, input.expectedHeadRevision, publication.expectedBaselineVersion, input.reason, publication.evaluationRefs, publication.id);
  }
  private movePointer(p: MemoryPrincipal, name: string, expected: string, revision: number, next: string, reason: string, evaluationRefs: string[], rollbackOf?: string, update?: () => void): MethodPublication {
    this.version(p.projectId, name, next);
    this.db.exec("BEGIN IMMEDIATE");
    let publication: MethodPublication;
    try {
      const result = this.db.prepare("UPDATE method_heads SET hash=?, revision=revision+1 WHERE project_id=? AND name=? AND hash=? AND revision=?").run(next, p.projectId, name, expected, revision);
      if (Number(result.changes) !== 1) throw new MemoryError("formal method pointer changed; reload", "METHOD_CONFLICT", 409);
      publication = { id: createId("pub"), skillId: name, expectedBaselineVersion: expected, publishedVersion: next, headRevision: revision + 1, evaluationRefs, actor: "user", reason, publishedAt: new Date().toISOString(), rollbackOf };
      this.db.prepare("INSERT INTO method_publications VALUES (?, ?, ?, ?)").run(publication.id, p.projectId, name, JSON.stringify(publication));
      update?.(); this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    this.publish(p, rollbackOf ? "method_rolled_back" : "method_published", publication); return publication;
  }
  migrateTask(p: MemoryPrincipal, name: string, expected: string, target: string, confirmed: boolean) {
    this.memory.authorize(p);
    if (p.actor !== "user" || confirmed !== true || this.head(p.projectId, name).hash !== target) throw new MemoryError("explicit user migration to the current formal version required", "METHOD_AUTHORITY", 403);
    const result = this.db.prepare("UPDATE task_method_bindings SET hash=? WHERE project_id=? AND task_id=? AND name=? AND hash=?").run(target, p.projectId, p.taskId, name, expected);
    if (Number(result.changes) !== 1) throw new MemoryError("task method binding changed", "METHOD_CONFLICT", 409);
    this.publish(p, "method_task_migrated", { name, previous: expected, target }); return this.bindings(p);
  }
  protected saveCandidate(candidate: EvolutionCandidate) {
    this.db.prepare("INSERT INTO evolution_candidates VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json").run(candidate.id, candidate.projectId, candidate.taskId, JSON.stringify(candidate));
  }
  protected publish(p: MemoryPrincipal, type: string, data: unknown) { this.events.publish(this.repos.appendEvent(p.projectId, p.taskId, type, data)); }
}
