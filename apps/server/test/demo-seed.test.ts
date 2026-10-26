import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { DEMO_SOURCE, seedDemo } from "../../../scripts/seed-demo.js";

test("README starter imports a real source, survives retries and never sends or approves work", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "sf-first-run-"));
  const config = loadConfig({ home: root, configFile: path.join(root, "config.json"), dataDir: path.join(root, "data"), env: {} }); config.workerEnabled = false;
  let modelCalls = 0;
  const app = await createApp({ config, agent: { sendMessage: async () => { modelCalls++; }, isRunning: () => false, stop: async () => ({ stopped: false }), dispose: async () => {} } });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/`;
  try {
    const first = await seedDemo(base, config.dataDir), second = await seedDemo(base, config.dataDir);
    assert.equal(first.project.id, second.project.id); assert.equal(first.task.id, second.task.id); assert.equal(first.material.id, second.material.id);
    assert.match(readFileSync(path.join(first.project.dataDir, DEMO_SOURCE), "utf8"), /SCHOLARFLOW_SOURCE_CHECK/);
    assert.equal(first.material.sha256, second.material.sha256);
    assert.equal(app.services.repositories.listMaterials(first.project.id).length, 1);
    assert.equal(app.services.repositories.listEvents(first.task.id).filter(e => e.type === "user_message").length, 0);
    assert.equal(app.services.repositories.listApprovals(first.task.id).length, 0);
    assert.equal(app.services.repositories.listRunRecords().length, 0); assert.equal(modelCalls, 0);
    assert.equal(existsSync(path.join(root, "config.json")), false, "starter does not create or copy credentials");
    await assert.rejects(() => seedDemo("https://example.org/", config.dataDir), /local ScholarFlow/);
    await assert.rejects(() => seedDemo(base, path.join(root, "unrelated")), /outside|escape|root/i);
    writeFileSync(path.join(first.project.dataDir, DEMO_SOURCE), "My newer source notes");
    await assert.rejects(() => seedDemo(base, config.dataDir), /local edits/);
    assert.equal(readFileSync(path.join(first.project.dataDir, DEMO_SOURCE), "utf8"), "My newer source notes");
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
});
