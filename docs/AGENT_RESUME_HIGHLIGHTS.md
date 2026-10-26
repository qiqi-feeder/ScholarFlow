# ScholarFlow：Agent 能力亮点与简历选材

更新：2026-10-26（Asia/Taipei）。用途：把已讨论的 Agent 设计整理成可选的简历素材与面试讲解提纲。本文不授权业务实现，不改变现有实施计划，也不把方案整理视为功能交付。

用户后续已要求进入实现阶段，实际入口为 [Agent 实施规格](AGENT_IMPLEMENTATION_PLAN.md) 与 PLAN 第 10 节。本文保留含金量和证据状态；授权来自后续指令，业务能力须随实际验收更新。

## 1. 怎么理解这里的排序

排序面向 Agent 应用开发与工程岗位，综合考虑机制设计难度、与 Agent 的直接关联、复杂失败场景和可验证性，是选材建议，不是行业统一评分。排序以各项完整实现并获得证据后的技术深度为前提。自我进化、跨任务记忆与冲突消解纳入同一榜单；原有编号保留为稳定引用，新方向分别记为 A08、A09，编号不代表排名。

**技术含金量与当前可写程度分开看。** 动态能力装配的讨论价值高，但当前更适合写“设计”；后台执行和结果校验已有较具体的代码及测试，较容易形成可展示的工程证据。

状态口径：**已有代码与测试**表示本轮查到相关实现和测试源码；**已讨论待实施**表示已有架构共识，但不能写为完成；**待评测**表示尚无效果对照。本文的源码核对不替代真实模型、目标实验或故障场景验收。各项具体边界见下文。

| 排名 | 编号 | 能力亮点 | 主要证明什么 | 当前边界 |
| --- | --- | --- | --- | --- |
| 1 | A08 | 基于执行证据的自我进化 | 经验提炼、候选搜索、独立评测与版本发布 | 已调研待实施；未验证跨任务改进收益 |
| 2 | A09 | 跨任务长期记忆与冲突消解 | 作用域、来源、时间有效性和并发一致性 | 已调研待实施；现有研究记录不等于自动冲突裁决 |
| 3 | A02 | 长任务上下文与持久研究记忆 | Context Engineering、有界输入、压缩与恢复 | 已有代码与测试；相关性选择和统一预算待补齐 |
| 4 | A01 | 动态能力装配与渐进式工具暴露 | Agent 架构、工具发现、Skill 与工具协同 | 已讨论待实施；现有 load_skill 只读取说明 |
| 5 | A03 | 有副作用工具的异步执行与恢复 | Durable Execution、幂等、进程与会话解耦 | 已有代码与测试；真实目标实验和完整故障矩阵未验收 |
| 6 | A04 | 基于真实产物的分层验证闭环 | Tool Grounding、完成判定、错误反馈 | 已有代码与测试；科学结论有效性仍需研究者判断 |
| 7 | A05 | Agent 评测与机制消融 | 实验设计、轨迹分析、收益归因 | 待评测；已有方案，不能填写提升数字 |
| 8 | A06 | 宿主控制的自主执行与人工确认 | Human-in-the-loop、权限、预算和执行门控 | 已有代码与测试；不等于操作系统沙箱 |
| 9 | A07 | 带来源和版本的证据工具链 | 领域工具设计、检索反馈、事实归属 | 已有代码与测试；公开全文获取和精确页码证据待补齐 |

建议项目定位：**基于 Pi 构建面向长期科研任务的 Agent Harness，围绕动态能力装配、持久上下文与可验证执行补充领域机制。** Harness 指模型运行所需的工具、状态、执行、约束和验证环境。Pi 提供运行循环、会话、压缩等基础能力，ScholarFlow 的贡献应落到宿主与科研领域机制。

相关依据：[当前产品共识](WORKSPACE_PRODUCT_DISCUSSION.md)、[Agent 能力架构](AGENT_CAPABILITY_ARCHITECTURE.md)、[实施与验收计划](../PLAN.md)、[上游调研与固定快照](research/HARNESS_SURVEY_2026-10-20.md)。

