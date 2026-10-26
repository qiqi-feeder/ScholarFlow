import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(path.join(root, file), "utf8");
const spec = read("docs/AGENT_IMPLEMENTATION_PLAN.md");
const plan = read("PLAN.md");
const frontend = read("docs/FRONTEND_PRODUCT_REQUIREMENTS.md");

function rows(text, prefix, width) {
  const result = new Map();
  for (const match of text.matchAll(new RegExp(`^\\| (${prefix}\\d{2}) \\|[^\\r\\n]+`, "gm"))) {
    const cells = match[0].split("|").slice(1, -1).map(value => value.trim());
    assert.equal(cells.length, width, `Incomplete ${prefix} row`);
    assert.ok(cells.every(Boolean), `Empty ${prefix} cell`);
    assert.ok(!result.has(cells[0]), `Duplicate ${prefix} ID`);
    result.set(cells[0], cells);
  }
  return result;
}

function validateGraph(specText, planText, frontendText) {
  const phases = rows(planText, "IG", 5);
  const checks = rows(specText, "RT", 4);
  assert.deepEqual([...phases.keys()], Array.from({length: 8}, (_, i) => `IG0${i}`));
  assert.deepEqual([...checks.keys()], Array.from({length: 16}, (_, i) => `RT${String(i + 1).padStart(2, "0")}`));
  for (const check of checks.values()) assert.equal(check[3], "待实施", "Acceptance falsely promoted");
  const covered = new Set();
  const deps = new Map();
  for (const [id, cells] of phases) {
    assert.equal(cells[4], "待实施", "Phase falsely promoted");
    const prerequisites = cells[1].match(/IG\d{2}/g) ?? [];
    assert.ok(cells[1] === "无" || prerequisites.length, "Missing dependency");
    if (cells[1] === "无") assert.equal(id, "IG00", "Only baseline can start without a dependency");
    for (const dep of prerequisites) assert.ok(phases.has(dep), "Unknown dependency");
    deps.set(id, prerequisites);
    const refs = cells[3].match(/RT\d{2}/g) ?? [];
    assert.ok(refs.length, "Missing acceptance assignment");
    for (const ref of refs) {
      assert.ok(checks.has(ref), "Unknown acceptance reference");
      covered.add(ref);
    }
  }
  const done = new Set();
  while (done.size < phases.size) {
    const before = done.size;
    for (const [id, required] of deps) if (required.every(dep => done.has(dep))) done.add(id);
    assert.ok(done.size > before, "Cyclic dependencies");
  }
  for (let i = 1; i < 8; i++) assert.ok(deps.get(`IG0${i}`).includes(`IG0${i - 1}`), "Missing prerequisite gate");
  assert.equal(covered.size, checks.size, "Unassigned acceptance");
  const ui = rows(frontendText, "MF", 4);
  assert.deepEqual([...ui.keys()], ["MF01", "MF02", "MF03", "MF04"]);
  for (const cells of ui.values()) {
    const refs = cells[3].match(/RT\d{2}/g) ?? [];
    assert.ok(refs.length, "Missing UI acceptance");
    for (const ref of refs) assert.ok(checks.has(ref), "Unknown UI acceptance");
  }
}

function validateContracts(text) {
  for (const contract of [
    "本次交付文档与测试，不代表功能完成", "本期不实现探索树回放",
    "不将 mem0、Graphiti、Harness² 直接作为运行时依赖", "expectedRevision", "sourceRefs[]",
    "validFrom", "validTo", "recordedAt", "knownAt", "supersedes[]", "conflictsWith[]",
    "模型建议不能自动升级为用户决定", "不能以省略 projectId 隐式开启",
    "默认关闭自动正式发布", "验证器不可进化", "基线始终参加比较",
    "逐样本反馈不回流提议器", "expectedBaselineVersion", "旧任务继续绑定原版本",
    "不能把旧轨迹回放当新 Skill 实效", "首个业务阶段为 IG00",
  ]) assert.ok(text.includes(contract), `Missing implementation contract: ${contract}`);
}

test("implementation stages form a pending dependency graph with complete functional and UI coverage", () => {
  validateGraph(spec, plan, frontend);
  validateContracts(spec);
});

test("implementation graph rejects unknown, cyclic, missing, duplicate and falsely completed records", () => {
  for (const [s, p, f, error] of [
    [spec, plan.replace("| IG00 | 无 |", "| IG00 | IG01 |"), frontend, /Cyclic/],
    [spec, plan.replace("| IG02 | IG01 |", "| IG02 | IG99 |"), frontend, /Unknown dependency/],
    [spec, plan.replace("| IG05 | IG04 |", "| IG05 | IG00 |"), frontend, /prerequisite gate/],
    [spec, plan.replace("RT15、RT16 | 待实施", "RT15 | 待实施"), frontend, /Unassigned/],
    [spec, plan.replace("RT15、RT16 | 待实施", "RT15、RT99 | 待实施"), frontend, /Unknown acceptance/],
    [spec.replace("| RT01 |", "| RT02 |"), plan, frontend, /Duplicate RT/],
    [spec.replace("| 待实施 |", "| 通过 |"), plan, frontend, /falsely promoted/],
    [spec, plan.replace("RT15、RT16 | 待实施", "RT15、RT16 | 已完成"), frontend, /falsely promoted/],
    [spec, plan, frontend.replace("RT14、RT16 |", "RT14、RT99 |"), /Unknown UI/],
  ]) assert.throws(() => validateGraph(s, p, f), error);
});

test("contracts reject changes that lose memory provenance, safe publication or scope boundaries", () => {
  for (const fragment of ["expectedRevision", "基线始终参加比较", "本期不实现探索树回放", "默认关闭自动正式发布"]) {
    assert.throws(() => validateContracts(spec.replaceAll(fragment, "omitted")), /Missing implementation contract/);
  }
});

test("all current entry points link the implementation specification and local targets resolve", () => {
  const files = ["README.md", "PLAN.md", "docs/AGENT_IMPLEMENTATION_PLAN.md", "docs/AGENT_CAPABILITY_ARCHITECTURE.md",
    "docs/WORKSPACE_PRODUCT_DISCUSSION.md", "docs/FRONTEND_PRODUCT_REQUIREMENTS.md", "docs/DISCOVERY.md",
    "docs/AGENT_RESUME_HIGHLIGHTS.md"];
  for (const file of files) {
    const text = read(file);
    if (!file.endsWith("/AGENT_IMPLEMENTATION_PLAN.md")) assert.ok(text.includes("AGENT_IMPLEMENTATION_PLAN.md"), `Missing handoff: ${file}`);
    assert.ok(!text.includes("\uFFFD"), `Invalid encoding: ${file}`);
    for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^(https?:|#)/.test(target)) continue;
      assert.ok(existsSync(path.resolve(root, path.dirname(file), target.split("#")[0])), `Broken link: ${file}: ${target}`);
    }
  }
  assert.ok(read("docs/WORKSPACE_PRODUCT_DISCUSSION.md").length < 5500);
});
