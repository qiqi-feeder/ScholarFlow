import test from "node:test";
import assert from "node:assert/strict";
import { activityChanges, transitionKey, type RunActivity } from "../src/activity.js";

test("background transitions are honest, independent of view and deduplicated across reloads", () => {
  const run: RunActivity = { projectId: "project-b", taskId: "task-b", id: "run", name: "CPU smoke", status: "running", finishedAt: null, verification: "unverified" };
  const baseline = activityChanges(null, [run], {});
  assert.equal(baseline.notifications.length, 0);
  for (const status of ["succeeded", "failed", "cancelled", "unknown"]) {
    const finished = { ...run, status, finishedAt: "2026-10-22" };
    const changes = activityChanges(baseline.next, [finished], {});
    assert.equal(changes.notifications[0]?.status, status);
    assert.equal(changes.notifications[0]?.verification, "unverified");
    assert.equal(activityChanges(changes.next, [finished], {}).notifications.length, 0);
    assert.equal(activityChanges(baseline.next, [finished], { [transitionKey(finished)]: true }).notifications.length, 0);
    assert.equal(activityChanges(null, [finished], {}).notifications.length, 0);
  }
});
