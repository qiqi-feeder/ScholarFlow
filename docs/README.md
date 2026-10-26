# Documentation / 文档

[English overview](../README.md) · [中文首页](../README.zh-CN.md)

Start with the run guide and the included example. Design history and acceptance identifiers are kept below for maintainers.

| I want to… / 我想… | Read / 文档 |
| --- | --- |
| Install, configure models, or recover local data / 启动、配置、恢复 | [Run guide](RUN_GUIDE.md) |
| Follow a concrete example / 看实际工作流 | [Demo walkthrough](DEMO.md) |
| Understand the current Agent design / 了解 Agent 机制 | [Capability architecture](AGENT_CAPABILITY_ARCHITECTURE.md), [implementation contracts](AGENT_IMPLEMENTATION_PLAN.md) |
| Inspect validation and limitations / 核对验证与限制 | [IG00–IG07 delivery report](verification/agent-implementation/IG07.md), [README media evidence](verification/readme-showcase.md) |
| Understand the roadmap / 查看实施依赖与科研验收 | [PLAN](../PLAN.md), [research acceptance card](RESEARCH_ACCEPTANCE_CARD.md) |
| Report a problem or contribute / 反馈或贡献 | [CONTRIBUTING](../CONTRIBUTING.md), [GitHub issues](https://github.com/qiqi-feeder/ScholarFlow/issues) |

## Source map

| Path | Responsibility |
| --- | --- |
| `apps/web` | Project workspace, persistent conversation, reading, runs, results, manuscripts, memory and method review. |
| `apps/server` | Local HTTP/SSE host, Pi integration, project ownership, domain tools and artifact services. |
| `packages/research` | Domain records and pure rules for context, snapshots, metrics, memory and method evaluation. |
| `packages/experiment-worker` | Durable queue, process identity, execution, logs, cancellation and recovery. |
| `resources` | Built-in Skills and LaTeX template. |
| `examples`, `scripts/seed-demo.ts` | Included first-run source and explicit starter setup. |
| `tests`, workspace `test` folders | Documentation contracts and software/integration/browser tests. |

## Design and verification history

- [Discovery and decisions](DISCOVERY.md), [current workspace product discussion](WORKSPACE_PRODUCT_DISCUSSION.md), [frontend requirements](FRONTEND_PRODUCT_REQUIREMENTS.md).
- [Workspace verification index](verification/workspace-redesign/README.md), [earlier MVP verification](VERIFICATION.md), [upstream harness survey](research/HARNESS_SURVEY_2026-10-20.md).
- [Historical product design](PRODUCT_DESIGN.md), [technical proposal](TECHNICAL_DESIGN.md), [original roadmap](IMPLEMENTATION_ROADMAP.md), [target-architecture diagram](diagrams/README.md). These describe earlier plans; the homepage diagram describes the current local runtime.
- [Third-party notices](m0/UPSTREAM_LICENSES.md), [M0 acceptance card](m0/ACCEPTANCE_CARD.md).
- [Agent research and implementation notes](AGENT_RESUME_HIGHLIGHTS.md). This is a maintainer reference, not an end-user guide.

<details>
<summary>Historical document verification commands / 历史文档验证命令</summary>

Run these from the repository root when changing the corresponding design documents. They check documentation contracts, not implemented behavior.

```powershell
node tests/architecture-docs.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/discovery-docs.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/workspace-product-docs.tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./tests/frontend-product-docs.tests.ps1
```

</details>

## Legacy static previews

[Light Workspace](../demo/workspace-light.html) and the [original demo](../demo/index.html) are archived interface prototypes. They do not run the local Agent or save research data. Their known missing-resource issues are tracked in [DISCOVERY](DISCOVERY.md); use the running application for the current experience.
