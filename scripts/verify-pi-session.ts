/**
 * M0 / V01 software check. This does not call a model. It proves the locked
 * package can be imported, discover the project skills, create a persistent
 * session, and reopen it through the public SDK.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";

const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const packageRoot = path.resolve(path.dirname(entry), "..");
const metadata = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
  license: string;
};

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(tmpdir(), "scholarflow-pi-verify-"));
const skills = [
  path.join(root, "resources", "skills", "literature-review"),
  path.join(root, "resources", "skills", "reproduction-admission"),
  path.join(root, "resources", "skills", "experiment-design"),
  path.join(root, "resources", "skills", "result-analysis"),
  path.join(root, "resources", "skills", "latex-writing"),
];

try {
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: path.join(temp, "agent"),
    additionalSkillPaths: skills,
    noExtensions: true,
    noContextFiles: true,
  });
  await loader.reload();
  const discovered = loader.getSkills();
  const names = discovered.skills.map((skill) => skill.name).sort();
  for (const required of ["experiment-design", "latex-writing", "literature-review", "result-analysis", "reproduction-admission"]) {
    if (!names.includes(required)) throw new Error(`skill not discovered: ${required}`);
  }

  const sessionDir = path.join(temp, "sessions");
  const manager = SessionManager.create(path.join(temp, "workspace"), sessionDir);
  const created = await createAgentSession({
    cwd: path.join(temp, "workspace"),
    agentDir: path.join(temp, "agent"),
    sessionManager: manager,
    resourceLoader: loader,
    tools: ["read"],
  });
  const toolNames = created.session.getActiveToolNames();
  created.session.dispose();

  const file = created.session.sessionFile;
  if (!file) throw new Error("Pi did not persist a session file");
  const reopenedManager = SessionManager.open(file);
  const reopened = await createAgentSession({
    cwd: path.join(temp, "workspace"),
    agentDir: path.join(temp, "agent"),
    sessionManager: reopenedManager,
    resourceLoader: loader,
    tools: ["read"],
  });
  const reopenedId = reopened.session.sessionId;
  reopened.session.dispose();

  console.log(JSON.stringify({
    sdkVersion: VERSION,
    packageVersion: metadata.version,
    license: metadata.license,
    persistentSession: true,
    reopenedSessionId: reopenedId,
    skills: names,
    tools: toolNames,
    realModelCall: process.env.DEEPSEEK_API_KEY ? "available (not executed by this check)" : "blocked: no DeepSeek API key",
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
