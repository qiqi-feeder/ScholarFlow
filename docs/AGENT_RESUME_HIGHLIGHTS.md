# ScholarFlow：Agent 能力亮点与简历选材

更新：2026-10-26（Asia/Taipei）。用途：把已讨论的 Agent 设计整理成可选的简历素材与面试讲解提纲。本文不授权业务实现，不改变现有实施计划，也不把方案整理视为功能交付。

## 1. 怎么理解这里的排序

排序面向 Agent 应用开发与工程岗位，综合考虑机制设计难度、与 Agent 的直接关联、复杂失败场景和可验证性，是选材建议，不是行业统一评分。前三项适合作为项目主线；第四项体现科研场景差异；第五项只有做出真实评测后，才能成为很有说服力的成果。

**技术含金量与当前可写程度分开看。** 动态能力装配的讨论价值高，但当前更适合写“设计”；后台执行和结果校验已有较具体的代码及测试，较容易形成可展示的工程证据。

状态口径：**已有代码与测试**表示本轮查到相关实现和测试源码；**已讨论待实施**表示已有架构共识，但不能写为完成；**待评测**表示尚无效果对照。本文的源码核对不替代真实模型、目标实验或故障场景验收。各项具体边界见下文。

| 排名 | 编号 | 能力亮点 | 主要证明什么 | 当前边界 |
| --- | --- | --- | --- | --- |
| 1 | A01 | 动态能力装配与渐进式工具暴露 | Agent 架构、工具发现、Skill 与工具协同 | 已讨论待实施；现有 load_skill 只读取说明 |
| 2 | A02 | 长任务上下文与持久研究记忆 | Context Engineering、状态恢复、信息归属 | 已有代码与测试；相关性选择和统一预算待补齐 |
| 3 | A03 | 有副作用工具的异步执行与恢复 | Durable Execution、幂等、进程与会话解耦 | 已有代码与测试；真实目标实验和完整故障矩阵未验收 |
| 4 | A04 | 基于真实产物的分层验证闭环 | Tool Grounding、完成判定、错误反馈 | 已有代码与测试；科学结论有效性仍需研究者判断 |
| 5 | A05 | Agent 评测与机制消融 | 实验设计、轨迹分析、收益归因 | 待评测；已有方案，不能填写提升数字 |
| 6 | A06 | 宿主控制的自主执行与人工确认 | Human-in-the-loop、权限、预算和执行门控 | 已有代码与测试；不等于操作系统沙箱 |
| 7 | A07 | 带来源和版本的证据工具链 | 领域工具设计、检索反馈、事实归属 | 已有代码与测试；公开全文获取和精确页码证据待补齐 |

建议项目定位：**基于 Pi 构建面向长期科研任务的 Agent Harness，围绕动态能力装配、持久上下文与可验证执行补充领域机制。** Harness 指模型运行所需的工具、状态、执行、约束和验证环境。Pi 提供运行循环、会话、压缩等基础能力，ScholarFlow 的贡献应落到宿主与科研领域机制。

相关依据：[当前产品共识](WORKSPACE_PRODUCT_DISCUSSION.md)、[Agent 能力架构](AGENT_CAPABILITY_ARCHITECTURE.md)、[实施与验收计划](../PLAN.md)、[上游调研与固定快照](research/HARNESS_SURVEY_2026-10-20.md)。

## 2. A01：动态能力装配与渐进式工具暴露

### 为什么排第一

它直接涉及 Agent 每次决策时能看到哪些方法和工具，以及如何在同一任务中扩展能力。能讲清发现、加载、调用和恢复的关系，比单独列出“接入若干工具”更能体现架构能力。

工具数量增加会带来更大的输入、相似工具之间的选择困难和更多无效调用机会。按需装配的目标是控制这些成本；具体是否改善质量、延迟和费用，要通过 A05 评测。

### 核心实现设计

