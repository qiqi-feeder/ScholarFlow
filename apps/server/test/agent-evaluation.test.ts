import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { assertPairedConditions, boundModelInput, estimateTokens, type ComparisonConditions } from "@scholarflow/research";
import { CORE_TOOLS } from "../src/capabilities.js";
import { toolNames } from "../src/agent-tools.js";

test("RT15 fixed paired software mechanism cards and one-factor ablations reject unfair comparisons", () => {
  const conditions: ComparisonConditions = { model: { provider: "deepseek", id: "deepseek-flash" }, permissionProfile: "same-project read-only; no target execution", inputBudget: 24000, outputBudget: 1024, fixtureVersion: "IG00-fixed-software-cards-v1", repetitions: 1 };
  for (const mismatch of [{ ...conditions, model: { ...conditions.model, id: "other" } }, { ...conditions, permissionProfile: "more privileges" }, { ...conditions, inputBudget: 99000 }]) assert.throws(() => assertPairedConditions(conditions, mismatch), /not comparable/);
  const fixture = [{ role: "system", content: "Preserve user constraints and source run_original." }, { role: "user", content: "Recover run_original with seed=42; do not resubmit." }, ...Array.from({ length: 24 }, () => ({ role: "toolResult", toolName: "read_artifact", content: "long raw log ".repeat(2000) }))];
  const rows = [];
  for (const group of ["baseline", "capabilities", "bounded-context", "memory", "evolved-method"] as const) {
    assertPairedConditions(conditions, structuredClone(conditions));
    const bounded = group === "bounded-context" || group === "memory" || group === "evolved-method";
    const input = bounded ? boundModelInput(fixture, 32000) : null;
    rows.push({ group, pairedConditions: conditions, toolDefinitions: group === "baseline" ? toolNames().length : CORE_TOOLS.length, inputEstimate: input?.after ?? estimateTokens(fixture), withinInputEnvelope: input ? input.after <= input.limit : estimateTokens(fixture) <= conditions.inputBudget, memoryMechanism: group === "memory" || group === "evolved-method", independentMethodProtocol: group === "evolved-method" ? "real-evaluation.json (separate fresh inference report)" : null });
  }
  assert.ok(rows[0]!.inputEstimate > conditions.inputBudget);
  assert.ok(rows[2]!.withinInputEnvelope);
  assert.ok(rows[0]!.toolDefinitions > rows[1]!.toolDefinitions);
  const evidenceDir = process.env.SCHOLARFLOW_AGENT_EVIDENCE_DIR;
  if (evidenceDir) {
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(path.join(evidenceDir, "mechanism-ablation.json"), JSON.stringify({ date: "2026-10-27", fixedCards: ["recover-run", "scoped-source", "late-correction", "disputed-claim"], rows, interpretation: "Deterministic software cost/invariant comparisons only. Temporal recall and provenance correctness are tested in memory.test.ts. Real paired method outputs are separate. These rows are not model quality scores or scientific efficacy measurements." }, null, 2) + "\n");
  }
});
