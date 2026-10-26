import type { DatabaseSync } from "node:sqlite";
import {
  createId,
  type AdmissionRecord,
  type ExperimentPlan,
  type ManuscriptVersion,
  type MaterialRecord,
  type MetricRecord,
  type ProjectRecord,
  type ResultVersion,
  type RunRecord,
  type TaskRecord,
  type TaskStatus,
} from "@scholarflow/research";

export interface ApprovalRecord {
  id: string;
  projectId: string;
  taskId: string;
  requestId: string;
  fingerprint: string;
  status: "pending" | "approved" | "rejected";
  spec: unknown;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface EventRecord {
  seq: number;
  taskId: string;
  projectId: string;
  type: string;
  data: unknown;
  createdAt: string;
}

function parse<T>(value: string): T {
  return JSON.parse(value) as T;
}

export class Repositories {
  constructor(private readonly db: DatabaseSync) {}

  // --- projects -----------------------------------------------------------
  createProject(input: { id?: string; name: string; description?: string; dataDir: string }, now = new Date()): ProjectRecord {
    const id = input.id ?? createId("prj", now.getTime());
    const timestamp = now.toISOString();
    const project: ProjectRecord = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      createdAt: timestamp,
      updatedAt: timestamp,
      dataDir: input.dataDir,
    };
    this.db
      .prepare("INSERT INTO projects (id, name, description, data_dir, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(project.id, project.name, project.description, project.dataDir, project.createdAt, project.updatedAt);
    return project;
  }

  listProjects(): ProjectRecord[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all();
    return rows.map((row) => this.mapProject(row as Record<string, unknown>));
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    return row ? this.mapProject(row as Record<string, unknown>) : undefined;
  }

  updateProject(id: string, fields: { name?: string; description?: string }, now = new Date()): ProjectRecord {
    const project = this.getProject(id);
    if (!project) throw new Error("project not found");
    const next = {
      ...project,
      name: fields.name?.trim() || project.name,
      description: fields.description ?? project.description,
      updatedAt: now.toISOString(),
    };
    this.db
      .prepare("UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?")
      .run(next.name, next.description, next.updatedAt, id);
    return next;
  }