1. **能力注册表**：维护能力 ID、简短用途、依赖、关联工具和 Skill 来源版本。工具注册与活动状态分开。
2. **最小初始集合**：向模型提供基础查询、能力发现/加载、必要恢复入口，以及简短目录；详细参数和 Skill 正文按需提供。
3. **Agent 自主选择**：主 Agent 根据目标请求能力；切换页面不自动强制更换能力，不默认每轮增加一个分类模型。
4. **宿主检查**：检查能力存在、凭据/依赖、项目归属、预算与权限，再读取方法并激活工具；失败返回具体原因。
5. **请求之间更新**：同一条用户消息处理中，加载结果返回后，下一次模型请求携带新的工具集合。
6. **任务隔离与恢复**：活动集合属于任务；重开和切换模型时重新验证，历史“曾加载”不代表当前可执行。

实现示意（候选流程，不是现有接口或可直接运行代码）：

```text
loadCapability(taskId, capabilityId):
    lock(taskId)
    definition = registry.require(capabilityId)
    host.validate(definition, currentProject, credentials, policy)
    method = readSkillWithVersion(definition.skill)
    desired = union(requiredCoreTools, task.activeTools, definition.tools)
    session.setActiveTools(desired)
    assert actualActiveTools contains every required tool
    persist task capability references and activation record
    return method + actual availability + source version
```

如果激活或保存失败，应恢复旧活动集合并记录失败，不返回“加载成功”；多项依赖应先完成预检。任务锁应与发消息、模型切换协调，避免并发改动污染下一次请求。

Pi 的 `setActiveTools()` 替换整个活动集合，调用时应保留必要核心工具；未知名称可能被忽略，因此必须检查实际结果。停用不清除已占用的历史上下文，隐藏工具也不等于阻止所有执行入口。

### 自己负责的部分与上游参考

Pi 已提供工具注册、活动工具切换和 Skill 机制；自己的工作应是能力目录、领域映射、宿主校验、任务级装配与恢复一致性。当前代码入口：[agent.ts](../apps/server/src/agent.ts)、[agent-tools.ts](../apps/server/src/agent-tools.ts)、[skills.ts](../apps/server/src/skills.ts)。目前仍一起启用研究工具，`load_skill` 不会自动激活工具。

参考 [Pi 扩展文档](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/docs/extensions.md)的扩展与工具机制；参考 [Deep Agents Skill 中间件](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/deepagents/middleware/skills.py)的方法与工具联动。借鉴机制不意味着把两套运行框架叠加。

### 验证与面试追问

关键用例：同消息加载后继续调用；缺凭据不报成功；未知工具名不能静默漏启用；任务 A/B 活动集合不串用；压缩后查询/取消仍可用；模型切换与加载并发得到明确处理。对应既有架构验收 AT01–AT04。

面试需要回答：为什么不一次提供所有工具？为什么读取 Skill 不等于执行授权？停用后输入量为什么不一定下降？如何处理模型请求缓存与装配变化的权衡？

**当前可用简历措辞：**“设计基于 Pi 的任务级动态能力装配方案，通过能力目录、按需 Skill 加载与宿主校验，组织跨调研、实验和写作的领域工具。”

**实施验收后可升级：**“实现任务级工具渐进暴露与能力加载，支持同轮工具集更新、依赖校验和会话恢复后的能力重建。”当前不能使用这句完成式。

## 3. A02：长任务上下文与持久研究记忆

### 为什么含金量高

科研任务的难点是多轮讨论后仍能保留正确约束：哪份方案已确认、数字来自哪次实验、哪些内容只是模型假设。持久记忆需要可回查的业务记录，不能只靠摘要描述“已经完成”。

### 核心实现设计

将信息分成三层：项目层保存材料、方案、运行和稿件；任务层保存独立会话及当前目标；请求层按当前问题选择小规模视图。上下文条目记录类型、来源 ID、版本/哈希及核验状态。

当前实现通过 `buildTaskContext` 区分已确认方案、论文陈述、实测结果、待验证假设和审稿意见；保存 `context.json` 与 `context.md`，提供 `get_research_context` 供 Agent 找回来源、条件和 runId。Pi 负责通用会话压缩，宿主负责恢复研究事实。

