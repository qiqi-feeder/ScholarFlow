import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createId,
  resolveInsideRoot,
  sha256,
  type MaterialKind,
  type MaterialRecord,
} from "@scholarflow/research";
import type { CrossrefSearch, SearchHit } from "./search.js";

const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;

export interface ImportedMaterial {
  material: MaterialRecord;
  note: string;
  warnings: string[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function extractPdf(bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(bytes);
    const text = (Array.isArray(result.text) ? result.text.join("\n") : String(result.text)).trim();
    if (!text) {
      return {
        text: "",
        warnings: ["PDF contains no extractable text; it may be scanned. Import a readable copy or OCR it outside ScholarFlow."],
      };
    }
    return { text, warnings: [] };
  } catch (error) {
    return { text: "", warnings: [`PDF text extraction failed: ${(error as Error).message}`] };
  }
}

function truncateNote(value: string, max = 6000): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

export interface MaterialServiceOptions {
  crossref: CrossrefSearch;
  fetchImpl?: typeof fetch;
}

export class MaterialService {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly options: MaterialServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private materialsDir(projectRoot: string): string {
    const directory = path.join(projectRoot, "materials");
    mkdirSync(directory, { recursive: true });
    return directory;
  }

  private makeRecord(input: {
    projectId: string;
    taskId: string | null;
    kind: MaterialKind;
    title: string;
    relativePath: string;
    mediaType: string;
    bytes: Buffer;
    source: MaterialRecord["source"];
    now?: Date;
  }): MaterialRecord {
    return {
      id: createId("mat", (input.now ?? new Date()).getTime()),
      projectId: input.projectId,
      taskId: input.taskId,
      kind: input.kind,
      title: input.title,
      path: input.relativePath,
      mediaType: input.mediaType,
      sha256: sha256(input.bytes),
      bytes: input.bytes.length,
      source: input.source,
      createdAt: (input.now ?? new Date()).toISOString(),
    };
  }

  async importDoi(projectId: string, projectRoot: string, taskId: string | null, doi: string): Promise<ImportedMaterial> {
    const hit = await this.options.crossref.fetchDoi(doi);
    const now = new Date();
    const id = createId("mat", now.getTime());
    const raw = JSON.stringify(hit.raw, null, 2);
    const bytes = Buffer.from(raw, "utf8");
    const relativePath = `materials/${id}.crossref.json`;
    writeFileSync(path.join(projectRoot, relativePath), bytes);
    this.materialsDir(projectRoot);
    const material = this.makeRecord({
      projectId,
      taskId,
      kind: "paper",
      title: hit.title,
      relativePath,
      mediaType: "application/json",
      bytes,
      source: {
        channel: "crossref",
        url: hit.url,
        doi: hit.doi,
        retrievedAt: hit.retrievedAt,
        license: hit.license,
        version: hit.year ? String(hit.year) : undefined,
        rawHash: sha256(raw),
      },
      now,
    });
    material.id = id;
    return {
      material,
      note: truncateNote(hit.abstract ?? `${hit.title}. ${hit.authors.join(", ")} (${hit.year ?? "year unknown"}), ${hit.container ?? "venue unknown"}.`),
      warnings: hit.license ? [] : ["source license is unknown; verify reuse terms"],
    };
  }

