# ScholarFlow 推荐实现路线与可验证节点

> **历史方案，待重新确认**：当前处于需求探索阶段，以 [DISCOVERY](DISCOVERY.md) 中逐项标注的状态为准。本文及配套节点清单、架构图保留作历史参考，不构成当前实施授权；不会据此自动开始 M1。

更新：2026-09-16。对应[产品](PRODUCT_DESIGN.md)、[技术](TECHNICAL_DESIGN.md)。当前仅文档与 Mock Demo，**M1–M8 尚未实现**；本次交付定义验收，不宣称已运行真实 Pi/Skill/排版。节点结构见 [implementation-milestones.json](implementation-milestones.json)。

## 1. 顺序与完成定义

推荐主线：D0 文档基线 → M1 Server/存储/鉴权 → M2 真实 Web/论文 → M3 持久 Pi 任务 → M4 Skill 系统 → M5 nature-reader 闭环 → M6 写作排版 → M7 实验 Lite → M8 自托管交付。E1 Electron 可选，放在 M8 后，不阻塞 Web。

M5 是第一条可试用的阅读技术 MVP；M6–M7 扩成科研工作台，M8 才称可交付自托管 MVP。建议每个节点一个可演示的纵向增量，不先把全部页面做完再接后端，也不先构建通用多 Agent/多租户框架。暂不承诺日期，以验收结果决定进入下一节点。

每个节点必须同时满足：实现/文档、对应测试（含失败路径）、累计回归、验收证据与 git commit。自动测试通过但人工/模型项未验收，只能标待验证；不能标 completed。每次变更必须更新测试并提交 commit，符合仓库 AGENTS.md。

## 2. 可执行验收与证据格式

D0 使用当前已有 PowerShell/Node 文档契约测试。下面的 `pnpm verify:milestone ...` 是**规划命令，当前不存在**，由 M1 创建验收 dispatcher；每个后续节点增加自己的实现/样例/验证器，不允许空脚本或 skip 返回成功。`pnpm test`、`pnpm test:e2e`、模型 eval 也是后续要提供的入口，不能现在当已通过结果展示。

dispatcher 按节点执行文中检查，输出 `artifacts/acceptance/<ID>/<runId>/report.json`，记录 commit、OS/运行时/数据库/SDK/模型/toolchain/Skill commit、输入 hash、每项 expected/actual/status、命令退出码、人工签核、成本与证据路径。截图、trace、API/工具审计、产物及 hash 清单按需同目录保存；普通 evidence 不含 API key/秘密。

任何 required 检查失败/缺证据，退出非零；缺模型凭据/执行器属于 blocked 而非 passed；人工或 live_model 项未完成是 pending，不能给总结果 passed。自动回归可用确定性模型桩；只有显式 live_model 验收才证明真实模型执行，二者报告分开。用户质量评审不写死在 CI 返回值里冒充自动结论。

所有下述 fixture 在对应节点创建并登记许可证/hash：优先自有微型论文，禁止把许可不清晰的商业全文放仓库。fixture 名称与目录是规划，并非本次已经创建。

## D0 — 文档与验收基线（本次范围）

- 依赖：无。交付：产品、技术、路线、机器可读节点清单与架构图源文件，更新 README 导航。
- 输入：当前仓库文档、既有 Demo、节点清单；不运行模型或下载/安装 Skill。
- 验证：`./tests/product-design.tests.ps1` 与 `./tests/architecture-docs.tests.ps1`，再跑全部既有 Demo 测试及 `git diff --check`。
- 通过：产品明确 Server/Web/Pi 边界、Skill/排版/数据与未实现状态；节点无重名/缺依赖/环，均有输入、交付、命令、量化标准、负例和证据路径；文档本地链接与图的节点/边有效。
- 负例：契约测试用内存变异清单验证缺标准、坏命令、循环依赖、缺节点、假完成状态会失败。
- 证据：测试输出与本次 commit。图结构验收不等于部署/功能验收。

## M1 — 可启动、可持久化、可鉴权的 Server

