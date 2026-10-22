export interface RunActivity { projectId: string; taskId: string; id: string; name: string; status: string; finishedAt: string | null; verification: string }
export const terminal = (status: string) => ["succeeded", "failed", "cancelled", "unknown"].includes(status);
export const transitionKey = (run: RunActivity) => `${run.projectId}/${run.id}/${run.status}/${run.finishedAt ?? ""}`;
export function activityChanges(previous: Record<string, string> | null, runs: RunActivity[], seen: Record<string, boolean>) {
  const next = Object.fromEntries(runs.map((run) => [run.id, transitionKey(run)]));
  const notifications = previous === null ? [] : runs.filter((run) => terminal(run.status) && previous[run.id] !== transitionKey(run) && !seen[transitionKey(run)]);
  return { next, notifications };
}
