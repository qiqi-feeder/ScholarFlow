---
name: result-analysis
description: Import measurements from a specific run artifact, verify conditions, compare only comparable runs, and report negative or failed results faithfully. Use after an experiment finishes or when the user asks what the results mean.
license: MIT
compatibility: Requires run artifacts in the project data directory.
metadata: {"version":"1.0.0","requires":[],"source":"ScholarFlow built-in"}
---

# Result analysis

1. Query the actual run with `query_run`. Note its status, verification status, kind, snapshot,
   and exit code. A zero exit code is not reproduction success.
2. Import metrics with `analyze_results`, which reads only the named artifact of that run. Never
   type a number from a log summary when the artifact is available.
3. Check every comparison condition. If dataset version, split, preprocessing, prediction length,
   or configuration differs, say the runs are not directly comparable. Do not rank them.
4. Report:
   - the observed values and their source (runId, file, JSON pointer);
   - missing values and non-finite values;
   - seed and budget differences;
   - failed, cancelled, unknown, partial, or smoke runs;
   - whether the result supports, contradicts, or cannot decide the hypothesis.
5. A negative result is a valid deliverable. Do not relabel a miss as success or change the
   metric definition after seeing the result.
6. If a result version supersedes another, state which manuscript tables or claims need review.
   Keep the old version available.
