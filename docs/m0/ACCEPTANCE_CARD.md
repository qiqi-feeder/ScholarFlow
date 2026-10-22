# M0 — 技术锁定与真实任务验收卡

状态：**部分完成（软件锁定完成；真实科研目标未确认）**。更新：2026-10-22。

M0 把“能运行”与“能宣布科研验收”分开。软件切片、版本、许可和资源上限已经锁定；真实目标论文必须同时满足 [PLAN](../../PLAN.md) 的复现准入，当前没有用户确认的候选，尚未确认目标数据，因此不能伪造一张“已批准”的任务卡。

## 1. 上游锁定

| 项 | 锁定值 | 证据 |
| --- | --- | --- |
| Pi SDK | `@earendil-works/pi-coding-agent` **1.3.0** | `package-lock.json`；`scripts/verify-pi-session.ts` |
| Pi 许可证 | MIT | `node_modules/@earendil-works/pi-coding-agent/package.json` |
| 调研快照 | `a731ba8b80ac56662b4ca7f09102f94447862d8c` | [HARNESS_SURVEY](../research/HARNESS_SURVEY_2026-10-20.md) |
| Node | >= 22.19（本机验证 24.21.0） | Pi `engines` |
| 检索通道 | Crossref REST (`https://api.crossref.org/works`)，DOI 定位 | 真实网络查询；无需 API Key；保留查询、时间、原始响应哈希 |
| 稿件模板 | `resources/templates/paper`（article + BibTeX + sections） | 构建测试 `latex-build.test.ts` |
| 默认资源上限 | 1 个并发重型运行；单次 1800 秒；任务预算由确认计划声明 | `apps/server` 默认配置 |
| 模型 | DeepSeek 由 Pi 提供方目录提供；凭据只存宿主配置，不进入项目数据 | `apps/server/src/config.ts` |

V01 的最小 SDK 生命周期已有证据；后续已配置真实模型并完成有界调用与工具循环，最新 [W05 证据](../verification/workspace-redesign/W05-regression.md) 验证显式引用及宿主重启恢复。目标科研实验尚未执行，详见 [科研验收执行卡](../RESEARCH_ACCEPTANCE_CARD.md)。

## 2. 真实任务验收卡（待用户确认）

以下字段必须由用户确认后填写；空白表示尚未批准。Agent 不得自行选定论文来绕过准入。

| 字段 | 值 |
| --- | --- |
| 论文标题 / 版本 | 待确认 |
| DOI / 官方链接 | 待确认 |
| 官方仓库 + commit | 待确认 |
| 官方脚本 / 参数 | 待确认 |
| 目标表/图与指标 | 待确认 |
| 数据、许可、获取方式 | 待确认；本机目前无目标数据 |
| 他人复现依据 1（独立组、链接、结果位置） | 待确认 |
| 他人复现依据 2（独立组、链接、结果位置） | 待确认 |
| 可接受偏差与判断依据 | 待确认 |
| 预算（运行数/时长/费用上限） | 默认最多 2 个目标运行、单次 30 分钟；费用未知 |
| 一次拟检验修改 | 待确认 |
| 最终交付物 | 英文 LaTeX article、PDF、投稿包、结果/限制说明 |

选择规则：

1. 优先熟悉领域、单卡/CPU 可在预算内完成的轻量任务。
2. 必须有两篇**其他论文/其他组**实际运行并报告的可定位结果；原论文自报数字、引用和转载不算。
3. 官方参数缺失时不允许猜参或独立补实现；只能更换目标或降级为 smoke 调试。
4. smoke 运行在 UI、结果和稿件中始终标注为 smoke，不能作为基线/复现证据。

## 3. 环境基线

- 后续已配置 Conda/Python 目标环境；解释器存在，当前不缺安装环境，缺已确认的目标/数据/官方脚本。
- 已发现 `latexmk`（MiKTeX），但 `latexmk --version` 当前失败；构建节点会执行真实探测并明确报告不可用，不把未编译标成成功。
- 已发现 Chrome 与 Edge，可用于真实浏览器验收。
- 旧测试基线：`demo/assets/ide-light/document.svg` 缺失导致 `workspace-light.tests.ps1` 既有失败；本计划不宣称全仓通过。

## 4. M0 出口状态

| 项 | 状态 | 说明 |
| --- | --- | --- |
| 发布版本/许可证/锁文件 | 完成 | Pi 1.3.0 / MIT / lockfile |
| 公开 API 与扩展点核对 | 完成（无模型调用） | `verify-pi-session.ts` 创建、持久化、重开并枚举 skill/tool |
| 真实 DeepSeek 调用 | 已验证 | W01 双模型及 W05 浏览器显式引用/实际工具调用，见最新证据 |
| 真实任务验收卡 | 待确认 | 缺用户确认目标、数据与官方脚本；环境已具备 |
| 检索通道 | 完成 | Crossref；2026-10-20 已执行真实查询并保留响应哈希，见 [验证记录](../VERIFICATION.md) |
| 模板与资源上限 | 完成 | 模板真实编译测试依赖 `pdflatex`/`bibtex`；本机通过，`latexmk` 因缺 Perl 不可用但不参与构建 |
| V01 | 软件证据已具备 | 包/生命周期及有界真实调用均已执行；历史 [EVIDENCE](EVIDENCE.md) 与最新 W05 分开保留，不冒充科研验收 |
