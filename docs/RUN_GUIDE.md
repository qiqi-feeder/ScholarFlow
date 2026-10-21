# ScholarFlow 运行指南（MVP）

本指南对应 2026-10-22 的软件切片。真实 DeepSeek 流式工具循环已通过；Conda 目标实验和科研验收尚未执行，限制见 [验证记录](VERIFICATION.md) 与 [W00 基线](verification/workspace-redesign/W00-baseline.md)。

## 1. 前置条件

- Windows，Node.js >= 22.19（开发机为 24.21.0）。
- 首次安装：在仓库根目录执行 `npm install`。
- 可选：Chrome 或 Edge（浏览器验证）；`pdflatex`、`bibtex`（稿件构建）；Conda/Python（真实实验）。
- 当前构建路径不需要 `latexmk`。本机 `latexmk` 因缺少 Perl 不可用，系统直接调用 `pdflatex` 和 `bibtex`，并禁用 shell escape。

## 2. 启动

```powershell
npm run build
npm start
```

打开 <http://127.0.0.1:8787>。服务默认只监听 `127.0.0.1:8787`，拒绝非回环地址。

`npm start` 会启动 HTTP/SSE 宿主，并在 `workerEnabled` 为真时启动一个独立实验 worker 子进程。浏览器关闭或页面刷新不会取消实验；实验状态由 worker 和数据库维护。

开发模式：

```powershell
npm run dev:server   # 后端热重载
npm run dev:web      # Vite 前端
npm run worker       # 单独启动 worker（不要再同时启动内置 worker）
```

同一数据目录只应运行一个 worker；当前并发上限是每个 worker 进程 1 个重型运行，不是跨进程锁。如果异常退出后不确定是否残留 worker，先在任务管理器确认没有多余的 `node` worker 进程，再重启。

## 3. 配置与数据位置

| 内容 | 默认位置 |
| --- | --- |
| 数据根目录 | `%USERPROFILE%\ScholarFlowData` |
| 数据库 | `<data>\scholarflow.sqlite` |
| 项目文件 | `<data>\projects\<projectId>` |
| 宿主配置 | `%USERPROFILE%\.scholarflow\config.json` |
| Pi 会话 | `%USERPROFILE%\.scholarflow\pi-agent` |

可在设置页配置：

- DeepSeek API Key 与模型 ID（默认 `deepseek-flash`）。
- Crossref 联系邮箱（可选，用于礼貌池标识）。
- `pdflatex` 路径。
- 实验默认解释器（显式绝对路径）、默认超时、每个任务的目标运行预算。

Key 只写入宿主配置文件，不写入项目数据、日志、浏览器存储或导出包。当前配置是**明文 JSON**；`mode: 0o600` 在 Windows 上不提供 POSIX 权限保证，安全性依赖本机账户与磁盘权限。不要把配置目录同步到共享位置。

环境变量覆盖：`SCHOLARFLOW_CONFIG`、`SCHOLARFLOW_DATA_DIR`、`SCHOLARFLOW_HOST`、`SCHOLARFLOW_PORT`、`DEEPSEEK_API_KEY`、`SCHOLARFLOW_MODEL`、`SCHOLARFLOW_SEARCH_EMAIL`、`SCHOLARFLOW_DISABLE_WORKER=1`。

## 4. 一次完整工作流

