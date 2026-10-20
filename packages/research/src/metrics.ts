import { sha256 } from "./paths.js";
import type {
  MetricRecord,
  MetricSpec,
  ResultTableRow,
  ResultVersion,
  RunRecord,
} from "./types.js";

export interface MetricExtractionInput {
  run: RunRecord;
  metricFileContent: string;
  fileSha256: string;
  specs: MetricSpec[];
  importedAt?: string;
  idFactory: (key: string) => string;
}

export interface MetricExtractionResult {
  metrics: MetricRecord[];
  errors: string[];
}

function getByPointer(root: unknown, pointer: string): unknown {
  if (pointer === "" || pointer === "/") return root;
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = root;
  for (const raw of pointer.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

export function runConditions(run: RunRecord): Record<string, string> {
  const config = run.spec.config;
  const conditionKeys = new Set([
    ...Object.keys(config).filter((key) =>
      /^(dataset|data|split|preprocess|prediction|seq|sequence|max_length|eval|task|model|prompt|temperature|top_p)/i.test(
        key,
      ),
    ),
  ]);
  const conditions: Record<string, string> = {
    "data.version": run.spec.data.version,
    "data.split": run.spec.data.split,
    "data.preprocessing": run.spec.data.preprocessing,
  };
  for (const key of [...conditionKeys].sort()) {
    const value = config[key];
    conditions[`config.${key}`] = value === undefined ? "unknown" : JSON.stringify(value);
  }
  return conditions;
}

export function conditionFingerprint(conditions: Record<string, string>): string {
  const sorted = Object.entries(conditions).sort(([a], [b]) => a.localeCompare(b));
  return sha256(JSON.stringify(sorted));
}

/**
 * Import metrics only from the named run artifact. Values must be finite numbers;
 * every record carries file, JSON pointer, hash, runId, and conditions.
 */
export function extractMetrics(input: MetricExtractionInput): MetricExtractionResult {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.metricFileContent);
  } catch (error) {
    return {
      metrics: [],
      errors: [`metric file is not valid JSON: ${(error as Error).message}`],
    };
  }
  const conditions = runConditions(input.run);
  const fingerprint = conditionFingerprint(conditions);
  const metrics: MetricRecord[] = [];
  for (const spec of input.specs) {
    const raw = getByPointer(parsed, spec.pointer);
    if (raw === undefined) {
      errors.push(`metric ${spec.key} not found at ${spec.pointer}`);
      continue;
    }
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push(`metric ${spec.key} at ${spec.pointer} is not a finite number (${String(raw)})`);
      continue;
    }
    const warnings: string[] = [];
    if (Object.values(conditions).some((value) => value === "unknown")) {
      warnings.push("one or more comparison conditions are unknown");
    }
    metrics.push({
      id: input.idFactory(spec.key),
      projectId: input.run.projectId,
      runId: input.run.id,
      key: spec.key,
      label: spec.label,
      value: raw,
      unit: spec.unit,
      direction: spec.direction,
      source: {
        file: spec.file,
        pointer: spec.pointer,
        sha256: input.fileSha256,
        importedAt: input.importedAt ?? new Date().toISOString(),
        runId: input.run.id,
        conditionFingerprint: fingerprint,
      },
      conditions,
      warnings,
    });
  }
  return { metrics, errors };
}

export interface ComparisonInput {
  run: RunRecord;
  metrics: MetricRecord[];
}

export interface ComparisonResult {
  comparable: boolean;
  keyDifferences: string[];
  warnings: string[];
  missingConditions: string[];
  table: ResultTableRow[];
  groups: Array<{ fingerprint: string; runIds: string[] }>;
}

function budgetSignature(run: RunRecord): string {
  return JSON.stringify({
    seed: run.spec.seed,
    timeout: run.spec.resourceLimits.timeoutSeconds,
    gpu: run.spec.resourceLimits.gpu ?? "unknown",
  });
}

