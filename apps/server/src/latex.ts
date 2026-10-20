import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import archiver from "archiver";
import {
  createId,
  resolveInsideRoot,
  sha256,
  type ManuscriptVersion,
  type ProjectRecord,
  type ResultVersion,
} from "@scholarflow/research";
import type { Repositories } from "./repos.js";

const TEXT_EXTENSIONS = new Set([".tex", ".bib", ".cls", ".sty", ".bst", ".txt", ".md", ".csv"]);
const FIGURE_EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".svg", ".eps"]);
const MAX_EDIT_BYTES = 2 * 1024 * 1024;

export interface BuildResult {
  ok: boolean;
  version: ManuscriptVersion;
  diagnostics: string[];
  pdfPath: string | null;
  logExcerpt: string;
}

function walk(directory: string, base = directory, result: string[] = []): string[] {
  if (!existsSync(directory)) return result;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, base, result);
    else result.push(path.relative(base, absolute).split(path.sep).join("/"));
  }
  return result;
}

function hashFiles(root: string, files: string[]): string {
  return sha256(files.sort().map((file) => `${file}:${sha256(readFileSync(path.join(root, file)))}`).join("\n"));
}

function citeKeys(tex: string): string[] {
  const keys: string[] = [];
  for (const match of tex.matchAll(/\\cite[a-zA-Z*]*\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    for (const key of match[1]!.split(",")) keys.push(key.trim());
  }
  return keys;
}

function bibKeys(bib: string): Set<string> {
  const keys = new Set<string>();
  for (const match of bib.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/g)) keys.add(match[1]!);
  return keys;
}

export class ManuscriptService {
  constructor(
    private readonly repos: Repositories,
    private readonly templateDir: string,
    private readonly pdflatexPath: () => string = () => "pdflatex",
  ) {}

  manuscriptRoot(project: ProjectRecord): string {
    return path.join(project.dataDir, "manuscript");
  }

  initialize(project: ProjectRecord): void {
    const target = this.manuscriptRoot(project);
    mkdirSync(target, { recursive: true });
    if (walk(target).length === 0) {
      const copy = (source: string, destination: string) => {
        mkdirSync(destination, { recursive: true });
        for (const entry of readdirSync(source, { withFileTypes: true })) {
          const from = path.join(source, entry.name);
          const to = path.join(destination, entry.name);
          if (entry.isDirectory()) copy(from, to);
          else writeFileSync(to, readFileSync(from));
        }
      };
      copy(this.templateDir, target);
    }
    if (this.repos.listManuscripts(project.id).length === 0) {
      this.createVersion(project, null, { status: "not_built", pdfPath: null, logPath: null, builtAt: null, diagnostics: [], sourceHash: null }, []);
    }
  }

  listFiles(project: ProjectRecord): Array<{ path: string; bytes: number; kind: "text" | "figure"; sha256: string }> {
    const root = this.manuscriptRoot(project);
    return walk(root).map((file) => {
      const absolute = path.join(root, file);
      const extension = path.extname(file).toLowerCase();
      return {
        path: file,
        bytes: statSync(absolute).size,
        kind: TEXT_EXTENSIONS.has(extension) ? "text" as const : "figure" as const,
        sha256: sha256(readFileSync(absolute)),
      };
    });
  }

  readFile(project: ProjectRecord, relative: string): string {
    const root = this.manuscriptRoot(project);
    const target = resolveInsideRoot(root, relative);
    if (target.includes(`${path.sep}build${path.sep}`)) throw new Error("build artifacts are not editable sources");
    const extension = path.extname(target).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error(`file type is not editable as text: ${extension}`);
    if (statSync(target).size > MAX_EDIT_BYTES) throw new Error("file exceeds the 2 MiB edit limit");
    return readFileSync(target, "utf8");
  }