进一步的已讨论设计是：常驻简短目标和目录；正文/日志/大表存后台；按论文、运行或稿件对象读取；对工具参数、Skill、历史和返回结果统一计量并预留输出空间。需要按模型窗口实测，字符数估算不能写为精确 token 预算。

重要现状：`ContextService.build()` 仍汇集项目材料和运行，**尚未形成完整的相关性选择、分页读取和统一上下文预算**。局部摘要截短也不能算已经解决项目规模增长问题。

### 代码、参考与验证

代码：[上下文服务](../apps/server/src/context.ts)、[来源标注组装](../packages/research/src/context.ts)、[上下文测试](../packages/research/test/context.test.ts)。现有测试覆盖确认来源、runId/指标保留、草稿不升级为已确认方案，以及跨项目材料排除。

参考 [DeerFlow 持久上下文](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py)的独立状态组织，以及 [OpenCode 压缩实现](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts)的任务交接摘要。这里借鉴状态和摘要应保留的信息，不宣称自研了 Pi 压缩算法。

有价值的验证：压缩后查回同一 runId、数据划分和方案版本；大资料集下输入量保持有界；模型不能将待验证假设升级为事实；恢复查询不能重新提交外部实验。指标可使用关键条件找回率、错误归属率、上下文输入量和恢复调用次数，均需留存原始轨迹。

面试需要回答：数据库与“记忆”如何关联？为什么向量检索不适合直接替代 runId 查询？摘要和持久记录冲突时信任谁？

**当前可用简历措辞：**“实现来源标注的研究上下文组装，将确认方案、实验运行和指标来源持久化，并提供恢复查询工具支持长任务继续处理。”

**待验证后补充：**“在压缩/重开场景下保持关键条件找回率为〔实测值〕，相比基线减少〔实测值〕输入量。”两个数值必须分别测量，不能推定同时改善。

## 4. A03：有副作用工具的异步执行与恢复

### 为什么含金量高

模型调用可能重试，但训练任务不能因网络重试重复启动。聊天结束、外部进程结束和研究目标达成都有各自生命周期。这类问题能体现 Agent 与真实系统交互时的工程深度。

### 核心实现设计

工具提交后返回 runId，由独立 worker 管理队列、日志、超时和取消；Agent 保存等待状态并结束当前响应，之后按需查询运行。页面连接、推理会话和实验进程分别管理。

持久运行记录包含请求 ID、项目/任务、配置指纹、快照、运行状态和核验状态。请求 ID 用于识别同一次逻辑提交；配置指纹用于比较内容。**相同配置的新请求可以是有意重复实验，不能全部去重。**

```text
submit(project, requestId, spec):
    existing = store.findByRequest(project.id, requestId)
    if existing:
        reject if existing fingerprint differs from spec
        return existing.runId
    validate confirmed plan, approval, limits and snapshot
    persist intent, snapshot and queued run
    worker later claims and executes the run

recover(run):
    inspect worker record and actual process identity
    if execution state cannot be confirmed:
        mark unknown; do not automatically launch again
```

这是语义示意；数据库唯一约束与启动协调仍然必要。尤其要分析“进程启动成功、运行记录尚未写完就崩溃”的窗口。数据库去重或会话检查点都不能自动证明所有外部副作用 exactly-once。

取消时核对 PID、启动身份和时间，防止 PID 复用误杀；停止 Agent 回答与取消实验是不同操作。`unknown` 是需要协调的状态，不能简单归为失败然后自动重跑。

### 代码、参考与验证

代码：[实验服务](../apps/server/src/runs.ts)、[运行存储与快照](../packages/experiment-worker/src/store.ts)、[worker](../packages/experiment-worker/src/worker.ts)、[进程执行](../packages/experiment-worker/src/runner.ts)。

[worker 测试](../packages/experiment-worker/test/worker.test.ts)包含同请求复用、同请求不同配置冲突、单并发、超时、重启 unknown、PID 身份不符拒绝取消和独立进程运行等。小进程测试能够验证控制行为，不能替代真实目标科研实验。

