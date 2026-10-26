import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, copyFileSync, constants, writeFileSync } from "node:fs";
import path from "node:path";

export function openDatabase(file: string): DatabaseSync {
  const existing = file !== ":memory:" && existsSync(file);
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    const version = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    if (version > SCHEMA_VERSION) throw new Error("database schema is newer than this application");
    if (version < SCHEMA_VERSION && existing) {
      const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      if (integrity.integrity_check !== "ok") throw new Error("database integrity check failed; migration cancelled");
      const backup = `${path.resolve(file)}.before-v${SCHEMA_VERSION}.${Date.now()}.sqlite`;
      db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      writeFileSync(`${backup}.json`, JSON.stringify({ source: path.resolve(file), backup, version, targetVersion: SCHEMA_VERSION, restore: "Close host and worker; restore this snapshot into a new data directory. Keep project files and Pi sessions unchanged. Rebuild derived indexes." }, null, 2));
    }
    ensureSchema(db);
  } catch (error) { db.close(); throw error; }
  return db;
}

export const SCHEMA_VERSION = 3;

/** Restore to a new path only, so recovery cannot overwrite a live database. */
export function restoreDatabase(backup: string, destination: string): void {
  const probe = new DatabaseSync(backup, { readOnly: true });
  try {
    if ((probe.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check !== "ok") throw new Error("invalid backup");
  } finally { probe.close(); }
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(backup, destination, constants.COPYFILE_EXCL);
}

export function ensureSchema(db: DatabaseSync): void {
  db.exec("BEGIN IMMEDIATE");
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      session_file TEXT,
      context_version INTEGER NOT NULL DEFAULT 1,
      review_text TEXT,
      model_provider TEXT,
      model_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, created_at);
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, seq);
    CREATE TABLE IF NOT EXISTS posted_messages (
      task_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (task_id, client_id)
    );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL,
      media_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      source_json TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_materials_project ON materials(project_id, created_at);
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      confirmed_by TEXT,
      confirmed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plans_task ON plans(task_id, version);
    CREATE TABLE IF NOT EXISTS admissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      assessed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admissions_task ON admissions(task_id, assessed_at);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      project_dir TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data_json TEXT NOT NULL,
      UNIQUE(project_id, request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, created_at);
    CREATE TABLE IF NOT EXISTS run_commands (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_run_commands_status ON run_commands(status, created_at);
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      status TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_approvals_task ON approvals(task_id, created_at);
    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      key TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics(run_id);
    CREATE TABLE IF NOT EXISTS result_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_results_project ON result_versions(project_id, created_at);
    CREATE TABLE IF NOT EXISTS manuscript_versions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      version INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manuscripts_project ON manuscript_versions(project_id, version);
    CREATE TABLE IF NOT EXISTS skills (
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      license TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      source_path TEXT NOT NULL,
      requires_json TEXT NOT NULL,
      content TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      PRIMARY KEY (project_id, name)
    );
    CREATE TABLE IF NOT EXISTS skill_loads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      loaded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_audit (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT,
      query TEXT NOT NULL,
      channel TEXT NOT NULL,
      response_hash TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  // Additive migration for databases created before task-level model selection.
  // Old task rows keep NULL and inherit the host default until the user switches.
  ensureColumn(db, "tasks", "model_provider", "model_provider TEXT");
  ensureColumn(db, "tasks", "model_id", "model_id TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_versions (
      memory_id TEXT NOT NULL, revision INTEGER NOT NULL, project_id TEXT NOT NULL,
      task_id TEXT NOT NULL, scope TEXT NOT NULL, data_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
      PRIMARY KEY(memory_id, revision)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_versions(project_id, task_id, scope);
    CREATE TABLE IF NOT EXISTS memory_heads (memory_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_changes (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_ingestions (project_id TEXT NOT NULL, task_id TEXT NOT NULL, source_key TEXT NOT NULL, memory_id TEXT NOT NULL, PRIMARY KEY(project_id, task_id, source_key));
    CREATE TABLE IF NOT EXISTS recall_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS method_versions (project_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY(project_id, name, hash));
    CREATE TABLE IF NOT EXISTS method_heads (project_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id, name));
    CREATE TABLE IF NOT EXISTS task_method_bindings (project_id TEXT NOT NULL, task_id TEXT NOT NULL, name TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY(task_id, name));
    CREATE TABLE IF NOT EXISTS experiences (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evolution_candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS method_evaluations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, candidate_id TEXT NOT NULL, data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS method_publications (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, data_json TEXT NOT NULL);
    INSERT OR IGNORE INTO method_versions SELECT project_id, name, sha256, json_object('name', name, 'hash', sha256, 'version', version, 'content', content, 'license', license, 'sourcePath', source_path, 'requires', json(requires_json), 'toolDescriptions', json('{}')) FROM skills;
    INSERT OR IGNORE INTO method_heads SELECT project_id, name, sha256, 0 FROM skills;
    INSERT OR IGNORE INTO task_method_bindings SELECT tasks.project_id, tasks.id, method_heads.name, method_heads.hash FROM tasks JOIN method_heads ON tasks.project_id=method_heads.project_id;
  `);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  if (columns.some((entry) => entry.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}