1. **创建项目与任务。** 项目共享材料，不共享全部聊天历史；不同项目的会话、文件、运行互相隔离。
2. **导入材料。** 支持 DOI、URL、PDF/HTML/文本路径和项目内路径。系统保存检索时间、定位信息、许可、响应哈希；标题检索可能命中多条，必须按 DOI/venue 核对，不能把第一条当目标论文。同一项目重复导入相同 DOI 会复用已有材料；材料页可导出 `refs.bib`。
3. **使用 Skill。** 项目初始化时装配 literature-review、reproduction-admission、experiment-design、result-analysis、latex-writing。`load_skill` 会记录实际读取的版本和哈希；缺依赖会显示，而不是静默忽略。
4. **形成并确认方案。** 方案保存目标、设计、条件、指标位置、种子、预算和 Skill 版本。草稿不进入任务上下文；只有用户确认的方案才算数。
5. **准入与提案。** target 运行要求准入状态为 `sufficient`：论文身份、官方仓库/commit、官方脚本/参数、两份独立复现依据、数据许可/划分等。缺一项只能先做 smoke，smoke 永远不算复现证据。
6. **批准并执行。** 提案显示精确配置指纹；批准后才创建 runId，并由 worker 启动进程。同一 requestId 重试返回同一 run，不会启动第二个进程。target 还需显式绝对解释器路径和预算内批准。
7. **核验结果。** 进程退出成功不等于科学核验。用户或 Agent 单独记录 `verified`/`partial`；指标从指定 run 的原始文件和 JSON pointer 导入，保留文件哈希。条件不一致时不排名，少种子/smoke/partial 会标注。
8. **写作与导出。** 稿件编辑产生版本；每个版本保存源码快照，可在稿件面板选择旧版本恢复。点击“同步结果图表/表格”会把当前结果版本生成 LaTeX 表格和 PGFPlots 柱状图 PDF，并写入 `generated/`；若图表编译失败会保留表格并显示警告。构建前检查引用和源哈希，未定义引用会失败，源文件变化后旧 PDF 返回 `409 STALE_BUILD`。导出包包含源文件、PDF、`MANIFEST.json`、结果/运行关联和限制，不包含密钥。
9. **继续任务。** 新任务可读取同项目已确认方案、运行、结果和稿件；不复制整段聊天历史。替换被引用结果会把相关稿件文件标为待核对，旧结果仍可查询。

## 5. 故障与恢复

| 情况 | 行为 |
| --- | --- |
| 未配置 Key | 聊天显示配置错误；不会生成假回答 |
| 未配置解释器 | target 提案被拒绝；smoke 可用 `node` 跑管线测试 |
| 进程退出码 0 但预期产物缺失 | run 标为 `succeeded` 但核验 `partial`，日志说明缺失文件 |
| 进程非零退出/超时 | run 标为 `failed`，保留日志、退出码和错误 |
| 取消 | queued 直接取消；running 先核对 PID 与启动时间，身份不符不发信号 |
| worker 重启时仍有 running | 改为 `unknown` 并保留日志；**不会自动重跑**，需人工核对进程和产物 |
| 浏览器断连/刷新 | SSE 从游标回放持久事件；实验和 worker 不受影响 |
| `pdflatex` 不可用 | 构建返回 422 和诊断，不保留“成功”PDF |
| `latexmk` 不可用 | 不影响当前构建；健康检查会如实显示不可用 |
| 旧 PDF 与源不一致 | 返回 409，要求重新构建 |

`unknown` 不是失败也不是成功。先确认原进程是否仍存活、日志是否完整，再决定人工取消或重新提交；不要直接假定失败并重复启动。

## 6. 安全边界

- 单用户、本地回环，无登录。不要把端口暴露到局域网或公网。
- 路径检查阻止项目归属混淆、绝对路径和 `..` 穿越，但本地进程、Skill 和 LaTeX 仍拥有宿主账户权限；目录限制**不是**操作系统沙箱。
- Agent 仅装配 `read/grep/find/ls` 只读文件工具和科研工具，不直接提供 `write/edit/powershell/bash`；写稿件必须走 `save_manuscript_file`，由版本快照保留旧内容。
- 实验命令在用户批准后以本机账户执行。只运行可信代码；不要导入会下载并执行远程脚本的未审阅 Skill。
- 日志会脱敏常见密钥形态，但这不替代谨慎：不要把密钥写入命令参数、配置值或材料。
- LaTeX 构建使用 `-no-shell-escape`；仍应只构建自己审阅过的源文件。

## 7. 验证命令

```powershell
npm run typecheck
npm test
npm run build
npm run test:browser
node --import tsx scripts/verify-pi-session.ts
```

`npm test` 不调用真实 DeepSeek，也不替代 V09/V13/V15。真实模型和目标实验需要用户配置后单独执行并记录证据，详见 [PLAN](../PLAN.md) 与 [验证记录](VERIFICATION.md)。

## 8. 尚未完成

- 真实 DeepSeek 流式工具循环已通过；压缩后检索、无效 Key/限流/断线/停止回答故障矩阵仍未完成。
- 真实论文基线、一次受控修改和科研验收（缺验收卡目标、目标数据/官方脚本/GPU 预算；Conda/Python 解释器已存在）。
- Pi 对照评测、干净检出发布回归。
- 旧静态 Demo 的缺失资源修复。

W00 工作台基线与 W01 入口见 [W00 基线](verification/workspace-redesign/W00-baseline.md)；W01 外壳与任务级模型已完成，证据见 [W01 外壳与模型](verification/workspace-redesign/W01-shell-models.md)；W02–W05 尚未实施。
