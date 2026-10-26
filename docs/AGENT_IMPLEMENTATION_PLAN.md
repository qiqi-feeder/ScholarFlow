# ScholarFlow Agent 实施规格：能力、记忆与方法进化

2026-10-27：IG00–IG07 已实现并通过软件验收，见 [最终报告](verification/agent-implementation/IG07.md)。真实候选评测未达标准，已拒绝并保留基线；不声明科研实效。以下“进入实施准备/本次仅文档”等为 2026-10-26 的历史入口。

更新：2026-10-26（Asia/Taipei）。状态：进入实施准备，功能待实施。来源：用户要求进入实现阶段并同步前述讨论。本次交付文档与测试，不代表功能完成；后续业务实现按本规格与 [PLAN 第 10 节](../PLAN.md) 分批推进。

## 1. 范围与实施决定

本规格定义执行契约、依赖与验收。产品共识见 [工作台讨论](WORKSPACE_PRODUCT_DISCUSSION.md)，基本工具与产物规则见 [Agent 架构](AGENT_CAPABILITY_ARCHITECTURE.md)。[面试选材](AGENT_RESUME_HIGHLIGHTS.md)解释含金量，不替代实施顺序。

继续复用 Pi 的每任务一个主会话、模型循环、Skill 与压缩；宿主补任务级动态能力、有界上下文、跨任务研究记忆与冲突处理，再实施有执行证据、独立回归和版本回退的 Skill 进化。沿用实验准入、精确配置批准、预算和版本保护。

默认沿用 TypeScript、SQLite 与文件存储，不将 mem0、Graphiti、Harness² 直接作为运行时依赖，不要求图数据库、向量数据库或 Linux/WSL。参考机制不等于引入代码依赖；后续确需新增依赖时记录兼容、许可与测试证据。

DREAM-RSI 优化探索分支、并行度和停止策略，历史树只覆盖已执行的空间；它与方法/Skill 进化不同。本期不实现探索树回放，不自动管理多方向目标实验，不训练模型权重，不建立固定多 Agent 团队。后续另立任务与验收，不能将普通经验总结称为 DREAM-RSI。

工具名、模块拆分、首批能力分组与数值预算可在实现时按现有代码细化并记录默认值，不需为普通命名再次等待审批；项目归属、来源、版本、未知状态和用户确认是必须满足的契约。

## 2. 基线、接入层与迁移

| 既有入口 | 后续接入 | 必须保留 |
| --- | --- | --- |
| [agent.ts](../apps/server/src/agent.ts)、[agent-tools.ts](../apps/server/src/agent-tools.ts) | 能力目录、动态集合和研究查询 | Pi 会话、任务模型、忙碌互斥和只读内置工具边界 |
| [context.ts](../apps/server/src/context.ts)、[研究上下文](../packages/research/src/context.ts) | 相关记录选择、有界读取、共同预算 | 确认条件、runId 和来源，不伪造历史 |
| [repos.ts](../apps/server/src/repos.ts)、[共享类型](../packages/research/src/types.ts) | 记忆/变更/冲突/候选记录与迁移 | 旧项目兼容，凭据与研究数据分离 |
| [runs.ts](../apps/server/src/runs.ts)、[worker](../packages/experiment-worker/src/worker.ts) | 提供经验与评测证据 | 去重、unknown 不自动重跑、原审批与资源上限 |
| [skills.ts](../apps/server/src/skills.ts) | 候选/正式版本及任务绑定 | 依赖和来源可查，旧任务不静默升级 |
| Web 与 [事件服务](../apps/server/src/events.ts) | 记忆、争议和候选方法反馈 | 保存后通知，不抢焦点、不丢草稿 |

新增领域类型与纯规则放在 `packages/research/src`，宿主服务与仓储接入放在 `apps/server/src`；具体文件在对应阶段确定。没有迁移的新表、没有真实实现的工具不提前显示为可用。

IG00 先重现并核对 [WR-R01–R03](verification/workspace-redesign/W02-W05-review-issues.md)，关闭受影响的保存/引用/重试问题并复验，再进入后续集成。旧 W/WT、AF/AT、科研 V 各自凭证据更新，不因本规格完成而提升。