前三名分别回答三个问题：A08 如何从经验改进方法；A09 哪些知识能跨任务复用、冲突如何处理；A02 每次给模型看哪些信息、长对话如何保持可控。A09 的长期存储不应全量注入 A02 的活动上下文，A08 的方法发布则依赖 A05 的独立评测。

A08 排第一的前提是有独立任务迁移与回归证据；仅有反思提示词或调用上游框架不具备这一排名对应的含金量。A09 同样需要实际演示范围隔离、纠错、争议和历史查询。A05 虽排在第七，却是前几项收益声明的共同前提，不能按榜单顺序拖到最后才做。

排序理由：前三项需要处理跨执行、跨任务或跨多轮交互的持续正确性，设计面更广；第四项体现模型决策时的能力组织，第五、六项体现可靠执行和领域验证，第八、九项作为重要的权限与来源基础。排名较低不表示不重要；完整的独立评测成果也可能比尚未落地的第一名更有面试说服力。

如果现在投递，优先采用已有证据的 A03、A04、A02；如果选择下一阶段补强方向，重点考虑 A09 与 A08。技术排序、可写程度和实施依赖是三个不同判断。

## 2. A08：基于执行证据的自我进化

状态：**已调研，待实施，未验证收益**。本节整理候选设计与关键实现，不表示 ScholarFlow 已接入 Harness²，不扩展现有业务实施授权。统一排名第 1；需以独立任务验证方法改进与迁移效果，与 A01/A05 组合。

### 2.1 亮点应体现什么

让系统从执行轨迹中发现可复用的问题，提出方法改进，并用真实任务验证改进是否有效。模型权重可以不变；进化对象是版本化 Skill、工具使用指引与上下文策略。

面试中应区分三种行为：重试同一任务、总结一段经验，以及经验证后发布可复用的新方法。第三种才形成完整的工程闭环。“Agent 会反思”不足以证明系统持续改善。

### 2.2 Harness² 参考：已公开的关键实现

核对快照：`google-research/harness2@1cfe254e8d25b15f37048c3730134686abe60335`。仓库采用 Apache-2.0，第三方材料仍遵循各自许可。[发布说明与运行要求](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/README.md)。

| 文件 / 函数 | 上游实现 | 借鉴点 |
| --- | --- | --- |
| `core/recursion.py`：`run_parallel`、`run_sequential` | 提议修改、实际执行探测、依据差异组合配置；支持并行探索与顺序改进 | 将修改方案和执行证据配对保存 |
| `core/recursion.py`：`_run_stage` | 检查候选修改，非法提议有限重试，失败继承原配置 | 给出结构化拒绝原因，保留回退配置 |
| `core/tree.py`：`SurfaceSpec`、`validate` | 声明可编辑文件范围并校验修改 | 对允许进化的能力设明确边界 |
| `core/selection.py`：`run_selection`、`reflect_adoption`、`_distil` | 比较匿名候选产物，解释采用原因并提炼经验 | 记录采用依据，避免只保存一条总分 |
| `core/library.py`：`Library.add` | 按领域保存完整采用配置、经验文件和索引 | 持久化方法及适用条件，供后续任务查询 |
| `core/ledger.py`：`Ledger` | 分别记录任务执行与改进阶段的预算 | 避免把多次尝试收益当作无额外成本的改善 |

源码：[递归流程](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py)、[修改范围](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/tree.py)、[候选选择与经验提炼](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/selection.py)。

经验至少包含 `cue`（适用线索）、`lesson`（可迁移方法）、`evidence`（执行依据）；可附 `confidence`。`Library.add` 缺少必要经验字段就不入库，完整方法文件与经验分别保留。检索按领域目录组织，由索引引导查阅，不等于已经具备通用语义冲突消解。[经验库实现](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/library.py)

上游预算账本中，每种递归模式计入 `4k` 次 rollout 和 `3k` 个改进阶段；选择与反思另行计数，重试也要计入实际调用成本。不能只用 k 代替总体预算。[预算实现](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/ledger.py)

