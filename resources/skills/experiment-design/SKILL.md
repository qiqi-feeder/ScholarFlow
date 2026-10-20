---
name: experiment-design
description: Turn a confirmed research objective and admitted reproduction materials into a bounded experiment plan with conditions, metrics, seeds, budget, and snapshot requirements. Use before proposing baseline or modification runs.
license: MIT
compatibility: The target interpreter and data must be configured by the user.
metadata: {"version":"1.0.0","requires":[],"source":"ScholarFlow built-in"}
---

# Experiment design

1. State the objective, hypotheses, and what observation would falsify each hypothesis.
2. Fix conditions that affect comparability: dataset version, split, preprocessing, model
   configuration, prediction length, metric definition, and evaluation script.
3. Declare metrics with a direction, unit, source file, and JSON pointer. A metric without a
   location in a run artifact is not admissible.
4. Declare seeds and resource limits. Do not silently change seeds or budgets between compared
   runs; disclose them.
5. Propose one baseline and at most one controlled modification within the user's budget.
6. Call `save_research_plan` with the complete plan. The user must confirm it in the Web UI.
7. Use `propose_experiment` for target runs. Target runs are queued only after the user approves
   the exact configuration fingerprint. Smoke runs are explicitly marked and never counted as
   reproduction evidence.
8. After proposing, stop and report the waiting state. Do not poll the model in a loop while a
   long experiment runs.
