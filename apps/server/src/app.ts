import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  createId,
  PathGuardError,
  resolveInsideRoot,
  type AdmissionInput,
  type ExperimentPlan,
  type MaterialRecord,
  type MetricSpec,
  type ProjectRecord,
  type TaskRecord,
} from "@scholarflow/research";
import { ExperimentWorker, openDatabase, RunStore } from "@scholarflow/experiment-worker";
import {
  AgentBusyError,
  AgentConfigurationError,
  ModelUnavailableError,
  PiAgentService,
  type AgentServiceLike,
} from "./agent.js";
import { ensureDirectories, loadConfig, publicSettings, saveConfig, type AppConfig } from "./config.js";
import { ContextService } from "./context.js";
import { EventHub } from "./events.js";
import { ManuscriptService } from "./latex.js";
import { MaterialService } from "./materials.js";
import { Repositories } from "./repos.js";
import { ExperimentService, RunValidationError } from "./runs.js";
import { CrossrefSearch } from "./search.js";
import { SkillService } from "./skills.js";
import { ReferenceError, resolveReferences } from "./references.js";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface CreateAppOptions {
  config?: AppConfig;
  agent?: AgentServiceLike;
  worker?: ExperimentWorker | null;
  workerFactory?: (db: import("node:sqlite").DatabaseSync) => ExperimentWorker;
  search?: CrossrefSearch;
  resourcesDir?: string;
  webDist?: string;
  logger?: (message: string) => void;
}

export interface CreatedApp {
  server: http.Server;
  config: AppConfig;
  close: () => Promise<void>;
  worker: ExperimentWorker | null;
  agent: AgentServiceLike;
  services: {
    repositories: Repositories;
    experiments: ExperimentService;
    manuscript: ManuscriptService;
    skills: SkillService;
    materials: MaterialService;
    context: ContextService;
    events: EventHub;
    store: RunStore;
  };
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "HTTP_ERROR",
  ) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new HttpError(413, "request body exceeds 4 MiB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "request body must be a JSON object");
  }
}

function requireString(value: unknown, name: string, max = 20000): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new HttpError(400, `${name} is required`);
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value;
}

function optionalString(value: unknown, name: string, max = 20000): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a string`);
  if (value.length > max) throw new HttpError(400, `${name} is too long`);
  return value;
}

function requireArray<T>(value: unknown, name: string): T[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${name} must be an array`);
  return value as T[];
}

function mapError(error: unknown): { status: number; body: { error: string; code: string } } {
  if (error instanceof HttpError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof PathGuardError) return { status: 400, body: { error: error.message, code: error.code } };
  if (error instanceof RunValidationError) return { status: 409, body: { error: error.message, code: error.code } };
  if (error instanceof AgentConfigurationError) return { status: 503, body: { error: error.message, code: error.code } };
  if (error instanceof AgentBusyError) return { status: 409, body: { error: error.message, code: error.code } };
  const message = (error as Error).message ?? String(error);
  return { status: 500, body: { error: message, code: "INTERNAL_ERROR" } };
}