  async importUrl(projectId: string, projectRoot: string, taskId: string | null, url: string): Promise<ImportedMaterial> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("material URL is invalid");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("only http/https material URLs are supported");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    timer.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(parsed.toString(), {
        signal: controller.signal,
        headers: { "User-Agent": "ScholarFlow/0.1 local research workspace" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`material download failed: HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > MAX_MATERIAL_BYTES) throw new Error("material exceeds the 25 MiB import limit");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_MATERIAL_BYTES) throw new Error("material exceeds the 25 MiB import limit");
    const contentType = (response.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
    const now = new Date();
    const id = createId("mat", now.getTime());
    let extension = "bin";
    let mediaType = contentType;
    let note = "";
    const warnings: string[] = [];
    if (contentType.includes("pdf") || parsed.pathname.toLowerCase().endsWith(".pdf")) {
      extension = "pdf";
      mediaType = "application/pdf";
      const extracted = await extractPdf(new Uint8Array(bytes));
      note = truncateNote(extracted.text);
      warnings.push(...extracted.warnings);
    } else if (contentType.includes("html") || parsed.pathname.toLowerCase().endsWith(".html")) {
      extension = "html";
      mediaType = "text/html";
      note = truncateNote(htmlToText(bytes.toString("utf8")));
    } else if (contentType.includes("json")) {
      extension = "json";
      note = truncateNote(bytes.toString("utf8"));
    } else {
      extension = "txt";
      mediaType = "text/plain";
      note = truncateNote(bytes.toString("utf8"));
    }
    const relativePath = `materials/${id}.${extension}`;
    writeFileSync(path.join(projectRoot, relativePath), bytes);
    const material = this.makeRecord({
      projectId,
      taskId,
      kind: "paper",
      title: path.basename(parsed.pathname) || parsed.hostname,
      relativePath,
      mediaType,
      bytes,
      source: {
        channel: "url",
        url: parsed.toString(),
        retrievedAt: now.toISOString(),
        rawHash: sha256(bytes),
        version: undefined,
      },
      now,
    });
    material.id = id;
    return { material, note, warnings };
  }

  importPath(projectId: string, projectRoot: string, taskId: string | null, relativePath: string): ImportedMaterial {
    const source = resolveInsideRoot(projectRoot, relativePath);
    if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`material file not found: ${relativePath}`);
    if (statSync(source).size > MAX_MATERIAL_BYTES) throw new Error("material exceeds the 25 MiB import limit");
    const bytes = readFileSync(source);
    const now = new Date();
    const id = createId("mat", now.getTime());
    const extension = path.extname(source).replace(/^\./, "").toLowerCase() || "txt";
    const target = `materials/${id}.${extension}`;
    copyFileSync(source, path.join(projectRoot, target));
    let note = "";
    const warnings: string[] = [];
    if (extension === "pdf") {
      // PDF extraction is async; this method remains synchronous for local copies.
      warnings.push("PDF imported; text extraction runs through importUrl or the material note must be supplied manually");
    } else {
      note = truncateNote(bytes.toString("utf8"));
    }
    const material = this.makeRecord({
      projectId,
      taskId,
      kind: "note",
      title: path.basename(source),
      relativePath: target,
      mediaType: extension === "pdf" ? "application/pdf" : "text/plain",
      bytes,
      source: {
        channel: "manual",
        url: `project:${relativePath}`,
        retrievedAt: now.toISOString(),
        rawHash: sha256(bytes),
      },
      now,
    });
    material.id = id;
    return { material, note, warnings };
  }

  saveHit(projectId: string, projectRoot: string, taskId: string | null, hit: SearchHit): ImportedMaterial {
    const now = new Date();
    const id = createId("mat", now.getTime());
    const raw = JSON.stringify(hit.raw, null, 2);
    const bytes = Buffer.from(raw, "utf8");
    const relativePath = `materials/${id}.crossref.json`;
    this.materialsDir(projectRoot);
    writeFileSync(path.join(projectRoot, relativePath), bytes);
    const material = this.makeRecord({
      projectId,
      taskId,
      kind: "paper",
      title: hit.title,
      relativePath,
      mediaType: "application/json",
      bytes,
      source: {
        channel: "crossref",
        url: hit.url,
        doi: hit.doi,
        retrievedAt: hit.retrievedAt,
        license: hit.license,
        rawHash: sha256(raw),
      },
      now,
    });
    material.id = id;
    return {
      material,
      note: truncateNote(hit.abstract ?? hit.title),
      warnings: hit.license ? [] : ["source license is unknown; verify reuse terms"],
    };
  }
}
