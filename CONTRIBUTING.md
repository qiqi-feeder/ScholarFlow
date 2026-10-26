# Contributing to ScholarFlow

Thanks for helping make long-running research work easier to inspect and resume. ScholarFlow is currently a Windows-first, single-user preview. Start with the [中文 README](README.md) or [English README](README.en.md), [run guide](docs/RUN_GUIDE.md), and [current plan](PLAN.md).

## Report a problem

Open a [GitHub issue](https://github.com/qiqi-feeder/ScholarFlow/issues) with your Node/Windows version, the relevant commit, reproduction steps, expected behavior, and a small example. Include whether the issue involves a model call, a worker process, a source version, or a browser draft.

Remove credentials, private source text, personal data paths, and unrelated logs before sharing evidence. Never attach host configuration or Pi authentication files. An exit-zero process and a successful scientific reproduction are separate claims.

## Work locally

```powershell
npm ci
npm run build
npm start
```

For development, run `npm run dev:server` and `npm run dev:web` in separate terminals. The [source map](docs/README.md#source-map) explains module responsibilities.

Use an isolated `SCHOLARFLOW_DATA_DIR` and `SCHOLARFLOW_CONFIG` for test work. Keep credentials in host configuration, not the repository or project files. Do not expose the unauthenticated local host outside loopback.

## Validate a change

```powershell
npm run verify
npm run test:browser
npm run test:docs
git diff --check
```

`verify` runs type checks, automated tests, and the production build. Browser tests need Chrome or Edge and the built web app; the LaTeX integration tests also need `pdflatex` and `bibtex`. Automated tests use controlled fixtures or lightweight processes. Opt-in external model checks are skipped by default.

Add or update tests for the behavior you change, preserve meaningful failure cases, and create a matching Git commit as required by [AGENTS.md](AGENTS.md). Documentation and media changes should validate local links, anchors, assets, provenance, and English/Chinese status consistency. Avoid claiming CI coverage until a corresponding workflow exists.

## External API checks

Run these deliberately with an existing DeepSeek configuration. They make billable requests; prices are unknown unless configured. Each check uses temporary test data. No target research experiment or automatic method publication is authorized by these commands.

```powershell
$env:SCHOLARFLOW_REAL_AGENT_TEST='1'
npm run test:agent-evaluation
Remove-Item Env:SCHOLARFLOW_REAL_AGENT_TEST

$env:SCHOLARFLOW_REAL_WORKSPACE_TEST='1'
npm run test:real-workspace
Remove-Item Env:SCHOLARFLOW_REAL_WORKSPACE_TEST
```

The paired method check uses 12 fresh model requests with at most 512 output tokens each. The real browser check sends two logical messages, including a tool loop and session reopen. A completed evaluation may correctly reject a candidate: record the measured outcome, keep the baseline when criteria fail, and never turn these lightweight cards into a claim of scientific efficacy.

## Before a pull request

Explain the concrete problem, resulting behavior, relevant validation, and any remaining limitations. Preserve provenance, project/task ownership, exact approvals, request deduplication, user drafts, and existing task method bindings. New target experiments or larger budgets require their own explicit approval.

The project-wide license is pending maintainer selection. Do not add an assumed license or licensing badge; retain upstream notices and attribution. For behavior changes, follow the [implementation contracts](docs/AGENT_IMPLEMENTATION_PLAN.md).