迁移先备份与检查旧库，按 schema version 幂等新增记录，不重写 Pi 会话。旧材料保留为来源资产，不自动回填为已确认跨任务事实；失败回滚事务，文件/索引残留按清单恢复或重建。迁移与重开不能自动提交消息、实验或方法发布。

## 3. 动态能力与有界上下文

能力记录至少包含 ID、用途摘要、关联 Skill 版本、工具清单、依赖、可用状态与失败原因。先注册工具，仅激活基础发现/读取/恢复入口；必要查询和取消不随方法卸载消失。

加载时校验任务/项目、配置、依赖和策略，再分别读取方法正文与激活工具；同消息的下一次模型请求可使用新集合。替换集合保留核心工具并核对实际结果；失败恢复旧集合，不报成功。装配与发送、停止、模型切换共用任务互斥边界，重开重新检查可用性。沿用 AT01–AT04，工具可见性不等于权限。

常驻目标、已确认约束、必要状态、当前对象引用和简短目录。论文正文、完整日志、大表与长期记忆存后台，工具分页/分段返回来源和继续读取入口。每请求共同计量系统提示、工具定义、Skill、历史和片段，预留输出空间。

预算按当前模型窗口配置；有 usage/tokenizer 时用于校准，否则标为估算、保守限量并处理 overflow，不能保证精确 token 上限。超预算优先缩减可重查片段，不能静默丢用户约束或把截断当全文。Pi 压缩后仍能查询原 runId/条件/版本，不能重新提交实验。沿用 AT05。

持久存储可以增长，每轮输入必须有界；全量长期记忆不重新注入系统提示。同一来源的重复查询保留明确版本及分页信息。

## 4. 跨任务记忆数据与写入

字段名可调整，下列语义必须完整：

```text
MemoryRecord:
  id, ownerId, scope, scopeId, sourceProjectId, sourceTaskId
  kind, subject, predicate, value, conditions, sourceRefs[]
  authority, status, revision, validFrom?, validTo?, recordedAt
  supersedes[], conflictsWith[]
MemoryChange:
  id, memoryId, expectedRevision, previousVersion, newVersion
  action, reason, actor, evidenceRefs[], recordedAt
RecallSnapshot:
  id, destinationProjectId, destinationTaskId, query, asOf?, knownAt?
  selectedMemoryVersions[], exclusions[], budgetEstimate
```

scope 首批为项目与任务；领域/账户共享要显式晋升，不能以省略 projectId 隐式开启。kind 区分确认决定、论文陈述、工具观察、假设和经验。authority 是来源身份，不是适用所有事实的总分；用户决定可修订方案，但不能改写原始指标。

validFrom/validTo 为事实有效时间，recordedAt 为系统获知时间；未知时间保持未知。asOf 回答某时点有效事实，knownAt 可限定当时已知记录。保存修订、撤回和替代，不从聊天摘要反推权威事实。

工具观察及用户确认可由已保存记录映射；聊天自动提取先为 candidate，保留原消息角色和来源。模型建议不能自动升级为用户决定，论文文本不能升级为规则。提取失败可有限重试并如实反馈，以来源事件 ID 去重，不能连带重启实验。

```text
ingest(sourceEvent, principal, expectedRevision):
    candidate = extractOrMapFromPersistedSource(sourceEvent)
    scope = hostAuthorizeScope(principal, candidate)
    related = findSameSubjectAndPredicate(scope, candidate.conditions)
    proposal = classifyRelation(candidate, related)
    decision = hostValidateAuthorityConditionsAndTime(proposal)
    transaction:
        check sourceEvent idempotency and expectedRevision
        append record, change and conflict evidence
        advance current version only for an admissible correction
    publish persisted change event
```

revision 不符返回冲突并重读，不能最后写入覆盖前者。索引在持久提交后更新，可重建，不是唯一事实来源。

## 5. 冲突、召回与工作区契约