  private mapProject(row: Record<string, unknown>): ProjectRecord {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      dataDir: String(row.data_dir),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // --- tasks --------------------------------------------------------------
  createTask(
    input: { projectId: string; title: string; objective: string; reviewText?: string | null },
    now = new Date(),
  ): TaskRecord {
    const id = createId("tsk", now.getTime());
    const timestamp = now.toISOString();
    const task: TaskRecord = {
      id,
      projectId: input.projectId,
      title: input.title.trim(),
      objective: input.objective.trim(),
      status: "idle",
      sessionFile: null,
      contextVersion: 1,
      modelProvider: null,
      modelId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db
      .prepare(
        "INSERT INTO tasks (id, project_id, title, objective, status, session_file, context_version, review_text, model_provider, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        task.id,
        task.projectId,
        task.title,
        task.objective,
        task.status,
        null,
        1,
        input.reviewText ?? null,
        null,
        null,
        timestamp,
        timestamp,
      );
    this.db.prepare("INSERT OR IGNORE INTO task_method_bindings SELECT ?, ?, name, hash FROM method_heads WHERE project_id=?").run(task.projectId, task.id, task.projectId);
    return task;
  }

  listTasks(projectId: string): TaskRecord[] {
    const rows = this.db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC").all(projectId);
    return rows.map((row) => this.mapTask(row as Record<string, unknown>));
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return row ? this.mapTask(row as Record<string, unknown>) : undefined;
  }

  updateTask(
    id: string,
    fields: Partial<Pick<TaskRecord, "status" | "sessionFile" | "objective" | "title" | "contextVersion" | "modelProvider" | "modelId">>,
    now = new Date(),
  ): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error("task not found");
    const next: TaskRecord = {
      ...task,
      ...fields,
      updatedAt: now.toISOString(),
    };
    this.db
      .prepare("UPDATE tasks SET status = ?, session_file = ?, objective = ?, title = ?, context_version = ?, model_provider = ?, model_id = ?, updated_at = ? WHERE id = ?")
      .run(next.status, next.sessionFile, next.objective, next.title, next.contextVersion, next.modelProvider ?? null, next.modelId ?? null, next.updatedAt, id);
    return next;
  }

  taskReviewText(taskId: string): string | null {
    const row = this.db.prepare("SELECT review_text FROM tasks WHERE id = ?").get(taskId) as { review_text: string | null } | undefined;
    return row?.review_text ?? null;
  }

  private mapTask(row: Record<string, unknown>): TaskRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      title: String(row.title),
      objective: String(row.objective),
      status: String(row.status) as TaskStatus,
      sessionFile: row.session_file ? String(row.session_file) : null,
      contextVersion: Number(row.context_version),
      modelProvider: row.model_provider ? String(row.model_provider) : null,
      modelId: row.model_id ? String(row.model_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  // --- events -------------------------------------------------------------
  appendEvent(projectId: string, taskId: string, type: string, data: unknown, now = new Date()): EventRecord {
    const timestamp = now.toISOString();
    const result = this.db
      .prepare("INSERT INTO events (project_id, task_id, type, data_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, taskId, type, JSON.stringify(data), timestamp);
    return {
      seq: Number(result.lastInsertRowid),
      taskId,
      projectId,
      type,
      data,
      createdAt: timestamp,
    };
  }

  listEvents(taskId: string, after = 0, limit = 2000): EventRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?")
      .all(taskId, after, limit);
    return rows.map((row) => this.mapEvent(row as Record<string, unknown>));
  }

  latestEventSeq(taskId: string): number {
    const row = this.db.prepare("SELECT MAX(seq) AS seq FROM events WHERE task_id = ?").get(taskId) as { seq: number | null };
    return Number(row.seq ?? 0);
  }

  getEvent(seq: number): EventRecord | undefined {
    const row = this.db.prepare("SELECT * FROM events WHERE seq = ?").get(seq);
    return row ? this.mapEvent(row as Record<string, unknown>) : undefined;
  }

  private mapEvent(row: Record<string, unknown>): EventRecord {
    return {
      seq: Number(row.seq),
      taskId: String(row.task_id),
      projectId: String(row.project_id),
      type: String(row.type),
      data: parse(String(row.data_json)),
      createdAt: String(row.created_at),
    };
  }

  hasClientMessage(taskId: string, clientId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM posted_messages WHERE task_id = ? AND client_id = ?").get(taskId, clientId));
  }

  claimClientMessage(taskId: string, clientId: string, now = new Date()): boolean {
    try {
      this.db
        .prepare("INSERT INTO posted_messages (task_id, client_id, seq, created_at) VALUES (?, ?, 0, ?)")
        .run(taskId, clientId, now.toISOString());
      return true;
    } catch {
      return false;
    }
  }

  setClientMessageSeq(taskId: string, clientId: string, seq: number): void {
    this.db.prepare("UPDATE posted_messages SET seq = ? WHERE task_id = ? AND client_id = ?").run(seq, taskId, clientId);
  }

  // --- materials ----------------------------------------------------------
  createMaterial(material: MaterialRecord, note: string | null): MaterialRecord {
    this.db
      .prepare(
        "INSERT INTO materials (id, project_id, task_id, kind, title, path, media_type, sha256, bytes, source_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        material.id,
        material.projectId,
        material.taskId,
        material.kind,
        material.title,
        material.path,
        material.mediaType,
        material.sha256,
        material.bytes,
        JSON.stringify(material.source),
        note,
        material.createdAt,
      );
    return material;
  }

  listMaterials(projectId: string): Array<MaterialRecord & { note?: string }> {
    const rows = this.db.prepare("SELECT * FROM materials WHERE project_id = ? ORDER BY created_at DESC").all(projectId);
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: String(value.id),
        projectId: String(value.project_id),
        taskId: value.task_id ? String(value.task_id) : null,
        kind: String(value.kind) as MaterialRecord["kind"],
        title: String(value.title),
        path: String(value.path),
        mediaType: String(value.media_type),
        sha256: String(value.sha256),
        bytes: Number(value.bytes),
        source: parse(String(value.source_json)),
        createdAt: String(value.created_at),
        note: value.note ? String(value.note) : undefined,
      };
    });
  }