- 依赖：D0。交付：monorepo 骨架、API＋单 Worker 生命周期、SQLite 迁移、dataRoot、登录/能力接口、验收 dispatcher；固定 Node/DB driver 及安全补丁。
- 输入：空临时 dataRoot、测试身份、Server A 与浏览器机器 B；本机 loopback 与受保护私网两种配置。
- 验证（规划）：`pnpm verify:milestone M1`，API 集成＋进程重启＋跨机器操作记录。
- 通过标准：创建项目/资产元数据后重启，ID/字段/hash 100%一致；迁移重复执行不损坏数据；未登录读/写私有 API 均 401/403；错误 Origin/CSRF 被拒；B 能登录连接 A，数据只在 A 的 dataRoot；单用户配置下第二 Worker 无执行许可。
- 负例：无权限/只读或不存在的存储根、坏配置、数据库写入失败必须明确报错；不因绑定 0.0.0.0 自动关闭鉴权；日志不含测试秘密。
- 证据：`artifacts/acceptance/M1/` 中健康/鉴权请求、迁移与重启日志、B→A 操作录像/截图、DB 对账。

## M2 — 真实 Web 项目与 PDF/证据资产

- 依赖：M1。交付：新 apps/web 的明亮工作台、真实项目/上传/API、PDF 预览与源块、Markdown 笔记/证据；保留所有旧 Demo。
- 输入：自有 `paper-text-v1.pdf`（3 页、可选择文本、已知段落/页码），同内容重传与换版 PDF；坏 PDF、大文件、恶意文件名、两个项目。
- 验证（规划）：`pnpm verify:milestone M2`，浏览器真实上传/读写，不 Mock API；PDF 文本/坐标金标准检查。
- 通过标准：上传后的 Server 原文件 hash 与客户端一致；刷新和 API 重启后仍能打开 PDF/笔记/证据；全部金标准块能定位正确页，至少 10 个点选来源定位无误；新 PDF 版本不沿用旧坐标；两项目材料不会串入；键盘可操作导航/标签/对话附件。
- 负例：越界路径/symlink、非法 MIME/坏 PDF、超限上传、跨项目资产 ID 被拒或明确失败；Markdown 脚本不执行。各失败 UI 可见，不能显示假预览。
- 证据：`artifacts/acceptance/M2/` 的 Playwright trace、源块对照、hash、权限/输入负例报告与空/错/断线截图。

## M3 — 真实 Pi＋持久 Run、流式、重连、取消

- 依赖：M2。交付：PiAdapter、受控 ResourceLoader/工具、Run 状态、Session 快照、持久事件 seq、审批/幂等/取消/进程中断策略。
- 输入：确定性模型桩（控制工具/失败/延迟），真实模型只读任务，30 秒受控长任务，模拟断网/Worker kill/外部动作不明样例。
- 验证（规划）：`pnpm verify:milestone M3`，确定性故障注入＋一次 live_model SDK/tool smoke；两类结果分别保存。
- 通过标准：同幂等键重复提交 10 次只有 1 个 Run（参数不同时 409）；断线 10 秒、刷新 3 次和关闭页面 30 秒均不新增模型请求，最终文本/工具事件按 seq 去重无缺失；重连同 runId；取消请求在受控样例 5 秒内停止 Worker/子进程；Worker 中断后旧 Run 10 秒内识别为 interrupted、不自动重发；手动重试有新 attempt。
- 负例：缺模型凭据 blocked；SDK/tool error 有失败原因；Skill/项目文件不能触发加载未知扩展或读取私密文件；撤销登录后 SSE 关闭；审批过期/版本不匹配不执行。外部副作用不明标 interrupted，不假装回滚。
- 证据：`artifacts/acceptance/M3/` 的请求计数、持久事件、状态转移/时钟、真实 SDK/tool 审计、取消与恢复日志。

## M4 — 用户/项目/工作区/对话 Skill 系统

- 依赖：M3。交付：受控导入/版本、依赖报告、scope 配置、对话选择器、完整正文/按需资源加载与 Run 快照。先用自有测试包，再预检 nature 包。
- 输入：两个工作区各自默认 Skill，同名不同来源包，shared 相对引用、正文尾部独特标记、缺资源/脚本/依赖与恶意越界包；固定上游 nature commit（实施时填写真实 hash）。
- 验证（规划）：`pnpm verify:milestone M4`，资源解析单测＋真实 SDK 上下文/工具审计＋浏览器选择流程。
- 通过标准：显式选择在两个工作区均覆盖默认；同名包来源可辨；正文尾部与全部必要核心资源完整进入本次上下文，hash/EOF 审计一致；匹配片段加载、无关片段不默认全部加载；更新库不改变运行中包 hash；完整 nature 包 shared 与 pdf Skill/验证脚本需求均有明确报告。
- 负例：缺 shared/pdf Skill/工具依赖标 partial 或 blocked，执行必要流程前阻断；越包根/junction/解压穿越被拒；包含专有 hooks/MCP/子代理不能标全兼容；Skill 文本不自授权限；改 Skill 开新 Session，不静默污染旧任务。
- 证据：`artifacts/acceptance/M4/` 的 scope 解析、导入能力报告、完整加载 hash、上下文审计、选择 UI trace。只看下拉框存在不算完成。

