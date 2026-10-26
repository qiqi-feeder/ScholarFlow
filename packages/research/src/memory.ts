import { canonicalJson } from "./snapshot.js";
export type MemoryKind = "confirmed_decision" | "paper_claim" | "tool_observation" | "hypothesis" | "experience";
export type MemoryStatus = "candidate" | "active" | "disputed" | "withdrawn" | "superseded";
export interface MemorySource { projectId: string; taskId: string; kind: string; id: string; version: string; role: string }
export interface MemoryRecord {
  id: string; ownerId: string; scope: "project" | "task"; scopeId: string;
  sourceProjectId: string; sourceTaskId: string; sourceEventSeq: number;
  kind: MemoryKind; subject: string; predicate: string; value: unknown; conditions: Record<string, string>;
  sourceRefs: MemorySource[]; authority: { role: string; identity: string };
  status: MemoryStatus; revision: number; validFrom?: string; validTo?: string; recordedAt: string;
  supersedes: string[]; conflictsWith: string[];
}
export interface MemoryChange {
  id: string; memoryId: string; expectedRevision: number; previousVersion: MemoryRecord | null; newVersion: MemoryRecord;
  action: string; reason: string; actor: string; evidenceRefs: MemorySource[]; recordedAt: string;
}
export interface RecallSnapshot {
  id: string; destinationProjectId: string; destinationTaskId: string; query: string; asOf?: string; knownAt?: string;
  selectedMemoryVersions: Array<{ id: string; revision: number }>; exclusions: string[]; budgetEstimate: number;
}
export function sameMemoryFact(a: MemoryRecord, b: MemoryRecord) {
  return a.scope === b.scope && a.scopeId === b.scopeId && a.subject === b.subject && a.predicate === b.predicate && canonicalJson(a.conditions) === canonicalJson(b.conditions);
}
export function overlappingFacts(a: MemoryRecord, b: MemoryRecord) {
  return (!a.validTo || !b.validFrom || a.validTo > b.validFrom) && (!b.validTo || !a.validFrom || b.validTo > a.validFrom);
}
export function memoryRelation(a: MemoryRecord, b: MemoryRecord): "independent" | "same" | "candidate" | "conflict" {
  if (!sameMemoryFact(a, b) || !overlappingFacts(a, b) || ["withdrawn", "superseded"].includes(a.status) || ["withdrawn", "superseded"].includes(b.status)) return "independent";
  if (a.status === "candidate" || b.status === "candidate") return "candidate";
  return canonicalJson(a.value) === canonicalJson(b.value) ? "same" : "conflict";
}
