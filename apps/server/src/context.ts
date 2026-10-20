import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildTaskContext,
  type MaterialRecord,
  type ProjectRecord,
  type TaskContextManifest,
  type TaskRecord,
} from "@scholarflow/research";
import type { Repositories } from "./repos.js";
import type { SkillService } from "./skills.js";

export class ContextService {
  constructor(
    private readonly repos: Repositories,
    private readonly skills: SkillService,
  ) {}

  build(project: ProjectRecord, task: TaskRecord): TaskContextManifest {
    const plan = this.repos.getConfirmedPlan(task.id);
    const admissions = this.repos.listAdmissions(task.id);
    const materials = this.repos.listMaterials(project.id) as Array<MaterialRecord & { note?: string }>;
    const notes: Record<string, string> = {};
    for (const material of materials) {
      if (material.note) notes[material.id] = material.note;
    }
    const runs = this.repos.listRunRecords().filter((run) => run.projectId === project.id);
    const runInputs = runs.map((run) => ({ run, metrics: this.repos.listMetrics([run.id]) }));
    const results = this.repos.listResults(project.id).filter((result) => result.status === "current");
    const manuscript = this.repos.listManuscripts(project.id).find((item) => item.build.status === "succeeded") ?? this.repos.listManuscripts(project.id)[0] ?? null;
    const context = buildTaskContext({
      project,
      task,
      plan: plan ?? this.repos.listPlans(task.id).at(-1) ?? null,
      admission: admissions[0] ?? null,
      materials,
      materialNotes: notes,
      runs: runInputs,
      results,
      manuscript,
      skills: this.skills.list(project.id).map((skill) => ({
        name: skill.name,
        version: skill.version,
        sha256: skill.sha256,
        dependenciesMissing: skill.missingDependencies,
      })),
      reviewComment: this.repos.taskReviewText(task.id),
    });
    const directory = path.join(project.dataDir, "tasks", task.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");
    writeFileSync(path.join(directory, "context.md"), context.markdown, "utf8");
    return context;
  }
}
