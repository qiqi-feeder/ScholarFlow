import { spawn } from "node:child_process";
import path from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await createApp({ config });
const repositoryRoot = path.resolve(import.meta.dirname, "..", "..", "..");
let workerChild: ReturnType<typeof spawn> | null = null;

if (config.workerEnabled) {
  workerChild = spawn(
    process.execPath,
    ["--import", "tsx", path.join(repositoryRoot, "packages", "experiment-worker", "src", "main.ts")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        SCHOLARFLOW_DB: path.join(config.dataDir, "scholarflow.sqlite"),
        SCHOLARFLOW_WORKER_POLL_MS: String(config.workerPollMs),
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  workerChild.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`[server] experiment worker exited with code ${code}`);
  });
}

const server = app.server;
server.listen(config.port, config.host, () => {
  console.log(`ScholarFlow listening on http://${config.host}:${config.port}`);
  console.log(`Data: ${config.dataDir}`);
  console.log(`Config: ${config.configFile}`);
  console.log(
    `Agent: ${config.deepseekApiKey || process.env.DEEPSEEK_API_KEY ? "DeepSeek configured" : "DeepSeek key missing (chat will report a configuration error)"}`,
  );
});

const shutdown = async () => {
  console.log("[server] shutting down; running experiments are owned by the worker, not this HTTP server");
  await app.close();
  // The worker is intentionally left running so an experiment's lifecycle does
  // not depend on an open browser or an HTTP process. Stop it explicitly when
  // doing maintenance.
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
