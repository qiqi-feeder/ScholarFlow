import { canonicalJson } from "./snapshot.js";
export interface ComparisonConditions {
  model: { provider: string; id: string }; permissionProfile: string; inputBudget: number; outputBudget: number;
  fixtureVersion: string; repetitions: number;
}
export function assertPairedConditions(left: ComparisonConditions, right: ComparisonConditions) {
  if (canonicalJson(left) !== canonicalJson(right)) throw new Error("paired evaluation is not comparable: model, permissions, fixture or budget differ");
}
