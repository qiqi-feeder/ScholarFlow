import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const architecture = read("docs/AGENT_CAPABILITY_ARCHITECTURE.md");
const plan = read("PLAN.md");
const discussion = read("docs/WORKSPACE_PRODUCT_DISCUSSION.md");
const frontend = read("docs/FRONTEND_PRODUCT_REQUIREMENTS.md");
const readme = read("README.md");

function rows(text, prefix, width) {
  const result = new Map();
  for (const match of text.matchAll(new RegExp(`^\\| (${prefix}\\d{2}) \\|[^\\r\\n]+`, "gm"))) {
    const cells = match[0].split("|").slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, width, `Incomplete ${prefix} row`);
    assert.ok(cells.every(Boolean), `Empty ${prefix} cell`);
    assert.ok(!result.has(cells[0]), `Duplicate ${prefix} ID`);
    result.set(cells[0], cells);
  }
  assert.ok(result.size, `Missing ${prefix} rows`);
  return result;
}

function validateTraceability(architectureText, planText) {
  const checks = rows(architectureText, "AT", 4);
  assert.deepEqual([...checks.keys()], Array.from({ length: 10 }, (_, i) => `AT${String(i + 1).padStart(2, "0")}`));
  for (const row of checks.values()) assert.ok(row[3] === "待实施" || /^通过.*\[[^\]]+\]\([^)]+\)/.test(row[3]), "Acceptance falsely promoted without evidence");
  const phases = rows(planText, "AF", 5);
  assert.deepEqual([...phases.keys()], ["AF01", "AF02", "AF03", "AF04"]);
  const covered = new Set();
  const dependencies = new Map();
  for (const [id, row] of phases) {
    assert.ok(row[4] === "待实施设计" || /^通过.*\[[^\]]+\]\([^)]+\)/.test(row[4]), "Phase falsely promoted without evidence");
    const deps = row[1].match(/AF\d{2}/g) ?? [];
    assert.ok(row[1] === "无" || deps.length, "Missing dependency declaration");
    for (const dep of deps) assert.ok(phases.has(dep), "Unknown phase dependency");
    dependencies.set(id, deps);
    const refs = row[3].match(/AT\d{2}/g) ?? [];
    assert.ok(refs.length, "Missing phase acceptance");
    for (const ref of refs) {
      assert.ok(checks.has(ref), "Unknown architecture acceptance");
      covered.add(ref);
    }
  }
  assert.equal(covered.size, checks.size, "Unassigned architecture acceptance");
  const done = new Set();
  while (done.size < phases.size) {
    const before = done.size;
    for (const [id, deps] of dependencies) {
      if (deps.every((dep) => done.has(dep))) done.add(id);
    }
    assert.ok(done.size > before, "Cyclic phase dependencies");
  }
}

function validateBoundary(text) {
  for (const fragment of [
    "框架已确认，待实施", "各工作区工具细节后续讨论", "每个任务一个主 Agent 会话",
    "不默认每轮运行额外的意图分类模型", "不等于权限隔离", "停用不会擦除历史工具结果",
    "具体数量、命名、参数、供应商与 Skill 拆分均待文献专题设计",
  ]) assert.ok(text.includes(fragment), `Missing architecture boundary: ${fragment}`);
}

test("architecture batches form a complete, pending acceptance graph", () => {
  validateTraceability(architecture, plan);
});

