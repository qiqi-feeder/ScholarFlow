import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDatabase } from "./db.js";
import { ExperimentWorker } from "./worker.js";
import { getProcessIdentity, sameProcess } from "./runner.js";

const dbPath = process.env.SCHOLARFLOW_DB ?? path.resolve("data", "scholarflow.sqlite");
const dataDir = path.dirname(dbPath);
const lockFile = path.join(dataDir, "worker.lock");

function acquireLock(): boolean {
  try {
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: getProcessIdentity(process.pid).startedAt, at: new Date().toISOString() }), { flag: "wx" });
    return true;
  } catch {
    try {
      const existing = JSON.parse(readFileSync(lockFile, "utf8")) as { pid: number; startedAt: string | null };
      if (existing.pid && sameProcess(getProcessIdentity(existing.pid), existing.startedAt)) {
        console.log(`[worker] another worker is already running (pid ${existing.pid}); exiting`);
        return false;
      }
      unlinkSync(lockFile);
      writeFileSync(lockFile, JSON.stringify({ pid: process.pid, startedAt: getProcessIdentity(process.pid).startedAt, at: new Date().toISOString() }));
      return true;
    } catch (error) {
      console.error(`[worker] could not acquire lock ${lockFile}: ${(error as Error).message}`);
      return false;
    }
  }
}

if (!acquireLock()) process.exit(0);

const db = openDatabase(dbPath);
const pollMs = Number(process.env.SCHOLARFLOW_WORKER_POLL_MS ?? 750);
const worker = new ExperimentWorker({
  db,
  pollMs,
  logger: (message) => console.log(`[worker ${new Date().toISOString()}] ${message}`),
});
worker.start();
console.log(`[worker] database=${dbPath} concurrency=1`);

const shutdown = async () => {
  console.log("[worker] stopping after current run");
  await worker.stop();
  db.close();
  try {
    if (existsSync(lockFile)) unlinkSync(lockFile);
  } catch {
    // best effort
  }
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
