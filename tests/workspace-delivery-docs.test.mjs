import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = path.join(root, "docs/verification/workspace-redesign");
const plan = readFileSync(path.join(root, "PLAN.md"), "utf8");
const evidence = JSON.parse(readFileSync(path.join(evidenceRoot, "W05-evidence/WT14-real-api.json"), "utf8"));

function validRealEvidence(e) {
  assert.equal(e.check, "WT14/WT15");
  assert.equal(e.provider, "deepseek");
  assert.ok(e.model);
  for (const [key, prefix] of [["projectId", "prj"], ["taskId", "tsk"], ["sourceId", "mat"]]) assert.match(e[key], new RegExp(`^${prefix}_[0-9a-z]{20}$`));
  assert.match(e.sourceHash, /^[0-9a-f]{64}$/);
  assert.equal(e.tool, "read_artifact");
  assert.equal(e.toolCalls, 1);
  for (const key of ["witnessMatched", "sessionReopened", "resumedPrompt", "draftRestored"]) assert.equal(e[key], true);
  assert.equal(e.logicalMessages, 2);
  assert.equal(e.automaticResubmission, false);
  assert.deepEqual(e.pageErrors, []);
  assert.doesNotMatch(JSON.stringify(e), /sk-[A-Za-z0-9_-]{10,}|apiKey|authorization/i);
}
test("real model evidence requires an actual bounded tool result and safe recovery", () => {
  validRealEvidence(evidence);
  for (const patch of [{ toolCalls: 0 }, { witnessMatched: false }, { sessionReopened: false }, { automaticResubmission: true }, { pageErrors: ["error"] }, { sourceHash: "fake" }]) assert.throws(() => validRealEvidence({ ...evidence, ...patch }));
});
test("completed workspace and correction rows link concrete evidence while AF remains separate", () => {
  const rows = plan.split(/\r?\n/).filter((line) => /^\| (W\d\d|WT\d\d|UI\d\d) \|/.test(line));
  assert.equal(rows.length, 34);
  for (const row of rows) {
    const cells = row.split("|").map((v) => v.trim());
    const status = cells.at(-2);
    assert.match(status, /^(已完成|通过)：/);
  }
  for (const line of plan.split(/\r?\n/).filter((line) => /^\| AF\d\d \|/.test(line))) assert.match(line, /待实施设计/);
});
test("final review links resolve and screenshots contain substantive evidence", () => {
  for (const filename of ["W03-references.md", "W04-feedback.md", "W05-regression.md"]) {
    const file = path.join(evidenceRoot, filename);
    const doc = readFileSync(file, "utf8");
    for (const match of doc.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      const target = path.resolve(path.dirname(file), match[1].split("#")[0]);
      const info = statSync(target);
      assert.ok(info.isFile());
      if (target.endsWith(".png")) assert.ok(info.size > 10000);
    }
  }
});
test("scientific acceptance stays unapproved until the actual target and budget are confirmed", () => {
  const card = readFileSync(path.join(root, "docs/RESEARCH_ACCEPTANCE_CARD.md"), "utf8");
  for (const term of ["待用户确认", "目标实验尚未执行", "官方", "独立", "数据许可", "1800", "指纹", "不足以证明统计显著性"]) assert.ok(card.includes(term), term);
  assert.match(card, /不把空字段视为批准/);
});
