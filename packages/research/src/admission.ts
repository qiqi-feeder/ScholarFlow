import type { AdmissionInput, AdmissionRecord, AdmissionStatus } from "./types.js";

const REQUIRED_REPRODUCTIONS = 2;

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Material admission follows the plan's evidence floor: an official repository,
 * explicit official scripts/parameters, available data, and at least two
 * independent third-party reproductions with a located result. Citations of the
 * original paper's numbers are deliberately rejected.
 */
export function assessAdmission(
  input: AdmissionInput,
  options: { projectId: string; taskId: string; id: string; now?: Date },
): AdmissionRecord {
  const missing: string[] = [];
  const pending: string[] = [...(input.pendingVerification ?? [])];
  const warnings: string[] = [];

  if (!input.paper.identityConfirmed || !input.paper.title.trim()) {
    missing.push("paper identity is not confirmed");
  }
  if (!input.paper.identityEvidence.trim()) {
    missing.push("paper identity evidence is missing");
  }
  if (input.paper.doi && !/^10\.\d{4,9}\/\S+$/.test(input.paper.doi)) {
    warnings.push("paper DOI has an unexpected format");
  }

  if (!input.repository.official) {
    missing.push("official repository is not identified");
  }
  if (!isHttpUrl(input.repository.url)) {
    missing.push("official repository URL is missing or invalid");
  }
  if (!input.repository.commit?.trim()) {
    missing.push("official repository commit is not pinned");
  }
  if (!input.repository.evidence.trim()) {
    missing.push("repository ownership evidence is missing");
  }

  if (!input.scripts.path?.trim()) {
    missing.push("official training/evaluation script path is missing");
  }
  if (!input.scripts.configPath?.trim()) {
    missing.push("official configuration or parameter file is missing");
  }
  if (!input.scripts.explicitParameters) {
    missing.push("official parameters are not explicit (guessing parameters is not allowed)");
  }
  if (!input.scripts.evidence.trim()) {
    missing.push("script/parameter evidence is missing");
  }

  if (!input.data.available) {
    missing.push("target data is not available");
  }
  if (!input.data.license?.trim()) {
    missing.push("dataset license is unknown");
  }
  if (!input.data.acquisition.trim()) {
    missing.push("dataset acquisition method is missing");
  }
  if (!input.data.reproducibleSplit) {
    missing.push("dataset split/preprocessing is not reproducible");
  }

  const independent = input.priorReproductions.filter(
    (item) =>
      !item.isOriginalPaper &&
      item.independent &&
      isHttpUrl(item.url) &&
      item.reportedResult.trim().length > 0 &&
      item.evidenceLocation.trim().length > 0,
  );
  const duplicateKeys = new Set<string>();
  const unique: typeof independent = [];
  for (const item of independent) {
    const key = (item.doi ?? item.url).toLowerCase();
    if (duplicateKeys.has(key)) {
      warnings.push(`duplicate reproduction evidence ignored: ${item.group}`);
      continue;
    }
    duplicateKeys.add(key);
    unique.push(item);
  }
  if (unique.length < REQUIRED_REPRODUCTIONS) {
    missing.push(
      `at least ${REQUIRED_REPRODUCTIONS} independent third-party reproductions with located results are required (found ${unique.length})`,
    );
  }
  if (input.priorReproductions.some((item) => item.isOriginalPaper && item.independent)) {
    warnings.push("the original paper's own reported numbers are not independent reproduction evidence");
  }

  if (!input.target.name.trim()) missing.push("target experiment is not named");
  if (!input.target.sourceLocation.trim()) missing.push("target experiment location in the paper is missing");
  if (!input.target.metric.trim()) missing.push("target metric is missing");
  if (!input.target.tolerance.trim()) missing.push("acceptable deviation is missing");
  if (!input.target.toleranceBasis.trim()) missing.push("tolerance basis is missing");

  let status: AdmissionStatus;
  if (missing.length > 0) {
    status = "insufficient";
  } else if (pending.length > 0) {
    status = "unverified";
  } else {
    status = "sufficient";
  }

  return {
    id: options.id,
    projectId: options.projectId,
    taskId: options.taskId,
    input,
    status,
    missing,
    pending,
    warnings,
    assessedAt: (options.now ?? new Date()).toISOString(),
  };
}

export function admissionAllowsTargetRun(record: AdmissionRecord | undefined | null): boolean {
  return record?.status === "sufficient";
}