特别边界：该版本 `selection_pool` 排除了基线，仅在最终候选中选择。因此“修改非法时回退原配置”不等于“收益不足时自动保留旧版本”。在线改进不读取标准答案，也不能保证候选实际正确或优于原版；正式质量评测应与改进过程分开。

本轮曾在 Windows 尝试运行上游 `tests/test_workflow.py`，因 Unix 模块 `fcntl` 不可用而失败并产生后续断言/文件缺失错误；官方要求 Linux。未改造上游以强行通过，未运行真实模型基准，不能登记为上游测试或性能已复现。

### 2.3 ScholarFlow 的关键实现示意

以下是**待实现伪代码**，接口和文件路径均未定稿。宿主权限、审批、预算与验证器不属于自动进化范围。

```text
improveSkill(skillId, failureCases, budget):
    baseline = loadPublishedVersion(skillId)
    evidence = collectSourceLinkedTraces(failureCases)
    candidates = proposeEdits(baseline, evidence, editableSurface)
    for candidate in candidates:
        validatePathsDependenciesAndImmutablePolicy(candidate)
        trial = evaluate(candidate, developmentTasks, budget)
        saveCandidateDiffAndTrace(candidate, trial)

    chosen = chooseIncludingBaseline(baseline, candidates)
    regression = evaluate(chosen, heldOutTasks, remainingBudget)
    if not passesPredeclaredCriteria(regression):
        recordRejection(chosen, regression)
        return baseline
    return publishNewVersionAtomically(chosen, expectedBaselineVersion)
```

实现时需要补齐的细节：

1. **受控修改范围**：先允许研究方法和工具说明的候选修改；未经审核的脚本或依赖不能直接进入生产。内容校验与真实执行权限分别控制。
2. **可比较试验**：同任务输入、数据、模型配置和预算，区别仅在候选方法；保存全部尝试。用历史轨迹回放、已有产物或批准的轻量任务先验证，不能因进化需要自动重复目标训练。
3. **独立验证**：开发集用于提议和筛选；留出集仅用于受控验证，不能把其答案、评分细则或逐样本反馈重新注入提议器。反复使用同一留出集仍会产生适应，需要限制轮次并保留最终独立测试。
4. **发布与回退**：候选与正式版本分开；发布以预期基线版本做并发检查，避免两个改进任务互相覆盖。旧任务继续绑定原 Skill 版本，主动迁移才改变后续行为。
5. **证据驱动入库**：保存适用线索、方法、证据位置和限制；模型自报 confidence 只是辅助信号，不能作为自动发布凭证。

建议经验记录结构（设计示意）：

```typescript
type ImprovementExperience = {
  id: string;
  projectId: string;
  domain: string;
  sourceTaskIds: string[];
  baselineSkillVersion: string;
  candidateSkillVersion: string;
  cue: string;
  lesson: string;
  evidenceRefs: string[]; // 指向真实 trace、run 或产物版本
  applicableConditions: Record<string, string>;
  limitations: string[];
  evaluationRef: string;
  status: "candidate" | "validated" | "published" | "rejected" | "retired";
};
```

### 2.4 面试讲法与失败案例

贯穿例子：某类复现反复误用评估脚本 → 定位轨迹及配置证据 → 提出“先检查目标表格对应脚本”的 Skill 修改 → 在其他任务上验证错误是否减少 → 通过后发布新版本；不能把用户未确认的猜测直接沉淀为通用方法。

面试需要回答：改进什么、不允许改什么？如何避免只适应某篇论文？为什么在选优池保留基线？遇到新版本退化、并发发布或预算不足怎么办？更多执行次数是否解释了全部收益？

**当前可用简历措辞：**“调研 Harness² 并设计基于执行证据的 Skill 迭代方案，覆盖候选生成、同条件对照、独立回归、版本发布与回退。”

**实现并评测后可升级：**“实现基于执行轨迹的版本化 Skill 进化闭环，通过留出任务回归与受控发布验证跨任务迁移效果。”若没有实际迁移证据，不能使用后半句。

## 3. A09：跨任务长期记忆与冲突消解

