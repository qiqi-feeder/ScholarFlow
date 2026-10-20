# Agent Harness 项目调研：实现、证据与可讨论的工程问题

查阅日期：2026-10-20（Asia/Shanghai）。状态：调研记录，不是架构定稿、实施计划或简历业绩。

本轮按用户要求，先研究已有项目，再讨论 ScholarFlow。覆盖 12 个代表项目及相关作者论文/工程报告，取得 70 份源码、测试或配套文档，对下列机制定向阅读，不是对全部文件逐行审计。没有安装这些项目、执行其测试、调用付费模型、运行 GPU 实验或复现其性能数字。覆盖具有代表性，不声称穷尽市面项目，也不把入选等同于质量排名。

选取理由：Pi 确定可复用边界；Deep Agents/OpenCode/DeerFlow 提供 Harness 与工作台实现；OpenHands/LangGraph 提供状态与恢复机制；PaperQA/RAGFlow 对照文献证据与材料检索；AI Scientist-v2/AutoResearchClaw 对照科研执行；mini-SWE-agent/Harbor 对照最小循环和外部验证。首轮科研项目清单仍见 [DISCOVERY 第 5 节](../DISCOVERY.md#5-github-调研第一轮)，本轮不重复把所有 README 当作深度调研。

## 1. 证据如何解读

| 标记 | 本轮实际获得什么 | 能说明什么 / 不能说明什么 |
| --- | --- | --- |
| I | 固定提交中的实现 | 可以解释代码路径与机制，不等于运行有效或科学正确 |
| T | 已阅读的相关测试源码 | 可以说明作者测试了哪些边界；本轮未执行，不能报告测试已通过 |
| E | 作者公开的实验或消融 | 可以作为限定模型、任务和预算下的效果证据；不是独立复现，也不能把系统总增益归因到每个组件 |
| D | 官方文档或工程经验 | 可以解释设计意图；没有独立对照时，不提升为已证明的性能收益 |

固定提交、源码/测试路径、内容校验值和一手评测地址保存在 [证据索引](harness-survey-2026-10-20.json)。代码链接使用完整提交 SHA；作者历史实验与当前代码快照不视为同一个版本。机器检查只验证调研材料的引用与状态完整性。

## 2. 项目快照

以下 SHA 为本轮 GitHub API 返回的默认分支 HEAD，不用星标数推断可靠性。短 SHA 对应完整值见证据索引。

| 编号 | 项目 | 提交 | 本轮重点 | 证据 |
| --- | --- | --- | --- | --- |
| H01 | [Pi](https://github.com/earendil-works/pi) | a731ba8b80ac | 已有压缩、Skill、MCP、工具发现边界 | I/T/D |
| H02 | [Deep Agents](https://github.com/langchain-ai/deepagents) | a2f88434c5a4 | 大输出外置、Skill 与工具的上下文联动 | I/T/E/D |
| H03 | [OpenCode](https://github.com/anomalyco/opencode) | d30e990c69ef | 结构化压缩交接、近期上下文及缓存 | I/T |
| H04 | [DeerFlow](https://github.com/bytedance/deer-flow) | 059758f321d8 | 输出预算、持久上下文、知识范围 | I/T |
| H05 | [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) | 0996c33916c2 | 事件日志、会话恢复和配置兼容 | I/T |
| H06 | [LangGraph](https://github.com/langchain-ai/langgraph) | 1400d25b7b88 | 检查点、任务写入、中断与重放 | I/T/D |
| H07 | [RAGFlow](https://github.com/infiniflow/ragflow) | 3d881b91cc58 | 检索范围、混合检索及评测口径 | I/T/D |
| H08 | [PaperQA](https://github.com/Future-House/paper-qa) | 57e89f7223b0 | 搜索、证据收集、回答的反馈循环 | I/T/E |
| H09 | [AI Scientist-v2](https://github.com/SakanaAI/AI-Scientist-v2) | 96bd51617cfd | 实验节点、失败分支、重复与聚合 | I/E |
| H10 | [AutoResearchClaw](https://github.com/aiming-lab/AutoResearchClaw) | be4ba4755bf1 | 实验状态、结果登记与验证限制 | I/T/E |
| H11 | [mini-SWE-agent](https://github.com/SWE-agent/mini-swe-agent) | 04d809ceab9d | 最小循环、预算、轨迹保存 | I/T |
| H12 | [Harbor](https://github.com/laude-institute/harbor) | 77094ca61001 | 独立验证、奖励文件和错误分类 | I/T |

12 个仓库在本轮元数据中均未标记归档。许可证元数据中，H01–H06、H10、H11 为 MIT，H07、H08、H12 为 Apache-2.0；H09 返回 NOASSERTION，实际 LICENSE 为自定义 The AI Scientist Source Code License，不能按 MIT/Apache 代码处理。这里只记录快照，不构成采用决定或完整许可审查。

## 3. 定向源码发现

### H01 / Pi：先识别已经拥有的机制

实现：`compaction.ts` 使用上下文预算触发压缩，保留近期消息并处理切分边界，记录读写文件；`skills.ts` 提供 Skill 发现；`extensions/tool-search/tool.ts` 已有工具元数据的 BM25 排序与按需声明；`extensions/mcp/tools.ts` 对大文本输出保留完整文件并截断模型侧视图，区分 MCP 错误与正常返回。源码入口：[工具发现](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/src/extensions/tool-search/tool.ts)、[MCP 输出处理](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/src/extensions/mcp/tools.ts)。

测试：`coding-agent/test/compaction.test.ts` 覆盖零 usage、超大尾部工具结果、切分点、近期预算等。边界：SDK 的扩展装配与 CLI 默认加载不同；文件工作目录不构成操作系统隔离。当前没有本地效果对照。

可讲清的工程问题：为何切分不能破坏工具调用/结果关系？何时需要再次读取完整输出？延迟加载的工具在恢复/分支中怎样保持一致？这些是底座能力，不能重写成 ScholarFlow 自研亮点。

### H02 / Deep Agents：外置大输出，以及 Skill 与工具的联动

实现：`FilesystemMiddleware` 可把超阈值工具结果外置到 backend，提供可分页读取的引用；`_message_eviction.py` 记录预览是否省略行或截短长行，避免仅从文本标记猜测是否发生截断。Skill 先提供元数据，支持显式 pin；`metadata.include_tools` 可把指定工具的暴露与 Skill 是否仍在当前上下文中关联。源码：[Skill 机制](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/deepagents/middleware/skills.py)、[输出外置辅助](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/deepagents/middleware/_message_eviction.py)。

测试：`test_skill_tools.py` 明确检查未读 Skill 时不能执行、同轮读取与调用被拒绝、压缩移除读取记录后撤回工具；`test_summarization_middleware.py` 检查外置上传失败与媒体引用。这里存在实际执行门控，但仍不是通用凭据或沙箱权限系统。

效果：LangChain 作者报告在固定 GPT-5.2-Codex 下，经 Harness 迭代使 Terminal Bench 2.0 从 52.8% 到 66.5%；改动同时涉及验证提醒、环境上下文、循环检测和推理预算。该结果不能单独证明 Skill 联动或外置机制贡献了多少；历史报告与当前快照也不同。[作者实验](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)

可讲清的工程问题：压缩后是否还执行一个方法对应的工具？外置失败时怎样保留可诊断信息？每次模型请求的工具声明与执行门控如何一致？

### H03 / OpenCode：摘要是任务交接，并考虑请求缓存

当前 `session/compaction.ts` 的模板分开目标、用户约束、决定、已完成/进行中/阻塞事项、下一步与关键文件；更新摘要时要求删除已解决问题，保留精确标识和工作状态。它保留近期上下文，区分自动、手动及 overflow；给摘要请求保留原请求前缀以利用缓存，输出不符合模板时有限提醒。源码：[压缩与交接](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts)。

测试：`session-compaction.test.ts` 检查模板、顺序、旧摘要更新、压缩时禁止执行原任务。注意：这是查阅时的实现；不能把旧文章中常见的 prune 常量/旧目录描述当作当前代码。

可讲清的工程问题：摘要应保留什么，哪些事实让下一个会话重新查文件？怎样避免摘要越更新越长？缓存收益与摘要完整性怎样取舍？未找到本轮机制的单独质量消融，不宣称优于 Pi。

### H04 / DeerFlow：预算压缩必须保留执行语义

`tool_output_budget_middleware.py` 将大结果保存为文件并返回类型化摘要，持久化不可用时退化为首尾截断；特别保持 bash 退出标记在末尾，避免下游误读成功/失败。`durable_context_middleware.py` 从独立状态通道注入目标、摘要、委派记录、Skill 引用和产物；静态规则与不可信上下文数据分开。`knowledge_scope_middleware.py` 在模型和工具边界处理本次知识范围，避免沿用任意历史消息的范围。源码：[输出预算](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/tool_output_budget_middleware.py)、[持久上下文](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py)。

测试分别覆盖失败退出标记、错误 receipt、摘要后保留委派/Skill 引用、不可信数据不进入 system、知识检索关闭后执行端拒绝。这里有源码和回归测试，尚无本轮独立性能消融。

可讲清的工程问题：压缩的是内容，怎样保持状态和引用不失真？重连后从哪恢复知识范围？隐藏工具与执行端拒绝为什么需要分别测试？

### H05 / OpenHands SDK：恢复不仅是加载聊天记录

`EventLog` 按事件存储，写入有锁、重复 ID 检查、父事件检查，支持活动分支遍历；`ConversationState` 保存执行状态、配置与活动叶节点。恢复测试区分工具增加与删除、Agent 类型变化、旧格式兼容，并保留安全判断和摘要。源码：[事件日志](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/openhands-sdk/openhands/sdk/conversation/event_store.py)、[恢复测试](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/tests/cross/test_conversation_restore_behavior.py)。

可讲清的工程问题：断开后能否用新配置继续旧任务？删掉历史依赖的工具怎么办？当前分支与废弃分支怎样区分？事件存储可帮助恢复会话，但不保证远端实验副作用恰好执行一次；本轮没有端到端重启实测。

### H06 / LangGraph：检查点与外部副作用是两个问题

`pregel/_loop.py`、`_runner.py` 区分检查点、任务 pending writes、中断和重放，管理持久化顺序；中断测试检查同步/异步恢复与恢复输入验证。官方 Functional API 文档要求把非确定性行为和副作用放进 task，并说明已开始未完成的 task 仍可能重跑，需要幂等键或检查已有结果。源码：[运行循环](https://github.com/langchain-ai/langgraph/blob/1400d25b7b88cfa055c55b8a82bd95b7c25caef1/libs/langgraph/langgraph/pregel/_loop.py)、[官方副作用说明](https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/functional-api.mdx)。

可讲清的工程问题：任务已经提交给 GPU、但记录完成前进程崩溃，恢复时怎么办？可以借鉴其状态与副作用边界，不据此决定在 Pi 外再加一套 LangGraph，也不声称 checkpoint 自动保证 exactly-once。

### H07 / RAGFlow：检索需要范围与评测口径

本轮快照的检索主线为 Go，不能沿用旧 Python 路径。`tool_search_chunks.go` 暴露词法/向量混合权重；`locate_search.go` 合并去重并限制模型请求的数据集范围不能超出服务端绑定范围，带租户与文档范围。源码：[检索入口](https://github.com/infiniflow/ragflow/blob/3d881b91cc58eb415e73a1db32a4e980477aea90/internal/agentic_rag/tool_search_chunks.go)、[范围与合并](https://github.com/infiniflow/ragflow/blob/3d881b91cc58eb415e73a1db32a4e980477aea90/internal/agentic_rag/locate_search.go)。

阅读的权限测试覆盖检索范围；`test/benchmark` 记录请求成败、延迟和吞吐，这不是带标准答案的检索质量对照。不能因为目录叫 benchmark 就宣称混合检索提高了事实准确率。

可讲清的工程问题：检索范围由谁决定？相关片段是否属于当前项目和文档？如何区分请求性能、证据召回与最终答案正确性？本轮未评测解析/重排效果，不建议据此接入完整 RAGFlow 服务。

### H08 / PaperQA：让检索结果先成为可检查的证据

`agents/tools.py` 将 `PaperSearch`、`GatherEvidence`、`GenerateAnswer` 分开。搜索维护既有查询与分页；证据工具面向具体问题收集并排序，反馈证据数量；回答使用已有证据，也可失败后继续补搜。`GatherEvidence` 会暂改共享 session.question，所以源码明确不支持同时调用自身，这说明“能并行调用工具”需要逐工具核对共享状态。源码：[搜索—证据—回答](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py)。

测试覆盖空材料拒绝、超时及引用格式。作者论文提供文献问答、带引用综述和矛盾发现的系统评估，但不是当前每个检索组件的独立消融，也不能推出实验执行能力。[作者论文](https://arxiv.org/html/2409.13740v1)

可讲清的工程问题：搜到文献与获得支持答案的证据有什么区别？证据不足怎样反馈给下一轮检索？哪些并行调用会竞争共享状态？

### H09 / AI Scientist-v2：实验树的价值在节点与失败记录

`journal.Node` 保存代码、父子关系、执行输出、异常、指标和 buggy 状态；`parallel_agent.py` 区分 draft/debug/improve 等分支，缺有效指标时标坏节点；管理器跨阶段保留选中节点，组织重复实验和聚合。源码：[实验节点](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/journal.py)、[分支处理](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/parallel_agent.py)。

作者论文展示完整科研案例，也明确承认三个生成稿件只有一篇被 workshop 接收；这不是大规模复现成功率。仓库树中本轮未找到独立测试目录，不能把论文实验当软件回归测试。[论文与限制](https://arxiv.org/html/2504.08066v1)

可讲清的工程问题：错误节点保留什么才能继续诊断？重复实验与改方法为何应是不同节点？挑选最佳分支与科学有效性之间是什么关系？当前只把节点/预算作为参考，不决定采用完整树搜索。

### H10 / AutoResearchClaw：核对实验来源，同时检查验证能力的边界

本轮成功取得 executor 及其拆分后的 `_execution.py`。执行区分 completed/partial/failed，超时但有指标可以保留 partial；解析器优先 JSON，其次 CSV、stdout。`VerifiedRegistry` 从实际实验汇总建立数字与来源表，登记舍入/百分比变体，检查非有限值。源码：[实际执行](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/pipeline/stage_impls/_execution.py)、[结果登记](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/pipeline/verified_registry.py)。

重要限制：`is_verified(number)` 检查数字是否与登记值接近，单靠它不能确认某句话对应了正确数据集、指标或实验条件；论文案例也说明真实的全零结果仍可无法回答研究问题。不能把“有反编造校验”写成“自动保证科学正确”。测试覆盖解析、登记和超时暂停等路径，未在本地运行。

作者论文有组件消融：10 个主题、每配置每主题三次运行并选最佳；不能与单次 HITL 表直接比较。摘要的 54.7% 是 CoPilot 综合分相对 AI Scientist-v2 的提升，包含人工参与，不是纯自动成功率。当前 ARC-Bench README 为 55 个主题，并明确大体积运行输出和评分分析未随仓库发布；与论文主表 25 个主题分开理解。[作者论文](https://arxiv.org/html/2605.20025v1)、[当前基准说明](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/experiments/arc_bench/README.md)

可讲清的工程问题：partial 怎样影响写作？舍入匹配怎样避免错误归因？基准比较是否包含人工干预和多次选优？其他系统的恢复能力应核对其代码与基线配置，不能沿用比较论文的概括就断言 AI Scientist-v2 没有调试。

### H11 / mini-SWE-agent：用简单循环作为复杂机制的对照

`DefaultAgent` 的主线是 query → execute → observation，模型与环境分离，每步 finally 保存轨迹；限制步骤、费用、墙钟时间和连续格式错误。费用上限是在调用前检查已消耗费用，源码明确可能先超出再停止，不能当硬额度预授权。源码：[最小循环](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py)。

测试覆盖预算、超时部分输出、格式错误计费和正常返回后错误计数复位。其意义是提供易分析的基础对照，不据此说复杂 Harness 无用或把软件工程基准成绩移植到科研任务。

可讲清的工程问题：每增加一个机制带来什么收益和负担？超限前后怎么记账？异常退出为什么也要保存轨迹？

### H12 / Harbor：让完成判断来自实际产物

`Trial` 编排任务运行，`Verifier` 执行验证并读取奖励文件，区分缺失、空文件、无效格式；拒绝 NaN/Infinity。验证前清理旧奖励，防止沿用上次结果；支持任务和验证器配置分开。源码：[验证器](https://github.com/laude-institute/harbor/blob/77094ca610014a3c7c2dcac6a29ef01f7ef800c8/src/harbor/verifier/verifier.py)。

测试明确覆盖旧奖励清理失败就停止、非有限/非数字奖励拒绝、过滤日志时不能丢奖励。独立验证流程仍取决于验证器自身质量，不能检查全部科学正确性；“单独运行验证”也不自动等于隔离充分或完全防止 Agent 操纵评测。

可讲清的工程问题：退出码与任务完成有什么区别？没有奖励文件怎样判定？怎样防止缓存的旧成功污染本次验证？这些是科研任务评测可参考的具体工程点。

## 4. 两项值得核对的跨项目效果证据

1. **大工具集合的按需发现。** Anthropic 内部 MCP 评测报告启用 Tool Search 后 Opus 4 为 49% → 74%，Opus 4.5 为 79.5% → 88.1%；文中明确适用大工具集合，也讨论增加检索延迟。它支持继续考察该机制，不证明 Pi 的 BM25 实现具有相同增益，更不能登记为 ScholarFlow 结果。[作者报告](https://www.anthropic.com/engineering/advanced-tool-use)
2. **跨会话的进度与环境交接。** Anthropic 公开 init 脚本、功能清单、进度记录、Git 和增量验证的实践，定位在长时间应用开发；没有本轮所需的严格单项消融，不能直接推出科研场景收益。[作者报告](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

## 5. 现在可以拿来讨论什么

以下是基于调研的讨论入口，不是已选定的 ScholarFlow 架构或实施优先级：

| 机制 | 最值得继续读的项目 | 已有依据 | 仍需验证的问题 |
| --- | --- | --- | --- |
| 大输出外置，保留引用和执行状态 | Pi、Deep Agents、DeerFlow | 三套具体实现；后两者有多种失败路径测试 | Pi 已有覆盖到哪；科研日志/表格还缺什么，不重复建设 |
| 压缩后保留目标、约束和材料入口 | OpenCode、DeerFlow、Pi | 明确模板、持久状态、引用及回归测试 | 是否减少实验条件遗漏；注入数据的信任边界与总 token 成本 |
| Skill 与所需工具/资源协同加载 | Deep Agents、Pi、DeerFlow | 显式激活、上下文关联、工具门控测试 | 用户选方法后怎样稳定执行；新增复杂度是否值得 |
| 中断恢复与外部任务副作用 | OpenHands、LangGraph | 事件/检查点实现及恢复测试 | 远端实验是否已提交，如何查询而非重跑；不预选第二套框架 |
| 搜索—证据—回答 | PaperQA、RAGFlow | 文献系统评估、证据反馈、范围限制 | 本项目文献/仓库定位任务能否迁移，检索质量须另测 |
| 实验结果进入稿件前验证 | AutoResearchClaw、Harbor | 数值来源登记、独立评分、负例与作者消融 | 数字存在与条件/结论一致如何同时保证 |
| 是否需要树搜索或多 Agent | AI Scientist-v2、mini-SWE-agent | 可解释节点结构与最小循环对照 | 首条任务是否真有独立分支；预算和质量是否优于简单方案 |

面试材料应当能够说明原项目机制、代码如何落实、已知失败条件、为何适用于我们的任务，以及自己最终实现和验证了什么。调研结论不能直接写成自研业绩。

## 6. 未解决的证据缺口

- 本轮没有任何本地上游运行效果；源码存在、测试存在和作者评测分别登记。
- 作者报告的实验版本与当前默认分支快照不同；历史结果若要复现，需固定历史配置、模型、数据和预算。
- 未统一实测 PDF 解析、混合检索/重排、跨会话材料遗漏、远端 GPU 恢复，不能给它们排序或填写提升比例。
- 科研近邻仍需下一步检查 AI-Researcher/Agent Laboratory 的具体恢复与产物契约、OpenScholar 的引用评估等；首轮已有介绍，本轮未将它们伪装为源码深审。
- 独立复现和更广泛项目检索仍可扩展，但先用本轮明确的源码机制与用户讨论；不因此生成 PLAN.md 或修改业务代码。

## 7. Pi / Deep Agents / DeerFlow 对照及科研场景差异

2026-10-20 接续讨论。以下为基于第 3 节实现的场景分析与候选适配，不是已确认架构、已有性能收益或自研创新。适用范围是初期计算型科研任务的分析样例，不扩展成全学科承诺。三个项目的能力有重叠；下表是在已读路径中选择比较点，不是声称某项目缺少其他能力，也不要求把三个运行框架叠加。

| 比较点 | Pi 的已读实现 | Deep Agents 的已读实现 | DeerFlow 的已读实现 | 科研任务中需要继续核对什么 |
| --- | --- | --- | --- | --- |
| 方法与工具 | Skill 发现/按需读取，工具可动态选择，MCP 工具发现 | Skill 读取或 pin 后关联工具；读取记录离开上下文后撤回关联工具 | 显式 Skill 激活；持久上下文保留 Skill 引用 | 方法正文、论文特定配置与外部实验状态应如何分别保存 |
| 上下文 | 通用会话压缩、近期消息、读写文件记录 | 大结果外置、摘要及 Skill/工具联动 | 目标、摘要、委派和产物的独立持久通道 | 压缩后怎样仍能定位正确实验条件、来源与运行版本 |
| 大输出 | MCP 大文本保留完整文件并截断模型视图 | backend 外置和分页读取，标记预览信息损失 | 类型化摘要与文件引用，保留命令退出语义 | 日志摘要之外，怎样提取原始指标、异常和 partial 状态 |
| 外部执行 | 会话/工具生命周期可作为接入点 | 文件/执行 backend 可承载工具运行 | sandbox 与执行中间件可承载外部任务 | 会话恢复不等于实验重启；任务查询、取消和科学完成状态仍需验证 |

### S01 / Skill：方法规范、实验条件和运行生命周期分开

已有依据：Deep Agents 的测试明确涵盖压缩移除 Skill 读取后撤回工具；DeerFlow 保留已读 Skill 引用，便于后续回查。它们处理的是当前模型请求的方法与能力上下文，不能据此推断外部训练进程已经停止。[Deep Agents 测试](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/tests/unit_tests/middleware/test_skill_tools.py)、[DeerFlow 持久上下文](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py)

科研推导：复现 Skill 保存通用方法，例如准入、先保留基线、检查结果；论文特定的脚本、数据划分、预测长度和参数是本次实验材料，运行标识与实际执行状态则属于外部任务。候选行为是提交时绑定所用材料和条件，恢复后先查询原任务；继续解释或改动方法前，按需重新加载相应 Skill。不能把方法正文是否仍在模型上下文中，直接当作进程是否存在或实验是否有效。

场景：训练还在运行，聊天发生压缩。应能找到原任务并查询，写报告时仍能定位原配置。反例：因为压缩后没看到训练历史就重跑，或因为加载了新 Skill 就悄悄改变已提交实验条件。如何实现方法可用性与执行授权的关系仍待确认；保留引用不等于已重新读取正文。

### S02 / 上下文：研究条件和证据类型比一般进度摘要更重要

已有依据：Pi 有通用压缩与文件记录；DeerFlow 的持久通道把目标、摘要、委派和产物分别组织，并把不可信数据与静态规则分开。这提供上下文组织机制，但没有自动保证论文配置与实测结果一致。[Pi 压缩](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/src/core/compaction/compaction.ts)、[DeerFlow 实现](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py)

科研推导：候选交接至少应能区分用户已确认目标、论文原始陈述、仓库实际配置、实测结果和 Agent 假设。字段保存位置和技术形式尚未确定，不要求全部常驻提示词；必要的是选入上下文的信息能返回原始材料与对应版本。

假设场景：同一模型的两次 MSE 分别来自预测长度 96 和 192，或数据划分不同。用户要求写优劣分析时，系统应先检查比较条件，不能仅按数值排序。反例：摘要只留下模型名和两个数值，之后生成“新方法更好”。这里的差异在于研究语义，不是通用摘要算法自然缺失的某个功能；是否改善遗漏率还需任务对照。

### S03 / 执行与恢复：聊天结束、进程退出和复现达标是不同事件

已有依据：Pi 提供会话和工具生命周期；DeerFlow 测试保持压缩后的退出状态；AutoResearchClaw 执行路径区分 completed/partial/failed。它们是可参考的机制，不共同构成已验证的科研执行服务。[DeerFlow 测试](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/tests/test_tool_output_budget_middleware.py)、[科研执行路径](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/pipeline/stage_impls/_execution.py)

科研推导：训练可能跨越多轮会话；重试有 GPU、时间和数据处理成本。候选行为是恢复时用已有运行标识核对实际状态，对已完成、运行中、失败和未知分别处理；重试和取消需要执行端确认结果，不能仅凭工具超时断言失败，也不能承诺恰好执行一次。

场景：连接中断但训练仍在执行，应查询而非自动再提交。反例：退出码为零、文件存在，就宣布复现达标；实际上执行了小规模调试配置或只完成部分种子。数据、配置、代码与运行绑定的做法也有成熟实验工具可参考：MLflow 记录参数、代码版本、指标和产物，并支持指标关联模型/数据集；DVC 管理实验与版本。这两项本轮仅查官方文档，没有源码/运行验证，也未决定接入。[MLflow Tracking](https://mlflow.org/docs/latest/ml/tracking/)、[DVC 实验管理](https://doc.dvc.org/user-guide/experiment-management)

### S04 / 知识检索：证据的用途和精确条件决定查找方式

已有依据：PaperQA 将找文献、收集证据和回答分开；RAGFlow 限制查询范围；Pi 已有工具发现与文件能力。这些机制可以支持材料定位，但搜索相关性不证明结果条件匹配。[PaperQA](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py)、[RAGFlow 范围](https://github.com/infiniflow/ragflow/blob/3d881b91cc58eb415e73a1db32a4e980477aea90/internal/agentic_rag/locate_search.go)

科研推导：找官方仓库地址应核对论文/作者来源；找训练参数应核对目标脚本和配置；找某次指标应查询该运行产物。论文段落可采用检索，模型名称和代码符号可精确查找，实验数值应保留运行与条件约束。具体是否使用 RAG、混合检索或现成实验系统仍待验证，不能把全部材料向量化作为默认决定。

场景：一篇后续论文只引用原文数字，不能满足 C09 所需的他人实际复现依据；找到了数字也不能推定实验曾执行。反例：搜索命中包含模型名和指标的段落，就自动标记复现依据充分。

### S05 / 验证：实测结果、可比结果与结论支持分层检查

已有依据：AutoResearchClaw 记录数值来源，Harbor 区分旧结果、缺失和无效奖励；这些检查有明确价值与边界。数值登记函数按数字匹配，单独使用不能判定其所在句子的实验条件与科学含义。[数值登记](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/pipeline/verified_registry.py)、[Harbor 验证](https://github.com/laude-institute/harbor/blob/77094ca610014a3c7c2dcac6a29ef01f7ef800c8/src/harbor/verifier/verifier.py)

科研推导：候选检查分为执行/产物检查、条件及数值归属检查、结论支持检查。前两者中可确定的部分由程序核验，科学解释仍可能需要模型与研究者判断；不宣称自动穷尽所有科学错误。

场景：目标实验按约定完成，但方法没有提升，可以交付忠实报告；原论文指标未达到，则准确报告复现未达标及已查明原因。反例：为了得到正结果换数据、缩短任务后不说明，或一直调参直到测试集数字变好。负结果、失败与材料不足都应保留，不合并成一种“成功”或“错误”。

这些要求在软件工程、数据分析等领域也存在；科研任务的突出差异是研究条件决定可比性、随机性影响评价、证据决定结论边界。以上适配尚未在本地实现或评测，不能写成已经验证的科研优势。

## 8. 基于 Pi 的具体实现参考

状态：候选实现建议，尚未确认，尚未实施；用户要求说明具体参考和做法，不等于授权业务实现。以下是机制如何衔接的示意，不是接口定稿、任务拆分或实施计划。

总体倾向：以 TypeScript 宿主嵌入 Pi SDK，沿用其运行循环、会话、压缩和资源加载；通过扩展和宿主服务补充领域能力。实验在独立 worker 的隔离环境中执行，Python 作为科研命令运行时而非额外 Agent 编排框架。项目元数据可先评估 SQLite，原始材料/日志/权重留在文件或既有存储中；这是单机/单用户假设下的候选，真实部署条件仍需确认。Pi 扩展与宿主同权限，实际隔离必须由执行环境保证。

### A01 / 宿主与会话：复用 SDK，区分三种状态

参考 [Pi SDK](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/docs/sdk.md)：`createAgentSession` 创建会话，`SessionManager` 保存会话树，`session.subscribe` 提供事件，`steer` / `followUp` 处理执行中的新输入。宿主负责把这些能力接到工作台；会话切换后重新绑定事件。一个项目可有多个任务会话，不强制整个项目使用无限长对话。

候选行为：分别保存“Agent 是否仍在响应”“科研任务是否等待材料/实验”“外部实验是否仍在运行”。`agent_settled` 可更新 Agent 空闲状态，不能据此标记实验完成；`agent_end` 也不是最终空闲信号。断开网页连接不应自动终止外部实验；用户停止当前回答与取消实验应是明确的不同操作。

### A02 / 材料记录：事实来源和实验快照由项目持有

参考 DeerFlow 的独立持久状态和 OpenHands 的状态恢复边界。候选存储仅需先覆盖材料引用、用户确认的约束、运行记录、指标引用和待解决问题，不从模型摘要反推全部事实。

提交实验时绑定代码版本及未提交差异、命令和配置、数据版本/划分与预处理说明、种子、环境引用、目标结果和使用的方法版本。大数据集可保留可核对的版本标识和存储位置，不要求每次复制全量数据。新结果作为新记录追加，明确替换/撤回时再影响引用它的草稿；原始日志和模型解释分开保存。模型抽取的内容在来源未核对前标为待核验，不能直接升级为用户决定或已验证事实。

### A03 / 上下文与 Skill：每次请求按当前任务组织

参考 [DeerFlow 持久上下文](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py) 与 [Deep Agents Skill 测试](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/tests/unit_tests/middleware/test_skill_tools.py)。在 Pi 的 `before_agent_start` 选择本次目标、方法和工具，在 `context` 等请求扩展点插入小规模、可回查的材料视图；不修改持久会话消息来伪造历史，也不每轮重复追加同一份状态。静态规则与论文/仓库等不可信材料分开，按 Pi 当前版本声明的 hook 契约实现。[Pi 扩展点](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/docs/extensions.md)

候选行为：复现时提供目标实验、准入证据、脚本/配置和运行状态；写作时提供已核验指标、可比性结论、失败/负结果与限制。默认让 Pi 加载 Skill，用户明确指定时保证读取正文，并保留方法版本和引用。借鉴工具协同但不照搬所有门控：运行查询/取消不能仅因 Skill 被压缩而失效；新实验提交仍要通过执行端的范围、配置、权限和预算检查。保留 Skill 路径不等于已重新读取全部要求。

### A04 / 实验执行：提交去重与有意重复运行分开

参考 OpenHands/LangGraph 对状态与副作用的区分、[AutoResearchClaw 执行](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/pipeline/stage_impls/_execution.py)。候选执行器先持久化提交意图和条件快照，再交给独立 worker；给 Agent 返回运行标识，之后通过工具查询、取回日志/结果或取消。工具名称和传输形式尚未定稿；保留隔离环境内通用文件/命令能力，避免所有科研操作都变成专用 API。

关键区分：同一次逻辑提交用稳定的请求标识，网络重试应返回原运行；实验条件指纹用于识别和比较配置，不作为永久禁止相同配置再次运行的键。有意重复实验、不同种子或重新尝试可以获得新请求标识，并保留与先前运行的关系。超时且状态未知时先查询执行端，必要时协调确认；不能承诺仅靠数据库唯一键解决所有远端重复副作用。预算和取消由执行端实际约束与确认，Agent 提醒不能替代它们。

### A05 / 结果检查：结构化结果进入上下文，原始证据可回查

参考 [DeerFlow 输出预算](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/tool_output_budget_middleware.py)、AutoResearchClaw 数值登记和 Harbor 验证器。保留 Pi 已有的大输出文件引用机制，科研侧补运行标识、状态、有效指标、异常摘要和原始日志位置；输出缩短后仍保留失败与 partial 语义。

候选检查先核对产物是否来自本次运行，再核对数据划分、目标任务、指标定义、预处理及其他约定条件，最后检查文字是否越过证据范围。条件缺失返回待核验，明确不同返回不可直接比较；同条件并不自动证明科学结论成立。负结果和未达标都可形成忠实报告。

Pi 的 `tool_call` / `tool_result` 扩展点可接检查与标准化，但远端执行器仍应独立校验，不能只靠模型侧工具暴露。`agent_before_settle` 可对声称完成的任务作有限的补验证提醒；等待实验时应正常结束本轮响应并保存等待状态，不在 hook 中阻塞数小时或无限强迫继续。Agent 空闲事件只用于通知，不作科研完成证明。

### A06 / MCP、检索和验证方式：先沿用已有机制，再确定新增价值

优先按 Pi SDK 文档装配现成 MCP / 工具发现扩展；选择实际要用的检索、仓库和执行服务，记录来源并处理错误。论文段落按需检索；仓库配置用文件/符号查找；实验数值按运行与条件查询。MLflow/DVC 可作为实验记录候选服务，不默认同时引入两者；是否需要向量索引及其规模由材料与任务评测确定。

未来实现后应做有行为差异的任务对照：基础 Pi 加相同科研 Skill，与加入候选机制的版本使用相同模型、工具底层权限、材料和预算；检查压缩后配置遗漏、断连重复提交、同数值错条件、等待状态与负结果。逐项移除机制观察收益及成本。当前只完成参考与设计讨论，没有这些结果。

贯穿示例：输入模型名称 → 核对论文、仓库、脚本/配置及他人实际复现依据 → 材料不足则交付缺失说明 → 条件足够时记录快照并提交 → 断连后查询原运行 → 核对真实结果和比较条件 → 产出有来源的复现报告。步骤依据状态调整，目标和预算仍由会话授权界定。
