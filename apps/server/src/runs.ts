import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  admissionAllowsTargetRun,
  buildResultVersion,
  compareRuns,
  createId,
  experimentConfigFingerprint,
  extractMetrics,
  renderComparisonSvg,
  renderResultReport,
  resolveInsideRoot,
  sha256,
  type AdmissionRecord,
  type ExperimentPlan,
  type ExperimentSpec,
  type MetricRecord,
  type MetricSpec,
  type ProjectRecord,
  type ResultVersion,
  type RunRecord,
  type RunStatus,
  type TaskRecord,
} from "@scholarflow/research";
import type { DatabaseSync } from "node:sqlite";
import { RunStore, type ExperimentWorker } from "@scholarflow/experiment-worker";
import type { AppConfig } from "./config.js";
import type { EventHub } from "./events.js";
import type { Repositories } from "./repos.js";
import type { SkillService } from "./skills.js";

export interface ProposalInput {
  requestId?: string;
  name: string;
  kind: "smoke" | "target";
  description?: string;
  planId?: string;
  admissionId?: string | null;
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  config?: Record<string, unknown>;
  data?: { version?: string; split?: string; preprocessing?: string; license?: string };
  seed?: number[];
  metrics: MetricSpec[];
  timeoutSeconds?: number;
  expectedArtifacts?: string[];
  snapshotFiles?: string[];
}

export interface ProposalResult {
  approvalId: string;
  status: "pending" | "approved" | "rejected";
  requestId: string;
  fingerprint: string;
  spec: ExperimentSpec;
  warnings: string[];
}

export class RunValidationError extends Error {
  readonly code = "RUN_VALIDATION";
}

export class ExperimentService {
  constructor(
    private readonly repositories: Repositories,
    private readonly db: DatabaseSync,
    private readonly store: RunStore,
    private readonly worker: ExperimentWorker | null,
    private readonly config: AppConfig,
    private readonly skills: SkillService,
    private readonly events: EventHub,
  ) {}

  private projectDir(project: ProjectRecord): string {
    return project.dataDir;
  }

  list(projectId: string): RunRecord[] {
    return this.store.list(projectId);
  }

  get(runId: string): RunRecord | undefined {
    return this.store.get(runId);
  }

  private resolvePlan(task: TaskRecord, planId?: string): ExperimentPlan {
    const plan = planId ? this.repositories.getPlan(planId) : this.repositories.getConfirmedPlan(task.id);
    if (!plan || plan.taskId !== task.id) throw new RunValidationError("no confirmed experiment plan belongs to this task");
    if (plan.status !== "confirmed") throw new RunValidationError(`plan is ${plan.status}; the user must confirm it in the Web UI first`);
    return plan;
  }

  private resolveAdmission(task: TaskRecord, admissionId?: string | null): AdmissionRecord | undefined {
    if (!admissionId) return this.repositories.listAdmissions(task.id).find((item) => item.status === "sufficient");
    const admission = this.repositories.getAdmission(admissionId);
    if (!admission || admission.taskId !== task.id) throw new RunValidationError("admission record does not belong to this task");
    return admission;
  }