  saveFile(project: ProjectRecord, taskId: string | null, relative: string, content: string): ManuscriptVersion {
    const root = this.manuscriptRoot(project);
    const target = resolveInsideRoot(root, relative);
    if (target.includes(`${path.sep}build${path.sep}`)) throw new Error("build artifacts are not editable sources");
    if (Buffer.byteLength(content, "utf8") > MAX_EDIT_BYTES) throw new Error("file exceeds the 2 MiB edit limit");
    const extension = path.extname(target).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) throw new Error(`file type is not editable as text: ${extension}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
    return this.createVersion(
      project,
      taskId,
      { status: "not_built", pdfPath: null, logPath: null, builtAt: null, diagnostics: [], sourceHash: null },
      [],
    );
  }

  private createVersion(
    project: ProjectRecord,
    taskId: string | null,
    build: ManuscriptVersion["build"],
    sourceResultVersions: string[],
  ): ManuscriptVersion {
    const files = this.listFiles(project).map((file) => ({ path: file.path, sha256: file.sha256, bytes: file.bytes }));
    const version: ManuscriptVersion = {
      id: createId("man"),
      projectId: project.id,
      taskId,
      version: this.repos.nextManuscriptVersion(project.id),
      files,
      build,
      sourceResultVersions: sourceResultVersions.length
        ? sourceResultVersions
        : (this.repos.listResults(project.id).filter((result) => result.status === "current").map((result) => result.id)),
      createdAt: new Date().toISOString(),
    };
    return this.repos.createManuscript(version);
  }

  checkSources(project: ProjectRecord): { errors: string[]; warnings: string[]; files: string[] } {
    const root = this.manuscriptRoot(project);
    const files = walk(root);
    const errors: string[] = [];
    const warnings: string[] = [];
    const texFiles = files.filter((file) => file.endsWith(".tex"));
    const bib = files.filter((file) => file.endsWith(".bib")).map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
    const keys = bibKeys(bib);
    for (const file of texFiles) {
      const content = readFileSync(path.join(root, file), "utf8");
      for (const key of citeKeys(content)) {
        if (!keys.has(key)) errors.push(`${file}: citation key not found in BibTeX: ${key}`);
      }
      for (const match of content.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
        const raw = match[1]!.trim();
        const candidates = [raw, ...["pdf", "png", "jpg", "jpeg", "eps"].map((extension) => `${raw}.${extension}`)];
        if (!candidates.some((candidate) => existsSync(path.resolve(root, candidate)))) {
          errors.push(`${file}: figure not found: ${raw}`);
        }
      }
      for (const match of content.matchAll(/\\(?:label|ref|eqref)\{([^}]+)\}/g)) {
        if (!content.includes(`\\label{${match[1]}}`) && match[0].startsWith("\\ref")) {
          // Reference may be defined in another file; handled after collecting all labels.
        }
      }
    }
    const labels = new Set<string>();
    for (const file of texFiles) {
      for (const match of readFileSync(path.join(root, file), "utf8").matchAll(/\\label\{([^}]+)\}/g)) labels.add(match[1]!);
    }
    for (const file of texFiles) {
      for (const match of readFileSync(path.join(root, file), "utf8").matchAll(/\\(?:ref|eqref)\{([^}]+)\}/g)) {
        if (!labels.has(match[1]!)) errors.push(`${file}: reference target not defined: ${match[1]}`);
      }
    }
    if (!existsSync(path.join(root, "main.tex"))) errors.push("main.tex is missing");
    if (files.some((file) => file.endsWith(".bib")) && keys.size === 0) warnings.push("BibTeX file contains no entries");
    return { errors, warnings, files };
  }

  private run(command: string, args: string[], cwd: string, timeoutMs = 120000): { code: number; output: string } {
    try {
      const output = execFileSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout: timeoutMs,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          max_print_line: "1000000",
          error_line: "254",
          half_error_line: "238",
        },
      });
      return { code: 0, output };
    } catch (error) {
      const err = error as { status?: number; stdout?: string; stderr?: string; message?: string };
      return {
        code: typeof err.status === "number" ? err.status : 1,
        output: `${err.stdout ?? ""}\n${err.stderr ?? ""}\n${err.message ?? ""}`,
      };
    }
  }

  build(project: ProjectRecord, taskId: string | null): BuildResult {
    const root = this.manuscriptRoot(project);
    const check = this.checkSources(project);
    if (check.errors.length > 0) {
      const version = this.createVersion(project, taskId, {
        status: "failed",
        pdfPath: null,
        logPath: null,
        builtAt: new Date().toISOString(),
        diagnostics: check.errors,
        sourceHash: null,
      }, []);
      return { ok: false, version, diagnostics: check.errors, pdfPath: null, logExcerpt: "" };
    }
    const buildId = createId("bld");
    const buildDir = path.join(root, "build", buildId);
    mkdirSync(buildDir, { recursive: true });
    for (const file of walk(root)) {
      const source = path.join(root, file);
      const target = path.join(buildDir, file);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(source));
    }
    const diagnostics: string[] = [];
    const commands: string[][] = [
      [this.pdflatex(), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex"],
    ];
    if (existsSync(path.join(buildDir, "refs.bib"))) {
      commands.push(["bibtex", "main"]);
      commands.push([this.pdflatex(), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex"]);
      commands.push([this.pdflatex(), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex"]);
    } else {
      commands.push([this.pdflatex(), "-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "main.tex"]);
    }
    let lastOutput = "";
    for (const [command, ...args] of commands) {
      const result = this.run(command!, args, buildDir);
      lastOutput = result.output;
      if (result.code !== 0) {
        diagnostics.push(`${command} failed with exit code ${result.code}`);
        break;
      }
    }
    const logFile = path.join(buildDir, "main.log");
    const log = existsSync(logFile) ? readFileSync(logFile, "utf8") : lastOutput;
    if (/Undefined control sequence|Emergency stop|Fatal error/i.test(log)) diagnostics.push("LaTeX reported an undefined control sequence or fatal error");
    const undefinedCitations = [...log.matchAll(/Citation [`']([^']+)' .*undefined/g)].map((match) => match[1]!);
    for (const key of undefinedCitations) diagnostics.push(`undefined citation: ${key}`);
    const undefinedReferences = [...log.matchAll(/Reference [`']([^']+)' .*undefined/g)].map((match) => match[1]!);
    for (const key of undefinedReferences) diagnostics.push(`undefined reference: ${key}`);
    if (/\bOverfull \\hbox\b/.test(log)) diagnostics.push("warning: overfull hbox (layout review required)");
    const pdf = path.join(buildDir, "main.pdf");
    const pdfExists = existsSync(pdf) && statSync(pdf).size > 1000;
    const fatal = diagnostics.some((item) => !item.startsWith("warning:"));
    const sourceHash = hashFiles(root, walk(root));
    const ok = pdfExists && !fatal;
    const version = this.createVersion(project, taskId, {
      status: ok ? "succeeded" : "failed",
      pdfPath: ok ? path.relative(root, pdf).split(path.sep).join("/") : null,
      logPath: path.relative(root, logFile).split(path.sep).join("/"),
      builtAt: new Date().toISOString(),
      diagnostics,
      sourceHash,
    }, []);
    return { ok, version, diagnostics, pdfPath: ok ? pdf : null, logExcerpt: log.split(/\r?\n/).slice(-80).join("\n") };
  }

  private pdflatex(): string {
    return this.pdflatexPath() || "pdflatex";
  }

  latestBuild(project: ProjectRecord): ManuscriptVersion | undefined {
    return this.repos.listManuscripts(project.id).find((version) => version.build.status === "succeeded");
  }

  pdfFor(project: ProjectRecord): { path: string; version: ManuscriptVersion; stale: boolean } {
    const version = this.latestBuild(project);
    if (!version?.build.pdfPath) throw new Error("no successful manuscript build exists");
    const root = this.manuscriptRoot(project);
    const pdf = resolveInsideRoot(root, version.build.pdfPath);
    if (!existsSync(pdf)) throw new Error("built PDF is missing from the build directory");
    const currentHash = hashFiles(root, walk(root));
    return { path: pdf, version, stale: version.build.sourceHash !== currentHash };
  }

  sourceHash(project: ProjectRecord): string {
    const root = this.manuscriptRoot(project);
    return hashFiles(root, walk(root));
  }

  async exportPackage(project: ProjectRecord): Promise<{ path: string; manifest: Record<string, unknown> }> {
    const { path: pdf, version, stale } = this.pdfFor(project);
    if (stale) throw new Error("manuscript sources changed after the last build; rebuild before exporting");
    const root = this.manuscriptRoot(project);
    const exportsDir = path.join(project.dataDir, "exports");
    mkdirSync(exportsDir, { recursive: true });
    const exportPath = path.join(exportsDir, `submission-${Date.now()}.zip`);
    const results = this.repos.listResults(project.id).filter((result) => version.sourceResultVersions.includes(result.id));
    const runs = this.repos.listRunRecords().filter((run) => resultRunIds(results).includes(run.id));
    const manifest = {
      project: { id: project.id, name: project.name },
      builtAt: version.build.builtAt,
      buildSourceHash: version.build.sourceHash,
      manuscriptVersion: version.version,
      resultVersions: results.map((result) => ({
        id: result.id,
        title: result.title,
        runs: result.runIds,
        comparable: result.comparability.comparable,
        report: result.reportPath,
      })),
      runs: runs.map((run) => ({
        id: run.id,
        name: run.name,
        status: run.status,
        verificationStatus: run.verificationStatus,
        kind: run.kind,
        configFingerprint: run.configFingerprint,
        snapshot: run.snapshotPath,
      })),
      limitations: [
        "Smoke runs are not reproduction evidence.",
        "Successful process exit is not scientific verification.",
        runs.some((run) => run.verificationStatus !== "verified") ? "Some runs are not verified." : null,
      ].filter(Boolean),
    };
    writeFileSync(path.join(root, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const archive = archiver("zip", { zlib: { level: 9 } });
    const output = createWriteStream(exportPath);
    const completed = new Promise<void>((resolve, reject) => {
      output.on("close", () => resolve());
      output.on("error", reject);
      archive.on("error", reject);
    });
    archive.pipe(output);
    for (const file of walk(root)) {
      if (file === "build" || file.startsWith("build/") || file.endsWith(".aux") || file.endsWith(".log")) continue;
      archive.file(path.join(root, file), { name: file });
    }
    archive.file(pdf, { name: "main.pdf" });
    archive.append(
      [
        "ScholarFlow submission package",
        `Project: ${project.name}`,
        `Manuscript version: ${version.version}`,
        `Build source hash: ${version.build.sourceHash}`,
        `Exported: ${new Date().toISOString()}`,
        "This package contains no model credentials. Verify result provenance in MANIFEST.json.",
        "Exit code alone is not reproduction success; see the manuscript limitations section.",
        "",
      ].join("\n"),
      { name: "README.txt" },
    );
    await archive.finalize();
    await completed;
    return { path: exportPath, manifest };
  }
}

function resultRunIds(results: ResultVersion[]): string[] {
  return [...new Set(results.flatMap((result) => result.runIds))];
}

export function renderResultsLatex(input: {
  title: string;
  table: Array<{ runName: string; values: Record<string, { value: number; unit?: string }> }>;
  keys: string[];
  caption: string;
  label: string;
}): string {
  const header = ["Run", ...input.keys].join(" & ");
  const lines = input.table.map((row) => {
    const values = input.keys.map((key) => {
      const value = row.values[key];
      return value ? `${value.value}${value.unit ? ` (${value.unit})` : ""}` : "--";
    });
    return `${row.runName.replace(/([_%&#])/g, "\\$1")} & ${values.join(" & ")} \\\\`;
  });
  return [
    "% Generated by ScholarFlow from a ResultVersion. Keep run IDs in the project report.",
    "\\begin{table}[h]",
    "\\centering",
    `\\caption{${input.caption}}`,
    `\\label{${input.label}}`,
    "\\begin{tabular}{l" + "c".repeat(input.keys.length) + "}",
    "\\toprule",
    `${header} \\\\`,
    "\\midrule",
    ...lines,
    "\\bottomrule",
    "\\end{tabular}",
    "\\end{table}",
    "",
  ].join("\n");
}

export function removeStaleBuild(project: ProjectRecord): void {
  const build = path.join(project.dataDir, "manuscript", "build");
  rmSync(build, { recursive: true, force: true });
}
