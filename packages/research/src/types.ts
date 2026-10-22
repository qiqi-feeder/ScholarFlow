export type TaskStatus = "idle" | "running" | "awaiting_approval" | "complete" | "error";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type RunKind = "smoke" | "target";
export type VerificationStatus = "unverified" | "verified" | "partial";
export type AdmissionStatus = "sufficient" | "insufficient" | "unverified";
export type PlanStatus = "draft" | "confirmed" | "rejected";

/** Explicit, bounded, per-message source. Titles and excerpts are host resolved. */
export interface MessageReference {
  kind: "material" | "plan" | "run" | "result" | "manuscript" | "review";
  id: string;
  version: string;
  file?: string;
  page?: number;
  start?: number;
  end?: number;
  quote?: string;
}
export interface ResolvedReference extends MessageReference {
  projectId: string;
  taskId: string | null;
  title: string;
  text: string;
}
export type MaterialKind = "paper" | "repository" | "dataset" | "note" | "other";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  dataDir: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: TaskStatus;
  sessionFile: string | null;
  contextVersion: number;
  /** Explicit task-level model selection. Null on legacy tasks; they inherit the configured default. */
  modelProvider?: string | null;
  modelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialSource {
  channel: "crossref" | "arxiv" | "manual" | "url";
  url: string;
  doi?: string;
  retrievedAt: string;
  license?: string;
  version?: string;
  rawHash?: string;
  query?: string;
  ambiguity?: string;
}

export interface MaterialRecord {
  id: string;
  projectId: string;
  taskId: string | null;
  kind: MaterialKind;
  title: string;
  path: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  source: MaterialSource;
  createdAt: string;
}

export interface PlanMetric {
  key: string;
  label: string;
  direction: "higher" | "lower";
  unit?: string;
  sourceLocation: string;
}