参考 [LangGraph 运行循环](https://github.com/langchain-ai/langgraph/blob/1400d25b7b88cfa055c55b8a82bd95b7c25caef1/libs/langgraph/langgraph/pregel/_loop.py)理解持久化与恢复；参考 [OpenHands 事件存储](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/openhands-sdk/openhands/sdk/conversation/event_store.py)理解会话事件及恢复边界。ScholarFlow 继续使用 Pi，不因此引入第二套 Agent 编排框架。

建议演示：重复提交同一请求只产生一个逻辑运行；新请求可以重复相同配置；运行中重启 worker 后标记 unknown 并保留日志；错误 PID 身份不被终止。分别记录行为，避免用一句“支持断点续跑”掩盖实际恢复范围。

面试需要回答：为什么 requestId 与 fingerprint 不能合并？何时先查询再重试？进程恢复、任务恢复和模型会话恢复有什么差别？

**当前可用简历措辞：**“实现 Agent 与独立实验 worker 协同执行，通过请求幂等、配置快照、单并发队列及进程身份校验，处理长任务的重试、超时、取消和重启后未知状态。”

## 5. A04：基于真实产物的分层验证闭环

### 核心价值

工具被调用不代表研究任务完成。完成判定应逐层收集证据，给 Agent 返回具体缺项，使后续决策有依据。

| 验证层 | 具体检查 | 不能据此推出什么 |
| --- | --- | --- |
| 执行层 | 退出码、终止原因、预期产物、日志 | 退出码为零不能证明复现达标 |
| 归属层 | runId、文件、JSON pointer、哈希、结果版本 | 数字确实存在不能证明比较对象正确 |
| 条件层 | 数据版本/划分、预处理、任务设置、指标方向、预算与种子差异 | 同条件不能自动证明统计显著或方法创新 |
| 结论层 | 论断是否获得证据支持、限制是否披露 | 程序检查不能穷尽科学解释错误 |

### 核心实现

指标从约定的原始文件提取，拒绝缺失、非数值和非有限值；每个指标保留运行、文件位置、哈希和条件。比较器发现关键条件不一致时返回不可直接比较，必要时不生成排名图；失败与负结果可以形成报告。

```text
observation = executeOrQuery(toolCall)
artifactCheck = validateArtifacts(observation.runId)
metrics = parseMetricsWithProvenance(artifactCheck.files)
comparison = compareDeclaredConditions(metrics)
return execution status + validation status + limitations + source references
```

这里的自有贡献是来源结构、比较规则、失败语义及反馈契约。现有比较条件主要依配置字段和既定规则抽取，完整性取决于记录质量，不能声称自动理解任意科研条件。

代码：[指标与比较](../packages/research/src/metrics.ts)、[分析服务](../apps/server/src/runs.ts)、[指标测试](../packages/research/test/metrics.test.ts)。现有测试覆盖来源信息、无效指标、不同划分不可比、少种子提示以及结果版本。稿件构建另见 [latex.ts](../apps/server/src/latex.ts)，保存版本与 PDF 构建版本也属于产物一致性。

参考 [Harbor 验证器](https://github.com/harbor-framework/harbor/blob/77094ca610014a3c7c2dcac6a29ef01f7ef800c8/src/harbor/verifier/verifier.py)的独立产物检查及无效结果处理。其他科研验证器参考集中保留在既有[调研 S05](research/HARNESS_SURVEY_2026-10-20.md#s05--验证实测结果可比结果与结论支持分层检查)，避免把数字登记误写成自动科学审查。

建议故障注入：旧指标文件、错误 runId、缺字段、不同划分、smoke 结果冒充 target、未核验结果请求排名。统计错误接受率，同时统计合法结果被误拒的比例。

面试需要回答：验证器与生成模型的职责怎样分开？如何防止旧成功污染新运行？验证器本身如何测试？为什么不能承诺“消除幻觉”？

**当前可用简历措辞：**“构建执行、指标来源与条件可比性的分层校验，将指标绑定 runId、原文件位置和哈希，对缺失产物、不可比结果及负结果返回结构化反馈。”

## 6. A05：Agent 评测与机制消融

### 为什么值得单列

能说明为什么要加某项机制，并用对照证明收益，往往比继续增加功能更有面试说服力。本项当前没有评测成果，排序反映潜在价值。

### 核心评测设计

基线采用基础 Pi 加相同科研 Skill；实验组加入 ScholarFlow 的对应机制。固定任务材料、模型及参数、底层工具权限、初始状态与预算，区分本轮只比较工具暴露还是其他变量。

至少安排以下任务族：工具选择与能力加载；压缩后找回条件；断连/重试下的提交；相同数字但不同实验条件；等待实验及负结果写作。包含正常、失败、材料不足场景，按预先固定规则全部报告，不能只选成功轨迹。

逐项关闭动态装配、来源上下文、执行去重或结果检查，观察变化。执行幂等与归属规则先做程序测试；模型是否主动查询、能否正确解释限制，再做真实模型任务。不要用程序测试通过率代替 Agent 成功率。

| 问题 | 可测指标 | 必须保存的证据 |
| --- | --- | --- |
| 是否正确完成任务 | 按固定验收规则的成功/部分完成/失败比例 | 输入、最终产物、验证结果 |
| 动态装配是否值得 | 输入 token、无效工具调用、端到端延迟、成功率 | 每次请求活动工具集合、usage、工具轨迹 |
| 压缩后能否继续 | 关键条件找回率、错来源率、重复提交次数 | 压缩事件、恢复查询、runId |
| 验证能否拦错 | 错误接受率、正确结果误拒率 | 注入样本及逐项检查输出 |
| 是否改善成本 | 实际调用量、可得费用、作业时间、人工干预次数 | 用量、计价版本、人工操作记录 |

建议用成对运行降低任务差异，报告次数、波动、失败原因和原始记录；少量重复只适合初步观察，不能据此断言稳定优势。未配置价格时只报告实际 usage 与未知费用，不虚构账单。

参考基线复杂度的思路见既有[mini-SWE-agent 调研](research/HARNESS_SURVEY_2026-10-20.md#h11--mini-swe-agent用简单循环作为复杂机制的对照)；产物验证可借鉴 A04 的 Harbor。评测方案对应 PLAN 的 V15，当前未执行。上游项目的成绩不能记入本项目。

面试需要回答：比较变量是什么？工具权限是否相同？重复次数是否足够？失败样本是否保留？收益来自哪一层？

**当前可用表述：**“设计基础 Pi 与领域 Harness 的配对评测方案，覆盖能力加载、上下文恢复、重复提交和结果归属，并规划逐项消融。”

**评测完成后句式：**“在〔任务集/模型/次数〕条件下，相比〔基线〕将〔指标〕从〔实测值〕改善至〔实测值〕，同时报告延迟、成本和失败类型。”此句含待填项，不可直接作为已完成成果。

## 7. A06：宿主控制的自主执行与人工确认

### 核心实现

将“模型建议做什么”和“系统允许执行什么”分开。模型可以提出实验方案；宿主检查已确认方案、准入材料、精确配置、项目归属与资源限制；用户批准后才排队执行。恢复后再次检查仍有效的前置条件。

批准应绑定本次配置指纹，不能由一句笼统“同意实验”覆盖后续任意改参。新目标、扩大预算和正式稿件覆盖应遵循明确确认边界。等待批准时保存状态，正常结束本轮回答。

当前代码：[实验提案与批准](../apps/server/src/runs.ts)、[复现准入](../packages/research/src/admission.ts)、[路径约束](../packages/research/src/paths.ts)、[Agent 规则](../apps/server/src/agent.ts)。[服务测试](../apps/server/test/server.test.ts)和[准入测试](../packages/research/test/admission.test.ts)提供部分执行门控证据。

重要边界：领域服务具备检查，不代表已经覆盖所有通用执行路径。Pi 扩展和本地命令具有宿主权限，Conda 与目录限制不构成操作系统沙箱。论文和日志作为不可信数据处理是必要设计，但仅有系统提示词不能证明全面防御提示注入。

参考 A03 的 LangGraph 中断与恢复思路，以及 A01 的 Pi 扩展入口；不把框架有 hook 等同于产品已经完成全链路权限治理。

有价值的验证：未确认方案拒绝、准入不足拒绝、跨项目请求拒绝、批准后条件变化拒绝、超预算拒绝；并检查其他工具入口能否绕过同一约束。恢复后不可复用已经失效的批准。

面试需要回答：哪些行为由模型判断，哪些由程序硬约束？批准绑定什么？通用工具能否绕过专用工具检查？

**当前可用简历措辞：**“在领域实验服务中实现方案确认、材料准入与用户批准门控，结合项目归属和运行预算约束 Agent 提交行为。”避免扩大成“实现安全沙箱”。

## 8. A07：带来源和版本的证据工具链

### 核心价值与实现

Agent 需要知道“这段信息属于哪篇论文、哪个版本、哪次运行”。检索、获取原文、收集证据和组织答案应该保留各自状态；论文标题命中不代表拿到全文，数字命中也不代表实验实际发生。

设计上将工具包装成有业务语义的动作，统一返回对象 ID、版本、状态、证据位置、限制和可继续读取的入口。MCP 可以连接外部服务，但宿主仍负责领域语义、归属校验和可用状态。

用户引用由宿主解析并核对对象归属、版本和精确选区，保存本条消息所用的内容快照。研究记录随后可进入 A02 的记忆和 A04 的核验。工具返回有界内容，大文件通过引用继续读取；不能以截断摘要冒充完整原文。

代码：[引用解析](../apps/server/src/references.ts)、[材料服务](../apps/server/src/materials.ts)、[研究工具](../apps/server/src/agent-tools.ts)。[服务测试](../apps/server/test/server.test.ts)中已有伪造引用拒绝、精确选区快照及重试/重启保留测试。现阶段页码定位仍有全文摘要局限，公开全文获取、完整位置证据和系统化证据反馈仍待补齐，不能写成已经完成 Agentic RAG。

参考 [PaperQA 搜索、证据收集与回答工具](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py)的分步证据处理。模型可根据证据不足继续检索，但具体反馈策略与评价需要本项目验证。

验证应覆盖错版本、跨项目、选区伪造、未获取全文和证据不足；检索召回率、引用准确率和最终答案支持率要分别评估。

面试需要回答：什么时候用精确对象查询，什么时候用文本检索？全文、摘要和模型解释怎样区分？引用过期怎么办？

**当前可用简历措辞：**“设计来源与版本感知的领域工具，实现在消息引用端校验项目归属、对象版本及精确选区，并保存可恢复的引用快照。”

## 9. 简历如何挑选与组合

### 推荐选择

| 目标岗位 | 优先选择 | 讲述重心 |
| --- | --- | --- |
| Agent 应用开发 | A01＋A02＋A04 | 能力组织、持续上下文和可验证结果 |
| Agent 平台 / 后端工程 | A03＋A01＋A06 | 外部副作用、状态一致性与宿主门控 |
| 偏评测与优化的岗位 | A05＋A02＋A04 | 同条件对照、失败归因及真实收益 |
| 当前就准备投递 | A03＋A04＋A02 | 优先展示已有实现；A01 单列为设计工作 |

选三条即可，不必把所有术语塞进简历。A02 与 A07、A03 与 A06 有关联，可以合并；每条保留一个核心问题、一组机制和一份可展示证据。

### 基于当前代码的简历素材组合

以下是根据代码核对拟定的候选文案，使用者应确保属于自己实际完成且能现场解释的工作。这里不填尚未进行的效果对照：

> 基于 Pi SDK 构建科研 Agent 宿主，组织任务级会话与研究上下文，将已确认方案、实验运行和指标来源持久化，并提供恢复查询入口。
>
> 实现独立实验 worker 与 Agent 协同，通过请求幂等、配置快照、单并发队列、超时取消及进程身份校验，管理长任务执行和重启后的未知状态。
>
> 实现指标来源与实验条件校验，将结果绑定运行、原始文件位置和哈希，对缺失指标、不可比条件与负结果生成可追溯反馈。

若需要突出架构设计，可以将其中一条替换为 A01 的“设计”版，明确动态装配尚待实施。不要将“设计”全部改成“实现”。

### 不建议单独当主亮点的内容

“接入 DeepSeek”“使用 Pi”“支持 MCP”“有 Skill”“会话支持模型切换”可以作为技术栈或配套能力。只有说明它们如何解决能力发现、状态隔离、恢复或验证问题，才形成更强的 Agent 叙述。

固定多 Agent 团队、树搜索、向量数据库和复杂知识图谱均不属于当前确认主线；不要为了关键词把它们补进简历。worker 负责下载、训练和编译，也不能计作推理 Agent。

## 10. 开源参考清单与复用边界

下表链接固定到既有调研快照。2026-10-26 重新访问这些一手源码/文档入口，未运行上游测试，也未复现上游性能。更完整的路径、测试和证据索引见[原调研](research/HARNESS_SURVEY_2026-10-20.md)。固定快照便于复查，不代表建议使用其最新版本。

| 项目 | 重点参考 | 与 ScholarFlow 的关系 | 不能冒充的成果 |
| --- | --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/docs/extensions.md) | Agent 运行、会话、扩展和工具控制 | 实际采用的底座 | 不声称自研模型循环与通用压缩 |
| [Deep Agents](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/deepagents/middleware/skills.py) | 方法与工具的关联 | A01 设计参考，未作为第二运行时接入 | 不声称已取得其效果收益 |
| [DeerFlow](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py) | 持久上下文与状态组织 | A02 设计参考 | 不声称复制完整 Harness |
| [OpenCode](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | 任务交接摘要与近期上下文 | A02 压缩交接参考 | 不把上游摘要实现算作自研 |
| [LangGraph](https://github.com/langchain-ai/langgraph/blob/1400d25b7b88cfa055c55b8a82bd95b7c25caef1/libs/langgraph/langgraph/pregel/_loop.py) | 持久执行与恢复边界 | A03/A06 机制参考，未接入框架 | 不承诺检查点自动带来 exactly-once |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/openhands-sdk/openhands/sdk/conversation/event_store.py) | 事件存储和会话状态 | A03 恢复参考 | 不把会话恢复写成训练续跑 |
| [Harbor](https://github.com/harbor-framework/harbor/blob/77094ca610014a3c7c2dcac6a29ef01f7ef800c8/src/harbor/verifier/verifier.py) | 独立验证与无效产物处理 | A04/A05 验证设计参考 | 不声称自动保证科学正确 |
| [PaperQA](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py) | 搜索、证据收集、回答分工 | A07 领域工具参考 | 不声称已复现其问答或检索成绩 |

“借鉴”需要能够解释源机制、适配原因、自己的实现以及失败边界；不要求把参考项目全部装进产品。若实际复制代码或分发依赖，应另行核对对应版本许可证并保留要求的声明。

## 11. 交付证据与后续补强建议

每条被选进简历的亮点，最好能准备：一个可复现任务、一段核心代码、一份失败测试和一份真实运行轨迹。面试时按“问题 → 机制 → 失败边界 → 测试或评测”讲述。

优先补强建议：先完成 A01 的最小动态装配，连同 A02 的有界读取做小型对照；再对 A03 的故障窗口和 A04 的错来源样本做演示。A05 负责记录这些机制的实际收益，避免持续加功能却缺乏可验证成果。该顺序只是简历选材建议，不修改 PLAN 的执行优先级。

真实科研目标实验、压缩后模型行为、完整权限绕过检查和机制收益目前仍有证据缺口。现有[验证记录](VERIFICATION.md)、[科研执行卡](RESEARCH_ACCEPTANCE_CARD.md)与 PLAN 的阶段说明存在不同更新时间，应按具体用例的原始证据判断，本文不宣布科研全流程通过。

本文相关检查：`node --test tests/agent-resume-highlights.test.mjs`。检查排名完整、各项实现/证据边界、源码链接和固定上游参考；文档检查通过不代表方案已实施或 Agent 效果已验证。
