# 验证记录（2026-10-20）

本文件记录实际执行过的命令、环境和结果，以及尚未执行的验收项。它不替代 [PLAN](../PLAN.md) 的验收标准；“部分”或“未执行”不会被写成完成。

## 1. 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows（本地单用户） |
| Node.js | 24.21.0（满足 Pi 要求 >= 22.19） |
| Pi SDK | `@earendil-works/pi-coding-agent` 1.3.0，MIT |
| 浏览器 | Google Chrome（Playwright `playwright-core` 驱动） |
| TeX | `pdflatex` 可用（MiKTeX）；`latexmk --version` 因缺少 Perl 失败 |
| 检索 | Crossref REST，无需 Key |
| DeepSeek API Key | 未配置 |
| Conda/Python 目标环境 | 未配置 |
| 目标论文/数据 | 未确认 |

## 2. 本地检查

以下命令在仓库根目录执行并通过：

```powershell
npm run typecheck
npm test
npm run build
npm run test:browser
node --import tsx scripts/verify-pi-session.ts
```

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，无错误 |
| `npm test` | 56 个 Node 测试全部通过，0 失败（research、server、worker、agent 工具与 Pi 会话） |
| `npm run build` | 通过，Vite 生成 `apps/web/dist` |
| `npm run test:browser` | 1 个 Chrome E2E 通过 |
| Pi 生命周期脚本 | Session 持久化并可重开；发现 5 个 Skill 与 Pi 内置工具；真实模型调用报告 `blocked: no DeepSeek API key` |

测试覆盖的关键行为：

- 项目/任务归属隔离、绝对路径与穿越路径拒绝、重启后记录和事件恢复。
- SSE 持久事件按游标回放；重复客户端消息不二次提交；设置不回显密钥。
- Pi Session 文件落盘、Skill 目录装配、17 个科研工具注册；模型未配置时产生可见错误。
- 方案确认、准入充分性、精确指纹批准、requestId 去重、单并发队列、日志、超时、取消、PID 身份校验、worker 重启后 `unknown` 不自动重跑。
- 指标从真实产物按 JSON pointer 导入并保留文件与哈希；缺指标、不可比条件、少种子和 smoke 有明确标识。
- 结果版本共存、替换时标记受影响稿件文件；失败运行生成负结果报告。
- 真实 `pdflatex`/`bibtex` 构建 PDF；未定义引用导致 422；源文件变化后旧 PDF 返回 409；导出 zip 可生成。
- 浏览器完成项目/任务切换、刷新恢复、错误可见、材料导入、方案确认、批准 smoke、核验、结果分析、稿件面板、设置持久化和双项目隔离。

## 3. 真实检索证据

2026-10-20T11:43:09.012Z 对 Crossref 执行了真实查询：

- 查询：`Attention Is All You Need`
- 通道：`crossref`
- 响应 SHA-256：`ac80bbbc1d64d7631e340d7111e5d952573e380d15cb9fe3b5f155f67cdd1f28`
- 前三条结果：`Is Attention All You Need?`（10.1007/978-3-031-84300-6_13）、`Attention Is All You Need: An Analysis Of The Valuation Of Artificial Intelligence Tokens`（10.2139/ssrn.4993784）、`Attention is All You Need... Unless You Are a CISO...`（10.2139/ssrn.5967774）。

该查询证明网络通道、来源字段和响应哈希可用，同时说明标题检索会返回近似/无关记录。系统保留这些结果并提示按 DOI/venue 确认，不自动把第一条当成目标论文。

## 4. 真实构建证据

server 集成测试在存在 TeX 的机器上执行了真实构建：

- `pdflatex -no-shell-escape -interaction=nonstopmode -halt-on-error -file-line-error main.tex` 与 `bibtex main` 实际运行。
- 生成的 PDF 以 `%PDF` 开头，通过 API 返回 `application/pdf`。
- 添加不存在的 `\cite{does-not-exist}` 后构建返回 422，并报告未定义引用。
- 修改源文件后请求旧 PDF 返回 `409 STALE_BUILD`，不会把旧 PDF 冒充新产物。
- 投稿包 zip 以 `PK` 开头；包内清单记录构建源哈希、结果版本、runId、快照和限制。

`latexmk` 在本机不可用，因此构建实现直接调用 `pdflatex` 和 `bibtex`，并禁用 shell escape。设置中的 `pdflatexPath` 会在每次构建时读取；配置不存在的可执行文件会得到失败诊断，而不是成功。

## 5. V01–V16 状态

| 编号 | 状态 | 说明 |
| --- | --- | --- |
| V01 | 部分 | 包版本/许可证/锁文件/Session 重开/Skill 发现通过；真实模型调用缺 Key |
| V02 | 通过（自动化＋浏览器） | 隔离、穿越拒绝、重启恢复、刷新保持任务均通过 |
| V03 | 未执行（真实部分） | 只有缺 Key 的错误可见性与消息去重测试；未发生真实流式工具循环 |
| V04 | 部分 | 真实 Crossref 查询完成；Skill 可加载；未执行真实 Agent 调用 Skill 的任务 |
| V05 | 通过（自动化） | 准入正负样例全部通过 |
| V06 | 部分 | 上下文装配与来源保留测试通过；真实压缩后 Agent 主动查询未执行 |
| V07 | 通过（自动化） | 去重、单并发、快照、指纹冲突测试通过 |
| V08 | 部分 | 取消/超时/进程树/重启 unknown 通过；SSE 断开不终止实验未单独演练 |
| V09 | 未执行 | 无 Conda/Python 目标环境、无目标数据 |
| V10 | 通过（自动化） | 真实 smoke 产物指标链路与不可比标识通过 |
| V11 | 通过（自动化） | 结果版本、替换影响与负结果通过 |
| V12 | 部分 | 构建/引用失败/陈旧 PDF/导出通过；解包到新目录重编译未演练 |
| V13 | 未执行 | 缺验收卡目标、数据与真实模型循环 |
| V14 | 部分 | 主流程 E2E 通过；停止回答、取消实验、预算拒绝未逐一走 UI |
| V15 | 未执行 | 未做 Pi 基线对照与三次配对运行 |
| V16 | 未执行 | 未从干净检出按指南重跑 |

## 6. 未执行项与阻塞

- **真实 DeepSeek 工具循环（V03）**：需要用户提供 API Key。当前聊天会明确报告配置错误，不生成假回答。
- **真实目标实验（V09、V13）**：需要用户确认验收卡中的论文、官方仓库/commit、脚本/参数、两份独立复现依据、数据许可与获取方式、预算和一次拟检验修改；同时需要显式 Conda/Python 路径和必要数据/GPU。
- **V15 对照评测**：需要先有真实任务卡，再固定五类场景和评分表。
- **V16 干净检出回归**：本地 `npm install` 后检查通过，但未在全新目录按指南重跑全部流程。
- **旧 Demo 既有失败**：`tests/workspace-light.tests.ps1` 仍因缺少 `demo/assets/ide-light/document.svg` 失败；本轮未修改旧 Demo。

## 7. 可重复执行

```powershell
npm install
npm run verify        # typecheck + 56 Node tests + web build
npm run test:browser  # requires `npm run build` first and Chrome/Edge
node --import tsx scripts/verify-pi-session.ts
```

浏览器测试依赖本机 Chrome 或 Edge。LaTeX 测试在缺少 TeX 时会明确失败或返回诊断；该失败不能被当作通过。真实模型/目标实验测试需要用户配置，不包含在默认 `npm test` 中，也不会用桩自动标记通过。