export interface ExperimentPlan {
  id: string;
  projectId: string;
  taskId: string;
  version: number;
  objective: string;
  hypotheses: string[];
  design: string;
  conditions: Record<string, string>;
  metrics: PlanMetric[];
  seed: number[];
  budget: { maxMinutes: number; maxRuns: number; maxGpuHours?: number };
  resources: string;
  risks: string[];
  skillVersions: Array<{ name: string; sha256: string; version?: string }>;
  status: PlanStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface ReproductionEvidence {
  id: string;
  group: string;
  title: string;
  url: string;
  doi?: string;
  isOriginalPaper: boolean;
  reportedResult: string;
  evidenceLocation: string;
  independent: boolean;
  notes?: string;
}

export interface AdmissionInput {
  paper: {
    title: string;
    doi?: string;
    url?: string;
    identityConfirmed: boolean;
    identityEvidence: string;
  };
  repository: {
    url?: string;
    commit?: string;
    official: boolean;
    evidence: string;
  };
  scripts: {
    path?: string;
    configPath?: string;
    command?: string;
    explicitParameters: boolean;
    evidence: string;
  };
  data: {
    available: boolean;
    license?: string;
    acquisition: string;
    reproducibleSplit: boolean;
  };
  priorReproductions: ReproductionEvidence[];
  target: {
    name: string;
    sourceLocation: string;
    metric: string;
    tolerance: string;
    toleranceBasis: string;
  };
  pendingVerification?: string[];
}

export interface AdmissionRecord {
  id: string;
  projectId: string;
  taskId: string;
  input: AdmissionInput;
  status: AdmissionStatus;
  missing: string[];
  pending: string[];
  warnings: string[];
  assessedAt: string;
}

export interface MetricSpec {
  key: string;
  label: string;
  direction: "higher" | "lower";
  file: string;
  pointer: string;
  unit?: string;
}

export interface ExperimentSpec {
  name: string;
  kind: RunKind;
  planId: string;
  admissionId: string | null;
  description: string;
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  config: Record<string, unknown>;
  data: {
    version: string;
    split: string;
    preprocessing: string;
    license: string;
  };
  seed: number[];
  metrics: MetricSpec[];
  resourceLimits: { timeoutSeconds: number; maxMemoryMb?: number; gpu?: string };
  expectedArtifacts: string[];
  snapshotFiles: string[];
  skillVersions: Array<{ name: string; sha256: string; version?: string }>;
}

export interface RunSnapshot {
  schema: 1;
  runId: string;
  requestId: string;
  projectId: string;
  taskId: string;
  planId: string;
  admissionId: string | null;
  createdAt: string;
  spec: ExperimentSpec;
  configFingerprint: string;
  code: {
    commit: string | "unknown";
    branch: string | "unknown";
    dirty: boolean | "unknown";
    diffPath: string | null;
    files: Array<{ path: string; sha256: string | "missing"; bytes: number }>;
  };
  environment: {
    platform: string;
    node: string;
    interpreter: string;
    interpreterVersion: string | "unknown";
    conda: string | "not-configured";
    description: string;
  };
  limits: { timeoutSeconds: number };
  provenance: {
    createdBy: string;
    planVersion: number | "unknown";
    skillVersions: Array<{ name: string; sha256: string; version?: string }>;
  };
}

export interface RunRecord {
  id: string;
  projectId: string;
  taskId: string;
  requestId: string;
  planId: string;
  admissionId: string | null;
  kind: RunKind;
  name: string;
  description: string;
  status: RunStatus;
  verificationStatus: VerificationStatus;
  configFingerprint: string;
  spec: ExperimentSpec;
  snapshotPath: string;
  logPath: string;
  pid: number | null;
  processStartedAt: string | null;
  processToken: string | null;
  exitCode: number | null;
  error: string | null;
  unknownReason: string | null;
  timeoutSeconds: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface MetricRecord {
  id: string;
  projectId: string;
  runId: string;
  key: string;
  label: string;
  value: number;
  unit?: string;
  direction: "higher" | "lower";
  source: {
    file: string;
    pointer: string;
    sha256: string;
    importedAt: string;
    runId: string;
    conditionFingerprint: string;
  };
  conditions: Record<string, string>;
  warnings: string[];
}

export interface ResultTableRow {
  runId: string;
  runName: string;
  status: RunStatus;
  values: Record<string, { value: number; unit?: string; source: string }>;
  conditions: Record<string, string>;
  comparableGroup: string;
}

export interface ResultVersion {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  runIds: string[];
  table: ResultTableRow[];
  comparability: {
    comparable: boolean;
    keyDifferences: string[];
    warnings: string[];
    missingConditions: string[];
  };
  chartPath: string | null;
  reportPath: string;
  supersedes: string | null;
  status: "current" | "superseded";
  affectedArtifacts: string[];
  createdAt: string;
}

export interface ManuscriptVersion {
  id: string;
  projectId: string;
  taskId: string | null;
  version: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  /** Relative to the project data directory; absent for versions created before snapshots existed. */
  snapshotPath?: string | null;
  build: {
    status: "not_built" | "succeeded" | "failed";
    pdfPath: string | null;
    logPath: string | null;
    builtAt: string | null;
    diagnostics: string[];
    sourceHash: string | null;
  };
  sourceResultVersions: string[];
  createdAt: string;
}

export interface ContextEntry {
  kind:
    | "task_objective"
    | "confirmed_plan"
    | "paper_claim"
    | "material"
    | "admission"
    | "run_result"
    | "result_analysis"
    | "manuscript"
    | "review_comment"
    | "open_hypothesis"
    | "skill";
  sourceType: string;
  sourceId: string;
  version?: string | number;
  sha256?: string;
  verified: boolean;
  summary: string;
}

export interface TaskContextManifest {
  schema: 1;
  taskId: string;
  projectId: string;
  builtAt: string;
  entries: ContextEntry[];
  markdown: string;
  tokenEstimate: number;
  excluded: string[];
}
