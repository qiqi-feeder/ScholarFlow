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
  assert.equal(rows.length, 7, "Expected seven ranked highlights");
  const expected = Array.from({ length: 7 }, (_, i) => `A0${i + 1}`);
  assert.deepEqual(rows.map((row) => row[2]), expected, "Ranks must be unique and ordered");
  rows.forEach((row, i) => assert.equal(Number(row[1]), i + 1, "Rank sequence is invalid"));
  assert.match(rows[0][5], /已讨论待实施.*只读取说明/, "Dynamic loading must remain pending");
  assert.match(rows[4][5], /待评测.*不能填写提升数字/, "Evaluation must remain unmeasured");
  for (const id of expected) {
    const heading = new RegExp(`^## \\d+\\. ${id}：.+$`, "m").exec(text);
    assert.ok(heading, `Missing detail for ${id}`);
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
  assert.throws(() => validateSelection(document.replace(/^\| 7 \| A07 \|.+\r?\n/m, "")), /seven/);
  assert.throws(() => validateSelection(document.replace("| 7 | A07 |", "| 7 | A06 |")), /ordered/);
  assert.throws(() => validateSelection(document.replace("| 2 | A02 |", "| 3 | A02 |")), /sequence/);
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
  assert.equal(upstream.size, 8, "Expected eight specific upstream projects");
  assert.ok(readFileSync(path.join(root, "README.md"), "utf8").includes("docs/AGENT_RESUME_HIGHLIGHTS.md"));
});
