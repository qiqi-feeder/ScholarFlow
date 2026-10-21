# W00 基线核对与 WT01 证据

日期：2026-10-22（Asia/Shanghai）。
范围：只读盘点、测试基线、原型快照与实施默认值；没有实施 W01–W05 业务功能，也没有把任何 WT 之外的新界面能力标为通过。
结论：**W00 完成，WT01 通过**。W01–W05 仍待实施；本次变更不改变 M0–M6、V01–V16 的既有状态。

## 1. 代码与环境基线

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\workspace\ScholarFlow`（本地单用户，不是部署环境） |
| 分支 / 基线提交 | `main` / `89dfe8f2f192b41115c0c1900c6bb142330eb712`（2026-10-22 01:21:24 +08:00） |
| 系统 | Windows 11 家庭中文版 10.0.26200 |
| Node / npm | 24.21.0 / 11.19.0 |
| 浏览器 | Google Chrome 155.0.8059.80（Playwright core 驱动） |
| TeX | MiKTeX-pdfTeX 4.23（MiKTeX 25.12）；`latexmk` 仍因缺少 Perl 不可用 |
| Python | 已配置 `%USERPROFILE%\miniconda3\envs\scholarflow\python.exe`，Python 3.12.15；未验证目标数据/脚本 |
| DeepSeek | 宿主配置已存在 Key；本记录不读取、不回显 Key 值 |
| 数据目录 | `%USERPROFILE%\ScholarFlowData`；配置 `%USERPROFILE%\.scholarflow\config.json` |

## 2. 检查命令与结果

以下命令在 W00 改动后的工作区执行；基线提交上的 `npm test` 为 57 项，本次新增 4 项 Web 夹具契约测试后为 61 项。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，无输出错误 |
| `npm test` | 61/61 通过（含新增 `apps/web/test/workspace*.test.ts` 4 项） |
| `npm run build` | 通过；Vite 生成 `apps/web/dist` |
| `npm run test:browser` | 1 个 Chrome E2E 通过 |
| `tests/mvp-plan.tests.ps1` | 通过；文档结构、追踪和负例 |
| `tests/workspace-product-docs.tests.ps1` | 通过；18 个负例 |
| `tests/frontend-product-docs.tests.ps1` | 通过；28 个负例 |
| `tests/design-reference-images.tests.ps1` | 通过；图片哈希、尺寸、链接和 6 个负例 |
| `tests/discovery-docs.tests.ps1` | 通过；40 个负例 |
| `tests/workspace-light.tests.ps1` | **失败**：缺少 `demo/assets/ide-light/document.svg`（旧静态 Demo 既有问题，未在本节点修复） |

PowerShell 兼容性：本机只有 Windows PowerShell 5.1，没有 `pwsh`。仓库原有的 12 个 `.ps1` 文档测试是 UTF-8 无 BOM，5.1 会把中文按 ANSI 解析并直接报语法错误。本节点只做了编码修复（添加 UTF-8 BOM），没有改测试断言；修复后上表文档测试可执行。该问题此前被误记为“旧 Demo 缺 SVG”，实际在 5.1 下会先在解析阶段失败。

## 3. 旧数据与备份

在开始任何数据库/模型字段改动前，已把当前数据备份到仓库外：

| 项 | 值 |
| --- | --- |
| 备份目录 | `%USERPROFILE%\ScholarFlowData\backups\workspace-w00-2026-10-22` |
| 备份数据库 SHA-256 | `1F76C625BFBD693CC034331B36606B86FD4C7A16B43257C2F751173EFFCD44BD` |
| 备份内容 | SQLite 快照（`VACUUM INTO`）＋ `projects` 目录；共 23 个文件、274,353 字节 |
| `PRAGMA integrity_check` | `ok` |
| 旧库记录数 | projects 1；tasks 1；events 18；posted_messages 3；manuscript_versions 1；skills 5；runs/materials/plans/admissions/metrics/result_versions/skill_loads/search_audit 均为 0 |
| 旧任务会话 | 存在一个 Pi `.jsonl` 会话文件；旧 `tasks` 表列为 `id, project_id, title, objective, status, session_file, context_version, review_text, created_at, updated_at`，**没有模型字段** |

旧数据可重新打开；没有执行删除、迁移或重写，不改写历史。W01 引入任务模型字段时必须保留该任务和会话可打开，迁移说明见 [实施默认值](W00-implementation-defaults.md)。

## 4. 权限与工具基线

当前宿主边界（W00 盘点，不是新安全沙箱）：

- 服务只监听 `127.0.0.1`/`localhost`/`::1`，拒绝绑定其他地址。
- Pi Agent 的活动内置工具只有 `read/grep/find/ls`；没有 `write/edit/powershell/bash`。写稿件必须走 `save_manuscript_file` 的版本化工具。
- 18 个科研工具：`get_research_context`、`list_skills`、`load_skill`、`search_literature`、`import_material`、`save_research_plan`、`assess_admission`、`propose_experiment`、`list_runs`、`query_run`、`read_artifact`、`cancel_run`、`record_run_verification`、`analyze_results`、`sync_manuscript_results`、`save_manuscript_file`、`compile_manuscript`、`export_submission`。
- 文件工具调用会检查项目根目录，拒绝绝对路径和 `..` 逃逸；命令工具（若未来启用）会拦截触碰 `.scholarflow`、`auth.json`、`deepseekApiKey` 的命令。
- 日志/事件会对常见 Key、Bearer token 和 `api_key=...` 形态脱敏；这不代替谨慎。
- Key 存在宿主配置文件，当前为明文 JSON；不会写入项目数据、日志、导出包或浏览器存储。
- 浏览器现有本地状态仅使用 `scholarflow.project` 和 `scholarflow.task.<projectId>`；没有 Key、日志或数据集。

本轮不得放宽：方案确认、实验审批/预算、运行快照、结果来源、稿件版本、导出边界。新界面只能调用既有后端约束，不能把前端按钮当成权限来源。

## 5. 模型能力与旧任务继承

通过 Pi `ModelRuntime` 只读检查（未发起模型请求）：

| 提供方 | 模型 | 名称 | API | 推理 | 上下文 | 最大输出 | 输入 | 当前可用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| deepseek | `deepseek-flash` | DeepSeek V4.1 Flash | openai-completions | 是 | 1,000,000 | 384,000 | text, image | 是 |
| deepseek | `deepseek-v4-pro` | DeepSeek V4 Pro | openai-completions | 是 | 1,000,000 | 384,000 | text | 是 |

- 其它提供方在 Pi 目录中存在模型，但当前没有凭据，`getAvailable()` 返回空；W01 不能把它们显示为可用。
- Pi 公开支持 `AgentSession.setModel(model, options)`、`session.isIdle`、`session.isStreaming`；会话以 `model_change` 条目记录切换，助手消息记录实际 `provider/model`。这满足“下一条生效、历史保留”的机制基础。
- W00 没有执行真实切换或真实模型调用；WT16 仍需两个已配置模型各做一次有界真实调用，不能拿本表代替。
- 旧任务（无模型字段）规则：打开时继承当前默认模型并显示“继承默认”；首次发送或显式切换时把解析后的 provider/model 写入任务行，之后修改全局默认值不再覆盖。已显式选择但模型不可用时，阻止发送并要求重选，不静默回退。

## 6. 原型基线

Stitch SB01–SB07 的读取时间、资源名、截图、HTML 摘要、尺寸和 SHA-256 见 [design-baseline/README.md](design-baseline/README.md) 与 [manifest.json](design-baseline/manifest.json)。EX01–EX04 只登记为排除项，不使用。

已确认的视觉方向：浅色底、细边框、克制蓝色、64px 图标栏＋约 250px 内容列表＋自适应中央区＋约 360px 右侧常驻会话。原稿中的演示指标、GPU/SLURM、Zotero、编译耗时、顶刊结论和 CDN 依赖不进入产品。

## 7. 既有失败与限制

- `tests/workspace-light.tests.ps1`：旧静态 Demo 缺少 `demo/assets/ide-light/document.svg`。本轮只增加 BOM，不修复旧 Demo，不能称全仓测试通过。
- 没有 `pwsh`；文档测试只在 Windows PowerShell 5.1 下验证。CI/其他机器应使用 PowerShell 7 或保持 UTF-8 BOM。
- 未执行真实目标实验、真实模型切换、压缩后查询、浏览器断线演练；对应 V09/V13/V15/V16 与 WT02/03/09/10/11/14/16 仍不能标通过。
- 未生成 1440/1024/390px 新界面截图；W02/W05 再做。
- 当前前端仍是单文件旧布局，尚无工作区状态/引用/任务模型代码；本节点只建立夹具与契约。

## 8. WT01 结果

| 通过标准 | 证据 | 结果 |
| --- | --- | --- |
| 可回查提交/环境/命令/退出码/既有失败 | 本文第 1、2、7 节 | 通过 |
| 旧数据重开且备份存在 | 第 3 节；备份 hash + `integrity_check=ok` | 通过 |
| 不记录 Key | 第 1、4 节只记录“已配置”，无 Key 值 | 通过 |
| 确认本轮不得放开的权限 | 第 4 节 | 通过 |
| 模型兼容能力与旧任务继承规则明确 | 第 5 节 + [实施默认值](W00-implementation-defaults.md) | 通过 |

限制：WT01 只证明基线/兼容事实可核对，不证明新工作台、模型选择或引用功能已实现；W01 起仍需逐项执行 WT02–WT19。
