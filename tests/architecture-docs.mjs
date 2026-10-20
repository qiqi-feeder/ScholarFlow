import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const product = read('docs/PRODUCT_DESIGN.md');
const technical = read('docs/TECHNICAL_DESIGN.md');
const roadmap = read('docs/IMPLEMENTATION_ROADMAP.md');
const diagramReadme = read('docs/diagrams/README.md');
const manifest = JSON.parse(read('docs/implementation-milestones.json'));
const ids = ['D0', ...Array.from({ length: 8 }, (_, i) => `M${i + 1}`), 'E1'];
let assertions = 0;
const check = (value, message) => { assertions++; assert.ok(value, message); };

function validateManifest(value) {
  assert.equal(value.schemaVersion, 1, 'schemaVersion');
  assert.equal(value.implementationStatus, 'not_started', 'Current docs must not claim runtime implementation');
  assert.equal(value.commandStatus, 'M1-and-later-commands-are-planned', 'Future commands must be labelled planned');
  assert.ok(Array.isArray(value.milestones), 'milestones array required');
  const nodes = new Map();
  for (const node of value.milestones) {
    assert.ok(ids.includes(node.id), `Unknown milestone ${node.id}`);
    assert.ok(!nodes.has(node.id), `Duplicate milestone ${node.id}`);
    nodes.set(node.id, node);
    assert.equal(node.status, 'defined', `${node.id}: defined is not completed`);
    assert.equal(typeof node.optional, 'boolean', `${node.id}: optional flag required`);
    assert.equal(node.optional, node.id === 'E1', `${node.id}: only Electron is optional`);
    assert.ok(typeof node.title === 'string' && node.title.trim(), `${node.id}: title required`);
    assert.ok(Array.isArray(node.dependsOn), `${node.id}: dependencies required`);
    assert.equal(new Set(node.dependsOn).size, node.dependsOn.length, `${node.id}: duplicate dependency`);
    for (const key of ['deliverables', 'fixtures', 'passCriteria', 'negativeCases']) {
      assert.ok(Array.isArray(node[key]) && node[key].length > 0, `${node.id}: ${key} required`);
      assert.ok(node[key].every(item => typeof item === 'string' && item.trim()), `${node.id}: empty ${key}`);
    }
    assert.ok(node.passCriteria.length >= 2, `${node.id}: multiple concrete criteria required`);
    const command = node.id === 'D0' ? './tests/architecture-docs.tests.ps1' : `pnpm verify:milestone ${node.id}`;
    assert.equal(node.verification, command, `${node.id}: verification command mismatch`);
    const evidence = node.id === 'D0' ? 'git commit 与文档/累计测试输出' : `artifacts/acceptance/${node.id}/`;
    assert.equal(node.evidence, evidence, `${node.id}: evidence location required`);
  }
  assert.deepEqual([...nodes.keys()].sort(), [...ids].sort(), 'All defined nodes must be present');
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    assert.ok(nodes.has(id), `Missing dependency ${id}`);
    assert.ok(!visiting.has(id), `Dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    nodes.get(id).dependsOn.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  }
  ids.forEach(visit);
  ids.forEach((id, index) => assert.deepEqual(nodes.get(id).dependsOn, index ? [ids[index - 1]] : [], `${id}: roadmap order`));
}

validateManifest(manifest);
const mutate = fn => { const copy = structuredClone(manifest); fn(copy); return copy; };
const invalid = [
  [value => value.milestones[1].passCriteria = [], /passCriteria required/],
  [value => value.milestones[2].verification = 'echo passed', /verification command mismatch/],
  [value => value.milestones[1].dependsOn = ['M8'], /Dependency cycle/],
  [value => value.milestones[1].dependsOn = ['M99'], /Missing dependency/],
  [value => value.milestones.pop(), /All defined nodes/],
  [value => value.milestones.push(structuredClone(value.milestones[1])), /Duplicate milestone/],
  [value => value.milestones[4].fixtures = [''], /empty fixtures/],
  [value => value.milestones[3].negativeCases = [], /negativeCases required/],
  [value => value.milestones[5].evidence = '../private/secrets', /evidence location/],
  [value => value.milestones[1].status = 'completed', /defined is not completed/],
  [value => value.implementationStatus = 'implemented', /must not claim runtime/],
  [value => value.milestones[5].optional = true, /only Electron is optional/]
];
invalid.forEach(([fn, error]) => { assertions++; assert.throws(() => validateManifest(mutate(fn)), error); });

for (const node of manifest.milestones) {
  const heading = `## ${node.id} — `;
  check(roadmap.includes(heading), `${node.id}: section missing`);
  const section = roadmap.split(heading)[1].split(/\n## /)[0];
  for (const label of ['依赖', '交付', '输入', '验证', '通过', '负例', '证据']) {
    check(section.includes(label), `${node.id}: ${label} missing`);
  }
  check(section.includes(node.verification), `${node.id}: command not in corresponding section`);
  if (node.id !== 'D0') check(section.includes(node.evidence), `${node.id}: evidence not in section`);
}

const contracts = [
  [product, ['Server 所在机器', '浏览器缓存不是业务数据库', '完整 `SKILL.md`', '写作与排版', '尚未实现']],
  [technical, ['SQLite', '单 Worker', 'noTools: "builtin"', 'ResourceLoader', 'expectedVersion', 'Last-Event-ID',
    'Idempotency-Key', 'interrupted', '../nature-shared', 'SSRF', 'CSRF', '不自动重发模型请求', '没有内置 OS 沙箱']],
  [roadmap, ['规划命令，当前不存在', '缺模型凭据/执行器属于 blocked 而非 passed', '各 3 次', '至少 90%',
    '1e-6', '5 秒', '10 秒', '60 秒', '100%', '不允许空脚本或 skip', '累计回归']]
];
for (const [document, markers] of contracts) {
  markers.forEach(marker => check(document.includes(marker), `Documentation contract missing: ${marker}`));
}

for (const path of ['README.md', 'docs/PRODUCT_DESIGN.md', 'docs/TECHNICAL_DESIGN.md',
  'docs/IMPLEMENTATION_ROADMAP.md', 'docs/diagrams/README.md']) {
  for (const match of read(path).matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^https?:\/\//.test(target)) continue;
    const local = resolve(dirname(resolve(root, path)), target.split('#')[0]);
    check(!relative(root, local).startsWith('..'), `${path}: link escapes repository`);
    check(existsSync(local) && statSync(local).isFile(), `${path}: broken local link ${target}`);
  }
}

const xml = read('docs/diagrams/architecture.drawio');
const cells = [...xml.matchAll(/<mxCell\b([^>]*?)(?:\/?>)/g)].map(match =>
  Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]])));
