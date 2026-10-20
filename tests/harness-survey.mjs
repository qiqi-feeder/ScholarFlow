import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(root, 'docs/research');
const survey = JSON.parse(readFileSync(resolve(folder, 'harness-survey-2026-10-20.json'), 'utf8'));
const report = readFileSync(resolve(folder, survey.report), 'utf8');

// These contracts protect provenance and evidence status, not architecture choices
// or the validity of upstream benchmark results. They require no upstream runtime.
function validate(data, text) {
  assert.equal(data.schema_version, 1, 'schema version');
  assert.equal(data.status, 'research_only', 'research status');
  assert.equal(data.scope, 'representative_not_exhaustive', 'coverage boundary');
  assert.equal(data.local_upstream_tests, 'not_run', 'upstream test boundary');
  assert.equal(data.local_model_or_gpu_experiments, 'not_run', 'local experiment boundary');
  assert.match(data.review_date, /^\d{4}-\d{2}-\d{2}$/, 'review date');
  assert.equal(data.timezone, 'Asia/Shanghai', 'review timezone');
  assert.ok(Array.isArray(data.projects) && data.projects.length > 0, 'project records');
  const ids = new Set();
  const repos = new Set();
  let sources = 0;
  for (const project of data.projects) {
    assert.match(project.id, /^H\d{2}$/, 'project id');
    assert.ok(!ids.has(project.id), 'duplicate project id');
    assert.ok(!repos.has(project.repo), 'duplicate project repository');
    ids.add(project.id);
    repos.add(project.repo);
    assert.match(project.commit, /^[0-9a-f]{40}$/, 'full commit SHA');
    assert.equal(project.tree_truncated, false, 'incomplete source tree');
    assert.equal(project.local_execution, 'not_run', 'local execution boundary');
    assert.ok(project.mechanisms.length > 0, 'mechanism records');
    assert.ok(project.limitations.length > 0, 'evidence limitations');
    assert.ok(project.interview_questions.length > 0, 'engineering questions');
    assert.ok(project.sources.some(s => s.kind === 'implementation'), 'implementation source');
    const paths = new Set();
    for (const source of project.sources) {
      assert.ok(!paths.has(source.path), 'duplicate source path');
      paths.add(source.path);
      assert.ok(['implementation', 'test', 'documentation', 'license'].includes(source.kind), 'source kind');
      assert.equal(source.url, `https://github.com/${project.repo}/blob/${project.commit}/${source.path}`, 'pinned source URL');
      assert.match(source.sha256, /^[0-9a-f]{64}$/, 'source content digest');
      assert.ok(Number.isInteger(source.line_count) && source.line_count > 0, 'source line count');
      sources++;
    }
    for (const evaluation of project.author_evaluations) {
      assert.equal(evaluation.attribution, 'author_reported', 'evaluation attribution');
      assert.equal(evaluation.local_replication, 'not_run', 'evaluation replication boundary');
      assert.equal(evaluation.applies_to, 'historical_experiment_not_current_snapshot', 'evaluation version boundary');
      assert.match(evaluation.url, /^https:\/\//, 'evaluation URL');
    }
    assert.match(text, new RegExp(`^### ${project.id} / `, 'm'), 'missing report project');
    assert.ok(text.includes(project.commit.slice(0, 12)), 'report snapshot');
  }
  assert.equal(sources, data.source_file_count, 'source file count');
  for (const match of text.matchAll(/^### (H\d{2}) \/ /gm)) {
    assert.ok(ids.has(match[1]), 'report project missing evidence record');
  }
  const discovery = readFileSync(resolve(root, 'docs/DISCOVERY.md'), 'utf8');
  assert.match(discovery, /^\| C14 \|/m, 'research-first decision');
  assert.ok(discovery.includes('research/HARNESS_SURVEY_2026-10-20.md'), 'discovery report link');
}

validate(survey, report);
let negatives = 0;
function rejected(change, expected, transformReport = text => text) {
  const copy = structuredClone(survey);
  change(copy);
  assert.throws(() => validate(copy, transformReport(report)), expected);
  negatives++;
}
rejected(d => { d.projects.push(d.projects[0]); }, /duplicate project id/);
rejected(d => { d.projects[0].commit = 'abcdef'; }, /full commit SHA/);
rejected(d => { d.projects[0].sources[0].url = d.projects[0].sources[0].url.replace(d.projects[0].commit, 'main'); }, /pinned source URL/);
rejected(d => { d.projects[0].sources[0].sha256 = 'unknown'; }, /source content digest/);
rejected(d => { d.local_upstream_tests = 'passed'; }, /upstream test boundary/);
rejected(d => { d.projects[0].local_execution = 'passed'; }, /local execution boundary/);
rejected(d => { d.projects.find(p => p.author_evaluations.length).author_evaluations[0].attribution = 'independently_verified'; }, /evaluation attribution/);
rejected(d => { d.projects.find(p => p.author_evaluations.length).author_evaluations[0].applies_to = 'current_snapshot'; }, /evaluation version boundary/);
rejected(d => { d.source_file_count++; }, /source file count/);
rejected(() => {}, /missing report project/, text => text.replace('### H01 /', '### Missing /'));
console.log(`Harness survey provenance passed: ${survey.projects.length} projects, ${survey.source_file_count} source records, ${negatives} negative cases. Documentation only; upstream tests and model experiments were not run.`);
