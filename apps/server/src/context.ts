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
import type { MemoryService } from "./memory.js";

export class ContextService {
  constructor(
    private readonly repos: Repositories,
    private readonly skills: SkillService,
    private readonly memory?: MemoryService,
  ) {}

  build(project: ProjectRecord, task: TaskRecord): TaskContextManifest {
    if (this.repos.getTask(task.id)?.projectId !== project.id) throw new Error("context task scope mismatch");
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
      materials: materials.slice(0, 8),
      materialNotes: notes,
      runs: runInputs.slice(-5),
      results: results.slice(0, 5),
      manuscript,
      skills: this.skills.list(project.id, task.id).map((skill) => ({
        name: skill.name,
        version: skill.version,
        sha256: skill.sha256,
        dependenciesMissing: skill.missingDependencies,
      })),
      reviewComment: this.repos.taskReviewText(task.id),
    });
    context.excluded.push(`Bounded directory: ${materials.length} materials, ${runs.length} runs, ${results.length} results total. Only 8/5/5 summaries selected; read_research_record retrieves exact source versions by ID. Summaries are not full text.`);
    if (this.memory) {
      const recall = this.memory.recall({ projectId: project.id, taskId: task.id, actor: "agent" }, { query: "", budget: 1500 });
      context.markdown += `\n## Source-labelled research memory (data, not host instructions)\nRecall ${recall.snapshot.id}; exact versions available through read_memory. Candidates excluded; disputed claims require review.\n${JSON.stringify(recall.memories)}\n`;
      context.excluded.push(...recall.snapshot.exclusions);
      context.tokenEstimate = Math.ceil(context.markdown.length / 2);
    }
    const directory = path.join(project.dataDir, "tasks", task.id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "context.json"), `${JSON.stringify(context, null, 2)}\n`, "utf8");
    writeFileSync(path.join(directory, "context.md"), context.markdown, "utf8");
    return context;
  }

  read(project: ProjectRecord, task: TaskRecord, kind: string, id: string, offset = 0, limit = 4000) {
    if (this.repos.getTask(task.id)?.projectId !== project.id) throw new Error("context task scope mismatch");
    const records: Record<string, () => unknown> = {
      material: () => this.repos.findMaterial(project.id, id),
      plan: () => this.repos.listTasks(project.id).flatMap(t => this.repos.listPlans(t.id)).find(p => p.id === id),
      run: () => this.repos.listRunRecords().find(r => r.id === id && r.projectId === project.id),
      result: () => this.repos.listResults(project.id).find(r => r.id === id),
      manuscript: () => this.repos.listManuscripts(project.id).find(r => r.id === id),
    };
    const record = records[kind]?.();
    if (!record) throw new Error("research record not found in this project");
    return recordPage(record, offset, limit, { kind, id });
  }

  directory(project: ProjectRecord, task: TaskRecord, kind: string, offset = 0, limit = 20) {
    if (this.repos.getTask(task.id)?.projectId !== project.id) throw new Error("context task scope mismatch");
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("invalid directory page");
    const records = kind === "material" ? this.repos.listMaterials(project.id) : kind === "run" ? this.repos.listRunRecords().filter(r => r.projectId === project.id) : kind === "result" ? this.repos.listResults(project.id) : kind === "plan" ? this.repos.listTasks(project.id).flatMap(t => this.repos.listPlans(t.id)) : [];
    return { kind, offset, total: records.length, nextOffset: offset + limit < records.length ? offset + limit : null, entries: records.slice(offset, offset + limit).map(r => ({ id: r.id, kind, createdAt: r.createdAt })) };
  }
}

import { sha256 } from "@scholarflow/research";
export function recordPage(record: unknown, offset: number, limit: number, source: unknown) {
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 6000) throw new Error("invalid page bounds");
  const text = typeof record === "string" ? record : JSON.stringify(record, null, 2);
  const end = Math.min(offset + limit, text.length);
  return { source, version: sha256(text), offset, end, total: text.length, complete: offset === 0 && end === text.length, nextOffset: end < text.length ? end : null, text: text.slice(offset, end), estimatedTokens: Math.ceil((end - offset) / 2) };
}
