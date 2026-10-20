# ScholarFlow
An Agentic Research Workspace powered by Pi

> **MVP 实施中（2026-10-20）**：首期范围、实施节点和验证要求见 [PLAN](PLAN.md)，M0 技术锁定见 [M0 验收卡](docs/m0/ACCEPTANCE_CARD.md)。真实 DeepSeek 调用、Conda 目标实验和 V13 科研验收尚未执行；缺少凭据/环境时 UI 与验收记录会明确显示为未完成，而不是用 Mock 冒充。

## 运行

要求 Node.js >= 22.19（已验证 24.21）。

```powershell
npm install
npm run build
npm start
```

打开 <http://127.0.0.1:8787>。数据默认保存在 `%USERPROFILE%\ScholarFlowData`，配置保存在
`%USERPROFILE%\.scholarflow\config.json`（与项目数据分离）。可在设置页配置 DeepSeek API Key、
Crossref 联系邮箱、LaTeX 路径和实验解释器。密钥不会写入项目、日志或导出包。

验证：

```powershell
npm run verify            # 类型检查 + 单元/集成测试 + Web 构建
node --import tsx scripts/verify-pi-session.ts   # Pi 1.3.0 生命周期与 Skill 发现
```

真实 Agent 对话需要 DeepSeek Key；真实实验需要显式的 Python/Conda 解释器、数据和资源预算。
缺少这些条件时，Agent 工具和实验提交会返回可读的配置错误或 `unknown` 状态，不会伪造成功。

## 文档

- [第一版 MVP 计划](PLAN.md)：M0–M6 实施顺序、V01–V16 验证矩阵、真实科研验收与完成定义。
- [M0 验收卡](docs/m0/ACCEPTANCE_CARD.md)：Pi/检索/模板/资源上限锁定与真实任务卡。
- [产品设计](docs/PRODUCT_DESIGN.md)、[技术方案](docs/TECHNICAL_DESIGN.md)、[实现路线](docs/IMPLEMENTATION_ROADMAP.md)：历史规划参考。
- [Harness 调研](docs/research/HARNESS_SURVEY_2026-10-20.md)：12 个上游实现的机制与证据。

计划/需求文档验证：`./tests/mvp-plan.tests.ps1`、`./tests/discovery-docs.tests.ps1`。当前 Light Workspace 资源缺失及验证限制见 DISCOVERY；文档检查不代表真实功能验收。

## 旧方案与静态 Demo

早期产品文档和静态 Mock Demo 保留作参考，不与当前实现并行作为执行要求。[Light Workspace v2](demo/workspace-light.html) 与 [原始 Demo](demo/index.html) 不是 ScholarFlow Server，不执行 Agent 或保存项目数据。

从仓库根目录运行 `python -m http.server 8811 --bind 127.0.0.1`，打开 <http://127.0.0.1:8811/demo/workspace-light.html>。旧 Demo 的验证为 `./tests/workspace-light.tests.ps1`（需要 Python、Node 和 Chrome/Edge），其既有资源缺失问题按 PLAN 记录，不在本计划中顺带修复。