function latexProbe(config: AppConfig): {
  pdflatex: { available: boolean; version?: string; error?: string };
  latexmk: { available: boolean; version?: string; error?: string };
} {
  const probe = (command: string) => {
    try {
      const output = execFileSync(command, ["--version"], {
        encoding: "utf8",
        timeout: 8000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { available: true, version: output.split(/\r?\n/)[0]?.slice(0, 200) };
    } catch (error) {
      return { available: false, error: (error as Error).message.split(/\r?\n/)[0]?.slice(0, 300) };
    }
  };
  return { pdflatex: probe(config.pdflatexPath), latexmk: probe(config.latexmkPath) };
}

export async function createApp(options: CreateAppOptions = {}): Promise<CreatedApp> {
  const config = options.config ?? loadConfig();
  const paths = ensureDirectories(config);
  const resourcesDir = options.resourcesDir ?? path.resolve(import.meta.dirname, "..", "..", "..", "resources");
  const webDist = options.webDist ?? path.resolve(import.meta.dirname, "..", "..", "web", "dist");
  const db = openDatabase(paths.databaseFile);
  const repositories = new Repositories(db);
  const events = new EventHub();
  const search = options.search ?? new CrossrefSearch({ contactEmail: config.searchEmail });
  const materials = new MaterialService({ crossref: search });
  const skills = new SkillService(repositories, resourcesDir);
  const context = new ContextService(repositories, skills);
  const manuscript = new ManuscriptService(
    repositories,
    path.join(resourcesDir, "templates", "paper"),
    () => config.pdflatexPath,
  );
  const store = new RunStore(db);
  const worker = options.worker ?? options.workerFactory?.(db) ?? null;
  const experiments = new ExperimentService(repositories, db, store, worker, config, skills, events);
  const agent =
    options.agent ??
    new PiAgentService({
      repositories,
      context,
      events,
      config,
      search,
      materials,
      skills,
      experiments,
      manuscript,
    });
  const logger = options.logger ?? (() => undefined);

  const ensureProject = (project: ProjectRecord) => {
    for (const directory of ["workspace", "materials", "runs", "results", "manuscript", "tasks", ".pi/skills"]) {
      mkdirSync(path.join(project.dataDir, directory), { recursive: true });
    }
    if (skills.list(project.id).length === 0) skills.installDefaults(project.id, project.dataDir);
    manuscript.initialize(project);
  };
  for (const project of repositories.listProjects()) {
    try {
      ensureProject(project);
    } catch (error) {
      logger(`failed to prepare project ${project.id}: ${(error as Error).message}`);
    }
  }

  const projectFor = (projectId: string): ProjectRecord => {
    const project = repositories.getProject(projectId);
    if (!project) throw new HttpError(404, "project not found", "PROJECT_NOT_FOUND");
    return project;
  };
  const taskFor = (project: ProjectRecord, taskId: string): TaskRecord => {
    const task = repositories.getTask(taskId);
    if (!task || task.projectId !== project.id) throw new HttpError(404, "task not found in this project", "TASK_NOT_FOUND");
    return task;
  };
  const runFor = (project: ProjectRecord, runId: string) => {
    const run = store.get(runId);
    if (!run || run.projectId !== project.id) throw new HttpError(404, "run not found in this project", "RUN_NOT_FOUND");
    return run;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
    const method = req.method ?? "GET";
    try {
      if (url.pathname.startsWith("/api/")) {
        const origin = req.headers.origin;
        if (origin) {
          try {
            const parsed = new URL(origin);
            if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
              throw new HttpError(403, "cross-origin request rejected", "ORIGIN_REJECTED");
            }
          } catch {
            throw new HttpError(403, "invalid origin", "ORIGIN_REJECTED");
          }
        }
        if (method === "GET" && url.pathname === "/api/health") {
          return json(res, 200, {
            ok: true,
            version: "0.1.0",
            piVersion: "1.3.0",
            node: process.version,
            agent: {
              configured: await isAgentConfigured(agent, config),
              provider: config.modelProvider,
              model: config.modelId,
            },
            latex: latexProbe(config),
            search: { channel: "crossref", contactEmail: config.searchEmail || null },
            worker: { mode: worker ? "in-process" : config.workerEnabled ? "separate-child" : "disabled", concurrency: 1 },
            dataDir: config.dataDir,
          });
        }
        if (method === "GET" && url.pathname === "/api/settings") {
          return json(res, 200, publicSettings(config));
        }
        if (method === "PUT" && url.pathname === "/api/settings") {
          const body = await readJson(req);
          const updates: Partial<AppConfig> = {};
          if (typeof body.deepseekApiKey === "string") updates.deepseekApiKey = body.deepseekApiKey.trim();
          if (body.clearDeepseekKey === true) updates.deepseekApiKey = "";
          if (typeof body.modelId === "string" && body.modelId.trim()) updates.modelId = body.modelId.trim();
          if (typeof body.modelProvider === "string" && body.modelProvider.trim()) updates.modelProvider = body.modelProvider.trim();
          if (typeof body.searchEmail === "string") updates.searchEmail = body.searchEmail.trim();
          if (typeof body.pdflatexPath === "string" && body.pdflatexPath.trim()) updates.pdflatexPath = body.pdflatexPath.trim();
          if (typeof body.latexmkPath === "string" && body.latexmkPath.trim()) updates.latexmkPath = body.latexmkPath.trim();
          if (typeof body.defaultInterpreter === "string") updates.defaultInterpreter = body.defaultInterpreter.trim();
          if (body.defaultTimeoutSeconds !== undefined) {
            const value = Number(body.defaultTimeoutSeconds);
            if (!Number.isFinite(value) || value <= 0) throw new HttpError(400, "defaultTimeoutSeconds must be positive");
            updates.defaultTimeoutSeconds = value;
          }
          if (body.maxTargetRunsPerTask !== undefined) {
            const value = Number(body.maxTargetRunsPerTask);
            if (!Number.isInteger(value) || value <= 0) throw new HttpError(400, "maxTargetRunsPerTask must be positive");
            updates.maxTargetRunsPerTask = value;
          }
          const next = saveConfig(config, updates);
          Object.assign(config, next);
          (agent as unknown as { configChanged?: () => Promise<void> }).configChanged?.();
          return json(res, 200, publicSettings(config));
        }
        if (method === "GET" && url.pathname === "/api/models") {
          const models = agent.listModels
            ? await agent.listModels()
            : [
                {
                  provider: config.modelProvider,
                  id: config.modelId,
                  name: config.modelId,
                  available: Boolean(config.deepseekApiKey || process.env.DEEPSEEK_API_KEY),
                },
              ];
          return json(res, 200, {
            models,
            default: { provider: config.modelProvider, id: config.modelId },
          });
        }

        // Projects
        if (method === "GET" && url.pathname === "/api/activity") {
          return json(res, 200, { runs: repositories.listRunRecords().map((run) => ({
            projectId: run.projectId, taskId: run.taskId, id: run.id, name: run.name, status: run.status,
            finishedAt: run.finishedAt, verification: run.verificationStatus,
          })) });
        }
        if (method === "GET" && url.pathname === "/api/projects") {
          return json(res, 200, { projects: repositories.listProjects().map(projectSummary) });
        }
        if (method === "POST" && url.pathname === "/api/projects") {
          const body = await readJson(req);
          const name = requireString(body.name, "name", 120);
          const id = createId("prj");
          const dataDir = path.join(paths.projectsDir, id);
          const project = repositories.createProject({ id, name, description: optionalString(body.description, "description", 1200) ?? "", dataDir });
          ensureProject(project);
          return json(res, 201, { project: projectSummary(project) });
        }

        const projectMatch = url.pathname.match(/^\/api\/projects\/(prj_[0-9a-z]{20})(?:\/(.*))?$/);
        if (!projectMatch) throw new HttpError(404, "API route not found", "NOT_FOUND");
        const project = projectFor(projectMatch[1]!);
        const rest = projectMatch[2] ?? "";

        if (method === "POST" && rest === "objects/open") {
          const body = await readJson(req);
          const task = repositories.listTasks(project.id)[0];
          if (!task) throw new HttpError(404, "项目中没有可打开来源的任务", "NOT_FOUND");
          try {
            const references = resolveReferences(repositories, project, task, [body.reference]);
            return json(res, 200, { reference: references[0] });
          } catch (error) { throw new HttpError(400, error instanceof ReferenceError ? error.message : "来源文件不可用", "INVALID_REFERENCE"); }
        }

        if (method === "GET" && rest === "") return json(res, 200, { project: projectSummary(project) });
        if (method === "PATCH" && rest === "") {
          const body = await readJson(req);
          const updated = repositories.updateProject(project.id, {
            name: optionalString(body.name, "name", 120),
            description: optionalString(body.description, "description", 1200),
          });
          return json(res, 200, { project: projectSummary(updated) });
        }
        if (method === "GET" && rest === "overview") {
          const tasks = repositories.listTasks(project.id);
          return json(res, 200, {
            project: projectSummary(project),
            counts: {
              tasks: tasks.length,
              materials: repositories.listMaterials(project.id).length,
              runs: store.list(project.id).length,
              results: repositories.listResults(project.id).length,
              skills: skills.list(project.id).length,
            },
            tasks: tasks.map(taskSummary),
            latestRuns: store.list(project.id, 5).map((run) => experiments.tailStatus(run)),
          });
        }

        // Tasks
        if (method === "GET" && rest === "tasks") {
          return json(res, 200, { tasks: repositories.listTasks(project.id).map(taskSummary) });
        }
        if (method === "POST" && rest === "tasks") {
          const body = await readJson(req);
          const title = requireString(body.title, "title", 200);
          const objective = requireString(body.objective, "objective", 8000);
          const task = repositories.createTask({
            projectId: project.id,
            title,
            objective,
            reviewText: optionalString(body.reviewText, "reviewText", 20000) ?? null,
          });
          mkdirSync(path.join(project.dataDir, "tasks", task.id), { recursive: true });
          const event = repositories.appendEvent(project.id, task.id, "task_created", {
            title: task.title,
            objective: task.objective,
            reviewText: optionalString(body.reviewText, "reviewText", 20000) ?? null,
          });
          events.publish(event);
          return json(res, 201, { task: taskSummary(task) });
        }
        const taskMatch = rest.match(/^tasks\/(tsk_[0-9a-z]{20})(?:\/(.*))?$/);
        if (taskMatch) {
          const task = taskFor(project, taskMatch[1]!);
          const action = taskMatch[2] ?? "";
          if (method === "GET" && action === "") {
            return json(res, 200, {
              task: taskSummary(task),
              model: modelSelection(task, config),
              sessionFile: task.sessionFile,
              reviewText: repositories.taskReviewText(task.id),
              events: repositories.listEvents(task.id, 0, 5000),
              plans: repositories.listPlans(task.id),
              admissions: repositories.listAdmissions(task.id),
              approvals: repositories.listApprovals(task.id),
            });
          }
          if (method === "GET" && action === "events") {
            const after = Number(url.searchParams.get("after") ?? 0);
            return json(res, 200, { events: repositories.listEvents(task.id, Number.isFinite(after) ? after : 0, 5000) });
          }
          if (method === "GET" && action === "events/stream") {
            const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0);
            res.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
              "X-Accel-Buffering": "no",
            });
            res.write(": scholarflow event stream\n\n");
            const send = (event: { seq: number; type: string; data: unknown; createdAt: string }) => {
              if (event.seq > 0) res.write(`id: ${event.seq}\n`);
              res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
            };
            for (const event of repositories.listEvents(task.id, Number.isFinite(after) ? after : 0, 5000)) send(event);
            const unsubscribe = events.subscribe(task.id, send);
            const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
            heartbeat.unref?.();
            req.on("close", () => {
              clearInterval(heartbeat);
              unsubscribe();
            });
            return;
          }
          if (method === "PUT" && action === "model") {
            if (!agent.switchModel) throw new HttpError(501, "model switching is not available", "NOT_IMPLEMENTED");
            const body = await readJson(req);
            const provider = requireString(body.provider, "provider", 80).trim();
            const modelId = requireString(body.modelId ?? body.id, "modelId", 120).trim();
            try {
              const updated = await agent.switchModel(project, task.id, provider, modelId);
              return json(res, 200, {
                task: taskSummary(updated),
                model: modelSelection(updated, config),
              });
            } catch (error) {
              if (error instanceof AgentBusyError) throw new HttpError(409, error.message, error.code);
              if (error instanceof ModelUnavailableError) throw new HttpError(400, error.message, error.code);
              if (error instanceof AgentConfigurationError) throw new HttpError(400, error.message, error.code);
              throw error;
            }
          }
          if (method === "POST" && action === "messages") {
            const body = await readJson(req);
            const text = requireString(body.text, "text", 40000);
            const clientId = requireString(body.clientId, "clientId", 120);
            if (repositories.hasClientMessage(task.id, clientId)) {
              return json(res, 200, { accepted: false, duplicate: true, latestSeq: repositories.latestEventSeq(task.id) });
            }
            if (agent.isRunning(task.id)) {
              throw new HttpError(409, "this task is answering or switching models; wait for it to become idle", "AGENT_BUSY");
            }
            let references;
            if (Array.isArray(body.references) && body.references.some((reference) => !reference || typeof reference !== "object" || !(reference as Record<string, unknown>).version)) {
              throw new HttpError(400, "请先解析并确认引用版本，再发送消息", "INVALID_REFERENCE");
            }
            try { references = resolveReferences(repositories, project, task, body.references); }
            catch (error) { throw new HttpError(400, error instanceof ReferenceError ? error.message : "引用文件不可用，请重新选择", "INVALID_REFERENCE"); }
            if (!repositories.claimClientMessage(task.id, clientId)) {
              return json(res, 200, { accepted: false, duplicate: true, latestSeq: repositories.latestEventSeq(task.id) });
            }
            if (references.length) {
              const event = repositories.appendEvent(project.id, task.id, "message_context", { clientId, references });
              events.publish(event);
            }
            void agent
              .sendMessage(project, task, text, clientId, references)
              .catch((error) => logger(`agent message failed: ${(error as Error).message}`));
            return json(res, 202, { accepted: true, duplicate: false, latestSeq: repositories.latestEventSeq(task.id) });
          }
          if (method === "POST" && action === "references/resolve") {
            const body = await readJson(req);
            try { return json(res, 200, { references: resolveReferences(repositories, project, task, body.references) }); }
            catch (error) { throw new HttpError(400, error instanceof ReferenceError ? error.message : "引用文件不可用，请重新选择", "INVALID_REFERENCE"); }
          }
          if (method === "POST" && action === "stop") {
            const result = await agent.stop(task.id);
            const event = repositories.appendEvent(project.id, task.id, "agent_status", {
              status: "idle",
              stopped: result.stopped,
              note: "answer stopped; experiments are not cancelled",
            });
            events.publish(event);
            repositories.updateTask(task.id, { status: "idle" });
            return json(res, 200, result);
          }
          if (method === "GET" && action === "context") {
            const manifest = context.build(project, task);
            return json(res, 200, manifest);
          }
        }

        // Materials
        if (method === "GET" && rest === "materials") {
          return json(res, 200, { materials: repositories.listMaterials(project.id) });
        }
        if (method === "GET" && rest === "materials/bibtex") {
          const exported = materials.exportBibtex(project.dataDir, repositories.listMaterials(project.id));
          res.writeHead(200, {
            "Content-Type": "application/x-bibtex; charset=utf-8",
            "Content-Disposition": 'attachment; filename="refs.bib"',
            "Cache-Control": "no-store",
            "X-ScholarFlow-Warnings": exported.warnings.join(" | "),
          });
          res.end(exported.bibtex);
          return;
        }
        if (method === "POST" && rest === "materials") {
          const body = await readJson(req);
          const taskId = optionalString(body.taskId, "taskId");
          if (taskId) taskFor(project, taskId);
          const choices = [body.doi, body.url, body.path].filter(Boolean);
          if (choices.length !== 1) throw new HttpError(400, "provide exactly one of doi, url, or path");
          if (typeof body.doi === "string") {
            const existing = repositories.findMaterialByDoi(project.id, body.doi);
            if (existing) {
              return json(res, 200, {
                material: existing,
                note: existing.note ?? "",
                warnings: ["DOI is already imported in this project; reusing the existing source record."],
                duplicate: true,
              });
            }
          }
          const imported = body.doi
            ? await materials.importDoi(project.id, project.dataDir, taskId ?? null, requireString(body.doi, "doi", 300))
            : body.url
              ? await materials.importUrl(project.id, project.dataDir, taskId ?? null, requireString(body.url, "url", 4000))
              : materials.importPath(project.id, project.dataDir, taskId ?? null, requireString(body.path, "path", 1000));
          repositories.createMaterial(imported.material, imported.note);
          if (taskId) {
            const event = repositories.appendEvent(project.id, taskId, "material_imported", {
              materialId: imported.material.id,
              title: imported.material.title,
              warnings: imported.warnings,
            });
            events.publish(event);
          }
          return json(res, 201, imported);
        }
        if (method === "POST" && rest === "search") {
          const body = await readJson(req);
          const query = requireString(body.query, "query", 500);
          const response = await search.search(query, typeof body.rows === "number" ? body.rows : 8);
          repositories.recordSearch({
            id: createId("srch"),
            projectId: project.id,
            taskId: optionalString(body.taskId, "taskId") ?? null,
            query,
            responseHash: response.responseHash,
            resultCount: response.hits.length,
          });
          return json(res, 200, response);
        }

        // Skills
        if (method === "GET" && rest === "skills") return json(res, 200, { skills: skills.list(project.id) });
        if (method === "POST" && rest === "skills/import") {
          const body = await readJson(req);
          const source = requireString(body.path, "path", 2000);
          const document = skills.importFromPath(project.id, project.dataDir, source);
          return json(res, 201, { skill: document });
        }

        // Plans
        if (method === "GET" && rest === "plans") {
          const taskId = url.searchParams.get("taskId");
          const plans = taskId
            ? repositories.listPlans(taskFor(project, taskId).id)
            : repositories.listTasks(project.id).flatMap((task) => repositories.listPlans(task.id));
          return json(res, 200, { plans });
        }
        if (method === "POST" && rest === "plans") {
          const body = await readJson(req);
          const task = taskFor(project, requireString(body.taskId, "taskId"));
          const plan: ExperimentPlan = {
            id: createId("pln"),
            projectId: project.id,
            taskId: task.id,
            version: repositories.nextPlanVersion(task.id),
            objective: requireString(body.objective, "objective"),
            hypotheses: requireArray(body.hypotheses, "hypotheses").map(String),
            design: requireString(body.design, "design"),
            conditions: (body.conditions ?? {}) as Record<string, string>,
            metrics: requireArray<ExperimentPlan["metrics"][number]>(body.metrics, "metrics"),
            seed: requireArray<number>(body.seed, "seed"),
            budget: body.budget as ExperimentPlan["budget"],
            resources: String(body.resources ?? ""),
            risks: requireArray(body.risks, "risks").map(String),
            skillVersions: skills.list(project.id).map((skill) => ({ name: skill.name, sha256: skill.sha256, version: skill.version })),
            status: "draft",
            confirmedBy: null,
            confirmedAt: null,
            createdAt: new Date().toISOString(),
          };
          if (plan.metrics.length === 0) throw new HttpError(400, "at least one metric is required");
          repositories.createPlan(plan);
          const event = repositories.appendEvent(project.id, task.id, "plan_drafted", { planId: plan.id, version: plan.version });
          events.publish(event);
          return json(res, 201, { plan });
        }
        const planMatch = rest.match(/^plans\/(pln_[0-9a-z]{20})(?:\/(confirm|reject))?$/);
        if (planMatch) {
          const plan = repositories.getPlan(planMatch[1]!);
          if (!plan || plan.projectId !== project.id) throw new HttpError(404, "plan not found");
          if (method === "POST" && planMatch[2] === "confirm") {
            const confirmed = repositories.confirmPlan(plan.id, "user");
            const event = repositories.appendEvent(project.id, plan.taskId, "plan_confirmed", {
              planId: plan.id,
              version: plan.version,
            });
            events.publish(event);
            return json(res, 200, { plan: confirmed });
          }
          if (method === "POST" && planMatch[2] === "reject") {
            const rejected = repositories.rejectPlan(plan.id);
            return json(res, 200, { plan: rejected });
          }
        }

        // Admissions
        if (method === "GET" && rest === "admissions") {
          const taskId = url.searchParams.get("taskId");
          const records = taskId
            ? repositories.listAdmissions(taskFor(project, taskId).id)
            : repositories.listTasks(project.id).flatMap((task) => repositories.listAdmissions(task.id));
          return json(res, 200, { admissions: records });
        }
        if (method === "POST" && rest === "admissions") {
          const body = await readJson(req);
          const task = taskFor(project, requireString(body.taskId, "taskId"));
          const { assessAdmission } = await import("@scholarflow/research");
          const record = assessAdmission(body.input as AdmissionInput, {
            projectId: project.id,
            taskId: task.id,
            id: createId("adm"),
          });
          repositories.createAdmission(record);
          const event = repositories.appendEvent(project.id, task.id, "admission_assessed", {
            admissionId: record.id,
            status: record.status,
            missing: record.missing,
          });
          events.publish(event);
          return json(res, 201, { admission: record });
        }

        // Approvals and runs
        if (method === "POST" && rest === "runs/proposals") {
          const body = await readJson(req);
          const task = taskFor(project, requireString(body.taskId, "taskId"));
          const proposal = experiments.propose(project, task, {
            requestId: optionalString(body.requestId, "requestId", 120),
            name: requireString(body.name, "name", 200),
            kind: body.kind === "target" ? "target" : "smoke",
            description: optionalString(body.description, "description", 2000),
            planId: optionalString(body.planId, "planId"),
            admissionId: optionalString(body.admissionId, "admissionId"),
            program: optionalString(body.program, "program", 2000),
            args: body.args === undefined ? [] : requireArray<string>(body.args, "args").map(String),
            cwd: optionalString(body.cwd, "cwd", 1000),
            env: (body.env ?? {}) as Record<string, string>,
            config: (body.config ?? {}) as Record<string, unknown>,
            data: body.data as { version?: string; split?: string; preprocessing?: string; license?: string } | undefined,
            seed: body.seed === undefined ? undefined : requireArray<number>(body.seed, "seed"),
            metrics: requireArray<MetricSpec>(body.metrics, "metrics"),
            timeoutSeconds: typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : undefined,
            expectedArtifacts: body.expectedArtifacts === undefined ? undefined : requireArray<string>(body.expectedArtifacts, "expectedArtifacts"),
            snapshotFiles: body.snapshotFiles === undefined ? undefined : requireArray<string>(body.snapshotFiles, "snapshotFiles"),
          });
          return json(res, 201, proposal);
        }
        if (method === "GET" && rest === "approvals") {
          const taskId = url.searchParams.get("taskId");
          const approvals = taskId
            ? repositories.listApprovals(taskFor(project, taskId).id)
            : repositories.listTasks(project.id).flatMap((task) => repositories.listApprovals(task.id));
          return json(res, 200, { approvals });
        }
        const approvalMatch = rest.match(/^approvals\/(apr_[0-9a-z]{20})\/(approve|reject)$/);
        if (method === "POST" && approvalMatch) {
          const approval = repositories.getApproval(approvalMatch[1]!);
          if (!approval || approval.projectId !== project.id) throw new HttpError(404, "approval not found");
          const task = taskFor(project, approval.taskId);
          if (approvalMatch[2] === "reject") {
            experiments.reject(task, approval.id);
            return json(res, 200, { rejected: true });
          }
          const result = experiments.approve(project, task, approval.id);
          return json(res, 202, result);
        }
        if (method === "GET" && rest === "runs") {
          const runs = experiments.list(project.id).map((run) => ({
            ...experiments.tailStatus(run),
            requestId: run.requestId,
            createdAt: run.createdAt,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            conditions: run.spec.data,
            seed: run.spec.seed,
          }));
          return json(res, 200, { runs });
        }
        const runMatch = rest.match(/^runs\/(run_[0-9a-z]{20})(?:\/(log|cancel|verify|artifacts|evidence))?$/);
        if (runMatch) {
          const run = runFor(project, runMatch[1]!);
          const action = runMatch[2];
          if (method === "GET" && !action) {
            const task = taskFor(project, run.taskId);
            return json(res, 200, {
              run,
              task: taskSummary(task),
              metrics: repositories.listMetrics([run.id]),
              logTail: experiments.logs(run.id, 200),
            });
          }
          if (method === "GET" && action === "log") {
            const lines = Number(url.searchParams.get("lines") ?? 300);
            return json(res, 200, { log: experiments.logs(run.id, Number.isFinite(lines) ? lines : 300) });
          }
          if (method === "POST" && action === "cancel") {
            const task = taskFor(project, run.taskId);
            const result = await experiments.cancel(project, task, run.id);
            return json(res, 202, result);
          }
          if (method === "POST" && action === "verify") {
            const task = taskFor(project, run.taskId);
            const body = await readJson(req);
            const status = body.status === "verified" ? "verified" : "partial";
            const updated = experiments.verify(project, task, run.id, status, requireString(body.note, "note"), "user");
            return json(res, 200, { run: updated });
          }
          if (method === "GET" && action === "evidence") {
            return json(res, 200, {
              run: experiments.tailStatus(run),
              snapshot: existsSync(run.snapshotPath) ? JSON.parse(readFileSync(run.snapshotPath, "utf8")) : null,
              metrics: repositories.listMetrics([run.id]),
              logTail: experiments.logs(run.id, 80),
            });
          }
        }

        // Results
        if (method === "GET" && rest === "results") {
          return json(res, 200, { results: repositories.listResults(project.id) });
        }
        if (method === "POST" && rest === "results/analyze") {
          const body = await readJson(req);
          const task = taskFor(project, requireString(body.taskId, "taskId"));
          const analyzed = experiments.analyze(project, task, {
            runIds: requireArray<string>(body.runIds, "runIds"),
            title: requireString(body.title, "title", 300),
            metricKeys: body.metricKeys === undefined ? undefined : requireArray<string>(body.metricKeys, "metricKeys"),
            supersedes: optionalString(body.supersedes, "supersedes"),
          });
          return json(res, 201, analyzed);
        }

        // Manuscript
        if (method === "GET" && rest === "manuscript") {
          return json(res, 200, {
            files: manuscript.listFiles(project),
            versions: repositories.listManuscripts(project.id),
            sourceHash: manuscript.sourceHash(project),
            latestBuild: manuscript.latestBuild(project) ?? null,
          });
        }
        if (method === "GET" && rest === "manuscript/file") {
          const file = url.searchParams.get("path");
          if (!file) throw new HttpError(400, "path is required");
          const content = manuscript.readFile(project, file);
          return json(res, 200, { path: file, content, hash: manuscript.listFiles(project).find((item) => item.path === file)?.sha256 });
        }
        const restoreMatch = rest.match(/^manuscript\/versions\/(\d+)\/restore$/);
        if (method === "POST" && restoreMatch) {
          const body = await readJson(req);
          const taskId = optionalString(body.taskId, "taskId") ?? null;
          if (taskId) taskFor(project, taskId);
          const restored = manuscript.restoreVersion(project, taskId, Number(restoreMatch[1]));
          if (taskId) {
            const event = repositories.appendEvent(project.id, taskId, "manuscript_restored", {
              fromVersion: Number(restoreMatch[1]),
              newVersion: restored.version,
              files: restored.files.map((file) => file.path),
            });
            events.publish(event);
          }
          return json(res, 200, { manuscript: restored });
        }
        if (method === "PUT" && rest === "manuscript/file") {
          const body = await readJson(req);
          const taskId = optionalString(body.taskId, "taskId") ?? null;
          if (taskId) taskFor(project, taskId);
          const file = requireString(body.path, "path", 1000);
          if (body.baseHash !== undefined) {
            const current = manuscript.listFiles(project).find((item) => item.path === file)?.sha256 ?? null;
            if (body.baseHash !== current) throw new HttpError(409, "服务端文件已变化，请比较后重新加载；本地草稿已保留。", "SOURCE_CONFLICT");
          }
          const version = manuscript.saveFile(
            project,
            taskId,
            file,
            requireString(body.content, "content", MAX_BODY_BYTES),
          );
          return json(res, 200, { manuscript: version });
        }
        if (method === "POST" && rest === "manuscript/results/sync") {
          const body = await readJson(req);
          const taskId = optionalString(body.taskId, "taskId") ?? null;
          if (taskId) taskFor(project, taskId);
          const synced = manuscript.syncResults(project, taskId);
          if (taskId) {
            const event = repositories.appendEvent(project.id, taskId, "manuscript_results_synced", {
              version: synced.version.version,
              resultIds: synced.resultIds,
              files: synced.files,
              warnings: synced.warnings,
            });
            events.publish(event);
          }
          return json(res, 200, synced);
        }
        if (method === "POST" && rest === "manuscript/build") {
          const body = await readJson(req);
          const taskId = optionalString(body.taskId, "taskId") ?? null;
          if (taskId) taskFor(project, taskId);
          const result = manuscript.build(project, taskId);
          if (taskId) {
            const event = repositories.appendEvent(project.id, taskId, "manuscript_built", {
              ok: result.ok,
              diagnostics: result.diagnostics,
              version: result.version.version,
              versionId: result.version.id,
              pdfPath: result.pdfPath,
            });
            events.publish(event);
          }
          return json(res, result.ok ? 200 : 422, {
            ok: result.ok,
            diagnostics: result.diagnostics,
            version: result.version,
            logExcerpt: result.logExcerpt,
          });
        }
        if (method === "GET" && rest === "manuscript/pdf") {
          const pdf = manuscript.pdfFor(project);
          if (pdf.stale) throw new HttpError(409, "PDF is stale: manuscript sources changed after the last build", "STALE_BUILD");
          res.writeHead(200, {
            "Content-Type": "application/pdf",
            "Content-Length": statSync(pdf.path).size,
            "Content-Disposition": `inline; filename="scholarflow-v${pdf.version.version}.pdf"`,
            "Cache-Control": "no-store",
          });
          createReadStream(pdf.path).pipe(res);
          return;
        }
        if (method === "POST" && rest === "manuscript/export") {
          const exported = await manuscript.exportPackage(project);
          return json(res, 201, { path: exported.path, manifest: exported.manifest });
        }
        if (method === "GET" && rest === "manuscript/download") {
          const bodyPath = url.searchParams.get("path");
          if (!bodyPath) throw new HttpError(400, "path is required");
          const target = resolveInsideRoot(project.dataDir, bodyPath);
          if (!existsSync(target) || !statSync(target).isFile()) throw new HttpError(404, "file not found");
          const extension = path.extname(target).toLowerCase();
          const contentTypes: Record<string, string> = {
            ".pdf": "application/pdf",
            ".zip": "application/zip",
            ".svg": "image/svg+xml",
            ".md": "text/markdown; charset=utf-8",
            ".json": "application/json; charset=utf-8",
            ".tex": "text/plain; charset=utf-8",
            ".txt": "text/plain; charset=utf-8",
          };
          res.writeHead(200, {
            "Content-Type": contentTypes[extension] ?? "application/octet-stream",
            "Content-Length": statSync(target).size,
            "Content-Disposition": `attachment; filename="${path.basename(target)}"`,
            "Cache-Control": "no-store",
          });
          createReadStream(target).pipe(res);
          return;
        }

        // Material files
        const materialMatch = rest.match(/^materials\/(mat_[0-9a-z]{20})\/file$/);
        if (method === "GET" && materialMatch) {
          const material = repositories.findMaterial(project.id, materialMatch[1]!);
          if (!material) throw new HttpError(404, "material not found");
          const target = resolveInsideRoot(project.dataDir, material.path);
          res.writeHead(200, {
            "Content-Type": material.mediaType,
            "Content-Length": statSync(target).size,
            "Content-Disposition": `inline; filename="${path.basename(target)}"`,
            "Cache-Control": "no-store",
          });
          createReadStream(target).pipe(res);
          return;
        }

        throw new HttpError(404, "API route not found", "NOT_FOUND");
      }

      // Static web app
      if (!existsSync(webDist)) {
        res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("ScholarFlow Web UI is not built. Run `npm run build`, or use `npm run dev:web` for development.");
        return;
      }
      const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
      let target = path.resolve(webDist, requested);
      if (!target.startsWith(path.resolve(webDist))) {
        res.writeHead(400).end("invalid path");
        return;
      }
      if (!existsSync(target) || !statSync(target).isFile()) target = path.join(webDist, "index.html");
      const extension = path.extname(target).toLowerCase();
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
        ".json": "application/json",
      };
      res.writeHead(200, {
        "Content-Type": types[extension] ?? "application/octet-stream",
        "Content-Length": statSync(target).size,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      createReadStream(target).pipe(res);
    } catch (error) {
      const mapped = mapError(error);
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, mapped.status, mapped.body);
    }
  });

  const close = async () => {
    await agent.dispose();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    // Event streams are long-lived; graceful shutdown must release them rather
    // than waiting forever for a browser to close its SSE connection.
    server.closeAllConnections();
    await closed;
    db.close();
  };

  return {
    server,
    config,
    close,
    worker,
    agent,
    services: { repositories, experiments, manuscript, skills, materials, context, events, store },
  };
}

function projectSummary(project: ProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    dataDir: project.dataDir,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function taskSummary(task: TaskRecord) {
  return {
    id: task.id,
    projectId: task.projectId,
    title: task.title,
    objective: task.objective,
    status: task.status,
    contextVersion: task.contextVersion,
    modelProvider: task.modelProvider ?? null,
    modelId: task.modelId ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function modelSelection(task: TaskRecord, config: AppConfig) {
  const inherited = !task.modelProvider || !task.modelId;
  return {
    provider: task.modelProvider || config.modelProvider,
    id: task.modelId || config.modelId,
    name: task.modelId || config.modelId,
    inherited,
  };
}

async function isAgentConfigured(agent: AgentServiceLike, config: AppConfig): Promise<boolean> {
  if (!config.deepseekApiKey && !process.env.DEEPSEEK_API_KEY) return false;
  return agent instanceof PiAgentService;
}
