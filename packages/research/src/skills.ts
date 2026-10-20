import { createHash } from "node:crypto";

export interface SkillDocument {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  version?: string;
  requires: string[];
  source?: string;
  body: string;
  sha256: string;
  filePath: string;
}

export interface SkillValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Minimal, strict parser for the Agent Skills frontmatter used by Pi. */
export function parseSkillMarkdown(
  markdown: string,
  filePath: string,
): { document: SkillDocument | null; validation: SkillValidation } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return {
      document: null,
      validation: { ok: false, errors: ["SKILL.md must start with YAML frontmatter"], warnings },
    };
  }
  const end = normalized.indexOf("\n---", 4);
  if (end < 0) {
    return {
      document: null,
      validation: { ok: false, errors: ["SKILL.md frontmatter is not closed"], warnings },
    };
  }
  const frontmatter = normalized.slice(4, end).split("\n");
  const body = normalized.slice(end + 4).replace(/^\n+/, "").trim();
  const fields: Record<string, string> = {};
  for (const line of frontmatter) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      errors.push(`invalid frontmatter line: ${line}`);
      continue;
    }
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = value;
  }
  const name = unquote(fields.name ?? "");
  const description = unquote(fields.description ?? "");
  const metadataRaw = fields.metadata;
  let metadata: Record<string, unknown> = {};
  if (metadataRaw) {
    try {
      const parsed: unknown = JSON.parse(metadataRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Record<string, unknown>;
      } else {
        warnings.push("metadata must be an object");
      }
    } catch {
      warnings.push("metadata is not valid JSON; version/dependencies cannot be recorded");
    }
  }
  const requiresRaw = metadata.requires;
  const requires = Array.isArray(requiresRaw)
    ? requiresRaw.filter((item): item is string => typeof item === "string")
    : [];
  const sha256 = createHash("sha256").update(normalized).digest("hex");

  const document: SkillDocument = {
    name,
    description,
    license: fields.license ? unquote(fields.license) : undefined,
    compatibility: fields.compatibility ? unquote(fields.compatibility) : undefined,
    version: typeof metadata.version === "string" ? metadata.version : undefined,
    requires,
    source: typeof metadata.source === "string" ? metadata.source : undefined,
    body,
    sha256,
    filePath,
  };

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) {
    errors.push("skill name must be lowercase letters, numbers, and single hyphens (max 64 chars)");
  }
  if (description.length === 0) errors.push("skill description is required");
  if (description.length > 1024) errors.push("skill description exceeds 1024 characters");
  if (body.length === 0) errors.push("skill body is empty");
  if (!document.license) warnings.push("skill license is not recorded");
  if (!document.version) warnings.push("skill version is not recorded");
  if (/\b(curl|wget)\s+[^\n]*\|\s*(sh|bash)/i.test(body)) {
    warnings.push("skill body pipes a download into a shell; requires explicit review");
  }
  if (/ignore\s+(?:all\s+)?(?:previous\s+|prior\s+)?instructions/i.test(body)) {
    errors.push("skill body contains an instruction-override pattern and is rejected");
  }

  return { document: errors.length === 0 ? document : null, validation: { ok: errors.length === 0, errors, warnings } };
}

export function checkSkillDependencies(
  requires: string[],
  available: (name: string) => boolean,
): string[] {
  return requires.filter((name) => !available(name));
}

export function skillManifestEntry(document: SkillDocument, sourcePath: string, importedAt = new Date().toISOString()) {
  return {
    name: document.name,
    version: document.version ?? "unversioned",
    license: document.license ?? "unknown",
    sha256: document.sha256,
    source: sourcePath,
    requires: document.requires,
    importedAt,
  };
}
