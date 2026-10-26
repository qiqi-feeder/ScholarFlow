import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(path.join(root, file), "utf8");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const files = ["README.md", "README.zh-CN.md", "CONTRIBUTING.md", "docs/README.md", "docs/DEMO.md", "docs/verification/readme-showcase.md", "docs/RUN_GUIDE.md"];
const manifest = JSON.parse(read("docs/assets/manifest.json"));
const withoutCode = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");

function anchors(text) {
  const seen = new Map(), ids = new Set();
  for (const [, heading] of withoutCode(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = heading.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}_\s-]/gu, "").trim().replace(/\s/g, "-");
    const count = seen.get(base) ?? 0; seen.set(base, count + 1);
    ids.add(count ? `${base}-${count}` : base);
  }
  return ids;
}

function validateLinks(file, text) {
  assert.ok(!text.includes("\uFFFD"), `Invalid UTF-8: ${file}`);
  const prose = withoutCode(text);
  const targets = [...prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g), ...prose.matchAll(/\bsrc="([^"]+)"/g)].map(m => m[1]);
  for (const target of targets) {
    if (/^https?:\/\//.test(target)) continue;
    assert.ok(!/^[a-z]+:/i.test(target), `Unexpected link scheme: ${target}`);
    const [name, fragment] = target.split("#");
    const absolute = name ? path.resolve(root, path.dirname(file), decodeURIComponent(name)) : path.join(root, file);
    const relative = path.relative(root, absolute);
    assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `Link outside repository: ${target}`);
    assert.ok(existsSync(absolute) && statSync(absolute).isFile(), `Broken local link: ${file}: ${target}`);
    if (fragment) assert.ok(anchors(readFileSync(absolute, "utf8")).has(decodeURIComponent(fragment)), `Broken heading anchor: ${file}: ${target}`);
  }
}

// Read GIF blocks, including sub-block lengths, rather than counting bytes inside compressed pixels.
function gifMetadata(bytes) {
  assert.match(bytes.subarray(0, 6).toString(), /^GIF8[79]a$/);
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  let at = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0), frames = 0, durationMs = 0, ended = false;
  const skipBlocks = () => { while (at < bytes.length) { const size = bytes[at++]; if (!size) return; at += size; } throw new Error("Truncated GIF sub-block"); };
  while (at < bytes.length) {
    const block = bytes[at++];
    if (block === 0x3b) { ended = true; break; }
    if (block === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) { assert.equal(bytes[at++], 4); durationMs += bytes.readUInt16LE(at + 1) * 10; at += 4; assert.equal(bytes[at++], 0); }
      else skipBlocks();
    } else if (block === 0x2c) {
      const packed = bytes[at + 8]; at += 9;
      if (packed & 128) at += 3 * 2 ** ((packed & 7) + 1);
      at++; skipBlocks(); frames++;
    } else throw new Error(`Unexpected GIF block ${block}`);
    assert.ok(at <= bytes.length, "Truncated GIF");
  }
  assert.ok(ended, "Missing GIF trailer");
  return { width, height, frames, durationMs };
}

