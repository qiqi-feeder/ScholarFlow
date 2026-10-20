import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  assertSnapshotComplete,
  canonicalJson,
  experimentConfigFingerprint,
  resolveInsideRoot,
  sha256,
  validateExperimentEnv,
  type ExperimentSpec,
  type RunRecord,
  type RunSnapshot,
} from "@scholarflow/research";

export class RequestConflictError extends Error {
  readonly code = "REQUEST_ID_CONFLICT";
}

export class RunValidationError extends Error {
  readonly code = "INVALID_RUN";
}

export interface CreateRunOptions {
  projectId: string;
  taskId: string;
  requestId: string;
  projectDir: string;
  spec: ExperimentSpec;
  planVersion?: number | "unknown";
  now?: Date;
  runId: string;
}

export interface CreateRunResult {
  run: RunRecord;
  deduplicated: boolean;
  snapshotErrors: string[];
}

function safeVersion(program: string): string {
  try {
    const output = execFileSync(program, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function buildSnapshot(options: CreateRunOptions): { snapshot: RunSnapshot; errors: string[] } {
  const now = options.now ?? new Date();
  const projectRoot = options.projectDir;
  const runDir = path.join(projectRoot, "runs", options.runId);
  mkdirSync(runDir, { recursive: true });
  const workDir = resolveInsideRoot(projectRoot, options.spec.cwd || ".");
  const commit = git(workDir, ["rev-parse", "HEAD"]);
  const branch = git(workDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = git(workDir, ["status", "--porcelain"]);
  let diffPath: string | null = null;
  if (status && status.trim().length > 0) {
    const diff = git(workDir, ["diff", "HEAD"]);
    if (diff !== null) {
      diffPath = `runs/${options.runId}/code/diff.patch`;
      mkdirSync(path.join(runDir, "code"), { recursive: true });
      writeFileSync(path.join(projectRoot, diffPath), diff, "utf8");
    }
  }
  const files: RunSnapshot["code"]["files"] = [];
  for (const relative of options.spec.snapshotFiles) {
    try {
      const source = resolveInsideRoot(projectRoot, relative);
      if (!existsSync(source) || !statSync(source).isFile()) {
        files.push({ path: relative, sha256: "missing", bytes: 0 });
        continue;
      }
      const target = path.join(runDir, "code", "files", relative);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(source, target);
      files.push({ path: relative, sha256: sha256(readFileSync(source)), bytes: statSync(source).size });
    } catch {
      files.push({ path: relative, sha256: "missing", bytes: 0 });
    }
  }

  const snapshot: RunSnapshot = {
    schema: 1,
    runId: options.runId,
    requestId: options.requestId,
    projectId: options.projectId,
    taskId: options.taskId,
    planId: options.spec.planId,
    admissionId: options.spec.admissionId,
    createdAt: now.toISOString(),
    spec: options.spec,
    configFingerprint: experimentConfigFingerprint(options.spec),
    code: {
      commit: commit?.trim() || "unknown",
      branch: branch?.trim() || "unknown",
      dirty: status === null ? "unknown" : status.trim().length > 0,
      diffPath,
      files,
    },
    environment: {
      platform: process.platform,
      node: process.version,
      interpreter: options.spec.program,
      interpreterVersion: safeVersion(options.spec.program),
      conda: process.env.CONDA_PREFIX ?? "not-configured",
      description: options.spec.description,
    },
    limits: { timeoutSeconds: options.spec.resourceLimits.timeoutSeconds },
    provenance: {
      createdBy: "host",
      planVersion: options.planVersion ?? "unknown",
      skillVersions: options.spec.skillVersions,
    },
  };
  const errors = assertSnapshotComplete(snapshot);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeFileSync(path.join(runDir, "request.json"), `${JSON.stringify({ requestId: options.requestId, spec: options.spec }, null, 2)}\n`, "utf8");
  return { snapshot, errors };
}

export class RunStore {
  constructor(
    private readonly db: import("node:sqlite").DatabaseSync,
    private readonly options: { now?: () => Date } = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  list(projectId?: string, limit = 100): RunRecord[] {
    const rows = projectId
      ? this.db.prepare("SELECT data_json FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit)
      : this.db.prepare("SELECT data_json FROM runs ORDER BY created_at DESC LIMIT ?").all(limit);
    return rows.map((row) => JSON.parse(String((row as { data_json: string }).data_json)) as RunRecord);
  }

  get(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT data_json FROM runs WHERE id = ?").get(id) as { data_json: string } | undefined;
    return row ? (JSON.parse(row.data_json) as RunRecord) : undefined;
  }

  findByRequest(projectId: string, requestId: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT data_json FROM runs WHERE project_id = ? AND request_id = ?").get(projectId, requestId) as
      | { data_json: string }
      | undefined;
    return row ? (JSON.parse(row.data_json) as RunRecord) : undefined;
  }

  createRun(options: CreateRunOptions): CreateRunResult {
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(options.requestId)) {
      throw new RunValidationError("requestId must be a stable 8-120 character identifier");
    }
    const spec = options.spec;
    if (!spec.program.trim()) throw new RunValidationError("experiment program is required");
    if (spec.args.some((arg) => arg.includes("\0"))) throw new RunValidationError("argument contains a NUL byte");
    if (!Number.isFinite(spec.resourceLimits.timeoutSeconds) || spec.resourceLimits.timeoutSeconds <= 0) {
      throw new RunValidationError("timeoutSeconds must be positive");
    }
    if (spec.metrics.length === 0) throw new RunValidationError("at least one metric is required");
    const envErrors = validateExperimentEnv(spec.env);
    if (envErrors.length > 0) throw new RunValidationError(envErrors.join("; "));

    const existing = this.findByRequest(options.projectId, options.requestId);
    if (existing) {
      const expected = experimentConfigFingerprint(spec);
      if (existing.configFingerprint !== expected) {
        throw new RequestConflictError(
          `requestId ${options.requestId} already refers to a different configuration`,
        );
      }
      return { run: existing, deduplicated: true, snapshotErrors: [] };
    }

    const { snapshot, errors } = buildSnapshot(options);
    if (errors.length > 0) {
      throw new RunValidationError(`experiment snapshot is incomplete: ${errors.join("; ")}`);
    }
    const now = this.now().toISOString();
    const runDir = path.join(options.projectDir, "runs", options.runId);
    const record: RunRecord = {
      id: options.runId,
      projectId: options.projectId,
      taskId: options.taskId,
      requestId: options.requestId,
      planId: spec.planId,
      admissionId: spec.admissionId,
      kind: spec.kind,
      name: spec.name,
      description: spec.description,
      status: "queued",
      verificationStatus: "unverified",
      configFingerprint: snapshot.configFingerprint,
      spec,
      snapshotPath: path.join(runDir, "snapshot.json"),
      logPath: path.join(runDir, "run.log"),
      pid: null,
      processStartedAt: null,
      processToken: null,
      exitCode: null,
      error: errors.length > 0 ? `snapshot incomplete: ${errors.join("; ")}` : null,
      unknownReason: null,
      timeoutSeconds: spec.resourceLimits.timeoutSeconds,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    };
    mkdirSync(runDir, { recursive: true });
    try {
      this.db
        .prepare(
          "INSERT INTO runs (id, project_id, task_id, request_id, status, kind, project_dir, created_at, updated_at, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          record.id,
          record.projectId,
          record.taskId,
          record.requestId,
          record.status,
          record.kind,
          options.projectDir,
          now,
          now,
          JSON.stringify(record),
        );
    } catch (error) {
      const raced = this.findByRequest(options.projectId, options.requestId);
      if (raced) return { run: raced, deduplicated: true, snapshotErrors: [] };
      throw error;
    }
    return { run: record, deduplicated: false, snapshotErrors: errors };
  }

  claimNext(): RunRecord | undefined {
    const row = this.db.prepare("SELECT id, data_json FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as
      | { id: string; data_json: string }
      | undefined;
    if (!row) return undefined;
    const now = this.now().toISOString();
    const result = this.db
      .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(now, row.id);
    if (Number(result.changes) === 0) return undefined;
    const record = JSON.parse(row.data_json) as RunRecord;
    record.status = "running";
    record.startedAt = now;
    record.updatedAt = now;
    this.save(record);
    return record;
  }

  claimSpecific(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT id, data_json FROM runs WHERE id = ? AND status = 'queued'").get(id) as
      | { id: string; data_json: string }
      | undefined;
    if (!row) return undefined;
    const now = this.now().toISOString();
    const result = this.db
      .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(now, id);
    if (Number(result.changes) === 0) return undefined;
    const record = JSON.parse(row.data_json) as RunRecord;
    record.status = "running";
    record.startedAt = now;
    record.updatedAt = now;
    this.save(record);
    return record;
  }

  save(record: RunRecord): void {
    record.updatedAt = this.now().toISOString();
    this.db
      .prepare("UPDATE runs SET status = ?, updated_at = ?, data_json = ? WHERE id = ?")
      .run(record.status, record.updatedAt, JSON.stringify(record), record.id);
  }

  markRunning(record: RunRecord, pid: number, processStartedAt: string | null): RunRecord {
    record.pid = pid;
    record.processStartedAt = processStartedAt;
    record.processToken = sha256(`${record.id}:${pid}:${processStartedAt ?? ""}`).slice(0, 32);
    record.status = "running";
    record.startedAt ??= this.now().toISOString();
    this.save(record);
    return record;
  }

  markFinished(
    record: RunRecord,
    outcome: { status: "succeeded" | "failed" | "cancelled" | "unknown"; exitCode: number | null; error?: string | null; unknownReason?: string | null },
  ): RunRecord {
    record.status = outcome.status;
    record.exitCode = outcome.exitCode;
    record.error = outcome.error ?? record.error;
    record.unknownReason = outcome.unknownReason ?? null;
    record.finishedAt = this.now().toISOString();
    this.save(record);
    return record;
  }

  setVerification(id: string, status: "unverified" | "verified" | "partial", note: string, actor: string): RunRecord {
    const record = this.get(id);
    if (!record) throw new Error(`run not found: ${id}`);
    record.verificationStatus = status;
    record.error = note ? `verification (${actor}): ${note}` : record.error;
    this.save(record);
    return record;
  }

  /** On worker start, running rows become unknown; never auto-run them again. */
  reconcileOnStart(): RunRecord[] {
    const rows = this.db.prepare("SELECT data_json FROM runs WHERE status = 'running'").all() as Array<{ data_json: string }>;
    const changed: RunRecord[] = [];
    for (const row of rows) {
      const record = JSON.parse(row.data_json) as RunRecord;
      record.status = "unknown";
      record.unknownReason = "worker restarted while the run was recorded as running; state is unknown and will not be restarted automatically";
      record.finishedAt = this.now().toISOString();
      this.save(record);
      changed.push(record);
    }
    return changed;
  }

  projectDirFor(record: RunRecord): string {
    const row = this.db.prepare("SELECT project_dir FROM runs WHERE id = ?").get(record.id) as { project_dir: string } | undefined;
    return row?.project_dir ?? "";
  }

  countRunning(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status = 'running'").get() as { n: number };
    return Number(row.n);
  }

  fingerprintSummary(record: RunRecord): string {
    return canonicalJson({ fingerprint: record.configFingerprint, seed: record.spec.seed });
  }
}