export function compareRuns(inputs: ComparisonInput[]): ComparisonResult {
  const keyDifferences: string[] = [];
  const warnings: string[] = [];
  const missingConditions: string[] = [];
  const table: ResultTableRow[] = [];
  const groups = new Map<string, string[]>();

  for (const input of inputs) {
    if (input.run.status !== "succeeded" && input.run.status !== "failed") {
      warnings.push(`run ${input.run.name} is ${input.run.status}; its metrics are not final`);
    }
    if (input.run.kind === "smoke") {
      warnings.push(`run ${input.run.name} is a smoke run and cannot support a target claim`);
    }
    if (input.run.verificationStatus !== "verified") {
      warnings.push(`run ${input.run.name} is not verified (${input.run.verificationStatus})`);
    }
    const conditions = input.metrics[0]?.conditions ?? runConditions(input.run);
    for (const [key, value] of Object.entries(conditions)) {
      if (!value || value === "unknown") missingConditions.push(`${input.run.name}: ${key}`);
    }
    const fingerprint = conditionFingerprint(conditions);
    const group = groups.get(fingerprint) ?? [];
    group.push(input.run.id);
    groups.set(fingerprint, group);
    table.push({
      runId: input.run.id,
      runName: input.run.name,
      status: input.run.status,
      values: Object.fromEntries(
        input.metrics.map((metric) => [
          metric.key,
          {
            value: metric.value,
            unit: metric.unit,
            source: `${metric.source.file}#${metric.source.pointer}`,
          },
        ]),
      ),
      conditions,
      comparableGroup: fingerprint.slice(0, 12),
    });
  }

  if (groups.size > 1) {
    keyDifferences.push("runs use different comparison conditions");
    const keys = new Set<string>();
    for (const input of inputs) {
      for (const key of Object.keys(input.metrics[0]?.conditions ?? runConditions(input.run))) keys.add(key);
    }
    for (const key of [...keys].sort()) {
      const values = new Set(
        inputs.map((input) => (input.metrics[0]?.conditions ?? runConditions(input.run))[key] ?? "missing"),
      );
      if (values.size > 1) keyDifferences.push(`${key}: ${[...values].join(" vs ")}`);
    }
  }
  const seeds = new Set(inputs.map((input) => JSON.stringify(input.run.spec.seed)));
  if (seeds.size > 1) warnings.push("seeds differ between runs; results are not seed-averaged");
  if (seeds.size === 1 && inputs[0] && inputs[0].run.spec.seed.length < 3) {
    warnings.push("fewer than three seeds; report this as limited evidence");
  }
  const budgets = new Set(inputs.map((input) => budgetSignature(input.run)));
  if (budgets.size > 1) warnings.push("training/resource budgets differ between runs");
  const failed = inputs.filter((input) => input.run.status !== "succeeded");
  if (failed.length > 0) warnings.push(`${failed.length} run(s) did not succeed; negative/failed results are retained`);

  const comparable =
    groups.size === 1 &&
    missingConditions.length === 0 &&
    inputs.every((input) => input.run.status === "succeeded") &&
    inputs.every((input) => input.run.verificationStatus === "verified") &&
    inputs.every((input) => input.run.kind === "target");

  return { comparable, keyDifferences, warnings, missingConditions, table, groups: [...groups].map(([fingerprint, runIds]) => ({ fingerprint, runIds })) };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Source-labelled SVG. A chart is only produced when all runs share conditions;
 * otherwise returning null prevents an unsupported visual ranking.
 */
export function renderComparisonSvg(
  comparison: ComparisonResult,
  metricKeys: string[],
  title: string,
): string | null {
  if (!comparison.comparable) return null;
  const rows = comparison.table.filter((row) => row.status === "succeeded");
  if (rows.length === 0 || metricKeys.length === 0) return null;
  const width = Math.max(640, 120 + metricKeys.length * 150);
  const height = 360;
  const chartTop = 70;
  const chartHeight = 210;
  const maxByKey = new Map<string, number>();
  for (const key of metricKeys) {
    maxByKey.set(
      key,
      Math.max(1e-12, ...rows.map((row) => Math.abs(row.values[key]?.value ?? 0))),
    );
  }
  const barWidth = Math.min(46, (width - 100) / (rows.length * metricKeys.length + 2));
  const groupWidth = (width - 80) / metricKeys.length;
  const colors = ["#2563eb", "#0d9488", "#d97706", "#7c3aed", "#dc2626", "#4b5563"];
  let bars = "";
  metricKeys.forEach((key, metricIndex) => {
    const groupX = 60 + metricIndex * groupWidth;
    rows.forEach((row, rowIndex) => {
      const value = row.values[key]?.value ?? 0;
      const max = maxByKey.get(key) ?? 1;
      const h = Math.max(1, (Math.abs(value) / max) * (chartHeight - 30));
      const x = groupX + 10 + rowIndex * (barWidth + 8);
      const y = chartTop + chartHeight - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" fill="${colors[rowIndex % colors.length]}" />`;
      bars += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="10" text-anchor="middle" fill="#111827">${escapeXml(value.toFixed(4))}</text>`;
    });
    bars += `<text x="${(groupX + groupWidth / 2).toFixed(1)}" y="${chartTop + chartHeight + 24}" font-size="12" text-anchor="middle" fill="#111827">${escapeXml(key)}</text>`;
  });
  const legend = rows
    .map(
      (row, index) =>
        `<rect x="${60 + index * 170}" y="${height - 42}" width="10" height="10" fill="${colors[index % colors.length]}" /><text x="${76 + index * 170}" y="${height - 33}" font-size="11" fill="#111827">${escapeXml(row.runName)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}"><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="30" font-size="16" font-weight="600" fill="#111827">${escapeXml(title)}</text><text x="24" y="50" font-size="10" fill="#6b7280">Values imported from per-run artifact files; conditions identical across runs.</text><line x1="50" y1="${chartTop + chartHeight}" x2="${width - 20}" y2="${chartTop + chartHeight}" stroke="#d1d5db"/>${bars}${legend}</svg>`;
}

export function buildResultVersion(input: {
  id: string;
  projectId: string;
  taskId: string;
  title: string;
  comparison: ComparisonResult;
  chartPath: string | null;
  reportPath: string;
  supersedes?: string | null;
  now?: Date;
}): ResultVersion {
  return {
    id: input.id,
    projectId: input.projectId,
    taskId: input.taskId,
    title: input.title,
    runIds: input.comparison.table.map((row) => row.runId),
    table: input.comparison.table,
    comparability: {
      comparable: input.comparison.comparable,
      keyDifferences: input.comparison.keyDifferences,
      warnings: input.comparison.warnings,
      missingConditions: input.comparison.missingConditions,
    },
    chartPath: input.chartPath,
    reportPath: input.reportPath,
    supersedes: input.supersedes ?? null,
    status: "current",
    affectedArtifacts: [],
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export function renderResultReport(version: ResultVersion, metricKeys: string[]): string {
  const lines: string[] = [];
  lines.push(`# ${version.title}`);
  lines.push("");
  lines.push(`Result version: ${version.id}`);
  lines.push(`Created: ${version.createdAt}`);
  lines.push(`Runs: ${version.runIds.join(", ")}`);
  lines.push("");
  lines.push("## Comparability");
  lines.push("");
  lines.push(`- directly comparable: ${version.comparability.comparable ? "yes" : "no"}`);
  for (const difference of version.comparability.keyDifferences) lines.push(`- difference: ${difference}`);
  for (const warning of version.comparability.warnings) lines.push(`- warning: ${warning}`);
  for (const missing of version.comparability.missingConditions) lines.push(`- missing condition: ${missing}`);
  lines.push("");
  lines.push("## Measurements");
  lines.push("");
  lines.push(`| run | status | ${metricKeys.join(" | ")} | source |`);
  lines.push(`| --- | --- | ${metricKeys.map(() => "---").join(" | ")} | --- |`);
  for (const row of version.table) {
    const values = metricKeys.map((key) => {
      const value = row.values[key];
      return value === undefined ? "missing" : `${value.value}${value.unit ? ` ${value.unit}` : ""}`;
    });
    const sources = metricKeys
      .map((key) => row.values[key]?.source)
      .filter(Boolean)
      .join("; ");
    lines.push(`| ${row.runName} | ${row.status} | ${values.join(" | ")} | ${sources} |`);
  }
  lines.push("");
  lines.push("Numbers above are traceable to the listed run artifact and JSON pointer. A successful exit code alone is not reproduction success.");
  return `${lines.join("\n")}\n`;
}
