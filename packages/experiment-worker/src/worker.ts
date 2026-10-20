import { appendFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { RunRecord } from "@scholarflow/research";
import { RunStore } from "./store.js";
import {
  getProcessIdentity,
  logTail,
  sameProcess,
  startLocalProcess,
  verifyArtifacts,
  type ProcessHandle,
  type ProcessStarter,
} from "./runner.js";

export interface WorkerOptions {
  db: DatabaseSync;
  pollMs?: number;
  processStarter?: ProcessStarter;
  identityLookup?: typeof getProcessIdentity;
  onRunFinished?: (run: RunRecord) => void;
  logger?: (message: string) => void;
}

export class ExperimentWorker {
  private readonly store: RunStore;
  private readonly db: DatabaseSync;
  private readonly pollMs: number;
  private readonly starter: ProcessStarter;
  private readonly identity: typeof getProcessIdentity;
  private readonly onRunFinished?: (run: RunRecord) => void;
  private readonly logger: (message: string) => void;
  private running = false;
  private stopping = false;
  private active: { record: RunRecord; handle: ProcessHandle } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private wakeResolver: (() => void) | null = null;

  constructor(options: WorkerOptions) {
    this.db = options.db;
    this.store = new RunStore(options.db);
    this.pollMs = options.pollMs ?? 750;
    this.starter = options.processStarter ?? startLocalProcess;
    this.identity = options.identityLookup ?? getProcessIdentity;
    this.onRunFinished = options.onRunFinished;
    this.logger = options.logger ?? ((message) => console.log(`[worker] ${message}`));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const reconciled = this.store.reconcileOnStart();
    for (const record of reconciled) {
      this.logger(`run ${record.id} became unknown after worker restart; not restarting automatically`);
    }
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.running && !this.stopping) {
      await this.processCommands();
      if (this.active) {
        await new Promise<void>((resolve) => {
          this.wakeResolver = resolve;
        });
        continue;
      }
      const record = this.store.claimNext();
      if (!record) {
        await this.sleep();
        continue;
      }
      await this.execute(record);
    }
    this.running = false;
  }

  private async processCommands(): Promise<void> {
    const rows = this.db
      .prepare("SELECT id, run_id FROM run_commands WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10")
      .all() as Array<{ id: string; run_id: string }>;
    for (const row of rows) {
      let result: { cancelled: boolean; reason: string };
      try {
        result = await this.cancel(row.run_id);
      } catch (error) {
        result = { cancelled: false, reason: (error as Error).message };
      }
      this.db
        .prepare("UPDATE run_commands SET status = 'done', result_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(result), new Date().toISOString(), row.id);
    }
  }

  private sleep(): Promise<void> {
    return new Promise((resolve) => {
      this.timer = setTimeout(resolve, this.pollMs);
      this.timer.unref?.();
      this.wakeResolver = () => {
        if (this.timer) clearTimeout(this.timer);
        resolve();
      };
    });
  }

  private async execute(record: RunRecord): Promise<void> {
    const projectDir = this.store.projectDirFor(record);
    if (!projectDir) {
      this.store.markFinished(record, { status: "failed", exitCode: null, error: "project directory is unavailable" });
      return;
    }
    let handle: ProcessHandle;
    try {
      handle = await this.starter(record, projectDir);
    } catch (error) {
      this.store.markFinished(record, {
        status: "failed",
        exitCode: null,
        error: `failed to start: ${(error as Error).message}`,
      });
      this.onRunFinished?.(record);
      this.wakeResolver?.();
      return;
    }
    const started = handle.startedAt ?? this.identity(handle.pid).startedAt;
    this.store.markRunning(record, handle.pid, started);
    this.active = { record, handle };
    const result = await handle.done;
    this.active = null;

    if (result.spawnError) {
      this.store.markFinished(record, {
        status: "failed",
        exitCode: null,
        error: `spawn error: ${result.spawnError}`,
      });
    } else {
      const cancelled = record.status === "cancelled";
      const missing = verifyArtifacts(record, projectDir);
      if (cancelled) {
        this.store.markFinished(record, { status: "cancelled", exitCode: result.code, error: "run cancelled" });
      } else if (result.code === 0) {
        this.store.markFinished(record, {
          status: "succeeded",
          exitCode: 0,
          error:
            missing.length > 0
              ? `process succeeded but expected artifacts are missing or invalid: ${missing.join(", ")}`
              : record.error,
        });
        if (missing.length > 0) {
          record.verificationStatus = "partial";
          this.store.save(record);
        }
      } else {
        this.store.markFinished(record, {
          status: "failed",
          exitCode: result.code,
          error: `process exited with code ${result.code ?? "null"}${result.signal ? ` (signal ${result.signal})` : ""}`,
        });
      }
    }
    appendFileSync(
      record.logPath,
      `[worker] finished status=${record.status} verification=${record.verificationStatus}\n`,
      "utf8",
    );
    this.logger(`run ${record.id} finished: ${record.status}`);
    this.onRunFinished?.(record);
    this.wakeResolver?.();
  }

  /** Cancel a queued run or a currently supervised process. */
  async cancel(runId: string): Promise<{ cancelled: boolean; reason: string; run?: RunRecord }> {
    const record = this.store.get(runId);
    if (!record) return { cancelled: false, reason: "run not found" };
    if (record.status === "queued") {
      this.store.markFinished(record, { status: "cancelled", exitCode: null, error: "cancelled before start" });
      return { cancelled: true, reason: "queued run cancelled", run: record };
    }
    if (record.status !== "running") {
      return { cancelled: false, reason: `run is ${record.status}, not running`, run: record };
    }
    if (this.active?.record.id === runId) {
      this.active.record.status = "cancelled";
      this.store.save(this.active.record);
      const result = await this.active.handle.cancel();
      if (!result.cancelled) {
        this.active.record.status = "running";
        this.active.record.unknownReason = result.reason;
        this.store.save(this.active.record);
      }
      return { ...result, run: this.active.record };
    }

    // The worker may have restarted. Verify the recorded process identity before
    // touching the PID, so a reused PID is never killed.
    if (!record.pid) return { cancelled: false, reason: "run has no recorded PID", run: record };
    const current = this.identity(record.pid);
    if (!sameProcess(current, record.processStartedAt)) {
      record.unknownReason = "recorded process is not alive or its identity does not match; no signal sent";
      this.store.save(record);
      return { cancelled: false, reason: record.unknownReason, run: record };
    }
    if (process.platform === "win32") {
      const { execFileSync } = await import("node:child_process");
      try {
        execFileSync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        return { cancelled: false, reason: "taskkill failed after identity check", run: record };
      }
    } else {
      try {
        process.kill(-record.pid, "SIGTERM");
      } catch {
        try {
          process.kill(record.pid, "SIGTERM");
        } catch {
          return { cancelled: false, reason: "process kill failed after identity check", run: record };
        }
      }
    }
    this.store.markFinished(record, { status: "cancelled", exitCode: null, error: "cancelled after identity check" });
    return { cancelled: true, reason: "cancelled after PID identity check", run: record };
  }

  tailLog(runId: string, lines = 200): string {
    const record = this.store.get(runId);
    return record ? logTail(record, lines) : "";
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.wakeResolver?.();
    if (this.timer) clearTimeout(this.timer);
    if (this.active) {
      await this.active.handle.done.catch(() => undefined);
    }
  }

  isIdle(): boolean {
    return !this.active;
  }
}
