import type { DatabaseSync } from "node:sqlite";
import { canonicalJson, createId, memoryRelation, memoryAt, sha256, estimateTokens, type MemoryRecord, type MemoryChange, type RecallSnapshot } from "@scholarflow/research";
import type { Repositories, EventRecord } from "./repos.js";
import type { EventHub } from "./events.js";

export interface MemoryPrincipal { projectId: string; taskId: string; actor: "user" | "agent" }
export class MemoryError extends Error {
  constructor(message: string, readonly code = "INVALID_MEMORY", readonly status = 400) { super(message); }
}
export interface IngestMemory { sourceEventSeq: number; scope: "project" | "task"; subject: string; predicate: string; conditions?: Record<string, string>; validFrom?: string; validTo?: string }
export class MemoryService {
  constructor(readonly db: DatabaseSync, private readonly repos: Repositories, private readonly events: EventHub) {}
  authorize(p: MemoryPrincipal) {
    if (!p.projectId || !p.taskId || !["user", "agent"].includes(p.actor) || this.repos.getTask(p.taskId)?.projectId !== p.projectId) throw new MemoryError("memory scope is not authorized", "MEMORY_SCOPE", 404);
  }
  private visible(p: MemoryPrincipal, record: MemoryRecord) {
    return record.sourceProjectId === p.projectId && (record.scope === "project" || record.scopeId === p.taskId);
  }
  list(p: MemoryPrincipal): MemoryRecord[] {
    this.authorize(p);
    return this.db.prepare("SELECT v.data_json FROM memory_versions v JOIN memory_heads h ON h.memory_id=v.memory_id AND h.revision=v.revision WHERE v.project_id=? AND (v.scope='project' OR v.task_id=?) ORDER BY v.recorded_at, v.memory_id")
      .all(p.projectId, p.taskId).map(row => JSON.parse(String(row.data_json)) as MemoryRecord).filter(r => this.visible(p, r));
  }
  get(p: MemoryPrincipal, id: string): MemoryRecord {
    this.authorize(p);
    const row = this.db.prepare("SELECT v.data_json FROM memory_versions v JOIN memory_heads h ON h.memory_id=v.memory_id AND h.revision=v.revision WHERE v.memory_id=? AND v.project_id=? AND (v.scope='project' OR v.task_id=?)").get(id, p.projectId, p.taskId);
    if (!row) throw new MemoryError("memory not found in this scope", "MEMORY_SCOPE", 404);
    return JSON.parse(String(row.data_json));
  }
  history(p: MemoryPrincipal, id: string): MemoryRecord[] {
    this.get(p, id);
    return this.db.prepare("SELECT data_json FROM memory_versions WHERE memory_id=? ORDER BY revision").all(id).map(r => JSON.parse(String(r.data_json)));
  }
  changes(p: MemoryPrincipal, id: string): MemoryChange[] {
    this.get(p, id);
    return this.db.prepare("SELECT data_json FROM memory_changes WHERE memory_id=? ORDER BY rowid").all(id).map(r => JSON.parse(String(r.data_json)));
  }
  recall(p: MemoryPrincipal, input: { query?: string; subject?: string; predicate?: string; asOf?: string; knownAt?: string; budget?: number } = {}) {
    this.authorize(p);
    const query = input.query ?? "";
    if (typeof query !== "string" || query.length > 500) throw new MemoryError("invalid recall query");
    const asOf = this.time(input.asOf) ?? new Date().toISOString(), knownAt = this.time(input.knownAt) ?? new Date().toISOString();
    const budget = input.budget ?? 2000;
    if (!Number.isInteger(budget) || budget < 200 || budget > 4000) throw new MemoryError("recall budget must be 200–4000 estimated tokens");
    const exclusions: string[] = [];
    const available = this.list(p).flatMap(head => {
      const selected = memoryAt(this.history(p, head.id), asOf, knownAt);
      if (!selected || selected.status === "candidate") { exclusions.push(`${head.id}: withdrawn, candidate, out of validity or not yet known`); return []; }
      return [selected];
    });
    const terms = (this.repos.getTask(p.taskId)!.objective.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 20);
    const relevance = (r: MemoryRecord) => terms.reduce((score, term) => score + Number(`${r.subject} ${r.predicate} ${JSON.stringify(r.value)}`.toLowerCase().includes(term)), 0) + Number(r.sourceTaskId === p.taskId) + Number(r.kind === "confirmed_decision");
    const matches = available.filter(r => (!input.subject || r.subject === input.subject) && (!input.predicate || r.predicate === input.predicate) && (!query || `${r.subject} ${r.predicate} ${JSON.stringify(r.value)}`.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => relevance(b) - relevance(a) || b.recordedAt.localeCompare(a.recordedAt));
    const selected: ReturnType<typeof summarizeMemory>[] = [], visited = new Set<string>();
    for (const match of matches) {
      if (visited.has(match.id)) continue;
      const group = [match];
      for (let i = 0; i < group.length; i++) for (const id of group[i]!.conflictsWith) {
        const peer = available.find(r => r.id === id);
        if (peer && !group.some(r => r.id === id)) group.push(peer);
      }
      group.forEach(r => visited.add(r.id));
      const summaries = group.map(summarizeMemory);
      if (estimateTokens([...selected, ...summaries]) > budget) { exclusions.push(`${group.map(r => r.id).join(",")}: entire evidence/conflict group excluded by budget; narrow query or read by ID`); continue; }
      selected.push(...summaries);
    }
    const boundedExclusions = exclusions.slice(0, 20);
    if (exclusions.length > 20) boundedExclusions.push(`${exclusions.length - 20} additional exclusions; narrow the query for details`);
    const snapshot: RecallSnapshot = { id: createId("rcl"), destinationProjectId: p.projectId, destinationTaskId: p.taskId, query, asOf: input.asOf, knownAt: input.knownAt, selectedMemoryVersions: selected.map(r => ({ id: r.id, revision: r.revision })), exclusions: boundedExclusions, budgetEstimate: estimateTokens(selected) };
    this.transaction(() => {
      this.db.prepare("INSERT INTO recall_snapshots VALUES (?, ?, ?, ?)").run(snapshot.id, p.projectId, p.taskId, JSON.stringify(snapshot));
      return { result: snapshot, event: this.repos.appendEvent(p.projectId, p.taskId, "memory_recalled", { snapshotId: snapshot.id, versions: snapshot.selectedMemoryVersions, estimated: true }) };
    });
    return { snapshot, memories: selected, estimated: true };
  }
  snapshots(p: MemoryPrincipal) {
    this.authorize(p);
    return this.db.prepare("SELECT data_json FROM recall_snapshots WHERE project_id=? AND task_id=? ORDER BY rowid DESC LIMIT 10").all(p.projectId, p.taskId).map(r => JSON.parse(String(r.data_json)) as RecallSnapshot);
  }
  snapshot(p: MemoryPrincipal, id: string) {
    this.authorize(p);
    const row = this.db.prepare("SELECT data_json FROM recall_snapshots WHERE id=? AND project_id=? AND task_id=?").get(id, p.projectId, p.taskId);
    if (!row) throw new MemoryError("recall snapshot not found in this task", "MEMORY_SCOPE", 404);
    return JSON.parse(String(row.data_json)) as RecallSnapshot;
  }
  private time(value?: string) {
    if (value !== undefined && (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value)))) throw new MemoryError("use an explicit ISO timestamp or leave time unknown");
    return value === undefined ? undefined : new Date(value).toISOString();
  }
  private append(record: MemoryRecord, previous: MemoryRecord | null, action: string, actor: string, reason: string) {
    const expected = previous?.revision ?? 0;
    const head = this.db.prepare("SELECT revision FROM memory_heads WHERE memory_id=?").get(record.id);
    if (Number(head?.revision ?? 0) !== expected) throw new MemoryError("memory revision changed; reload before editing", "MEMORY_CONFLICT", 409);
    this.db.prepare("INSERT INTO memory_versions VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.id, record.revision, record.sourceProjectId, record.scope === "task" ? record.scopeId : record.sourceTaskId, record.scope, JSON.stringify(record), record.recordedAt);
    this.db.prepare("INSERT INTO memory_heads VALUES (?, ?) ON CONFLICT(memory_id) DO UPDATE SET revision=excluded.revision").run(record.id, record.revision);
    const change: MemoryChange = { id: createId("mch"), memoryId: record.id, expectedRevision: expected, previousVersion: previous, newVersion: record, action, actor, reason, evidenceRefs: record.sourceRefs, recordedAt: record.recordedAt };
    this.db.prepare("INSERT INTO memory_changes VALUES (?, ?, ?)").run(change.id, record.id, JSON.stringify(change));
  }
  private transaction<T>(action: () => { result: T; event?: EventRecord }): T {
    this.db.exec("BEGIN IMMEDIATE");
    let outcome;
    try { outcome = action(); this.db.exec("COMMIT"); } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    if (outcome.event) this.events.publish(outcome.event);
    return outcome.result;
  }
  private conflicts(p: MemoryPrincipal, incoming: MemoryRecord) {
    for (const prior of this.list(p).filter(r => r.id !== incoming.id && memoryRelation(r, incoming) === "conflict")) {
      incoming.status = "disputed";
      if (!incoming.conflictsWith.includes(prior.id)) incoming.conflictsWith.push(prior.id);
      if (!prior.conflictsWith.includes(incoming.id)) this.append({ ...prior, status: "disputed", revision: prior.revision + 1, recordedAt: incoming.recordedAt, conflictsWith: [...prior.conflictsWith, incoming.id] }, prior, "dispute", "host", "contradictory evidence under the same conditions");
    }
  }
  ingest(p: MemoryPrincipal, input: IngestMemory): MemoryRecord {
    this.authorize(p);
    if (!["project", "task"].includes(input.scope) || typeof input.subject !== "string" || !input.subject.trim() || input.subject.length > 160 || typeof input.predicate !== "string" || !input.predicate.trim() || input.predicate.length > 100) throw new MemoryError("explicit scope, subject and predicate are required");
    const event = this.repos.getEvent(input.sourceEventSeq);
    if (!event || event.projectId !== p.projectId || event.taskId !== p.taskId) throw new MemoryError("persisted source event not found in task", "MEMORY_SCOPE", 404);
    const data = event.data as Record<string, unknown>;
    const conditions = input.conditions ?? {};
    if (p.actor === "agent" && (input.validFrom !== undefined || input.validTo !== undefined)) throw new MemoryError("agent extraction must leave unverified validity times unknown");
    if (!conditions || Array.isArray(conditions) || typeof conditions !== "object" || Object.values(conditions).some(v => typeof v !== "string") || JSON.stringify(conditions).length > 2000) throw new MemoryError("invalid conditions");
    let role: string, kind: MemoryRecord["kind"], status: MemoryRecord["status"], value: unknown;
    if (["user_message", "assistant_message"].includes(event.type)) { role = event.type === "user_message" ? "user" : "assistant"; kind = "hypothesis"; status = "candidate"; value = data.text; }
    else if (event.type === "plan_confirmed") {
      const plan = this.repos.getPlan(String(data.planId));
      if (!plan || plan.projectId !== p.projectId || plan.taskId !== p.taskId || plan.status !== "confirmed" || plan.confirmedBy !== "user") throw new MemoryError("source plan is not user confirmed");
      role = "user"; kind = "confirmed_decision"; status = "active"; value = { planId: plan.id, version: plan.version, objective: plan.objective, conditions: plan.conditions, budget: plan.budget };
    } else if (event.type === "tool_end") { role = "tool"; kind = "tool_observation"; status = "active"; value = { toolName: data.toolName, text: data.text, isError: data.isError }; }
    else if (event.type === "material_imported") {
      const material = this.repos.findMaterial(p.projectId, String(data.materialId)); if (!material) throw new MemoryError("source material not found");
      role = "source"; kind = "paper_claim"; status = "active"; value = { materialId: material.id, title: material.title, sha256: material.sha256, note: material.note };
    } else throw new MemoryError("source event cannot produce memory");
    if (value === undefined || JSON.stringify(value).length > 16000) throw new MemoryError("source is missing or too large; use a bounded persisted source");
    const validFrom = this.time(input.validFrom), validTo = this.time(input.validTo);
    if (validFrom && validTo && validFrom >= validTo) throw new MemoryError("invalid validity interval");
    const sourceKey = sha256(canonicalJson({ seq: event.seq, scope: input.scope, subject: input.subject.trim(), predicate: input.predicate.trim(), conditions }));
    return this.transaction(() => {
      const receipt = this.db.prepare("SELECT memory_id FROM memory_ingestions WHERE project_id=? AND task_id=? AND source_key=?").get(p.projectId, p.taskId, sourceKey);
      if (receipt) return { result: this.get(p, String(receipt.memory_id)) };
      const record: MemoryRecord = { id: createId("mem"), ownerId: "local-user", sourceProjectId: p.projectId, sourceTaskId: p.taskId, sourceEventSeq: event.seq, scope: input.scope, scopeId: input.scope === "project" ? p.projectId : p.taskId, subject: input.subject.trim(), predicate: input.predicate.trim(), value, conditions, kind, status, authority: { role, identity: `event:${event.seq}` }, sourceRefs: [{ projectId: p.projectId, taskId: p.taskId, kind: "event", id: String(event.seq), version: sha256(JSON.stringify(event.data)), role }], revision: 1, validFrom, validTo, recordedAt: new Date().toISOString(), supersedes: [], conflictsWith: [] };
      this.conflicts(p, record); this.append(record, null, "ingest", p.actor, "mapped from persisted source");
      this.db.prepare("INSERT INTO memory_ingestions VALUES (?, ?, ?, ?)").run(p.projectId, p.taskId, sourceKey, record.id);
      return { result: record, event: this.repos.appendEvent(p.projectId, p.taskId, "memory_changed", { id: record.id, revision: record.revision, status: record.status }) };
    });
  }
  revise(p: MemoryPrincipal, id: string, expectedRevision: number, input: { action: "correct" | "confirm" | "withdraw" | "state_change"; value?: unknown; reason: string; validFrom?: string }): MemoryRecord {
    this.authorize(p);
    if (p.actor !== "user") throw new MemoryError("only the user may confirm, correct or withdraw memory", "MEMORY_AUTHORITY", 403);
    if (!input.reason?.trim() || input.reason.length > 2000 || !["correct", "confirm", "withdraw", "state_change"].includes(input.action)) throw new MemoryError("an action and reason are required");
    if (input.value !== undefined && JSON.stringify(input.value).length > 8000) throw new MemoryError("correction is too large");
    return this.transaction(() => {
      let previous = this.get(p, id);
      if (previous.revision !== expectedRevision) throw new MemoryError("memory revision changed; reload before editing", "MEMORY_CONFLICT", 409);
      if (["tool_observation", "paper_claim"].includes(previous.kind) && input.action !== "withdraw") throw new MemoryError("raw observations and paper sources cannot be rewritten as user decisions; withdraw or record a separate decision");
      if (input.action === "confirm" && previous.status !== "candidate") throw new MemoryError("only a candidate can be confirmed");
      const validFrom = input.action === "state_change" ? this.time(input.validFrom) : previous.validFrom;
      if (input.action === "state_change" && !validFrom) throw new MemoryError("state change requires an explicit effective time");
      if (validFrom && previous.validTo && validFrom >= previous.validTo) throw new MemoryError("invalid validity interval");
      const review = this.repos.appendEvent(p.projectId, p.taskId, "memory_reviewed", { id, expectedRevision, ...input, actor: "user" });
      const priorValidTo = previous.validTo;
      if (input.action === "state_change") {
        if (previous.validFrom && validFrom! <= previous.validFrom) throw new MemoryError("state change must advance the known effective time; use a correction for earlier facts");
        const closed = { ...previous, revision: previous.revision + 1, validTo: validFrom, recordedAt: review.createdAt, supersedes: [...previous.supersedes, `${id}@${previous.revision}`] };
        this.append(closed, previous, "close_interval", p.actor, input.reason);
        previous = closed;
      }
      const record: MemoryRecord = { ...previous, value: input.value === undefined ? previous.value : input.value, kind: input.action === "withdraw" ? previous.kind : "confirmed_decision", status: input.action === "withdraw" ? "withdrawn" : "active", authority: { role: "user", identity: `event:${review.seq}` }, revision: previous.revision + 1, recordedAt: review.createdAt, validFrom, validTo: input.action === "state_change" ? priorValidTo : previous.validTo, supersedes: [...previous.supersedes, `${id}@${previous.revision}`], conflictsWith: [], sourceRefs: [...previous.sourceRefs, { projectId: p.projectId, taskId: p.taskId, kind: "event", id: String(review.seq), version: sha256(JSON.stringify(review.data)), role: "user" }] };
      for (const peer of this.list(p).filter(r => r.id !== id && r.conflictsWith.includes(id) && memoryRelation(r, record) !== "conflict")) {
        const remaining = peer.conflictsWith.filter(other => other !== id);
        this.append({ ...peer, revision: peer.revision + 1, recordedAt: record.recordedAt, conflictsWith: remaining, status: remaining.length ? "disputed" : "active" }, peer, "conflict_reconciled", "host", "source corrected or withdrawn; existing citations need review");
      }
      if (input.action !== "withdraw") this.conflicts(p, record);
      this.append(record, previous, input.action, p.actor, input.reason);
      return { result: record, event: this.repos.appendEvent(p.projectId, p.taskId, "memory_changed", { id: record.id, revision: record.revision, status: record.status, action: input.action, needsCitationReview: true }) };
    });
  }
}

function summarizeMemory(record: MemoryRecord) {
  const value = JSON.stringify(record.value);
  return { id: record.id, revision: record.revision, subject: record.subject, predicate: record.predicate, value: value.slice(0, 700), complete: value.length <= 700, scope: record.scope, scopeId: record.scopeId, kind: record.kind, status: record.status, conditions: record.conditions, sourceRefs: record.sourceRefs.slice(-3), authority: record.authority, validFrom: record.validFrom, validTo: record.validTo, validityUnknown: !record.validFrom, conflictsWith: record.conflictsWith, read: `read_memory ${record.id}` };
}
