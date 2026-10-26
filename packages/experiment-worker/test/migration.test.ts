import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openDatabase, restoreDatabase, SCHEMA_VERSION } from "../src/db.js";
test("RT02 migration backs up old data, is idempotent, rolls back and restores to a new path", () => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-migration-"));
  try {
    const file = path.join(root, "old.sqlite");
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE legacy (value TEXT); INSERT INTO legacy VALUES ('unchanged session reference')"); old.close();
    let db = openDatabase(file);
    assert.equal(db.prepare("SELECT value FROM legacy").get()!.value, "unchanged session reference");
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, SCHEMA_VERSION); db.close();
    const backups = () => readdirSync(root).filter(f => /before-.*\.sqlite$/.test(f));
    assert.equal(backups().length, 1);
    db = openDatabase(file); db.close(); assert.equal(backups().length, 1);
    const restored = path.join(root, "restored.sqlite");
    restoreDatabase(path.join(root, backups()[0]!), restored);
    assert.throws(() => restoreDatabase(path.join(root, backups()[0]!), restored));
    const broken = path.join(root, "broken.sqlite");
    db = new DatabaseSync(broken); db.exec("CREATE TABLE tasks (wrong TEXT)"); db.close();
    assert.throws(() => openDatabase(broken));
    db = new DatabaseSync(broken); assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 0);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='events'").get(), undefined); db.close();
    writeFileSync(path.join(root, "session.jsonl"), "untouched");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
