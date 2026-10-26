import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  checkSkillDependencies,
  parseSkillMarkdown,
  skillManifestEntry,
  type SkillDocument,
} from "@scholarflow/research";
import type { Repositories } from "./repos.js";
import type { MethodService } from "./methods.js";

export interface SkillView {
  name: string;
  version: string;
  license: string;
  sha256: string;
  sourcePath: string;
  requires: string[];
  missingDependencies: string[];
  importedAt: string;
}

const DEFAULT_SKILLS = [
  "literature-review",
  "reproduction-admission",
  "experiment-design",
  "result-analysis",
  "latex-writing",
];

export function commandAvailable(name: string, envPath = process.env.PATH ?? ""): boolean {
  if (name === "node") return true;
  if (name === "python" || name === "python3") {
    return ["python.exe", "python3.exe", "python"].some((candidate) => {
      return envPath.split(path.delimiter).some((directory) => existsSync(path.join(directory, candidate)));
    });
  }
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return envPath.split(path.delimiter).some((directory) => {
    return extensions.some((extension) => existsSync(path.join(directory, `${name}${extension.toLowerCase()}`)) || existsSync(path.join(directory, `${name}${extension}`)));
  });
}

export class SkillService {
  constructor(
    private readonly repos: Repositories,
    private readonly resourcesDir: string,
    private readonly methods?: MethodService,
  ) {}

  installDefaults(projectId: string, projectRoot: string): SkillView[] {
    for (const name of DEFAULT_SKILLS) {
      this.installFromDirectory(projectId, projectRoot, path.join(this.resourcesDir, "skills", name), "built-in");
    }
    return this.list(projectId);
  }

  installFromDirectory(projectId: string, projectRoot: string, sourceDir: string, sourceLabel = sourceDir): SkillDocument {
    const skillFile = path.join(sourceDir, "SKILL.md");
    if (!existsSync(skillFile)) throw new Error(`SKILL.md not found in ${sourceDir}`);
    const parsed = parseSkillMarkdown(readFileSync(skillFile, "utf8"), skillFile);
    if (!parsed.document) {
      throw new Error(`invalid skill: ${parsed.validation.errors.join("; ")}`);
    }
    const document = parsed.document;
    const targetDir = path.join(projectRoot, ".pi", "skills", document.name);
    mkdirSync(targetDir, { recursive: true });
    cpSync(sourceDir, targetDir, { recursive: true, force: true });
    const manifest = skillManifestEntry(document, sourceLabel);
    writeFileSync(path.join(targetDir, ".scholarflow-skill.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    this.repos.upsertSkill({
      projectId,
      name: document.name,
      version: document.version ?? "unversioned",
      license: document.license ?? "unknown",
      sha256: document.sha256,
      sourcePath: sourceLabel,
      requires: document.requires,
      content: readFileSync(path.join(targetDir, "SKILL.md"), "utf8"),
      importedAt: manifest.importedAt,
    });
    this.methods?.install(projectId, document.name);
    return { ...document, filePath: path.join(targetDir, "SKILL.md") };
  }

  importFromPath(projectId: string, projectRoot: string, sourceDir: string): SkillDocument {
    const resolved = path.resolve(sourceDir);
    if (!existsSync(resolved)) throw new Error(`skill directory not found: ${sourceDir}`);
    const document = this.installFromDirectory(projectId, projectRoot, resolved, resolved);
    return document;
  }

  list(projectId: string, taskId?: string): SkillView[] {
    return this.repos.listSkills(projectId).map((base) => {
      const bound = this.methods?.resolve(projectId, base.name, taskId);
      const skill = bound ? { ...base, ...bound, sha256: bound.hash } : base;
      return ({
      name: skill.name,
      version: skill.version,
      license: skill.license,
      sha256: skill.sha256,
      sourcePath: skill.sourcePath,
      requires: skill.requires,
      missingDependencies: checkSkillDependencies(skill.requires, (name) => commandAvailable(name)),
      importedAt: skill.importedAt,
    }); });
  }

  toolDescriptions(projectId: string, taskId: string): Record<string, string> {
    return Object.assign({}, ...this.repos.listSkills(projectId).map(s => this.methods?.resolve(projectId, s.name, taskId).toolDescriptions ?? {}));
  }

  readForTask(projectId: string, taskId: string, name: string): { name: string; path: string; body: string; sha256: string; version: string; license: string } {
    if (this.repos.getTask(taskId)?.projectId !== projectId) throw new Error("skill task scope mismatch");
    const base = this.repos.getSkill(projectId, name);
    const bound = base && this.methods?.resolve(projectId, name, taskId);
    const skill = base && bound ? { ...base, ...bound, sha256: bound.hash } : base;
    if (!skill) throw new Error(`skill not found in this project: ${name}`);
    const missing = checkSkillDependencies(skill.requires, commandAvailable);
    if (missing.length) throw new Error(`missing skill dependencies: ${missing.join(", ")}`);
    this.repos.recordSkillLoad(projectId, taskId, name, skill.sha256);
    return {
      name: skill.name,
      path: skill.sourcePath,
      body: skill.content,
      sha256: skill.sha256,
      version: skill.version,
      license: skill.license,
    };
  }
}
