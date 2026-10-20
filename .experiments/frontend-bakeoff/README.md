# ScholarFlow frontend skill bake-off

This directory contains the frozen inputs for a controlled comparison of
frontend-design skills against `demo/index.html`.

## Experiment arms

- One no-skill control arm.
- Three treatment arms, each loading exactly one vendored skill.
- Every arm starts from the same preparation commit in an isolated Git
  worktree and branch.
- Agents use the same model, reasoning setting, brief, validation commands,
  and implementation/repair budget.

The branch-to-skill mapping is intentionally kept out of the comparison
artifacts until the blinded review is complete.

## Vendored-tool validation note

The UI/UX Pro Max runtime search command is smoke-tested from the vendored
directory with the repository's available Python 3.7 interpreter. Its upstream
repository-development test suite is not a ScholarFlow gate: several tests
assume the original upstream checkout layout and Python 3.9+ APIs. ScholarFlow
variants are instead gated by the three PowerShell commands in `brief.md` and
by a direct design-system search performed in the UI/UX Pro Max arm.

## Reproducibility

- `skills.lock.json` records the upstream commit and local `SKILL.md` hash.
- `brief.md` is the exact shared implementation contract.
- `rubric.md` defines the hard gates and blinded scoring dimensions.
- The vendored skill directories are experiment inputs, not globally
  installed Codex skills and not automatically discovered by agents.