## M5 — nature-reader 真实中英对照闭环（阅读技术 MVP）

- 依赖：M4。交付：完整上游 Skill 执行、通用产物登记与双语/公式/图表/来源渲染；阅读版、后续问答、选段路径区别可观察。
- 输入：两份合法自有短论文：3 页含图/表/两公式与纯文本短文，金标准段落/图片/公式/页块；扫描/缺页/缺图样例。不将标准答案正文提供给模型，也不预置生成产物。
- 验证（规划）：`pnpm verify:milestone M5`，确定性验证器＋真实模型每份论文各 3 次独立全文 Run，固定模型/参数/Skill commit/输入 hash；另测后续问答与选段。真实执行要求 API 凭据，不以 Mock 代替。
- 通过标准（全部适用 Run）：真实生成 paper.md/source_map.json/translation_notes.md/assets；源段落覆盖 100%（按 fixture 金标准归一化匹配），英中块配对 100%，所有 asset 链接/源引用合法，10 个来源点选全部正确，JSON/公式确定性检查全部通过；公式语义/token 保持，图表关联无遗漏；问答不重建阅读器，选段不生成全文。
- 人工质量：每份论文每次抽查至少 20 个固定段落（短文不足时全查），至少 90% 无实质误译；关键结论/数字/否定/公式错误 0，虚构原文/来源 0。评审记录逐项理由，任一 Run 不达标则节点未通过，不能只挑最好一次截图。
- 负例：扫描无 OCR、缺全文/资源或验证失败不发布 complete，显示 draft/blocked 和缺失说明；不能以摘要替代全文。记录时间/token/成本，初始不设未经测量的模型性能 SLA；超过用户预算会中止并保留草稿。
- 证据：`artifacts/acceptance/M5/` 的 6 次真实 Run、完整加载/工具审计、产物 hash、覆盖/公式/来源报告、人工评分与截图。通过后再邀请目标用户试用，而非马上扩全部页面。

## M6 — 证据→写作 Skill→真实排版 PDF

- 依赖：M5。交付：写作与排版正式工作区、稿件/模板/引用、提案 diff 与审批、版本保存、隔离 LaTeX 构建/PDF 预览与导出；Markdown/BibTeX/CSV 基础导出。
- 输入：自有两页稿件模板（2 个引用、1 个图、1 个公式）、M5 证据、写作 Skill（来源锁定）、陈旧 patch、无效 citation、TeX 报错/文件泄漏/命令/超时样例。
- 验证（规划）：`pnpm verify:milestone M6`，确定性构建/版本测试＋至少一次真实写作 Skill 生成与用户审批全链路。
- 通过标准：未经审批不改正式稿件，批准后恰好新增 1 版本；并发编辑/重复批准不会覆盖新版本；绑定引用全部存在/可追溯；真实产出两页 PDF，关键文本/图/公式检查与截图布局审查通过；下载的源/PDF hash 对账；失败构建保留上一成功 PDF并清楚标注版本，不显示本次成功。
- 负例：无执行器/依赖 blocked，不回退宿主；TeX 无网络/秘密访问/shell-escape，攻击样例不产生预期泄漏/命令副作用；受控超时样例在 60 秒内结束（测试资源限额固定）；编译/引用错误日志可见。禁 shell-escape 不替代完整隔离。
- 证据：`artifacts/acceptance/M6/` 的 Skill/审批审计、diff、源与 PDF/hash、引用/布局检查、构建/攻击负例日志。

## M7 — 结果导入＋隔离 CPU 实验 Lite