  propose(project: ProjectRecord, task: TaskRecord, input: ProposalInput): ProposalResult {
    if (!input.name?.trim()) throw new RunValidationError("experiment name is required");
    if (input.kind !== "smoke" && input.kind !== "target") throw new RunValidationError("kind must be smoke or target");
    if (!Array.isArray(input.metrics) || input.metrics.length === 0) {
      throw new RunValidationError("at least one metric with file and JSON pointer is required");
    }
    for (const metric of input.metrics) {
      if (!metric.key?.trim() || !metric.file?.trim() || !metric.pointer?.trim()) {
        throw new RunValidationError("each metric needs key, file, and pointer");
      }
      if (metric.direction !== "higher" && metric.direction !== "lower") {
        throw new RunValidationError(`metric ${metric.key} needs a direction`);
      }
    }
    const plan = this.resolvePlan(task, input.planId);
    const admission = input.kind === "target" ? this.resolveAdmission(task, input.admissionId) : null;
    if (input.kind === "target" && !admissionAllowsTargetRun(admission)) {
      throw new RunValidationError(
        "target experiments require a sufficient admission record; run a smoke test or fix the missing evidence",
      );
    }
    const program = input.program?.trim() || this.config.defaultInterpreter || (input.kind === "smoke" ? process.execPath : "");
    if (!program) {
      throw new RunValidationError(
        "no experiment interpreter is configured; set an explicit Python/Conda path in Settings or pass a program",
      );
    }
    if (input.kind === "target" && !path.isAbsolute(program)) {
      throw new RunValidationError("target experiments require an explicit absolute interpreter path");
    }
    const timeoutSeconds = input.timeoutSeconds ?? this.config.defaultTimeoutSeconds;
    if (input.kind === "target") {
      const existingTargets = this.store.list(project.id).filter((run) => run.kind === "target" && run.taskId === task.id).length;
      const pending = this.repositories
        .listApprovals(task.id)
        .filter((approval) => approval.status === "pending" && (approval.spec as ExperimentSpec).kind === "target").length;
      if (existingTargets + pending >= this.config.maxTargetRunsPerTask) {
        throw new RunValidationError(
          `task target-run budget reached (${this.config.maxTargetRunsPerTask}); confirm a new budget before proposing more target runs`,
        );
      }
    }

    const metricFiles = [...new Set(input.metrics.map((metric) => metric.file))];
    const spec: ExperimentSpec = {
      name: input.name.trim(),
      kind: input.kind,
      planId: plan.id,
      admissionId: admission?.id ?? null,
      description: input.description ?? "",
      program,
      args: input.args ?? [],
      cwd: input.cwd ?? "workspace",
      env: input.env ?? {},
      config: input.config ?? plan.conditions,
      data: {
        version: input.data?.version ?? String(plan.conditions["data.version"] ?? plan.conditions.dataset ?? "unknown"),
        split: input.data?.split ?? String(plan.conditions["data.split"] ?? plan.conditions.split ?? "unknown"),
        preprocessing: input.data?.preprocessing ?? String(plan.conditions.preprocessing ?? "unknown"),
        license: input.data?.license ?? String(plan.conditions["data.license"] ?? "unknown"),
      },
      seed: input.seed ?? plan.seed,
      metrics: input.metrics,
      resourceLimits: { timeoutSeconds },
      expectedArtifacts: [...new Set([...(input.expectedArtifacts ?? []), ...metricFiles])],
      snapshotFiles: input.snapshotFiles ?? [],
      skillVersions: plan.skillVersions.length
        ? plan.skillVersions
        : this.skills.list(project.id).map((skill) => ({ name: skill.name, sha256: skill.sha256, version: skill.version })),
    };
    const fingerprint = experimentConfigFingerprint(spec);
    const requestId = input.requestId ?? createId("req");
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(requestId)) throw new RunValidationError("requestId is invalid");
    const approval = this.repositories.createApproval({
      projectId: project.id,
      taskId: task.id,
      requestId,
      fingerprint,
      spec,
      reason: input.kind === "target" ? "target experiment requires explicit user approval" : "smoke run requires explicit user approval",
    });
    const event = this.repositories.appendEvent(project.id, task.id, "run_proposed", {
      approvalId: approval.id,
      requestId,
      fingerprint,
      kind: spec.kind,
      spec,
    });
    this.events.publish(event);
    this.repositories.updateTask(task.id, { status: "awaiting_approval" });
    return {
      approvalId: approval.id,
      status: approval.status,
      requestId,
      fingerprint,
      spec,
      warnings:
        spec.kind === "smoke"
          ? ["Smoke runs do not count as reproduction evidence."]
          : [],
    };
  }

  approve(project: ProjectRecord, task: TaskRecord, approvalId: string, actor = "user"): { run: RunRecord; deduplicated: boolean; warnings: string[] } {
    const approval = this.repositories.getApproval(approvalId);
    if (!approval || approval.projectId !== project.id || approval.taskId !== task.id) {
      throw new RunValidationError("approval does not belong to this project/task");
    }
    if (approval.status === "rejected") throw new RunValidationError("approval was rejected");
    const spec = approval.spec as ExperimentSpec;
    if (spec.kind === "target") {
      const plan = this.repositories.getPlan(spec.planId);
      if (!plan || plan.status !== "confirmed") throw new RunValidationError("plan is no longer confirmed");
      const admission = spec.admissionId ? this.repositories.getAdmission(spec.admissionId) : undefined;
      if (!admissionAllowsTargetRun(admission)) throw new RunValidationError("admission is no longer sufficient");
    }
    const plan = this.repositories.getPlan(spec.planId);
    const result = this.store.createRun({
      projectId: project.id,
      taskId: task.id,
      requestId: approval.requestId,
      projectDir: this.projectDir(project),
      spec,
      planVersion: plan?.version ?? "unknown",
      runId: createId("run"),
    });
    if (approval.status === "pending") {
      this.repositories.decideApproval(approvalId, "approved", actor);
    }
    const event = this.repositories.appendEvent(project.id, task.id, "run_queued", {
      runId: result.run.id,
      approvalId,
      deduplicated: result.deduplicated,
      status: result.run.status,
      snapshotErrors: result.snapshotErrors,
    });
    this.events.publish(event);
    this.repositories.updateTask(task.id, { status: "idle" });
    return {
      run: result.run,
      deduplicated: result.deduplicated,
      warnings: [
        ...result.snapshotErrors,
        ...(spec.kind === "smoke" ? ["Smoke run: not reproduction evidence."] : []),
      ],
    };
  }

  reject(task: TaskRecord, approvalId: string, actor = "user"): void {
    this.repositories.decideApproval(approvalId, "rejected", actor);
    this.repositories.updateTask(task.id, { status: "idle" });
  }

  async cancel(project: ProjectRecord, task: TaskRecord, runId: string): Promise<{ cancelled: boolean; reason: string; run?: RunRecord }> {
    const run = this.store.get(runId);
    if (!run || run.projectId !== project.id) throw new RunValidationError("run does not belong to this project");
    if (run.status === "queued") {
      run.status = "cancelled";
      run.error = "cancelled before start";
      run.finishedAt = new Date().toISOString();
      this.store.save(run);
      this.emitRun(project, task, "run_cancelled", { runId, reason: "queued run cancelled" });
      return { cancelled: true, reason: "queued run cancelled", run };
    }
    if (run.status !== "running" && run.status !== "unknown") {
      return { cancelled: false, reason: `run is ${run.status}`, run };
    }
    if (this.worker) {
      const result = await this.worker.cancel(runId);
      this.emitRun(project, task, "run_cancel_requested", { runId, ...result });
      return result;
    }
    const commandId = createId("cmd");
    this.db
      .prepare("INSERT INTO run_commands (id, run_id, command, status, result_json, created_at) VALUES (?, ?, 'cancel', 'pending', NULL, ?)")
      .run(commandId, runId, new Date().toISOString());
    this.emitRun(project, task, "run_cancel_requested", {
      runId,
      commandId,
      reason: "cancel request queued for the independent worker process",
    });
    return { cancelled: false, reason: "cancel request queued; the worker verifies process identity before killing" };
  }

  verify(project: ProjectRecord, task: TaskRecord, runId: string, status: "verified" | "partial", note: string, actor = "user"): RunRecord {
    const run = this.store.get(runId);
    if (!run || run.projectId !== project.id) throw new RunValidationError("run does not belong to this project");
    if (!note.trim()) throw new RunValidationError("verification note is required");
    const updated = this.store.setVerification(runId, status, note.trim(), actor);
    this.emitRun(project, task, "run_verified", { runId, status, note, actor });
    return updated;
  }

  logs(runId: string, lines = 300): string {
    const run = this.store.get(runId);
    if (!run) throw new RunValidationError("run not found");
    if (!existsSync(run.logPath)) return "";
    return readFileSync(run.logPath, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  }

  private emitRun(project: ProjectRecord, task: TaskRecord, type: string, data: unknown): void {
    const event = this.repositories.appendEvent(project.id, task.id, type, data);
    this.events.publish(event);
  }

  importMetrics(project: ProjectRecord, run: RunRecord): MetricRecord[] {
    if (run.projectId !== project.id) throw new RunValidationError("run does not belong to this project");
    if (run.status !== "succeeded" && run.status !== "failed") {
      throw new RunValidationError(`run is ${run.status}; metrics can only be imported after the process finishes`);
    }
    const byFile = new Map<string, MetricSpec[]>();
    for (const metric of run.spec.metrics) {
      const list = byFile.get(metric.file) ?? [];
      list.push(metric);
      byFile.set(metric.file, list);
    }
    const metrics: MetricRecord[] = [];
    const errors: string[] = [];
    for (const [file, specs] of byFile) {
      let target: string;
      try {
        target = resolveInsideRoot(project.dataDir, path.posix.join(run.spec.cwd, file));
      } catch (error) {
        errors.push(`${file}: ${(error as Error).message}`);
        continue;
      }
      if (!existsSync(target)) {
        errors.push(`${file}: not found for run ${run.id}`);
        continue;
      }
      const content = readFileSync(target, "utf8");
      const extracted = extractMetrics({
        run,
        metricFileContent: content,
        fileSha256: sha256(content),
        specs,
        idFactory: (key) => createId(`met_${key.replace(/[^a-z0-9]/gi, "_")}`),
      });
      errors.push(...extracted.errors);
      metrics.push(...extracted.metrics);
    }
    if (errors.length > 0) throw new RunValidationError(`metric import failed: ${errors.join("; ")}`);
    if (metrics.length === 0) throw new RunValidationError("no metrics were imported");
    this.repositories.saveMetrics(metrics);
    return metrics;
  }

  analyze(
    project: ProjectRecord,
    task: TaskRecord,
    input: { runIds: string[]; title: string; metricKeys?: string[]; supersedes?: string | null },
  ): { result: ResultVersion; warnings: string[] } {
    if (!Array.isArray(input.runIds) || input.runIds.length === 0) throw new RunValidationError("at least one runId is required");
    const runs = input.runIds.map((runId) => {
      const run = this.store.get(runId);
      if (!run || run.projectId !== project.id) throw new RunValidationError(`run does not belong to this project: ${runId}`);
      return run;
    });
    for (const run of runs) this.importMetrics(project, run);
    const inputs = runs.map((run) => ({ run, metrics: this.repositories.listMetrics([run.id]) }));
    const comparison = compareRuns(inputs);
    const resultId = createId("res");
    const directory = path.join(project.dataDir, "results", resultId);
    mkdirSync(directory, { recursive: true });
    const metricKeys = input.metricKeys?.length
      ? input.metricKeys
      : [...new Set(inputs.flatMap((item) => item.metrics.map((metric) => metric.key)))];
    const chart = renderComparisonSvg(comparison, metricKeys, input.title);
    let chartPath: string | null = null;
    if (chart) {
      chartPath = `results/${resultId}/chart.svg`;
      writeFileSync(path.join(project.dataDir, chartPath), chart, "utf8");
    }
    const reportPath = `results/${resultId}/report.md`;
    let affectedArtifacts: string[] = [];
    if (input.supersedes) {
      const previous = this.repositories.getResult(input.supersedes);
      if (!previous || previous.projectId !== project.id) throw new RunValidationError("superseded result version does not belong to this project");
      affectedArtifacts = ["manuscript/main.tex", previous.reportPath, ...(previous.chartPath ? [previous.chartPath] : [])];
    }
    const result = buildResultVersion({
      id: resultId,
      projectId: project.id,
      taskId: task.id,
      title: input.title,
      comparison,
      chartPath,
      reportPath,
      supersedes: input.supersedes ?? null,
    });
    result.affectedArtifacts = affectedArtifacts;
    writeFileSync(path.join(project.dataDir, reportPath), renderResultReport(result, metricKeys), "utf8");
    this.repositories.createResult(result);
    if (input.supersedes) {
      this.repositories.supersedeResult(input.supersedes, resultId, []);
    }
    this.emitRun(project, task, "result_created", {
      resultId,
      runIds: result.runIds,
      comparable: result.comparability.comparable,
      chartPath,
      reportPath,
      supersedes: input.supersedes ?? null,
    });
    return {
      result,
      warnings: [
        ...result.comparability.warnings,
        ...result.comparability.keyDifferences,
        ...(chart ? [] : ["chart omitted because runs are not directly comparable"]),
      ],
    };
  }

  tailStatus(run: RunRecord): {
    id: string;
    status: RunStatus;
    verification: string;
    name: string;
    kind: string;
    fingerprint: string;
    pid: number | null;
    exitCode: number | null;
    error: string | null;
  } {
    return {
      id: run.id,
      status: run.status,
      verification: run.verificationStatus,
      name: run.name,
      kind: run.kind,
      fingerprint: run.configFingerprint,
      pid: run.pid,
      exitCode: run.exitCode,
      error: run.error,
    };
  }
}