| 情况 | 规则 |
| --- | --- |
| 不同项目/任务范围或实验条件 | 并存，不自动替代 |
| 同对象的明确确认修订 | 新版本替代旧版本，保留确认依据与历史 |
| 同条件证据相互矛盾 | 保留双方，标为 disputed 并显示来源，必要时交研究者判断 |
| 模型建议与确认方案不一致 | 只作候选，不覆盖正式方案 |
| 晚到历史事实 | 按有效时间保存，不因写入较晚成为当前值 |
| 并发修订或来源撤回 | 版本检查后处理，标记受影响引用与未决状态 |

来源纠错与现实状态变化分开：前者保留原说法错误的修订证据，后者关闭旧状态有效区间。不猜造时间；争议未决的当前值查询不能仅返回最相似一条。

召回先宿主鉴权、确定范围，再做对象/subject/predicate 精确查询，必要时加全文相关性检索；按当前/历史语义过滤后有界组装。首批可复用 SQLite 全文检索，向量检索在基准证明有必要后再接。

同项目新任务可读项目级记忆；任务私有及跨项目经验需相应授权。查询、写入前检索、去重、辅助索引、按 ID 读取和更新/删除均应用相同范围，不只过滤最终 search。不能认为自定义 metadata 已自动隔离所有内部路径。

按 [前端需求](FRONTEND_PRODUCT_REQUIREMENTS.md) 显示本轮记忆依据、版本、范围、争议和历史，提供查看、更正、撤回与候选审阅。保存后反馈，其他任务不抢焦点；更正记忆不修改原文或历史指标，不等于批准实验。

## 6. 经验、候选与正式方法发布

经验含 cue、lesson、evidenceRefs、applicableConditions、来源任务与方法版本，先候选后核验；模型 confidence 不作为发布凭证。跨项目通用化需显式晋升并保留来源。

```text
EvolutionCandidate:
  id, skillId, baselineVersion, candidateVersion, diff, sourceExperienceIds
  editableSurface, developmentEvaluationRef, holdoutEvaluationRef
  budgetUsed, rejectionReasons, status
Publication:
  id, skillId, expectedBaselineVersion, publishedVersion
  evaluationRefs[], actor, publishedAt, rollbackOf?
```

状态 candidate → evaluated → validated → published；可 rejected，正式版可 retired/rollback。第一版自动提出 Skill 正文和工具说明修改，默认关闭自动正式发布，由用户审阅 diff 与独立评测后确认。

宿主权限、准入、预算、凭据、确认门控及验证器不可进化。新脚本、依赖和执行入口另行审查，不由候选绕过。基线始终参加比较；开发集用于提议/筛选，留出集用于受控回归，其答案、细则与逐样本反馈不回流提议器。限制轮次并保留最终独立测试，防止反复使用同一留出集造成适应。

先使用可回放的工具记录、程序验证与批准的轻量任务；方法改变影响后续生成时须真实执行，不能把旧轨迹回放当新 Skill 实效。真实目标实验仍须精确配置批准，评测不能自动扩大训练预算。未达预先标准、合法任务退化或预算不足均保留旧版。

发布以 expectedBaselineVersion 做并发检查，绑定哈希、评测与批准记录，原子移动正式指针，失败保留旧指针。回退新增审计记录；旧任务继续绑定原版本，主动迁移才升级。重开/切模型后重新验证能力。

## 7. 上游借鉴边界

| 上游快照 | 借鉴机制 | 不直接沿用的假设 |
| --- | --- | --- |
| Harness² `1cfe254` | 候选、执行对照、经验库 | 最终候选池不含基线不是保守升级保证；Windows fcntl 测试未通过 |
| mem0 `2c81af3` | 抽取、作用域、检索、显式更新和历史 | 默认 ADD 不等于自动冲突裁决，OSS 不含所有平台时间能力 |
| Graphiti `5c27edf` | 有效区间与旧事实失效 | 矛盾/时间抽取不保证正确，不默认引入整套图服务 |
| DREAM-RSI | 探索调度与方法层的区分 | 本期不接入探索树回放，不声称实现其算法 |

完整 SHA 和一手源码见 [面试文档 A08/A09](AGENT_RESUME_HIGHLIGHTS.md)。这里定义适配方案，不声明复制算法或取得上游收益。