状态：**已调研，待实施，未验证收益**。已有 A02 保存研究状态并组装上下文；自动提取跨任务记忆、系统化冲突裁决及记忆晋升不应计为已有能力。统一排名第 2；可与 A02/A07 合成一条更深入的简历主线。

### 3.1 三类长期信息与跨任务范围

| 类别 | 示例 | 如何复用 |
| --- | --- | --- |
| 事实 / 决策记忆 | 项目已确认预算、研究目标、数据约束 | 同项目任务按来源与有效版本查询 |
| 情节 / 执行记忆 | 某任务发生过什么、何时失败、用了哪次运行 | 查任务与运行记录，保留原始证据 |
| 方法 / 经验记忆 | 哪类问题应先检查哪些条件 | 按适用条件检索，经 A08 验证后进入正式 Skill |

聊天摘要是短期工作上下文；长期记录存储完整来源，每轮只读取有界且相关的视图。跨任务共享不等于跨项目共享，更不等于复制所有历史聊天。

### 3.2 mem0：当前开源代码可借鉴什么

核对快照：`mem0ai/mem0@2c81af3bbe27d9bccb09c772d583df9e9be72ee5`，Apache-2.0。[仓库说明与许可](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/README.md)。

`Memory.add()` 的默认推断写入：作用域与近期消息 → 相关旧记忆召回 → 抽取新条目 → 批量 embedding → 去重与保存。`search()` 支持身份/元数据过滤、有界结果及可选重排；`update(memory_id, ...)` 提供显式修改，更新时保留身份字段并写入变更历史。[写入与查询实现](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/memory/main.py)

身份范围包括 `user_id`、`agent_id`、`run_id`。跨任务查询不能始终限定当前 run；反过来，省略 run 也不会自动检查项目权限。当前写入前召回与实体辅助路径主要使用这些标准身份字段，不能假定加入自定义 `project_id` metadata 就使所有内部路径按项目隔离。接入前应逐路径验证，必要时采用服务端项目命名空间或隔离集合。

**版本差异必须保留：当前默认 ADD 流程不等于自动冲突裁决。** 此快照仍有 `DEFAULT_UPDATE_MEMORY_PROMPT`，但默认写入调用的是 `ADDITIVE_EXTRACTION_PROMPT`。后者提取新增记忆，并要求为相关/矛盾信息提出关联；提示词存在关联要求，不代表已经实现可依赖的事实替代链。[抽取与旧更新提示词](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/configs/prompts.py)

值得借鉴的是来源角色区分、时间表述锚定、抽取去重及显式变更历史。助理提出的方案应记为“曾建议”，不能升级为用户确认。相同文本去重也不等于语义冲突消解。[历史持久化](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/memory/storage.py)

OSS 与云平台分开判断：该版本明确拒绝部分时间参数，如 `reference_date`；不能把平台介绍中的时间能力算作本地开源已有实现。[OSS 时间功能边界](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/memory/notices.py)。本轮未运行 mem0 的模型/向量库集成测试，不宣称已验证召回或冲突处理效果。

### 3.3 Graphiti：参考事实有效区间与失效机制

