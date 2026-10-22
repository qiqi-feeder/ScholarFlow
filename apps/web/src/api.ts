export interface Project {
  id: string;
  name: string;
  description: string;
  dataDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  objective: string;
  status: string;
  contextVersion: number;
  modelProvider?: string | null;
  modelId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  available: boolean;
  reason?: string | null;
}

export interface TaskModel {
  provider: string;
  id: string;
  name: string;
  inherited: boolean;
}

export interface ModelCatalog {
  models: ModelOption[];
  default: { provider: string; id: string };
}

export interface StreamEvent {
  seq: number;
  taskId: string;
  projectId: string;
  type: string;
  data: any;
  createdAt: string;
}

export interface Material {
  id: string;
  taskId?: string | null;
  title: string;
  kind: string;
  path: string;
  mediaType: string;
  sha256: string;
  bytes: number;
  note?: string;
  source: {
    channel: string;
    url: string;
    doi?: string;
    retrievedAt: string;
    license?: string;
    version?: string;
    ambiguity?: string;
  };
  createdAt: string;
}

export interface Plan {
  id: string;
  taskId: string;
  version: number;
  objective: string;
  hypotheses: string[];
  design: string;
  conditions: Record<string, string>;
  metrics: Array<{ key: string; label: string; direction: string; unit?: string; sourceLocation: string }>;
  seed: number[];
  budget: { maxMinutes: number; maxRuns: number; maxGpuHours?: number };
  resources: string;
  risks: string[];
  status: string;
  confirmedAt: string | null;
}

export interface Approval {
  id: string;
  taskId: string;
  requestId: string;
  fingerprint: string;
  status: string;
  spec: {
    name: string;
    kind: string;
    program: string;
    args: string[];
    cwd: string;
    metrics: Array<{ key: string; file: string; pointer: string }>;
    data: Record<string, string>;
    seed: number[];
    resourceLimits: { timeoutSeconds: number };
  };
  reason: string | null;
  createdAt: string;
}

export interface RunSummary {
  id: string;
  requestId: string;
  status: string;
  verification: string;
  name: string;
  kind: string;
  fingerprint: string;
  pid: number | null;
  exitCode: number | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  conditions: Record<string, string>;
  seed: number[];
}

export interface ResultVersion {
  id: string;
  title: string;
  runIds: string[];
  table: Array<{
    runId: string;
    runName: string;
    status: string;
    values: Record<string, { value: number; unit?: string; source: string }>;
    conditions: Record<string, string>;
    comparableGroup: string;
  }>;
  comparability: {
    comparable: boolean;
    keyDifferences: string[];
    warnings: string[];
    missingConditions: string[];
  };
  chartPath: string | null;
  reportPath: string;
  supersedes: string | null;
  status: string;
  affectedArtifacts: string[];
  createdAt: string;
}

export interface ManuscriptVersion {
  id: string;
  version: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  snapshotPath?: string | null;
  build: {
    status: string;
    pdfPath: string | null;
    builtAt: string | null;
    diagnostics: string[];
    sourceHash: string | null;
  };
  sourceResultVersions: string[];
  createdAt: string;
}

export interface Settings {
  dataDir: string;
  host: string;
  port: number;
  model: { provider: string; id: string; configured: boolean };
  search: { channel: string; contactEmail: string };
  latex: { latexmk: string; pdflatex: string };
  experiment: {
    defaultInterpreter: string;
    defaultTimeoutSeconds: number;
    maxTargetRunsPerTask: number;
    workerEnabled: boolean;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly payload?: any,
  ) {
    super(message);
  }
}

export async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiError(body?.error ?? `HTTP ${response.status}`, response.status, body?.code ?? "HTTP_ERROR", body);
  }
  return body as T;
}

export function post<T = any>(path: string, body: unknown = {}): Promise<T> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function put<T = any>(path: string, body: unknown): Promise<T> {
  return api<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function streamTask(
  path: string,
  after: number,
  onEvent: (event: StreamEvent) => void,
  signal: AbortSignal,
  onState: (state: "connected" | "reconnecting" | "closed") => void,
): Promise<void> {
  let cursor = after;
  while (!signal.aborted) {
    try {
      const response = await fetch(`${path}?after=${cursor}`, { signal, headers: { Accept: "text/event-stream" } });
      if (!response.ok || !response.body) throw new Error(`stream failed: ${response.status}`);
      onState("connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          let event = "";
          let id = 0;
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("id: ")) id = Number(line.slice(4));
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (event && data) {
            if (id > cursor) cursor = id;
            onEvent({
              seq: id,
              taskId: "",
              projectId: "",
              type: event,
              data: JSON.parse(data),
              createdAt: new Date().toISOString(),
            });
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (signal.aborted) return;
      onState("reconnecting");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  onState("closed");
}
