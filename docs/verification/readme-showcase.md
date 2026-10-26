# README showcase verification

Authoring date: 2026-10-27 (Asia/Taipei). Runtime baseline: `d5d908d5af19bd201060ea1a7e1839cb7352a1a9`, plus the README, starter, and capture-script changes delivered with this record. Node.js 24.21 on Windows; Chrome headless viewport 1440 × 900.

## What the assets demonstrate

- The [capture manifest](../assets/manifest.json) identifies real application/model use, three tool loops (`read_artifact`, `query_run`, `recall_memory`), one successful `kind=smoke` run, a real manuscript build, and project memory read in another task.
- The source is the committed [first-run fixture](../../examples/first-source.txt). The worker executes a deterministic 128-sample synthetic forecast and writes the metric to `metrics.json#/mae`. The run's approval, script hash, metric hash, and source locator are retained in the manifest.
- The report states its smoke scope. The capture script prepares the plan, result, LaTeX text, and memory through actual services/APIs; UI automation confirms the plan and approves the command. It does not inject assistant messages or claim autonomous experiment/report creation.
- The GIF is twelve sampled real screenshots at five seconds each. Timing is adjusted; it is not a continuous recording. PNGs preserve the captured viewport. Asset SHA-256 hashes and byte counts are checked by the documentation tests.
- Model usage is recorded as reported on the final replies, not as a complete bill. Pricing is unverified. The capture runs in disposable local data; credentials and private research material are not exported.

## Reproducible validation

```powershell
npm run verify
npm run test:browser
npm run test:docs
node tests/architecture-docs.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/discovery-docs.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/workspace-product-docs.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/frontend-product-docs.tests.ps1
git diff --check
```

The new starter integration test checks real HTTP import, repeated setup without duplicate records, preservation of local edits, configured-directory checks, zero model calls, and zero experiment approvals/runs. README tests resolve English/Chinese links and anchors, reject damaged assets and misleading evidence, and verify media metadata. Existing runtime/browser tests continue to exercise approvals, provenance, manuscripts, recovery, memory, and method review.

Executed checks: `npm run verify` passed type checks, 83 automated tests, and the production build; its three external API opt-ins stayed skipped. All three browser regression tests and 27 documentation tests passed. Discovery, workspace-product, frontend-product, architecture/XML, and MVP-plan PowerShell checks passed, including their negative cases. `git diff --cached --check` passed. [Regeneration instructions](../DEMO.md#regenerate-the-showcase) describe the separately executed real-model capture.

Local GitHub-style previews of both homepages were checked at 1440px and 390px: all images loaded, Mermaid 11.4.1 rendered the current diagram, and the document had no horizontal overflow. The captured app hero and mobile README layout were visually inspected. This preview is a local rendering check, not evidence of a GitHub CI run.

## Claim boundaries

The homepage identifies a Windows-first, single-user early preview and a pending project-wide license. No CI-success or license badge is invented. The small six-card method evaluation remains baseline 4/6 and candidate 4/6, with the candidate rejected and the baseline retained; see the [IG07 report](agent-implementation/IG07.md).

Software walkthrough success is not scientific reproduction, statistical significance, method improvement, or target-research acceptance. The [research acceptance card](../RESEARCH_ACCEPTANCE_CARD.md) and [plan](../../PLAN.md) remain the relevant gates. Historical design/prototype links stay in the [documentation index](../README.md), labelled as historical.