const cellIds = new Set(cells.map(cell => cell.id));
check(cellIds.size === cells.length, 'Duplicate drawio cell IDs');
check(cellIds.has('0') && cellIds.has('1'), 'Required drawio roots');
cells.forEach(cell => {
  if (cell.parent) check(cellIds.has(cell.parent), `Missing parent for ${cell.id}`);
  if (cell.edge === '1') {
    check(cellIds.has(cell.source) && cellIds.has(cell.target), `Dangling edge ${cell.id}`);
  }
});
const names = { '3': 'web', '4': 'api', '5': 'db', '6': 'worker', '7': 'pi', '8': 'executor', '9': 'files', '10': 'models' };
for (const id of ['4', '5', '6', '7', '8', '9']) check(cells.find(cell => cell.id === id)?.parent === '2', `${names[id]} outside Server`);
for (const id of ['3', '10']) check(cells.find(cell => cell.id === id)?.parent === '1', `${names[id]} must be outside Server container`);
const drawioEdges = cells.filter(cell => cell.edge === '1').map(cell => `${names[cell.source]}->${names[cell.target]}`).sort();
const mermaid = technical.match(/```mermaid\n([\s\S]*?)\n```/)[1];
const mermaidEdges = [...mermaid.matchAll(/^\s*(\w+)\s*-->(?:\|[^|]*\|)?\s*(\w+)/gm)].map(match => `${match[1]}->${match[2]}`).sort();
assert.deepEqual(drawioEdges, ['web->api', 'api->db', 'api->files', 'worker->db', 'worker->pi', 'pi->executor', 'executor->files', 'pi->models'].sort());
assert.deepEqual(mermaidEdges, drawioEdges, 'Mermaid/drawio relationships diverged');
assertions += 2;

const viewer = diagramReadme.match(/https:\/\/viewer\.diagrams\.net\/[^\s)]+/)[0];
const payload = decodeURIComponent(new URL(viewer).hash.slice(2));
const decoded = decodeURIComponent(inflateRawSync(Buffer.from(payload, 'base64')).toString('utf8'));
// Git autocrlf may change source line endings without changing diagram content.
const normalizeEol = value => value.replace(/\r\n/g, '\n');
assert.equal(normalizeEol(decoded), normalizeEol(xml), 'Viewer URL does not reproduce current Unicode XML');
assert.equal(normalizeEol(decoded.replace(/\r?\n/g, '\r\n')), normalizeEol(xml), 'Viewer comparison must work after CRLF checkout');
assertions += 2;

console.log(`${assertions} documentation assertions passed; ${invalid.length} invalid-manifest cases rejected.`);
console.log('These checks validate documentation contracts, NOT Server/Pi/Skill implementation or model quality.');
