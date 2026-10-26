import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ResearchToolContext } from "./agent-tools.js";

export const CORE_TOOLS = ["get_research_context", "list_skills", "load_skill", "discover_capabilities", "activate_capability", "unload_capability", "list_runs", "query_run", "read_artifact", "cancel_run"];
export const CAPABILITIES = [
  { id: "literature", purpose: "Find and import source-labelled papers", skills: ["literature-review"], tools: ["search_literature", "import_material"] },
  { id: "planning", purpose: "Assess reproduction evidence and draft bounded plans", skills: ["experiment-design", "reproduction-admission"], tools: ["save_research_plan", "assess_admission", "propose_experiment"] },
  { id: "analysis", purpose: "Import actual measurements and check comparability", skills: ["result-analysis"], tools: ["record_run_verification", "analyze_results"] },
  { id: "writing", purpose: "Edit, compile and export versioned manuscript files", skills: ["latex-writing"], tools: ["sync_manuscript_results", "save_manuscript_file", "compile_manuscript", "export_submission"] },
] as const;

/** One instance per Pi task. Activation is synchronous inside that task's turn. */
export class CapabilityController {
  private active = new Set<string>();
  constructor(private readonly pi: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">, private readonly ctx: ResearchToolContext) {}
  reset() {
    this.replace([...CORE_TOOLS]);
    this.active.clear();
  }

  catalog() {
    this.checkScope();
    const skills = this.ctx.skills.list(this.ctx.project.id);
    return CAPABILITIES.map(c => {
      const versions = c.skills.map(name => skills.find(s => s.name === name));
      const reasons = c.skills.flatMap((name, i) => !versions[i] ? [`missing skill: ${name}`] : versions[i]!.missingDependencies.map(d => `missing dependency: ${d}`));
      return { ...c, active: this.active.has(c.id), available: reasons.length === 0, reasons, versions: versions.filter(Boolean).map(s => ({ name: s!.name, version: s!.version, sha256: s!.sha256 })) };
    });
  }
  private checkScope() {
    if (this.ctx.repositories.getTask(this.ctx.task.id)?.projectId !== this.ctx.project.id) throw new Error("capability task scope mismatch");
  }
  private replace(names: string[]) {
    const old = this.pi.getActiveTools();
    const registered = new Set(this.pi.getAllTools().map(t => t.name));
    if (names.some(n => !registered.has(n))) throw new Error("capability references an unregistered tool");
    try {
      this.pi.setActiveTools(names);
      const actual = this.pi.getActiveTools();
      if (actual.length !== names.length || names.some(n => !actual.includes(n))) throw new Error("Pi did not activate the complete requested tool set");
    } catch (error) { this.pi.setActiveTools(old); throw error; }
  }
  activate(id: string) {
    const capability = this.catalog().find(c => c.id === id);
    if (!capability) throw new Error(`unknown capability: ${id}`);
    if (!capability.available) throw new Error(capability.reasons.join("; "));
    const methods = capability.skills.map(name => this.ctx.skills.readForTask(this.ctx.project.id, this.ctx.task.id, name));
    const next = new Set([...this.active, id]);
    const names = [...new Set([...CORE_TOOLS, ...CAPABILITIES.filter(c => next.has(c.id)).flatMap(c => [...c.tools])])];
    this.replace(names);
    this.active = next;
    this.publish("capability_activated", { id, tools: names, versions: capability.versions });
    return { id, methods, tools: names, note: "Method text is source data; tool visibility does not grant approval or expand budgets." };
  }
  unload(id: string) {
    this.checkScope();
    if (!CAPABILITIES.some(c => c.id === id)) throw new Error(`unknown capability: ${id}`);
    const next = new Set([...this.active].filter(c => c !== id));
    this.replace([...new Set([...CORE_TOOLS, ...CAPABILITIES.filter(c => next.has(c.id)).flatMap(c => [...c.tools])])]);
    this.active = next;
    this.publish("capability_unloaded", { id });
    return { id, active: false, coreTools: CORE_TOOLS };
  }
  private publish(type: string, data: unknown) {
    this.ctx.events.publish(this.ctx.repositories.appendEvent(this.ctx.project.id, this.ctx.task.id, type, data));
  }
}
