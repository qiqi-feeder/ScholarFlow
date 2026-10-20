import type { ExperimentSpec, RunSnapshot } from "./types.js";
import { sha256 } from "./paths.js";

export const SECRET_ENV_PATTERN = /(api[_-]?key|token|secret|password|credential|auth)/i;

/** Deterministic canonical JSON used for fingerprints and snapshots. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * Fingerprint excludes requestId/name so a retry with the same requestId can be
 * deduplicated while an intentional rerun with the same configuration remains
 * possible under a new requestId.
 */
export function experimentConfigFingerprint(spec: ExperimentSpec): string {
  const fingerprintInput = {
    program: spec.program,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    config: spec.config,
    data: spec.data,
    seed: spec.seed,
    metrics: spec.metrics,
    resourceLimits: spec.resourceLimits,
    expectedArtifacts: spec.expectedArtifacts,
    kind: spec.kind,
    planId: spec.planId,
  };
  return sha256(canonicalJson(fingerprintInput));
}

export function assertSnapshotComplete(snapshot: RunSnapshot): string[] {
  const errors: string[] = [];
  const required: Array<[string, unknown]> = [
    ["runId", snapshot.runId],
    ["requestId", snapshot.requestId],
    ["spec.program", snapshot.spec.program],
    ["spec.cwd", snapshot.spec.cwd],
    ["spec.config", snapshot.spec.config],
    ["spec.data.version", snapshot.spec.data.version],
    ["spec.data.split", snapshot.spec.data.split],
    ["spec.data.preprocessing", snapshot.spec.data.preprocessing],
    ["spec.seed", snapshot.spec.seed],
    ["spec.metrics", snapshot.spec.metrics],
    ["spec.resourceLimits", snapshot.spec.resourceLimits],
    ["spec.expectedArtifacts", snapshot.spec.expectedArtifacts],
    ["spec.planId", snapshot.spec.planId],
    ["code.commit", snapshot.code.commit],
    ["environment.interpreter", snapshot.environment.interpreter],
    ["provenance.planVersion", snapshot.provenance.planVersion],
  ];
  for (const [name, value] of required) {
    if (value === undefined || value === null || value === "") {
      errors.push(`${name} is missing from the experiment snapshot`);
    }
  }
  if (!Array.isArray(snapshot.spec.metrics) || snapshot.spec.metrics.length === 0) {
    errors.push("no metrics are declared; the run cannot be verified");
  }
  for (const metric of snapshot.spec.metrics ?? []) {
    if (!metric.file || !metric.pointer || !metric.key) {
      errors.push(`metric ${metric.key || "(unnamed)"} lacks file/pointer/key provenance`);
    }
  }
  if (!snapshot.spec.expectedArtifacts.includes(snapshot.spec.metrics[0]?.file ?? "")) {
    // The metric file is an expected artifact by definition.
    const metricFiles = new Set(snapshot.spec.metrics.map((metric) => metric.file));
    for (const file of metricFiles) {
      if (!snapshot.spec.expectedArtifacts.includes(file)) {
        errors.push(`metric file is not listed in expectedArtifacts: ${file}`);
      }
    }
  }
  if (snapshot.code.dirty === true && !snapshot.code.diffPath && snapshot.code.files.length === 0) {
    errors.push("dirty code is neither diffed nor file-snapshotted");
  }
  return errors;
}

/** Environment variables are references (`$ENV:NAME`) or literal non-secrets. */
export function validateExperimentEnv(env: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV_PATTERN.test(key) && !value.startsWith("$ENV:")) {
      errors.push(
        `environment variable ${key} looks secret; store it outside the project and use $ENV:${key} instead`,
      );
    }
    if (value.includes("\0")) errors.push(`environment variable ${key} contains a NUL byte`);
  }
  return errors;
}

export function resolveEnvReferences(
  env: Record<string, string>,
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("$ENV:")) {
      const name = value.slice(5);
      const found = source[name];
      if (found === undefined) throw new Error(`required environment variable ${name} is not set`);
      resolved[key] = found;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}
