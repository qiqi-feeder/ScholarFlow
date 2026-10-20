# ScholarFlow
An Agentic Research Workspace powered by Pi

> **MVP 计划已编写（2026-10-20）**：首期范围、实施节点和验证要求见 [PLAN](PLAN.md)，需求来源及讨论见 [DISCOVERY](docs/DISCOVERY.md)。本轮只编写计划，业务尚未实施；下列旧方案和静态 Demo 保留作参考，不作为并行执行依据。

计划/需求文档验证：`./tests/mvp-plan.tests.ps1`、`./tests/discovery-docs.tests.ps1`。当前 Light Workspace 资源缺失及验证限制见 DISCOVERY；文档检查不代表真实功能验收。

## 产品与实现方案

当前仓库是产品文档与静态 Mock Demo，尚无可执行的 ScholarFlow Server、真实 Pi/Skill 集成或排版引擎。现行计划为单用户本地 Web＋Pi SDK、Windows 本地实验和 LaTeX 交付；Electron 后置。

- [第一版 MVP 计划](PLAN.md)：M0–M6 实施顺序、V01–V16 验证矩阵、真实科研验收与完成定义。

- [产品设计](docs/PRODUCT_DESIGN.md)：部署/数据归属、Skill 选择与执行、写作排版、MVP 范围。
- [技术方案](docs/TECHNICAL_DESIGN.md)：架构、仓库拆分、存储、Pi/任务/权限与安全。
- [实现路线与验收](docs/IMPLEMENTATION_ROADMAP.md)：D0、M1–M8 和可选 Electron，每节点包含输入、检查、阈值、负例和证据；规划命令并非当前可运行功能。
- [架构图源文件](docs/diagrams/architecture.drawio) / [浏览器查看](docs/diagrams/README.md)。

文档验证：`./tests/product-design.tests.ps1`、`./tests/architecture-docs.tests.ps1`（后者需要 Node）。

## 前端 Demo

- [Light Workspace v2](demo/workspace-light.html)：明亮的 IDE 工作台设计，原生 HTML/CSS/JS，包含六个功能页、Profile/Skill 选择与一次性审批 Mock 交互。
- [原始 Demo](demo/index.html)：保留不覆盖。
- [第一版 Figma 设计](https://www.figma.com/design/rQ8doN3vOtVhHFFrhhPxFp?node-id=10-2) / [第一版截图](.experiments/frontend-bakeoff/scholarflow-ide-v1.png)：保留不覆盖。

从仓库根目录运行 `python -m http.server 8811 --bind 127.0.0.1`，打开 <http://127.0.0.1:8811/demo/workspace-light.html>。支持 `?view=notes`、`?view=reading` 等直接查看功能页；字体与图标均为本地资源。

上述 Python 服务仅提供静态 Demo，不是规划中的 ScholarFlow Server，不执行 Agent 或保存项目数据；不要把开发预览直接暴露公网。

Agent 视觉层预览：<http://127.0.0.1:8811/demo/workspace-light.html?view=reading&agent=1>。默认展示 Reader＋nature-reader 与待审批卡；可选择角色、搜索/多选 Skill、查看拟变更、批准一次或拒绝。`agent=1` 在窄屏自动展开 Agent。审批只改变页面状态，不执行 Skill、不创建文件；已有审批保留任务提交时的配置，换项目清空选择和审批。

验证：`./tests/workspace-light.tests.ps1`（需要 Python、Node 和 Chrome/Edge）。新页面的实现范围、截图与局限见 [v2 评审说明](.experiments/frontend-bakeoff/LIGHT_V2_REVIEW.md)，旧实验目录的恢复方式见 [worktree 清理记录](.experiments/frontend-bakeoff/WORKTREE_CLEANUP.md)。
