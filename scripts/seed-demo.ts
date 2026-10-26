import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInsideRoot, sha256 } from "@scholarflow/research";
import { loadConfig } from "../apps/server/src/config.js";

export const DEMO_PROJECT = "ScholarFlow · First research workspace";
export const DEMO_TASK = "Read a source, keep the evidence";
export const DEMO_SOURCE = "workspace/first-source.txt";
const fixture = path.resolve(import.meta.dirname, "../examples/first-source.txt");

/** The starter only imports a source. Sending messages and approving runs stay explicit. */
export async function seedDemo(base: string, dataRoot: string) {
  const url = new URL(base);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/") throw new Error("starter requires the local ScholarFlow server URL");
  const request = async (route: string, body?: unknown): Promise<any> => {
    const response = await fetch(new URL(route, url), { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const result = await response.json() as any;
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  };
  const { projects } = await request("/api/projects");
  const project = projects.find((p: any) => p.name === DEMO_PROJECT) ?? (await request("/api/projects", { name: DEMO_PROJECT, description: "An included software walkthrough. No scientific claims or automatic experiments." })).project;
  // The HTTP response never grants access to a directory outside the configured data root.
  const projectsRoot = path.resolve(dataRoot, "projects");
  if (!existsSync(projectsRoot)) throw new Error("configured data root does not match the running server");
  const projectRoot = resolveInsideRoot(projectsRoot, path.relative(projectsRoot, project.dataDir));
  const workspace = resolveInsideRoot(projectRoot, "workspace"); mkdirSync(workspace, { recursive: true });
  const target = resolveInsideRoot(projectRoot, DEMO_SOURCE);
  const hash = sha256(readFileSync(fixture));
  if (existsSync(target) && sha256(readFileSync(target)) !== hash) throw new Error("starter source has local edits; keep them or choose a new starter project before retrying");
  if (!existsSync(target)) copyFileSync(fixture, target, constants.COPYFILE_EXCL);
  const { tasks } = await request(`/api/projects/${project.id}/tasks`);
  const task = tasks.find((t: any) => t.title === DEMO_TASK) ?? (await request(`/api/projects/${project.id}/tasks`, { title: DEMO_TASK, objective: "Read workspace/first-source.txt, retain its witness and source. This is a software check only. Do not start experiments or publish methods." })).task;
  const { materials } = await request(`/api/projects/${project.id}/materials`);
  const material = materials.find((m: any) => m.taskId === task.id && m.sha256 === hash) ?? (await request(`/api/projects/${project.id}/materials`, { taskId: task.id, path: DEMO_SOURCE })).material;
  return { project, task, material, sourcePath: DEMO_SOURCE, expectedWitness: "SCHOLARFLOW_SOURCE_CHECK" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  try {
    const result = await seedDemo(`http://${config.host === "::1" ? "[::1]" : config.host}:${config.port}/`, config.dataDir);
    console.log(`Starter ready: ${result.project.name}\nTask: ${result.task.title}\nSource: ${result.sourcePath}\nOpen the workspace, select this project and task, and send the first-run prompt from README. No model calls or experiments were started.`);
  } catch (error) {
    console.error(`Could not prepare the starter: ${(error as Error).message}\nStart ScholarFlow with npm start first. Use the same SCHOLARFLOW_CONFIG and SCHOLARFLOW_DATA_DIR in both terminals.`);
    process.exitCode = 1;
  }
}