  findMaterial(projectId: string, id: string): (MaterialRecord & { note?: string }) | undefined {
    return this.listMaterials(projectId).find((material) => material.id === id);
  }

  findMaterialByDoi(projectId: string, doi: string): (MaterialRecord & { note?: string }) | undefined {
    const needle = doi.replace(/^https?:\/\/doi\.org\//i, "").trim().toLowerCase();
    return this.listMaterials(projectId).find((material) => material.source.doi?.toLowerCase() === needle);
  }

  // --- plans --------------------------------------------------------------
  createPlan(plan: ExperimentPlan): ExperimentPlan {
    this.db
      .prepare("INSERT INTO plans (id, project_id, task_id, version, status, data_json, confirmed_by, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        plan.id,
        plan.projectId,
        plan.taskId,
        plan.version,
        plan.status,
        JSON.stringify(plan),
        plan.confirmedBy,
        plan.confirmedAt,
        plan.createdAt,
      );
    return plan;
  }

  listPlans(taskId: string): ExperimentPlan[] {
    const rows = this.db.prepare("SELECT data_json FROM plans WHERE task_id = ? ORDER BY version ASC").all(taskId);
    return rows.map((row) => parse<ExperimentPlan>(String((row as { data_json: string }).data_json)));
  }

  getPlan(id: string): ExperimentPlan | undefined {
    const row = this.db.prepare("SELECT data_json FROM plans WHERE id = ?").get(id) as { data_json: string } | undefined;
    return row ? parse<ExperimentPlan>(row.data_json) : undefined;
  }

  getConfirmedPlan(taskId: string): ExperimentPlan | undefined {
    return this.listPlans(taskId).filter((plan) => plan.status === "confirmed").at(-1);
  }

  confirmPlan(id: string, actor: string, now = new Date()): ExperimentPlan {
    const plan = this.getPlan(id);
    if (!plan) throw new Error("plan not found");
    if (plan.status !== "draft") throw new Error(`plan is ${plan.status}, not a draft`);
    const confirmed: ExperimentPlan = {
      ...plan,
      status: "confirmed",
      confirmedBy: actor,
      confirmedAt: now.toISOString(),
    };
    this.db
      .prepare("UPDATE plans SET status = 'confirmed', data_json = ?, confirmed_by = ?, confirmed_at = ? WHERE id = ?")
      .run(JSON.stringify(confirmed), actor, confirmed.confirmedAt, id);
    return confirmed;
  }

  rejectPlan(id: string, now = new Date()): ExperimentPlan {
    const plan = this.getPlan(id);
    if (!plan) throw new Error("plan not found");
    const rejected: ExperimentPlan = { ...plan, status: "rejected", confirmedBy: null, confirmedAt: null };
    this.db.prepare("UPDATE plans SET status = 'rejected', data_json = ? WHERE id = ?").run(JSON.stringify(rejected), id);
    return rejected;
  }

  nextPlanVersion(taskId: string): number {
    const row = this.db.prepare("SELECT MAX(version) AS version FROM plans WHERE task_id = ?").get(taskId) as { version: number | null };
    return Number(row.version ?? 0) + 1;
  }

  // --- admissions ---------------------------------------------------------
  createAdmission(record: AdmissionRecord): AdmissionRecord {
    this.db
      .prepare("INSERT INTO admissions (id, project_id, task_id, status, data_json, assessed_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(record.id, record.projectId, record.taskId, record.status, JSON.stringify(record), record.assessedAt);
    return record;
  }

  listAdmissions(taskId: string): AdmissionRecord[] {
    const rows = this.db.prepare("SELECT data_json FROM admissions WHERE task_id = ? ORDER BY assessed_at DESC").all(taskId);
    return rows.map((row) => parse<AdmissionRecord>(String((row as { data_json: string }).data_json)));
  }

  getAdmission(id: string): AdmissionRecord | undefined {
    const row = this.db.prepare("SELECT data_json FROM admissions WHERE id = ?").get(id) as { data_json: string } | undefined;
    return row ? parse<AdmissionRecord>(row.data_json) : undefined;
  }

  // --- approvals ----------------------------------------------------------
  createApproval(input: {
    projectId: string;
    taskId: string;
    requestId: string;
    fingerprint: string;
    spec: unknown;
    reason?: string | null;
    now?: Date;
  }): ApprovalRecord {
    const existing = this.db
      .prepare("SELECT * FROM approvals WHERE task_id = ? AND request_id = ? AND fingerprint = ? AND status = 'pending'")
      .get(input.taskId, input.requestId, input.fingerprint) as Record<string, unknown> | undefined;
    if (existing) return this.mapApproval(existing);
    const now = (input.now ?? new Date()).toISOString();
    const approval: ApprovalRecord = {
      id: createId("apr", Date.now()),
      projectId: input.projectId,
      taskId: input.taskId,
      requestId: input.requestId,
      fingerprint: input.fingerprint,
      status: "pending",
      spec: input.spec,
      reason: input.reason ?? null,
      createdAt: now,
      decidedAt: null,
      decidedBy: null,
    };
    this.db
      .prepare("INSERT INTO approvals (id, project_id, task_id, request_id, fingerprint, status, spec_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        approval.id,
        approval.projectId,
        approval.taskId,
        approval.requestId,
        approval.fingerprint,
        approval.status,
        JSON.stringify(approval.spec),
        approval.reason,
        approval.createdAt,
      );
    return approval;
  }

  listApprovals(taskId: string): ApprovalRecord[] {
    const rows = this.db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC").all(taskId);
    return rows.map((row) => this.mapApproval(row as Record<string, unknown>));
  }

  getApproval(id: string): ApprovalRecord | undefined {
    const row = this.db.prepare("SELECT * FROM approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.mapApproval(row) : undefined;
  }

  decideApproval(id: string, status: "approved" | "rejected", actor: string, now = new Date()): ApprovalRecord {
    const approval = this.getApproval(id);
    if (!approval) throw new Error("approval not found");
    if (approval.status !== "pending") throw new Error(`approval is ${approval.status}`);
    const decidedAt = now.toISOString();
    this.db
      .prepare("UPDATE approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?")
      .run(status, decidedAt, actor, id);
    return { ...approval, status, decidedAt, decidedBy: actor };
  }

  private mapApproval(row: Record<string, unknown>): ApprovalRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      taskId: String(row.task_id),
      requestId: String(row.request_id),
      fingerprint: String(row.fingerprint),
      status: String(row.status) as ApprovalRecord["status"],
      spec: parse(String(row.spec_json)),
      reason: row.reason ? String(row.reason) : null,
      createdAt: String(row.created_at),
      decidedAt: row.decided_at ? String(row.decided_at) : null,
      decidedBy: row.decided_by ? String(row.decided_by) : null,
    };
  }

  // --- metrics and results ------------------------------------------------
  saveMetrics(metrics: MetricRecord[]): void {
    const statement = this.db.prepare(
      "INSERT OR REPLACE INTO metrics (id, project_id, run_id, key, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const metric of metrics) {
      statement.run(
        metric.id,
        metric.projectId,
        metric.runId,
        metric.key,
        JSON.stringify(metric),
        metric.source.importedAt,
      );
    }
  }

  listMetrics(runIds: string[]): MetricRecord[] {
    if (runIds.length === 0) return [];
    const placeholders = runIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT data_json FROM metrics WHERE run_id IN (${placeholders}) ORDER BY key ASC`)
      .all(...runIds);
    return rows.map((row) => parse<MetricRecord>(String((row as { data_json: string }).data_json)));
  }

  createResult(version: ResultVersion): ResultVersion {
    this.db
      .prepare("INSERT INTO result_versions (id, project_id, task_id, status, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(version.id, version.projectId, version.taskId, version.status, JSON.stringify(version), version.createdAt);
    return version;
  }

  listResults(projectId: string): ResultVersion[] {
    const rows = this.db
      .prepare("SELECT data_json FROM result_versions WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId);
    return rows.map((row) => parse<ResultVersion>(String((row as { data_json: string }).data_json)));
  }

  getResult(id: string): ResultVersion | undefined {
    const row = this.db.prepare("SELECT data_json FROM result_versions WHERE id = ?").get(id) as { data_json: string } | undefined;
    return row ? parse<ResultVersion>(row.data_json) : undefined;
  }

  supersedeResult(id: string, _replacementId: string, affectedArtifacts: string[]): ResultVersion {
    const version = this.getResult(id);
    if (!version) throw new Error("result version not found");
    const next: ResultVersion = {
      ...version,
      status: "superseded",
      affectedArtifacts,
    };
    this.db
      .prepare("UPDATE result_versions SET status = 'superseded', data_json = ? WHERE id = ?")
      .run(JSON.stringify(next), id);
    return next;
  }

  // --- manuscripts --------------------------------------------------------
  createManuscript(version: ManuscriptVersion): ManuscriptVersion {
    this.db
      .prepare("INSERT INTO manuscript_versions (id, project_id, task_id, version, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(version.id, version.projectId, version.taskId, version.version, JSON.stringify(version), version.createdAt);
    return version;
  }

  listManuscripts(projectId: string): ManuscriptVersion[] {
    const rows = this.db
      .prepare("SELECT data_json FROM manuscript_versions WHERE project_id = ? ORDER BY version DESC")
      .all(projectId);
    return rows.map((row) => parse<ManuscriptVersion>(String((row as { data_json: string }).data_json)));
  }

  getManuscript(id: string): ManuscriptVersion | undefined {
    const row = this.db.prepare("SELECT data_json FROM manuscript_versions WHERE id = ?").get(id) as { data_json: string } | undefined;
    return row ? parse<ManuscriptVersion>(row.data_json) : undefined;
  }

  nextManuscriptVersion(projectId: string): number {
    const row = this.db
      .prepare("SELECT MAX(version) AS version FROM manuscript_versions WHERE project_id = ?")
      .get(projectId) as { version: number | null };
    return Number(row.version ?? 0) + 1;
  }

  // --- skills -------------------------------------------------------------
  upsertSkill(input: {
    projectId: string;
    name: string;
    version: string;
    license: string;
    sha256: string;
    sourcePath: string;
    requires: string[];
    content: string;
    importedAt?: string;
  }): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO skills (project_id, name, version, license, sha256, source_path, requires_json, content, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.projectId,
        input.name,
        input.version,
        input.license,
        input.sha256,
        input.sourcePath,
        JSON.stringify(input.requires),
        input.content,
        input.importedAt ?? new Date().toISOString(),
      );
  }

  listSkills(projectId: string): Array<{
    name: string;
    version: string;
    license: string;
    sha256: string;
    sourcePath: string;
    requires: string[];
    content: string;
    importedAt: string;
  }> {
    const rows = this.db.prepare("SELECT * FROM skills WHERE project_id = ? ORDER BY name ASC").all(projectId);
    return rows.map((row) => {
      const value = row as Record<string, unknown>;
      return {
        name: String(value.name),
        version: String(value.version),
        license: String(value.license),
        sha256: String(value.sha256),
        sourcePath: String(value.source_path),
        requires: parse<string[]>(String(value.requires_json)),
        content: String(value.content),
        importedAt: String(value.imported_at),
      };
    });
  }

  getSkill(projectId: string, name: string) {
    return this.listSkills(projectId).find((skill) => skill.name === name);
  }

  recordSkillLoad(projectId: string, taskId: string, name: string, sha256: string, now = new Date()): void {
    this.db
      .prepare("INSERT INTO skill_loads (project_id, task_id, name, sha256, loaded_at) VALUES (?, ?, ?, ?, ?)")
      .run(projectId, taskId, name, sha256, now.toISOString());
  }

  recordSearch(input: {
    id: string;
    projectId: string;
    taskId: string | null;
    query: string;
    responseHash: string;
    resultCount: number;
  }): void {
    this.db
      .prepare("INSERT INTO search_audit (id, project_id, task_id, query, channel, response_hash, result_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        input.id,
        input.projectId,
        input.taskId,
        input.query,
        "crossref",
        input.responseHash,
        input.resultCount,
        new Date().toISOString(),
      );
  }

  metricsForRuns(runIds: string[]): MetricRecord[] {
    return this.listMetrics(runIds);
  }

  listRunRecords(): RunRecord[] {
    const rows = this.db.prepare("SELECT data_json FROM runs ORDER BY created_at DESC").all();
    return rows.map((row) => parse<RunRecord>(String((row as { data_json: string }).data_json)));
  }
}
