export class InputBudgetError extends Error { readonly code = "INPUT_BUDGET_EXCEEDED"; }
export const estimateTokens = (value: unknown) => Math.ceil(new TextEncoder().encode(JSON.stringify(value)).length / 2);
export interface BudgetMessage { role: string; content?: unknown; toolName?: string }
export function calibratedInputScale(previous: number, estimate: number, usage: { input?: number; cacheRead?: number; cacheWrite?: number }) {
  const actual = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return estimate > 0 && actual > 0 ? Math.max(1, previous, actual / estimate * 1.1) : previous;
}

/** Includes system messages, tool declarations, methods, history and evidence. */
export function boundModelInput<T extends BudgetMessage>(messages: T[], contextWindow: number, outputReserve = 4096, cap = 24000) {
  const limit = Math.min(cap, contextWindow - outputReserve);
  if (limit < 1024) throw new InputBudgetError("model window cannot reserve the required output space");
  const selected = structuredClone(messages);
  const before = estimateTokens(selected);
  let removed = 0;
  for (const message of selected) {
    if (estimateTokens(selected) <= limit) break;
    if (message.role !== "toolResult" || ["load_skill", "activate_capability"].includes(message.toolName ?? "")) continue;
    if (estimateTokens(message.content) < 200) continue;
    message.content = [{ type: "text", text: `[Evidence omitted from request budget; not a complete source. Re-read tool ${message.toolName ?? "unknown"} using its original arguments, source version and page cursor. Persisted records and artifacts are unchanged.]` }];
    removed++;
  }
  const after = estimateTokens(selected);
  if (after > limit) throw new InputBudgetError(`Required instructions, methods and user constraints exceed input budget (${after} estimated > ${limit}); compact history or narrow input explicitly. No request sent.`);
  return { messages: selected, before, after, limit, removed, outputReserve, estimated: true as const };
}
