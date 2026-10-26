import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filename = "docs/AGENT_RESUME_HIGHLIGHTS.md";
const document = readFileSync(path.join(root, filename), "utf8");

function validateSelection(text) {
  const rows = [...text.matchAll(/^\| (\d+) \| (A\d{2}) \| (.+) \| (.+) \| (.+) \|$/gm)];
  assert.equal(rows.length, 9, "Expected nine ranked highlights");
  const expected = ["A08", "A09", "A02", "A01", "A03", "A04", "A05", "A06", "A07"];
  assert.deepEqual(rows.map((row) => row[2]), expected, "Ranks must be unique and ordered");
  rows.forEach((row, i) => assert.equal(Number(row[1]), i + 1, "Rank sequence is invalid"));
  const byId = new Map(rows.map(row => [row[2], row]));
  assert.match(byId.get("A01")[5], /已讨论待实施.*只读取说明/, "Dynamic loading must remain pending");
  assert.match(byId.get("A05")[5], /待评测.*不能填写提升数字/, "Evaluation must remain unmeasured");
  for (const id of ["A08", "A09"]) assert.match(byId.get(id)[5], /已调研待实施/, "Top-ranked design falsely promoted");
  const sections = [...text.matchAll(/^## (\d+)\. /gm)].map(match => Number(match[1]));
  assert.deepEqual(sections, Array.from({length: 14}, (_, i) => i + 1), "Section numbers must remain sequential");
  let previousHeading = -1;
  for (const id of expected) {
    const heading = new RegExp(`^## \\d+\\. ${id}：.+$`, "m").exec(text);
    assert.ok(heading, `Missing detail for ${id}`);
    assert.ok(heading.index > previousHeading, "Detail order must match the ranking");
    previousHeading = heading.index;
    const tail = text.slice(heading.index + heading[0].length);
    const section = tail.split(/^## /m)[0];
    assert.match(section, /面试需要回答/, `Missing interview questions for ${id}`);
    assert.match(section, /简历措辞|可用表述/, `Missing resume wording for ${id}`);
    assert.match(section, /验证|评测/, `Missing validation for ${id}`);
    assert.match(section, /参考/, `Missing reference for ${id}`);
  }
}

test("ranked resume candidates distinguish architecture, implementation and unmeasured results", () => {
  validateSelection(document);
  assert.match(document, /尚未形成完整的相关性选择、分页读取和统一上下文预算/);
  assert.match(document, /不构成操作系统沙箱/);
  assert.match(document, /不能自动证明所有外部副作用 exactly-once/);
  assert.match(document, /不能写成已经完成 Agentic RAG/);
  assert.match(document, /文档检查通过不代表方案已实施或 Agent 效果已验证/);
});

test("selection validator rejects missing, duplicate and falsely promoted candidates", () => {
  assert.throws(() => validateSelection(document.replace(/^\| 9 \| A07 \|.+\r?\n/m, "")), /nine/);
  assert.throws(() => validateSelection(document.replace("| 9 | A07 |", "| 9 | A06 |")), /ordered/);
  assert.throws(() => validateSelection(document.replace("| 2 | A09 |", "| 3 | A09 |")), /sequence/);
  assert.throws(() => validateSelection(document.replace("已讨论待实施；现有 load_skill 只读取说明", "已完成")), /pending/);
  assert.throws(() => validateSelection(document.replace("待评测；已有方案，不能填写提升数字", "成功率提升 30%")), /unmeasured/);
});

test("document links resolve and primary upstream references use immutable revisions", () => {
  assert.ok(!document.includes("\uFFFD"));
  const upstream = new Set();
  for (const [, target] of document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (target.startsWith("https://github.com/")) {
      assert.match(target, /\/blob\/[a-f0-9]{40}\//, `Unpinned reference: ${target}`);
      upstream.add(new URL(target).pathname.split("/").slice(1, 3).join("/"));
    } else if (!/^(https?:|#)/.test(target)) {
      assert.ok(existsSync(path.resolve(root, path.dirname(filename), target.split("#")[0])), `Broken local link: ${target}`);
    }
  }
  assert.deepEqual([...upstream].sort(), [
    "earendil-works/pi", "langchain-ai/deepagents", "bytedance/deer-flow", "anomalyco/opencode",
    "langchain-ai/langgraph", "OpenHands/software-agent-sdk", "harbor-framework/harbor", "Future-House/paper-qa",
    "google-research/harness2", "mem0ai/mem0", "getzep/graphiti",
  ].sort(), "Expected pinned references for the original and newly researched projects");
  assert.ok(readFileSync(path.join(root, "README.md"), "utf8").includes("docs/README.md"));
  assert.ok(readFileSync(path.join(root, "docs/README.md"), "utf8").includes("(AGENT_RESUME_HIGHLIGHTS.md)"));
});

function validateExtensions(text) {
  for (const id of ["A08", "A09"]) {
    const heading = new RegExp(`^## \\d+\\. ${id}：.+$`, "m").exec(text);
    assert.ok(heading, `Missing extension ${id}`);
    const section = text.slice(heading.index + heading[0].length).split(/^## /m)[0];
    assert.ok(section.includes("已调研，待实施，未验证收益"), `Extension ${id} falsely promoted`);
    for (const fragment of ["待实现伪代码", "面试需要回答", "当前可用简历措辞", "实现并"]) {
      assert.ok(section.includes(fragment), `Missing ${id} boundary: ${fragment}`);
    }
  }
  for (const fragment of [
    "selection_pool` 排除了基线", "chooseIncludingBaseline", "heldOutTasks", "expectedBaselineVersion",
    "当前默认 ADD 流程不等于自动冲突裁决", "ADDITIVE_EXTRACTION_PROMPT", "reference_date",
    "fcntl", "sourceRefs", "recordedAt", "supersedes", "conflictsWith", "expectedRevision",
    "不覆盖正式方案", "不能因晚写入变成当前值",
  ]) assert.ok(text.includes(fragment), `Missing implementation safeguard: ${fragment}`);
  const cases = [...text.matchAll(/^\| (MC\d{2}) \|/gm)].map((match) => match[1]);
  assert.deepEqual(cases, Array.from({ length: 7 }, (_, i) => `MC0${i + 1}`), "Conflict cases must be complete and unique");
}

test("evolution and cross-task memory preserve source findings and proposed implementation contracts", () => {
  validateExtensions(document);
});

test("extension validation rejects false completion and missing conflict or publication safeguards", () => {
  assert.throws(() => validateExtensions(document.replace("已调研，待实施，未验证收益", "已实现且效果显著")), /falsely promoted/);
  for (const fragment of ["chooseIncludingBaseline", "expectedRevision", "当前默认 ADD 流程不等于自动冲突裁决"]) {
    assert.throws(() => validateExtensions(document.replaceAll(fragment, "omitted")), /safeguard/);
  }
  assert.throws(() => validateExtensions(document.replace("| MC07 |", "| MC06 |")), /complete and unique/);
});

test("unified ranking replaces appendices without confusing technical depth with current delivery", () => {
  assert.doesNotMatch(document, /扩展选材 E0[12]|前面的七项排序|### 为什么排第一/);
  assert.match(document, /如果现在投递，优先采用已有证据的 A03、A04、A02/);
  assert.match(document, /A08 排第一的前提是有独立任务迁移与回归证据/);
  assert.match(document, /含金量第 1 不代表应最先写自动进化循环/);
  assert.throws(() => validateSelection(document.replace("| 1 | A08 |", "| 1 | A01 |")), /ordered/);
  const swapped = document.replace("## 2. A08：", "## 2. TEMP：")
    .replace("## 3. A09：", "## 3. A08：").replace("## 2. TEMP：", "## 2. A09：");
  assert.throws(() => validateSelection(swapped), /Detail order/);
  assert.throws(() => validateSelection(document.replace("已调研待实施；未验证跨任务改进收益", "已验证迁移收益")), /falsely promoted/);
});
