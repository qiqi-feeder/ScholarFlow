import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface AppConfig {
  configFile: string;
  dataDir: string;
  host: string;
  port: number;
  deepseekApiKey: string;
  modelId: string;
  searchEmail: string;
  latexmkPath: string;
  pdflatexPath: string;
  defaultInterpreter: string;
  defaultTimeoutSeconds: number;
  maxTargetRunsPerTask: number;
  workerEnabled: boolean;
  workerPollMs: number;
}

export interface ConfigPaths {
  configDir: string;
  configFile: string;
  dataDir: string;
  databaseFile: string;
  projectsDir: string;
  piAgentDir: string;
}

export interface LoadConfigOptions {
  configFile?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  modelId: "deepseek-flash",
  defaultTimeoutSeconds: 1800,
  maxTargetRunsPerTask: 2,
  workerEnabled: true,
  workerPollMs: 750,
};

export function pathsFor(config: AppConfig): ConfigPaths {
  return {
    configDir: path.dirname(config.configFile),
    configFile: config.configFile,
    dataDir: config.dataDir,
    databaseFile: path.join(config.dataDir, "scholarflow.sqlite"),
    projectsDir: path.join(config.dataDir, "projects"),
    piAgentDir: path.join(path.dirname(config.configFile), "pi-agent"),
  };
}

export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const configFile =
    options.configFile ?? env.SCHOLARFLOW_CONFIG ?? path.join(home, ".scholarflow", "config.json");
  let stored: Partial<AppConfig> = {};
  if (existsSync(configFile)) {
    try {
      stored = JSON.parse(readFileSync(configFile, "utf8")) as Partial<AppConfig>;
    } catch (error) {
      throw new Error(`invalid config file ${configFile}: ${(error as Error).message}`);
    }
  }
  const dataDir =
    options.dataDir ??
    env.SCHOLARFLOW_DATA_DIR ??
    stored.dataDir ??
    path.join(home, "ScholarFlowData");
  const config: AppConfig = {
    configFile,
    dataDir: path.resolve(dataDir),
    host: env.SCHOLARFLOW_HOST ?? stored.host ?? DEFAULTS.host,
    port: Number(env.SCHOLARFLOW_PORT ?? stored.port ?? DEFAULTS.port),
    deepseekApiKey: env.DEEPSEEK_API_KEY ?? stored.deepseekApiKey ?? "",
    modelId: env.SCHOLARFLOW_MODEL ?? stored.modelId ?? DEFAULTS.modelId,
    searchEmail: env.SCHOLARFLOW_SEARCH_EMAIL ?? stored.searchEmail ?? "",
    latexmkPath: stored.latexmkPath ?? "latexmk",
    pdflatexPath: stored.pdflatexPath ?? "pdflatex",
    defaultInterpreter: stored.defaultInterpreter ?? "",
    defaultTimeoutSeconds: Number(stored.defaultTimeoutSeconds ?? DEFAULTS.defaultTimeoutSeconds),
    maxTargetRunsPerTask: Number(stored.maxTargetRunsPerTask ?? DEFAULTS.maxTargetRunsPerTask),
    workerEnabled: env.SCHOLARFLOW_DISABLE_WORKER === "1" ? false : (stored.workerEnabled ?? DEFAULTS.workerEnabled),
    workerPollMs: Number(env.SCHOLARFLOW_WORKER_POLL_MS ?? stored.workerPollMs ?? DEFAULTS.workerPollMs),
  };
  if (!["127.0.0.1", "localhost", "::1"].includes(config.host)) {
    throw new Error(
      `refusing to bind to ${config.host}; ScholarFlow is single-user local software and defaults to loopback`,
    );
  }
  return config;
}

export function saveConfig(config: AppConfig, updates: Partial<AppConfig>): AppConfig {
  const next: AppConfig = { ...config, ...updates, configFile: config.configFile, dataDir: config.dataDir };
  mkdirSync(path.dirname(config.configFile), { recursive: true });
  writeFileSync(config.configFile, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return next;
}

export function ensureDirectories(config: AppConfig): ConfigPaths {
  const paths = pathsFor(config);
  for (const directory of [config.dataDir, paths.projectsDir, paths.piAgentDir, path.dirname(paths.configFile)]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}

export function publicSettings(config: AppConfig) {
  return {
    dataDir: config.dataDir,
    host: config.host,
    port: config.port,
    model: {
      provider: "deepseek",
      id: config.modelId,
      configured: Boolean(config.deepseekApiKey),
    },
    search: { channel: "crossref", contactEmail: config.searchEmail },
    latex: { latexmk: config.latexmkPath, pdflatex: config.pdflatexPath },
    experiment: {
      defaultInterpreter: config.defaultInterpreter,
      defaultTimeoutSeconds: config.defaultTimeoutSeconds,
      maxTargetRunsPerTask: config.maxTargetRunsPerTask,
      workerEnabled: config.workerEnabled,
    },
  };
}
