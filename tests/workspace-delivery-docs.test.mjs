import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = path.join(root, "docs/verification/workspace-redesign");
const plan = readFileSync(path.join(root, "PLAN.md"), "utf8");
const evidence = JSON.parse(readFileSync(path.join(evidenceRoot, "W05-evidence/WT14-real-api.json"), "utf8"));
const review = readFileSync(path.join(evidenceRoot, "W02-W05-review-issues.md"), "utf8");
const unresolved = new Map([
  ["W02", "验收未通过："], ["W03", "验收未通过："], ["W05", "验收未通过："],
  ["WT06", "不通过："], ["WT09", "不通过："], ["WT10", "不通过："], ["WT13", "不通过："],
  ["UI03", "待复验："], ["UI04", "待复验："], ["UI07", "待复验："], ["UI08", "待复验："],
]);

function validReviewStatuses(text) {
  const rows = text.split(/\r?\n/).filter((line) => /^\| (W\d\d|WT\d\d|UI\d\d) \|/.test(line));
  assert.equal(rows.length, 34);
  for (const row of rows) {
    const cells = row.split("|").map((v) => v.trim());
    const expected = unresolved.get(cells[1]);
    if (expected) {
      assert.ok(cells.at(-2).startsWith(expected), `${cells[1]} cannot pass with an unresolved review issue`);
      assert.ok(cells.at(-2).includes("W02-W05-review-issues.md"));
    } else assert.match(cells.at(-2), /^(已完成|通过)：/);
  }
}

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
test("unresolved review issues block only affected milestones and checks while AF stays separate", () => {
  validReviewStatuses(plan);
  for (const id of unresolved.keys()) {
    const promoted = plan.split(/\r?\n/).map((row) => {
      if (!row.startsWith(`| ${id} |`)) return row;
      const cells = row.split("|");
      cells[cells.length - 2] = " 已完成：incorrectly promoted ";
      return cells.join("|");
    }).join("\n");
    assert.throws(() => validReviewStatuses(promoted));
  }
  for (const line of plan.split(/\r?\n/).filter((line) => /^\| AF\d\d \|/.test(line))) assert.match(line, /待实施设计/);
});

test("independent review keeps reproducible failure observations and all three issues open", () => {
  assert.ok(review.includes("8ae2ba7eb088be322e8106cbafa203a70bfde6ed"));
  for (const id of ["WR-R01", "WR-R02", "WR-R03"]) {
    const rows = review.split(/\r?\n/).filter((row) => row.startsWith(`| ${id} |`));
    assert.equal(rows.length, 1);
    assert.match(rows[0], /\| 待修复复验 \|$/);
  }
  for (const observation of ["newerEditKept=false", "INVALID_REFERENCE", "calls=2; differentClientIds=2", "修复及关闭条件"]) assert.ok(review.includes(observation));
});
test("final review links resolve and screenshots contain substantive evidence", () => {
  for (const filename of ["W03-references.md", "W04-feedback.md", "W05-regression.md", "W02-W05-review-issues.md"]) {
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
