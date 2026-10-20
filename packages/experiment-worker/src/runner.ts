import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { resolveEnvReferences, resolveInsideRoot, SECRET_ENV_PATTERN, sha256, type RunRecord } from "@scholarflow/research";

const ALLOWED_BASE_ENV = new Set([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "CUDA_VISIBLE_DEVICES",
  "CUDA_HOME",
  "CUDA_PATH",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "PYTHONPATH",
  "R_LIBS_USER",
]);

export interface ProcessIdentity {
  pid: number;
  startedAt: string | null;
  commandLine: string | null;
  alive: boolean;
}

export type IdentityLookup = (pid: number) => ProcessIdentity;

function parseCimDate(value: string): string | null {
  const match = value.match(/\/Date\((\d+)\)\//);
  if (match) return new Date(Number(match[1])).toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function getProcessIdentity(pid: number): ProcessIdentity {
  if (!Number.isInteger(pid) || pid <= 0) return { pid, startedAt: null, commandLine: null, alive: false };
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; if ($p) { $p.CreationDate.ToString('o') + '|' + $p.CommandLine }`,
        ],
        { encoding: "utf8", timeout: 8000, windowsHide: true },
      ).trim();
      if (!output) return { pid, startedAt: null, commandLine: null, alive: false };
      const [dateRaw, ...command] = output.split("|");
      const startedAt = parseCimDate(dateRaw ?? "");
      return { pid, startedAt, commandLine: command.join("\t") || null, alive: true };
    } catch {
      return { pid, startedAt: null, commandLine: null, alive: false };
    }
  }
  try {
    process.kill(pid, 0);
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return { pid, startedAt: parseCimDate(started), commandLine: null, alive: true };
  } catch {
    return { pid, startedAt: null, commandLine: null, alive: false };
  }
}

export function sameProcess(identity: ProcessIdentity, expectedStartedAt: string | null): boolean {
  if (!identity.alive) return false;
  if (!expectedStartedAt) return true;
  if (!identity.startedAt) return false;
  return Math.abs(Date.parse(identity.startedAt) - Date.parse(expectedStartedAt)) < 5000;
}

function redact(value: string): string {
  let result = value
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_KEY]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  for (const [key, secret] of Object.entries(process.env)) {
    if (!SECRET_ENV_PATTERN.test(key) || !secret || secret.length < 6) continue;
    result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

export function buildExperimentEnv(specEnv: Record<string, string>, runId: string, projectDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ALLOWED_BASE_ENV.has(key) && value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(resolveEnvReferences(specEnv))) env[key] = value;
  env.SCHOLARFLOW_RUN_ID = runId;
  env.SCHOLARFLOW_PROJECT_DIR = projectDir;
  env.PYTHONUNBUFFERED = "1";
  return env;
}

export interface ProcessHandle {
  pid: number;
  startedAt: string | null;
  done: Promise<{ code: number | null; signal: string | null; spawnError?: string }>;
  cancel: () => Promise<{ cancelled: boolean; reason: string }>;
}

export type ProcessStarter = (record: RunRecord, projectDir: string) => Promise<ProcessHandle>;

export const startLocalProcess: ProcessStarter = async (record, projectDir) => {
  const cwd = resolveInsideRoot(projectDir, record.spec.cwd || ".");
  mkdirSync(path.dirname(record.logPath), { recursive: true });
  const env = buildExperimentEnv(record.spec.env, record.id, projectDir);
  appendFileSync(
    record.logPath,
    `[host] ${new Date().toISOString()} starting ${record.id}\n[host] program=${record.spec.program}\n[host] args=${JSON.stringify(record.spec.args)}\n[host] cwd=${cwd}\n[host] timeout=${record.timeoutSeconds}s\n`,
    "utf8",
  );

  let child: ChildProcess;
  try {
    child = spawn(record.spec.program, record.spec.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
  } catch (error) {
    throw new Error(`failed to start experiment: ${(error as Error).message}`);
  }
  const pid = child.pid ?? -1;
  let timedOut = false;
  let cancelled = false;

  const write = (stream: "stdout" | "stderr", chunk: Buffer) => {
    try {
      appendFileSync(record.logPath, `[${stream}] ${redact(chunk.toString("utf8"))}`, "utf8");
    } catch {
      // Losing a log line must not take down the run supervisor.
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => write("stdout", chunk));
  child.stderr?.on("data", (chunk: Buffer) => write("stderr", chunk));

  const done = new Promise<{ code: number | null; signal: string | null; spawnError?: string }>((resolve) => {
    child.once("error", (error) => {
      appendFileSync(record.logPath, `[host] spawn error: ${error.message}\n`, "utf8");
      resolve({ code: null, signal: null, spawnError: error.message });
    });
    child.once("exit", (code, signal) => {
      appendFileSync(
        record.logPath,
        `[host] ${new Date().toISOString()} exited code=${code} signal=${signal ?? "none"}${timedOut ? " (timeout)" : ""}${cancelled ? " (cancelled)" : ""}\n`,
        "utf8",
      );
      resolve({ code, signal });
    });
  });

  const timer = setTimeout(() => {
    timedOut = true;
    void killTree(pid, getProcessIdentity(pid).startedAt).catch(() => undefined);
  }, Math.max(1, record.timeoutSeconds) * 1000);
  timer.unref?.();

  let started = getProcessIdentity(pid);
  for (let attempt = 0; attempt < 10 && !started.startedAt && started.alive; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    started = getProcessIdentity(pid);
  }

  return {
    pid,
    startedAt: started.startedAt,
    done: done.finally(() => clearTimeout(timer)),
    cancel: async () => {
      cancelled = true;
      const current = getProcessIdentity(pid);
      if (!sameProcess(current, started.startedAt)) {
        return { cancelled: false, reason: "process identity mismatch; refusing to kill a possibly reused PID" };
      }
      await killTree(pid, started.startedAt);
      return { cancelled: true, reason: "cancelled after PID identity check" };
    },
  };
};

export async function killTree(pid: number, expectedStartedAt: string | null): Promise<boolean> {
  const current = getProcessIdentity(pid);
  if (!sameProcess(current, expectedStartedAt)) return false;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

export function verifyArtifacts(record: RunRecord, projectDir: string): string[] {
  const missing: string[] = [];
  for (const relative of record.spec.expectedArtifacts) {
    try {
      const target = resolveInsideRoot(projectDir, path.posix.join(record.spec.cwd || ".", relative));
      if (!existsSync(target) || !statSync(target).isFile()) missing.push(relative);
      else if (relative.endsWith(".json")) JSON.parse(readFileSync(target, "utf8"));
    } catch {
      missing.push(relative);
    }
  }
  return missing;
}

export function logTail(record: RunRecord, lines = 200): string {
  try {
    if (!existsSync(record.logPath)) return "";
    return readFileSync(record.logPath, "utf8").split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export function processToken(record: RunRecord): string {
  return sha256(`${record.id}:${record.pid ?? ""}:${record.processStartedAt ?? ""}`).slice(0, 32);
}
