import type { MemorySource } from "./memory.js";
export interface MethodVersion {
  name: string; hash: string; version: string; content: string; license: string; sourcePath: string; requires: string[];
  toolDescriptions: Record<string, string>;
}
export interface ExperienceRecord {
  id: string; projectId: string; sourceTaskId: string; cue: string; lesson: string;
  applicableConditions: Record<string, string>; evidenceRefs: MemorySource[];
  sourceMemoryVersions: Array<{ id: string; revision: number }>; methodVersions: Array<{ name: string; hash: string }>;
  status: "candidate" | "validated" | "rejected"; reviewReason?: string; recordedAt: string;
}
export interface EvolutionCandidate {
  id: string; projectId: string; taskId: string; skillId: string; baselineVersion: string; candidateVersion: string;
  diff: string; sourceExperienceIds: string[]; editableSurface: "skill-body" | "tool-description";
  status: "candidate" | "evaluated" | "validated" | "published" | "rejected";
  budget: { maxAttempts: number; maxRequests: number; maxOutputTokens: number; maxMinutes: number };
  budgetUsed: { attempts: number; requests: number; outputTokens: number; elapsedMs: number; price: "unknown" };
  developmentEvaluationRef?: string; holdoutEvaluationRef?: string; rejectionReasons: string[]; createdAt: string;
}
export function validateEditableMethod(body: unknown, toolDescriptions: unknown, allowedTools: string[]) {
  if (body !== undefined && (typeof body !== "string" || !body.trim() || body.length > 18000 || body.trimStart().startsWith("---"))) throw new Error("only Skill body text may change; frontmatter, scripts and dependencies are protected");
  if (toolDescriptions !== undefined && (!toolDescriptions || typeof toolDescriptions !== "object" || Array.isArray(toolDescriptions) || Object.entries(toolDescriptions).some(([name, text]) => !allowedTools.includes(name) || typeof text !== "string" || !text.trim() || text.length > 1500))) throw new Error("only descriptions of this method's approved tools may change");
  const text = `${body ?? ""}\n${JSON.stringify(toolDescriptions ?? {})}`;
  if (/bypass|ignore (?:host|approval|budget)|skip (?:approval|validation)|disable (?:approval|validator)|绕过|忽略审批|关闭验证/i.test(text)) throw new Error("host approval, budget and validators cannot evolve");
}