补充快照：`getzep/graphiti@5c27edfa8d3e0f49b2571bcebb4261bcc89ee037`。其边处理代码区分重复关系和可能矛盾的关系，再按有效时间处理失效；旧事实保留 `valid_at`、`invalid_at`、`expired_at` 等时间信息。相关入口包括 `_dedupe_extracted_edge`、`resolve_edge_contradictions` 和 `resolve_extracted_edge`。[固定版本实现](https://github.com/getzep/graphiti/blob/5c27edfa8d3e0f49b2571bcebb4261bcc89ee037/graphiti_core/utils/maintenance/edge_operations.py)

可借鉴“旧事实失效但保留历史”的语义，无须立即引入完整图数据库。候选矛盾识别和时间抽取依然可能出错，本轮只查代码，未运行其测试。

### 3.4 ScholarFlow 的候选记忆结构

以下是**待实现伪代码**，用于说明核心字段，不是已经提交到业务代码的接口。

```typescript
type ResearchMemory = {
  id: string;
  ownerId: string;
  scope: "account" | "project" | "task" | "domain";
  scopeId: string;
  sourceProjectId: string;
  sourceTaskId: string;
  kind: "decision" | "paper_claim" | "observation" | "hypothesis" | "experience";
  subject: string;
  predicate: string;
  value: unknown;
  conditions: Record<string, string>;
  sourceRefs: string[];
  authority: "user_confirmed" | "tool_observed" | "paper_reported" | "model_proposed";
  validFrom: string | null; // 事实生效时间；无法确定时保持未知
  validTo: string | null;
  recordedAt: string;      // 系统获知时间，与事实生效时间分开
  supersedes: string[];
  conflictsWith: string[];
  revision: number;
  status: "candidate" | "active" | "disputed" | "superseded" | "retracted";
};
```

`authority` 表示信息身份，不能简单排成适用于所有问题的总分：用户确认决定可以更新方案，但不能因此篡改原始实测指标。原始运行与文件仍是事实依据，记忆只是可检索的派生视图。项目来源信息即便在晋升为领域经验后也须保留，跨项目晋升需明确授权并检查敏感信息。

### 3.5 冲突裁决：先判断范围，再判断能否替代

| 编号 | 情况 | 示例 | 候选规则 |
| --- | --- | --- | --- |
| MC01 | 不同项目 / 任务范围 | 项目 A 用 X，项目 B 用 Y | 并存，不互相替代 |
| MC02 | 同对象的明确决定修订 | 用户确认将预算从 30 改为 60 分钟 | 新版本替代旧版本，保留确认依据与历史 |
| MC03 | 不同实验条件 | 同模型在两个划分上得到不同指标 | 并存，按 runId 与条件分别查询 |
| MC04 | 同条件证据相互矛盾 | 两个来源对同一事实给出不同说法 | 标记争议，保留双方证据，不自动删除 |
| MC05 | 模型建议与已确认方案不一致 | 助理建议换数据集，用户尚未确认 | 保持候选，不覆盖正式方案 |
| MC06 | 补录历史事实 | 今天导入上个月已失效的约束 | 按生效区间保存，不能因晚写入变成当前值 |
| MC07 | 并发修改 | 两任务同时修订同一项目决定 | 以 revision 并发检查，失败后重读裁决 |

```text
ingestMemory(message, principal, expectedRevision):
    candidate = extractWithSource(message)
    scope = hostResolveAndAuthorizeScope(principal, candidate)
    related = lookupSameSubjectPredicate(scope, candidate.conditions)
    relation = classifyDuplicateCorrectionOrDispute(candidate, related)
    decision = hostApplyTypeAuthorityAndTimeRules(relation)
    transaction:
        assert currentRevision == expectedRevision
        append new record and decision evidence
        if confirmed correction: close old validity and move current pointer
        if unresolved contradiction: retain both and mark disputed
        increment revision
    return persisted decision and source references
```

LLM 可以提出冲突分类，不能决定项目权限或伪造用户确认。完整原文、运行指标和修改证据独立保存；更新记忆不直接改原始材料。没有明确适用时间或确认依据时，默认不静默替代。

跨任务读取则先鉴权并限定范围，再做相关性召回与排序；“现在”的查询只选择当前有效版本并显式提示争议，“当时”的查询按有效区间取历史。还应保留获知时间，以区分“当时真实是什么”和“系统当时知道什么”。最后按共同 token 预算组装有界片段，返回来源和继续读取入口。

### 3.6 面试讲法与验证

面试需要回答：同用户不同项目如何隔离？什么记忆能跨任务？晚到数据为何不能一律覆盖？模型建议如何与确认决定区分？当前答案和历史答案如何查询？并发更新如何避免丢失？

验证重点：MC01–MC07 的行为、作用域泄漏、旧值错误召回、合法新事实被误拒，以及争议是否被隐藏。指标包括当前值准确率、历史问答准确率、错误替代率、跨任务召回率、来源正确率和单次输入量；不能只报告向量相似度。

**当前可用简历措辞：**“基于 mem0 与 Graphiti 源码调研，设计跨任务研究记忆方案，区分事实、决策与经验，通过作用域、来源、有效时间和版本替代关系处理记忆更新及冲突。”

**实现并验收后可升级：**“实现带来源与有效区间的跨任务记忆，支持显式纠错、争议保留、历史查询及并发版本控制。”效果数字需来自独立任务评测。

## 4. A02：长任务上下文与持久研究记忆

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

## 5. A01：动态能力装配与渐进式工具暴露

### 为什么仍是核心架构能力

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

## 6. A03：有副作用工具的异步执行与恢复

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

## 7. A04：基于真实产物的分层验证闭环

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

## 8. A05：Agent 评测与机制消融

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

## 9. A06：宿主控制的自主执行与人工确认

### 核心实现

将“模型建议做什么”和“系统允许执行什么”分开。模型可以提出实验方案；宿主检查已确认方案、准入材料、精确配置、项目归属与资源限制；用户批准后才排队执行。恢复后再次检查仍有效的前置条件。

批准应绑定本次配置指纹，不能由一句笼统“同意实验”覆盖后续任意改参。新目标、扩大预算和正式稿件覆盖应遵循明确确认边界。等待批准时保存状态，正常结束本轮回答。

当前代码：[实验提案与批准](../apps/server/src/runs.ts)、[复现准入](../packages/research/src/admission.ts)、[路径约束](../packages/research/src/paths.ts)、[Agent 规则](../apps/server/src/agent.ts)。[服务测试](../apps/server/test/server.test.ts)和[准入测试](../packages/research/test/admission.test.ts)提供部分执行门控证据。

重要边界：领域服务具备检查，不代表已经覆盖所有通用执行路径。Pi 扩展和本地命令具有宿主权限，Conda 与目录限制不构成操作系统沙箱。论文和日志作为不可信数据处理是必要设计，但仅有系统提示词不能证明全面防御提示注入。

参考 A03 的 LangGraph 中断与恢复思路，以及 A01 的 Pi 扩展入口；不把框架有 hook 等同于产品已经完成全链路权限治理。

有价值的验证：未确认方案拒绝、准入不足拒绝、跨项目请求拒绝、批准后条件变化拒绝、超预算拒绝；并检查其他工具入口能否绕过同一约束。恢复后不可复用已经失效的批准。

面试需要回答：哪些行为由模型判断，哪些由程序硬约束？批准绑定什么？通用工具能否绕过专用工具检查？

**当前可用简历措辞：**“在领域实验服务中实现方案确认、材料准入与用户批准门控，结合项目归属和运行预算约束 Agent 提交行为。”避免扩大成“实现安全沙箱”。

## 10. A07：带来源和版本的证据工具链

### 核心价值与实现

Agent 需要知道“这段信息属于哪篇论文、哪个版本、哪次运行”。检索、获取原文、收集证据和组织答案应该保留各自状态；论文标题命中不代表拿到全文，数字命中也不代表实验实际发生。

设计上将工具包装成有业务语义的动作，统一返回对象 ID、版本、状态、证据位置、限制和可继续读取的入口。MCP 可以连接外部服务，但宿主仍负责领域语义、归属校验和可用状态。

用户引用由宿主解析并核对对象归属、版本和精确选区，保存本条消息所用的内容快照。研究记录随后可进入 A02 的记忆和 A04 的核验。工具返回有界内容，大文件通过引用继续读取；不能以截断摘要冒充完整原文。

代码：[引用解析](../apps/server/src/references.ts)、[材料服务](../apps/server/src/materials.ts)、[研究工具](../apps/server/src/agent-tools.ts)。[服务测试](../apps/server/test/server.test.ts)中已有伪造引用拒绝、精确选区快照及重试/重启保留测试。现阶段页码定位仍有全文摘要局限，公开全文获取、完整位置证据和系统化证据反馈仍待补齐，不能写成已经完成 Agentic RAG。

参考 [PaperQA 搜索、证据收集与回答工具](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py)的分步证据处理。模型可根据证据不足继续检索，但具体反馈策略与评价需要本项目验证。

验证应覆盖错版本、跨项目、选区伪造、未获取全文和证据不足；检索召回率、引用准确率和最终答案支持率要分别评估。

面试需要回答：什么时候用精确对象查询，什么时候用文本检索？全文、摘要和模型解释怎样区分？引用过期怎么办？

**当前可用简历措辞：**“设计来源与版本感知的领域工具，实现在消息引用端校验项目归属、对象版本及精确选区，并保存可恢复的引用快照。”

## 11. 简历如何挑选与组合

### 推荐选择

| 目标岗位 | 优先选择 | 讲述重心 |
| --- | --- | --- |
| Agent 应用开发（补齐后） | A08＋A09＋A01 | 方法进化、记忆治理和按需能力 |
| Agent 平台 / 后端工程 | A03＋A01＋A06 | 外部副作用、状态一致性与宿主门控 |
| 偏评测与优化的岗位（补齐后） | A08＋A05＋A09 | 迁移效果、机制消融及记忆错误分析 |
| 当前就准备投递 | A03＋A04＋A02 | 优先展示已有实现；A01 单列为设计工作 |

含金量排序用于选择技术主线，下面的现成文案仍按现有实现证据组织。A08/A09 当前只能使用各节的“调研与设计”措辞，不能直接替换成完成式。选三条即可，不必把所有术语塞进简历。A09 与 A02/A07、A03 与 A06 有关联，可以合并；每条保留一个核心问题、一组机制和一份可展示证据。

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

## 12. 开源参考清单与复用边界

下表链接固定到调研快照。原有八个项目沿用 2026-10-26 核对的一手入口，未运行其上游测试；Harness²、mem0 与 Graphiti 的新增核对及测试限制分别见 A08/A09，其中 Harness² 在 Windows 的尝试未通过。本轮未复现任何上游性能。更完整的历史路径、测试和证据索引见[原调研](research/HARNESS_SURVEY_2026-10-20.md)。固定快照便于复查，不代表建议使用其最新版本。

| 项目 | 重点参考 | 与 ScholarFlow 的关系 | 不能冒充的成果 |
| --- | --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi/blob/a731ba8b80ac56662b4ca7f09102f94447862d8c/packages/coding-agent/docs/extensions.md) | Agent 运行、会话、扩展和工具控制 | 实际采用的底座 | 不声称自研模型循环与通用压缩 |
| [Harness²](https://github.com/google-research/harness2/blob/1cfe254e8d25b15f37048c3730134686abe60335/harness2/core/recursion.py) | 候选方法、执行对照与经验库 | A08 自我进化参考，尚未接入 | 不声称自动改进或跨任务迁移已实现 |
| [mem0](https://github.com/mem0ai/mem0/blob/2c81af3bbe27d9bccb09c772d583df9e9be72ee5/mem0/memory/main.py) | 记忆抽取、范围过滤、检索与显式更新 | A09 跨任务记忆参考，尚未接入 | 不把当前 ADD 流程当作自动冲突裁决 |
| [Graphiti](https://github.com/getzep/graphiti/blob/5c27edfa8d3e0f49b2571bcebb4261bcc89ee037/graphiti_core/utils/maintenance/edge_operations.py) | 事实有效区间与失效处理 | A09 时间语义参考，尚未接入 | 不声称时间规则保证矛盾识别正确 |
| [Deep Agents](https://github.com/langchain-ai/deepagents/blob/a2f88434c5a4b5ce5244c468bb9f69b27831842d/libs/deepagents/deepagents/middleware/skills.py) | 方法与工具的关联 | A01 设计参考，未作为第二运行时接入 | 不声称已取得其效果收益 |
| [DeerFlow](https://github.com/bytedance/deer-flow/blob/059758f321d83dc7196e35fa99f5829333d97ec1/backend/packages/harness/deerflow/agents/middlewares/durable_context_middleware.py) | 持久上下文与状态组织 | A02 设计参考 | 不声称复制完整 Harness |
| [OpenCode](https://github.com/anomalyco/opencode/blob/d30e990c69efd8a954413a724b35c5a27462f320/packages/core/src/session/compaction.ts) | 任务交接摘要与近期上下文 | A02 压缩交接参考 | 不把上游摘要实现算作自研 |
| [LangGraph](https://github.com/langchain-ai/langgraph/blob/1400d25b7b88cfa055c55b8a82bd95b7c25caef1/libs/langgraph/langgraph/pregel/_loop.py) | 持久执行与恢复边界 | A03/A06 机制参考，未接入框架 | 不承诺检查点自动带来 exactly-once |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk/blob/0996c33916c2a977ea9fe38deee660ff0e1389f2/openhands-sdk/openhands/sdk/conversation/event_store.py) | 事件存储和会话状态 | A03 恢复参考 | 不把会话恢复写成训练续跑 |
| [Harbor](https://github.com/harbor-framework/harbor/blob/77094ca610014a3c7c2dcac6a29ef01f7ef800c8/src/harbor/verifier/verifier.py) | 独立验证与无效产物处理 | A04/A05 验证设计参考 | 不声称自动保证科学正确 |
| [PaperQA](https://github.com/Future-House/paper-qa/blob/57e89f7223b0960d5ee5ea048c69e3c47e088572/src/paperqa/agents/tools.py) | 搜索、证据收集、回答分工 | A07 领域工具参考 | 不声称已复现其问答或检索成绩 |

“借鉴”需要能够解释源机制、适配原因、自己的实现以及失败边界；不要求把参考项目全部装进产品。若实际复制代码或分发依赖，应另行核对对应版本许可证并保留要求的声明。

## 13. 交付证据与后续补强建议

每条被选进简历的亮点，最好能准备：一个可复现任务、一段核心代码、一份失败测试和一份真实运行轨迹。面试时按“问题 → 机制 → 失败边界 → 测试或评测”讲述。

按依赖补强建议：先完善 A02 的有界读取及 A09 的范围、来源与冲突规则，同时建立 A05 的固定任务和回归基线；在这些基础上增加 A08 的经验提炼、候选 Skill 对照与发布。A01 的动态装配继续作为核心能力建设，A03/A04 提供执行与验证证据。含金量第 1 不代表应最先写自动进化循环；这个建议不修改 PLAN 的执行优先级。

真实科研目标实验、压缩后模型行为、完整权限绕过检查和机制收益目前仍有证据缺口。现有[验证记录](VERIFICATION.md)、[科研执行卡](RESEARCH_ACCEPTANCE_CARD.md)与 PLAN 的阶段说明存在不同更新时间，应按具体用例的原始证据判断，本文不宣布科研全流程通过。

本文相关检查：`node --test tests/agent-resume-highlights.test.mjs`。检查排名完整、各项实现/证据边界、源码链接和固定上游参考；文档检查通过不代表方案已实施或 Agent 效果已验证。

## 14. 高排名能力怎样形成完整面试案例

建议贯穿案例：任务一发现某模型复现时必须使用特定评估脚本，保存运行证据及适用条件；任务二在同项目召回这条经验，并检查目标条件；用户修订方案后新决定替代旧决定，原实验结果保留；之后提出通用 Skill 修改，通过独立任务回归才发布。这样能同时解释“如何记住”“如何处理冲突”和“怎样证明学到的方法有用”。

| 能力方向 | 上游可借鉴 | ScholarFlow 应负责 | 当前可主张 |
| --- | --- | --- | --- |
| A08 自我进化 | Harness² 的候选、探测、组合及经验库 | 科研任务评价、保留基线、不可变策略、受控发布 | 调研与设计，不能声称已自我进化 |
| A09 跨任务记忆 | mem0 的抽取/检索/变更记录，Graphiti 的时间失效 | 项目权限、证据身份、修订与争议规则、并发一致性 | 调研与设计，不能声称已解决记忆冲突 |

建议的实现验证顺序：先做有来源、可隔离和可修订的记忆，再做经验提炼，最后增加候选 Skill 的自动评测与发布。错误记忆进入进化过程后可能变成可重复传播的方法错误，因此读取到某条记忆不能自动赋予其执行或规则权限。

上述设计示意均未引入新运行时、依赖或业务行为。文档测试只检查引用、设计契约和状态边界；不代表上游性能复现或 ScholarFlow 功能已完成。