- 依赖：M6。交付：结果/配置导入、实验列表/日志/指标视图、批准固定代码运行、可复现 Run 元数据与结果关联稿件/证据。
- 输入：自有固定 seed 的小型 CPU Python 脚本（无网络，生成 CSV/图）、镜像和输入文件；坏结果 schema、越界/网络/资源耗尽代码。
- 验证（规划）：`pnpm verify:milestone M7`，导入契约＋执行器故障注入＋两次独立重跑，浏览器审批/结果引用流程。
- 通过标准：导入不自动执行代码；未批准执行数为 0；批准后在固定输入/代码/环境下重跑两次，确定性 CSV hash 相同、指标绝对误差≤1e-6；配置/seed/代码/镜像/输入输出 hash/argv/日志/exitCode 记录 100%齐全；结果能从稿件/证据追溯到 Run。
- 负例：禁未授权网络/宿主文件，攻击无副作用；失败/超时/磁盘满可见且不标成功；不可用执行器 blocked，不回退宿主；历史配置重跑创建新 Run、不覆盖旧结果。容差只适用于固定测试，不泛化为全部科研实验保证。
- 证据：`artifacts/acceptance/M7/` 的两次 Run/config/CSV/hash/指标、审批与隔离报告、UI trace 与来源关联。

## M8 — 可交付自托管版本、恢复与安全回归

- 依赖：M7。交付：首个完整 Linux 自托管包/容器配置、权限与能力文档、服务管理、备份/恢复/升级、独立机器浏览器连接指南、累计验收报告；非 Linux 能力明确标支持/限制。
- 输入：干净 Linux Server A、独立浏览器机器 B、全新恢复目录、M5/M6/M7 项目、服务重启/队列任务/异常磁盘与网络样例。
- 验证（规划）：`pnpm verify:milestone M8`，从干净环境按 README 安装运行，执行跨机器 E2E、备份到空目录恢复、升级失败恢复、安全负例和累计回归。无公网暴露授权时用受保护私网验证。
- 通过标准：B 连接 A 完成上传→真实双语→稿件 PDF→实验记录；页面关闭后后台继续，服务重启正确标 interrupted；恢复后项目/源/PDF/实验/证据 hash 和关联 100%一致，不自动重发旧模型任务；普通备份无密钥、重配凭据可继续；全部必要 gate 与累计回归 passed，人工签核齐全。
- 负例：鉴权/CSRF/跨项目/越界路径/XSS/SSRF/扩展加载/脚本/TeX/审批重放负例全部通过；磁盘满不损坏已成功产物；不以“容器启动了”代替运行链路与恢复验收。
- 证据：`artifacts/acceptance/M8/` 的安装环境/步骤、B→A trace、备份恢复 hash 对账、故障/安全报告与发布 commit。修正文档若需人工补步骤，重新从干净环境复跑。

## E1 — Electron 客户端（可选，不阻塞 Web）

- 依赖：M8。交付：复用 Web 的桌面壳，连接远程 Server；内置本机 Server 是另一个显式配置，含服务生命周期与窄 IPC。
- 输入：远程连接 fixture、本机 Server 启停、离线/端口占用/恶意页面，目标 OS 的安装包。
- 验证（规划）：`pnpm verify:milestone E1`，Web 共用回归＋目标平台安装/关闭/升级与安全 smoke。
- 通过：远程模式不偷偷在客户端运行实验；本机模式服务启停无孤儿进程，端口冲突可诊断；同输入产物 hash 与 Web 一致；渲染器无 Node 权限，IPC 来源/参数受限；每个宣称支持 OS 均有安装启动退出记录。
- 负例：恶意网页不能用 IPC 读宿主秘密；网络断开不宣称离线可执行；未实现平台不得标支持。
- 证据：`artifacts/acceptance/E1/` 的各平台日志、安装/连接/生命周期 trace、安全与共用 gate 报告。

## 3. 推荐先做什么、暂不做什么

下一步实际编码先做 M1，并准备 M2 的自有 PDF；M3 先安全只读真实 Pi，再做 M4/M5。若 M5 表明 Skill 依赖/质量不达标，先解决工具/解析/上下文，不能靠多做几个 UI 主题掩盖。

在线文献源、OCR/DOCX、Fork、团队/多 Worker/数据库迁移属于后续独立增量，实施前各自定义输入、失败路径、阈值与证据；没有验收定义不加入 MVP 承诺。主线安全从 M1/M3 开始，M8 是汇总发布检查，不是最后才补安全。
