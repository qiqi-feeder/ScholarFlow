# W01 外壳、任务导航与任务级模型证据

日期：2026-10-22（Asia/Shanghai）。
范围：W01 拆分应用外壳、项目/任务导航、右侧常驻会话；任务切换隔离；任务级模型选择、宿主持久化与真实调用一致性。未实施 W02 的动态内容列表/布局恢复、W03 显式引用、W04 后台联动和 W05 UI 清单收口。
结论：**W01 完成，WT02、WT03、WT16 通过**。W02–W05 与其余 WT 仍待实施。

## 1. 实现

| 项 | 实现 |
| --- | --- |
| 外壳 | `64px` 工作视图图标栏 + 项目/任务导航 + 中央工作区 + 右侧常驻会话；已有任务/材料/方案/实验/结果/稿件/设置七个入口仍可进入 |
| 会话归属 | SSE、事件、`liveText`、发送/停止由 `App` 外壳持有；中央面板挂载/卸载不重建会话 |
| 任务切换 | 任务/项目加载序号与 `activeTask` 守卫；切换时只中止旧浏览器订阅，不取消宿主回答；旧响应与旧任务 SSE 不写入当前任务 |
| 导航 | 项目列表、新建项目、任务列表、新建任务仍在左侧；当前任务与中央内容、右侧会话一致 |
| 模型列表 | `GET /api/models` 通过 Pi `ModelRuntime.getAvailable()` 返回宿主真实可用模型；不返回 Key，不把未配置提供方标为可用 |
| 任务模型 | `tasks.model_provider`、`tasks.model_id` 可空迁移列；旧任务为空时显示“继承默认”，首次发送/显式切换写入解析后的模型，之后默认变化不覆盖 |
| 切换契约 | `PUT /api/projects/:projectId/tasks/:taskId/model`；同一任务锁内检查忙状态、可用性与 `session.isIdle`，成功后写任务行并追加 `model_changed`；失败保留原模型，`409 AGENT_BUSY` 或 `400 MODEL_UNAVAILABLE` |
| 发送竞态 | 忙时/切换中发送返回 `409`；被拒绝的请求不占用 `clientId`；重复 `clientId` 仍幂等返回一次 |
| 历史 | `assistant_message` 记录实际 `provider/model`；会话中显示回答模型，`model_changed` 作为系统记录 |
| 权限 | 未改变方案确认、实验批准/预算、运行快照、结果来源、稿件版本、工具权限与写稿边界 |

## 2. 兼容与迁移

- 旧 `tasks` 表按 additive migration 增加 nullable `model_provider`、`model_id`；不删除 `review_text`，不改写 `session_file` 与已有会话。
- 集成测试用旧 schema（无模型列）建库，执行 `openDatabase` 后确认列存在、旧任务可读、相对会话路径与审稿文本保留，模型选择可写回。
- 旧任务模型为空时不伪造历史：只显示“继承默认”；首次发送或显式切换才固定选择。
- 任务显式模型重新打开时以任务行为准；若 Pi 会话记录了旧的 `model_change`，加载时追加一次任务选择，不丢历史。

## 3. 验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 64 通过，1 跳过（WT16 真实调用需显式开关） |
| `npm run build` | 通过 |
| `npm run test:browser` | 2 个 Chrome E2E 通过 |
| `SCHOLARFLOW_REAL_MODEL_TEST=1 node --import tsx --test apps/server/test/wt16-real-models.test.ts` | 1 通过；两个已配置模型各一次有界真实调用 |

新增/更新的自动化覆盖：

- `apps/server/test/server.test.ts`
  - 旧任务 schema 迁移与会话指针保留。
  - 任务模型切换写入任务行与 `model_changed`；忙时拒绝；不可用模型不覆盖原选择。
  - `/api/models`、`PUT .../model`、任务详情模型字段；忙时发送 `409`；被拒请求不占用 `clientId`；重复 `clientId` 幂等；停止回答只更新回答状态并调用 Agent stop，不触碰实验取消。
- `apps/web/test/browser.test.ts`
  - 流式回答期间切到“材料”，右侧会话与输入框保持，回答继续出现。
  - 任务 A → B → A：B 不出现 A 消息；A 迟到增量不写入 B；返回 A 历史完整。
  - 任务级模型选择后，后续调用使用该模型；任务 B 使用默认模型；`sessionFile` 不变。
- `apps/server/test/wt16-real-models.test.ts`（默认跳过）
  - 从 `/api/models` 取两个真实可用 DeepSeek 模型，各发送一次“只回复 OK”的有界请求。
  - 结果：`deepseek-flash` 于事件 seq 6、`deepseek-v4-pro` 于 seq 12 返回；两条历史分别记录实际模型；文本长度 2；任务最终显式模型为第二个模型。
  - 未记录、回显或提交 Key；测试使用临时数据目录，结束后删除。

既有失败：`tests/workspace-light.tests.ps1` 仍因旧静态 Demo 缺少 `demo/assets/ide-light/document.svg` 失败；属于既有 Demo 问题，未在本节点隐藏或改写。

## 4. 限制与后续

- W01 保留现有七个顶部内容标签；W02 才实现视图对应内容列表、单/双区、辅助区、按任务恢复与脏稿保护。
- 会话宽度拖动、移动端工作区/会话显式切换、动态论文库、显式引用和后台运行提示不在本节点；分别由后续节点与 WT18/WT09 验收。
- 旧任务迁移在打开数据库时执行；本轮未改写宿主真实数据库内容，迁移测试使用合成旧 schema。
- 真实调用只验证模型选择、实际模型记录与有界通信；不代表科研结论、真实实验或顶刊结论已验收。
