import assert from "node:assert/strict";
import test from "node:test";
import { assessAdmission, admissionAllowsTargetRun } from "../src/admission.js";
import type { AdmissionInput } from "../src/types.js";

function baseInput(): AdmissionInput {
  return {
    paper: {
      title: "A Reproducible Baseline",
      doi: "10.1234/example.2024",
      url: "https://example.org/paper",
      identityConfirmed: true,
      identityEvidence: "DOI landing page table 1",
    },
    repository: {
      url: "https://github.com/example/baseline",
      commit: "abc1234",
      official: true,
      evidence: "Paper links this repository in its abstract",
    },
    scripts: {
      path: "scripts/train.sh",
      configPath: "configs/base.yaml",
      command: "bash scripts/train.sh",
      explicitParameters: true,
      evidence: "README and paper appendix B",
    },
    data: {
      available: true,
      license: "CC-BY-4.0",
      acquisition: "https://example.org/data",
      reproducibleSplit: true,
    },
    priorReproductions: [
      {
        id: "r1",
        group: "Group One",
        title: "Independent replication one",
        url: "https://example.org/r1",
        isOriginalPaper: false,
        reportedResult: "accuracy 78.2 on test split",
        evidenceLocation: "Table 3",
        independent: true,
      },
      {
        id: "r2",
        group: "Group Two",
        title: "Independent replication two",
        url: "https://example.org/r2",
        doi: "10.9999/r2",
        isOriginalPaper: false,
        reportedResult: "accuracy 77.9 on test split",
        evidenceLocation: "Section 5.2",
        independent: true,
      },
    ],
    target: {
      name: "Baseline test accuracy",
      sourceLocation: "Paper Table 2, row 1",
      metric: "accuracy",
      tolerance: "±1.0 absolute",
      toleranceBasis: "Independent reports range 77.9-78.2",
    },
  };
}

const ids = { projectId: "prj_test", taskId: "tsk_test", id: "adm_test" };

test("sufficient admission requires all evidence", () => {
  const record = assessAdmission(baseInput(), ids);
  assert.equal(record.status, "sufficient");
  assert.deepEqual(record.missing, []);
  assert.equal(admissionAllowsTargetRun(record), true);
});

test("missing official repository blocks target admission", () => {
  const input = baseInput();
  input.repository.official = false;
  input.repository.url = undefined;
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.missing.some((item) => item.includes("official repository")));
});

test("missing scripts or guessed parameters blocks admission", () => {
  const input = baseInput();
  input.scripts.path = undefined;
  input.scripts.explicitParameters = false;
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.missing.some((item) => item.includes("script path")));
  assert.ok(record.missing.some((item) => item.includes("parameters")));
});

test("one independent reproduction is not enough", () => {
  const input = baseInput();
  input.priorReproductions = input.priorReproductions.slice(0, 1);
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.missing.some((item) => item.includes("at least 2")));
});

test("the original paper's own numbers never count as reproduction evidence", () => {
  const input = baseInput();
  input.priorReproductions = [
    { ...input.priorReproductions[0]!, isOriginalPaper: true },
    { ...input.priorReproductions[1]!, isOriginalPaper: true },
  ];
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.missing.some((item) => item.includes("found 0")));
});

test("citation-only evidence without a located result is rejected", () => {
  const input = baseInput();
  input.priorReproductions = input.priorReproductions.map((item) => ({ ...item, evidenceLocation: "" }));
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
});

test("duplicate evidence groups are not double counted", () => {
  const input = baseInput();
  input.priorReproductions[1] = { ...input.priorReproductions[0]!, id: "r2", group: "Group One again" };
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.warnings.some((warning) => warning.includes("duplicate")));
});

test("pending verification yields unverified rather than sufficient", () => {
  const input = baseInput();
  input.pendingVerification = ["dataset checksum not yet compared with official release"];
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "unverified");
  assert.equal(admissionAllowsTargetRun(record), false);
});

test("missing data license or split blocks admission", () => {
  const input = baseInput();
  input.data.available = false;
  input.data.license = "";
  delete input.data.license;
  input.data.reproducibleSplit = false;
  const record = assessAdmission(input, ids);
  assert.equal(record.status, "insufficient");
  assert.ok(record.missing.some((item) => item.includes("data is not available")));
  assert.ok(record.missing.some((item) => item.includes("split")));
});
