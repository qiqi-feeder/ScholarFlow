import assert from "node:assert/strict";
import test from "node:test";
import { boundModelInput } from "../src/input-budget.js";
test("RT05 shared budget counts tools, methods and history; only re-readable evidence shrinks", () => {
  const messages = [
    { role: "system", content: "rules", tools: [{ name: "query_run", parameters: "schema" }] },
    { role: "user", content: "Keep seed=42; never restart run_original" },
    { role: "toolResult", toolName: "load_skill", content: "method v1" },
    ...Array.from({ length: 30 }, () => ({ role: "toolResult", toolName: "read_artifact", content: "log".repeat(10000) })),
  ];
  const budget = boundModelInput(messages, 32000);
  assert.ok(budget.after <= budget.limit); assert.ok(budget.removed > 0); assert.ok(budget.estimated);
  assert.deepEqual(budget.messages[1], messages[1]); assert.deepEqual(budget.messages[2], messages[2]);
  assert.match(JSON.stringify(budget.messages), /not a complete source/);
  assert.equal(messages[3]!.content.length, 30000, "persistent history is untouched");
  assert.throws(() => boundModelInput([{ role: "system", content: "must keep".repeat(10000) }], 8000), /No request sent/);
  assert.throws(() => boundModelInput([], 2000), /reserve/);
});