## 8. 功能验收矩阵

RT01–RT16 的当前结果与证据见下表；样例与夹具已按阶段添加。原 AT01–AT10、WT 和科研 V 保持独立验收。

| 编号 | 应验证什么 | 必须覆盖的反例 | 状态 |
| --- | --- | --- | --- |
| RT01 | 保存、选区引用和消息重试问题完成复验 | WR-R01–R03 未关闭就宣布集成通过 | 通过（[IG00](verification/agent-implementation/IG00.md)） |
| RT02 | 迁移备份、幂等及失败恢复 | 修改旧会话、自动提交消息/实验 | 通过（[IG00](verification/agent-implementation/IG00.md)） |
| RT03 | 同消息加载、核心工具和任务隔离 | 未知工具静默忽略、缺依赖却成功 | 通过（[IG01](verification/agent-implementation/IG01.md)） |
| RT04 | 激活与发送/切模型互斥、重开校验 | 历史激活当当前授权 | 通过（[IG01](verification/agent-implementation/IG01.md)） |
| RT05 | 大资料集每轮有界输入、估算标记 | 全量记忆注入、截断冒充全文 | 通过（[IG02](verification/agent-implementation/IG02.md)） |
| RT06 | 压缩后查回条件、版本与 runId | 忘记就重跑、约束静默丢失 | 通过（[IG02](verification/agent-implementation/IG02.md)） |
| RT07 | 事件去重、来源身份与范围一致 | 助理建议升级为确认、跨项目按 ID 读写 | 通过（[IG03](verification/agent-implementation/IG03.md)） |
| RT08 | 修订/争议/不同条件并存及并发控制 | 最后写入覆盖、未知时间猜造 | 通过（[IG03](verification/agent-implementation/IG03.md)） |
| RT09 | 当前、历史与当时已知查询正确 | 晚到旧值污染当前、隐藏争议 | 通过（[IG04](verification/agent-implementation/IG04.md)） |
| RT10 | 跨任务召回与 UI 查看/更正/撤回 | 缓存越权、错来源、未落盘即成功 | 通过（[IG04](verification/agent-implementation/IG04.md)） |
| RT11 | 经验有条件与证据、候选范围受限 | 经验变规则、修改审批或验证器 | 通过（[IG05](verification/agent-implementation/IG05.md)） |
| RT12 | 版本、候选状态和评测预算持久化 | 候选即正式、自动扩大训练预算 | 通过（[IG05](verification/agent-implementation/IG05.md)） |
| RT13 | 基线参与、开发/留出隔离与全尝试记录 | 选择性报告、答案泄漏、只靠自评分 | 通过（[IG06](verification/agent-implementation/IG06.md)） |
| RT14 | 发布确认、并发切换、回退与旧任务绑定 | 无确认发布、覆盖指针、静默升级任务 | 通过（[IG06](verification/agent-implementation/IG06.md)） |
| RT15 | 固定卡配对评测及机制消融 | 模型/权限/预算不同仍归因某机制 | 通过（[IG07](verification/agent-implementation/IG07.md)） |
| RT16 | 有界真实模型、重启和原流程回归 | 文档/smoke 代替科研实效、缺条件记通过 | 通过（[IG07](verification/agent-implementation/IG07.md)） |

## 9. 测试、证据与交付

每个 IG 阶段完成须有实现、相关测试、脱敏证据和对应 Git commit。提交前运行受影响测试与类型检查；阶段出口运行 `npm run verify`，涉及交互时构建后运行 `npm run test:browser`，并运行相关文档校验。

真实 API/目标实验按已有凭据、环境与批准范围执行，缺条件单列未执行，不重复索要已有信息，不自动扩预算。证据保存到 `docs/verification/agent-implementation/`（实施时创建），记录 commit、环境、RT/AT、命令/退出码与 task/run/版本引用。

评测另存模型配置、任务材料、分组、次数、usage、延迟、失败与人工干预；价格未知时费用为未知。来源全文或凭据不进入公开证据。文档检查不代表 RT 已执行，IG07 是最终报告而非才开始测试；首个业务阶段为 IG00，不按含金量先启动进化。