function validateEvidence(record, load = name => readFileSync(path.join(root, "docs/assets", name))) {
  assert.equal(record.realApplication, true); assert.equal(record.realModel, true);
  assert.equal(record.syntheticData, true); assert.equal(record.scientificReproduction, false);
  assert.equal(record.credentialsExported, false); assert.deepEqual(record.pageErrors, []);
  assert.match(record.sourceCommit, /^[0-9a-f]{40}$/); assert.ok(Number.isFinite(Date.parse(record.capturedAt)));
  assert.deepEqual(record.tools, ["read_artifact", "query_run", "recall_memory"]);
  assert.equal(record.usage.length, 3);
  for (const reply of record.usage) { assert.equal(reply.provider, "deepseek"); assert.equal(reply.model, record.model); assert.ok(reply.usage.totalTokens > 0); }
  assert.equal(record.run.kind, "smoke"); assert.equal(record.run.status, "succeeded");
  assert.ok(record.run.approvalId); assert.equal(record.run.requestId, "readme-smoke-once");
  const metric = record.run.metrics.find(m => m.key === "mae");
  assert.ok(Number.isFinite(metric.value)); assert.equal(metric.source.runId, record.run.id);
  assert.equal(metric.source.file, "metrics.json"); assert.equal(metric.source.pointer, "/mae");
  assert.match(metric.source.sha256, /^[0-9a-f]{64}$/); assert.match(record.run.scriptSha256, /^[0-9a-f]{64}$/);
  assert.equal(record.manuscript.built, true); assert.ok(record.manuscript.version > 0);
  assert.equal(record.memory.sharedAcrossTasks, true); assert.ok(record.memory.revision > 0);
  assert.equal(record.stages.length, record.animation.frames);
  assert.equal(record.animation.sampledFrames, true); assert.equal(record.animation.timingAdjusted, true);
  assert.deepEqual(record.stages.map(s => s.frame), Array.from({ length: 12 }, (_, i) => `frame-${String(i + 1).padStart(2, "0")}.png`));
  assert.equal(record.seedSource.path, "examples/first-source.txt");
  assert.equal(record.seedSource.sha256, hash(readFileSync(path.join(root, record.seedSource.path))));
  assert.deepEqual(record.assets.map(a => a.path).sort(), ["brand-mark.svg", "memory.png", "results.png", "source.png", "walkthrough.gif", "workspace.png"]);
  for (const asset of record.assets) {
    assert.equal(path.basename(asset.path), asset.path, "Asset path escapes its directory");
    const bytes = load(asset.path);
    assert.equal(hash(bytes), asset.sha256, `Asset checksum: ${asset.path}`); assert.equal(bytes.length, asset.bytes);
    if (asset.path.endsWith(".png")) {
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(bytes.readUInt32BE(16), record.viewport.width); assert.equal(bytes.readUInt32BE(20), record.viewport.height);
    }
  }
  const animation = gifMetadata(load("walkthrough.gif"));
  for (const key of ["width", "height", "frames", "durationMs"]) assert.equal(animation[key], record.animation[key], `GIF metadata: ${key}`);
  assert.doesNotMatch(JSON.stringify(record), /[A-Z]:[\\/]Users[\\/]|sk-[A-Za-z0-9]{16,}/i);
}

test("English and Chinese entry points, contributor guide and walkthrough resolve files and headings", () => {
  for (const file of files) validateLinks(file, read(file));
  assert.throws(() => validateLinks("README.md", "[bad](docs/absent.md)"), /Broken local link/);
  assert.throws(() => validateLinks("README.md", "[bad](README.zh-CN.md#absent)"), /Broken heading anchor/);
  assert.throws(() => validateLinks("README.md", "[bad](../outside.md)"), /outside repository/);
  assert.deepEqual([...anchors("# Heading\n# Heading\n# 快速开始")], ["heading", "heading-1", "快速开始"]);
});

test("both homepages share the current runtime diagram and executable setup commands", () => {
  const english = read("README.md"), chinese = read("README.zh-CN.md"), pkg = JSON.parse(read("package.json"));
  const diagram = text => text.match(/```mermaid\r?\n([\s\S]*?)\r?\n```/)?.[1].replace(/\r/g, "");
  assert.ok(diagram(english)); assert.equal(diagram(english), diagram(chinese));
  for (const text of [english, chinese]) {
    for (const command of ["npm ci", "npm run build", "npm start", "npm run demo:seed", "npm run test:docs"]) assert.ok(text.includes(command));
    for (const [, script] of text.matchAll(/npm run ([\w:-]+)/g)) assert.ok(pkg.scripts[script], `Missing npm script: ${script}`);
    assert.ok(text.includes("SCHOLARFLOW_SOURCE_CHECK")); assert.ok(text.includes("4/6"));
    assert.ok(text.includes("22.19")); assert.ok(text.includes("Windows"));
    assert.doesNotMatch(text, /img\.shields\.io\/[^\s)\n]*(?:license|passing|success)/i);
  }
  assert.match(english, /pending maintainer selection/); assert.match(chinese, /许可证.*待/);
  assert.ok(!existsSync(path.join(root, "LICENSE")), "A new license requires a corresponding documentation update");
});

test("showcase media matches the saved real-run evidence and actual GIF structure", () => validateEvidence(manifest));

test("evidence validation rejects scientific promotion, fake model status, damaged assets and altered timing", () => {
  for (const alter of [r => { r.scientificReproduction = true; }, r => { r.realModel = false; }, r => { r.run.kind = "target"; }, r => { r.animation.durationMs = 1; }, r => { r.run.metrics[0].source.runId = "other"; }]) {
    const changed = structuredClone(manifest); alter(changed); assert.throws(() => validateEvidence(changed));
  }
  assert.throws(() => validateEvidence(manifest, name => { const bytes = readFileSync(path.join(root, "docs/assets", name)); if (name === "workspace.png") bytes[100] ^= 1; return bytes; }), /Asset checksum/);
  const gif = readFileSync(path.join(root, "docs/assets/walkthrough.gif"));
  assert.throws(() => gifMetadata(gif.subarray(0, -1)), /trailer/);
});