test("traceability rejects missing, duplicate, unassigned, unknown and promoted records", () => {
  const cases = [
    [architecture.replace("| AT10 |", "| AT11 |"), plan, /deep-equal/],
    [architecture + "\n| AT01 | duplicate | negative | 待实施 |", plan, /Duplicate AT/],
    [architecture.replace("| 待实施 |", "| 已通过 |"), plan, /Acceptance falsely promoted/],
    [architecture.replace("| AT01 | 初始请求只含基础集合与能力目录，领域工具保留在注册表 |", "| AT01 | |"), plan, /Empty AT/],
    [architecture, plan.replace("AT06、AT07、AT08", "AT06、AT08"), /Unassigned architecture/],
    [architecture, plan.replace("AT06、AT07、AT08", "AT06、AT99、AT08"), /Unknown architecture/],
    [architecture, plan.replace("| AF01 | 无 |", "| AF01 | AF99 |"), /Unknown phase/],
    [architecture, plan.replace("| AF01 | 无 |", "| AF01 | AF02 |"), /Cyclic phase/],
    [architecture, plan.replace("| 待实施设计 |", "| 已完成 |"), /Phase falsely promoted/],
    [architecture, plan.replace("| AT05 |", "| 无 |"), /Missing phase acceptance/],
  ];
  for (const [a, p, error] of cases) assert.throws(() => validateTraceability(a, p), error);
});

test("confirmed architecture remains separate from deferred tool design and implementation", () => {
  validateBoundary(architecture);
  for (const fragment of ["不等于权限隔离", "各工作区工具细节后续讨论", "停用不会擦除历史工具结果"]) {
    assert.throws(() => validateBoundary(architecture.replace(fragment, "未声明")), /Missing architecture boundary/);
  }
  assert.match(architecture, /defaultActive: false/);
  assert.match(architecture, /setActiveTools\(\).*替换整个活动集合/);
  assert.match(architecture, /压缩前后均可从持久记录恢复/);
  assert.match(architecture, /先保存实际记录\/文件及版本，再产生变化事件/);
  assert.match(architecture, /Crossref 元数据不能当作已经获得原文/);
  assert.match(architecture, /旧编译不得覆盖新预览/);
});

test("discussion stays concise while retaining stable product references and latest decisions", () => {
  assert.ok(discussion.length < 5500, "Discussion has grown beyond the concise current-decision format");
  assert.deepEqual([...rows(discussion, "D", 4).keys()], ["D01", "D02", "D03", "D04", "D05", "D06", "D07"]);
  assert.equal(rows(discussion, "U", 5).size, 8);
  assert.match(discussion, /S6：.*各工作区的工具细节后续逐项讨论/);
  assert.match(discussion, /当前 `load_skill` 仅读取说明，不会自动启用工具/);
  assert.match(discussion, /真实记录\/文件 → 事件通知 → 工作区更新/);
  assert.doesNotMatch(discussion, /## \d+\. GitHub 调研参考|raw\.githubusercontent\.com/);
});

test("entry points agree on the architecture handoff without requiring new prototypes", () => {
  for (const text of [plan, discussion, frontend, readme]) assert.ok(text.includes("AGENT_CAPABILITY_ARCHITECTURE.md"));
  assert.match(plan, /^## 9\. Agent 能力与产物反馈后续计划$/m);
  assert.match(plan, /不能自动并入 W01–W05 的完成声明/);
  assert.match(frontend, /所有工作区的变化均来自后台已保存的真实记录\/文件与版本/);
  assert.match(frontend, /当前 DOI 导入不能视为已获取全文/);
  assert.ok(readme.includes("npm run test:docs"));
  assert.match(JSON.parse(read("package.json")).scripts["test:docs"], /tests\/\*\.test\.mjs/);
});

test("changed documentation uses valid encoding and resolvable local file links", () => {
  for (const [file, text] of [
    ["docs/AGENT_CAPABILITY_ARCHITECTURE.md", architecture],
    ["docs/WORKSPACE_PRODUCT_DISCUSSION.md", discussion],
    ["docs/FRONTEND_PRODUCT_REQUIREMENTS.md", frontend], ["PLAN.md", plan], ["README.md", readme],
  ]) {
    assert.ok(!text.includes("\uFFFD"), `Invalid encoding: ${file}`);
    assert.doesNotMatch(text, /[A-Z]:[\\/]Users[\\/]/i);
    for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^(https?:\/\/|#)/.test(target)) continue;
      assert.ok(existsSync(path.resolve(root, path.dirname(file), target.split("#")[0])), `Broken link: ${file}: ${target}`);
    }
  }
});
