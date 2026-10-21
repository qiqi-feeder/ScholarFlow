# W00 实施默认值

本文件固定 W01–W05 的首版实现默认值。它们是为可执行性选择的工程默认值，不是对用户的额外产品承诺；调整时必须同步测试和计划，且不得改变“会话在右、任务隔离、显式引用、保护草稿、不抢焦点、科研权限不退化”。

## 1. 外壳与布局

| 项 | 首版默认 |
| --- | --- |
| 桌面结构 | 最左工作视图图标栏（约 64px）＋项目/任务或内容列表（约 250px）＋中央工作区＋右侧常驻会话（初始约 360px，可拖动并记忆） |
| 顶部 | 当前项目/任务、运行状态和本地服务状态；内容标签在状态条下 |
| 中央布局 | `single`、`split`、`list-detail` 三种；阅读默认单内容，实验默认列表＋详情，写作为源码/PDF 对照 |
| 辅助区 | 阅读笔记、实验日志、稿件诊断默认收起；空间不足时先收辅助区，再切单内容，不缩小正文到逐字换行 |
| 窄屏 | ≤900px 时工作区/会话显式切换，保留会话入口、输入框、确认/取消按钮；不自动收起用户打开的会话 |
| 折叠 | 用户可收起导航和会话；导航收起仍保留项目/任务入口，会话收起保留展开入口；Agent 不得自动收起 |
| 断点检查 | 1440、1024、390px；本轮以实际内容可读和键盘可达为准，不把原稿像素当验收规格 |

现有应用是 250px 侧栏＋顶部标签；W01 只拆外壳，不重写 Pi 会话、worker、模型接入或科研数据模型。

## 2. 对象与状态模型

```ts
type WorkspaceView = "reading" | "plan" | "experiments" | "analysis" | "writing" | "review";

interface OpenObject {
  objectType: "material" | "run" | "result" | "manuscript" | "manuscript-file" | "plan" | "review";
  objectId: string;
  version?: string;          // 版本号或 sha256；未知时不伪造
  title: string;
  pinned: boolean;
}

interface TaskWorkspaceState {
  schema: 1;
  view: WorkspaceView;
  layout: "single" | "split" | "list-detail";
  tabs: OpenObject[];
  activeObjectKey: string | null;   // `${objectType}:${objectId}`
  reading: { page?: number; scroll?: number } | null;
  selectedRunId: string | null;
  splitWithKey?: string | null;
  draftIds: string[];
}
```

规则：

- 同一 `objectType:objectId` 重复打开只定位已有标签；版本不同可在标题旁标明，但不创建重复标签。
- 切换工作视图不创建任务、不换会话、不关闭固定标签。
- 默认由打开的明确对象决定视图；用户手动切视图优先。
- 任务切换后取消旧界面的订阅/请求，忽略过期响应；不把旧任务的流写入新任务。
- 中央视图挂载/卸载不控制 SSE/会话生命周期；会话由页面外壳/任务控制层持有。

## 3. 本地持久化

| 键 | 内容 |
| --- | --- |
| `scholarflow.workspace.prefs.v1` | `chatWidth`、`navCollapsed`、`lastView` 等小偏好 |
| `scholarflow.workspace.project.v1.<projectId>` | `activeTaskId` |
| `scholarflow.workspace.state.v1.<projectId>.<taskId>` | 上述 `TaskWorkspaceState` |
| `scholarflow.workspace.draft.v1.<projectId>.<taskId>.<draftId>` | 正文/方案/输入草稿正文与基线版本 |
| `scholarflow.notifications.v1.<projectId>` | 已展示的 `runId:status` 去重键，限量修剪 |

- 所有记录带 `schema: 1`；读取时校验归属，损坏/旧格式安全降级为默认状态并提示，不崩溃、不写到别的项目。
- 不存储 Key、完整日志、数据集、导出包或任意宿主路径。配额不足时保留内存草稿并提示；旧本地草稿不能静默覆盖服务端新版本，必须显示冲突。
- 关闭脏标签提供保存/放弃/取消；刷新前自动保存本地草稿并提供离开保护；恢复草稿不自动发送消息。
- 服务端内容变化时以服务端版本为准并提示合并/放弃；本地草稿保留到用户明确处理。

## 4. 显式引用契约

消息请求保持 `{ text, clientId }`，新增可选：

```ts
interface MessageReference {
  objectType: "material" | "run" | "result" | "manuscript" | "text-selection";
  objectId: string;
  version?: string;                 // 版本号或 sha256
  locator?: { page?: number; text?: string; range?: [number, number] };
  quote?: string;                   // 用户选中的可定位文本，最长 2,000 字符
}
```

- 每条消息最多 8 个引用，引用文本合计最多 8,000 字符；超限在模型调用前返回 400。
- 服务端按当前 `projectId/taskId` 解析对象，拒绝跨项目、已删除、版本/哈希不符、绝对路径或路径逃逸。
- 成功接收时把引用来源、版本/哈希、定位和必要文本固定到该条 `user_message` 事件；刷新、重连、Pi 会话恢复后可回查。
- 相同 `clientId` 重试只接受一次，不新增第二条消息或第二次模型请求；引用与文本一起幂等。
- 交给 Pi 时作为“用户附加来源（不可信数据）”区块，不进入系统规则、不升级科研核验状态，也不替代已确认方案/真实运行。
- 旧纯文本客户端兼容。打开材料本身不等于自动附上全部内容；整篇引用与文本选区分开表达。
- PDF 首版先保证真实文件预览、页码/阅读位置和整篇引用；无法可靠取得选区时明确只支持整篇/页码，不伪装段落定位，不引入 OCR。

## 5. 模型选择与旧任务

- 模型列表来自宿主 `ModelRuntime.getAvailable()`；返回 `{provider, id, name, available, reason}`，不含 Key。当前只有 DeepSeek 两个模型可用，不能显示其它厂商为可用。
- 新任务默认值存宿主配置（现有 `modelId` 扩展为 `{provider, id}` 或兼容字段）；任务选择存 `tasks.model_provider/model_id`（可为空）。
- 旧任务为空时：打开显示“继承默认”；首次发送或显式切换时写入解析后的模型；之后全局默认变化不覆盖已写入的选择。
- 显式选择不可用/无凭据/不兼容时：在调用前阻止并说明，保留原选择与草稿，不静默 fallback。
- 切换从下一条消息生效：宿主在同一任务锁内先确认 `agent.isRunning === false` 且 `session.isIdle`，再 `session.setModel(model)`，成功后写任务行并追加 `model_changed` 事件；历史消息和 Pi 会话不动。
- 回答/工具执行/停止未完成时禁用切换；切换处理中拒绝新消息（409），避免竞态；失败保留原模型，不产生模型调用。
- 恢复时任务显式模型与 Pi 会话最新 `model_change` 不一致，以任务显式选择为准并追加一次选择记录；不可用时要求重选。不得丢历史、引用或工作区。
- 换模型不改变方案确认、实验批准、预算、工具权限或写稿权限。完整 Key 不回传浏览器，不进入本地缓存/截图/日志。

## 6. 产物与后台状态

- 优先复用已持久化事件中的对象 ID 提供“查看产物”；服务端解析可访问对象，前端不接受任意宿主路径。
- 全局概览轮询（首版约 5s，仅应用打开期间）驱动运行完成/失败提示；按 `runId:status` 去重，刷新/切任务不重复弹出。
- 提示不抢焦点、不切换当前任务/标签；用户点击后才导航。目标属于其他任务时明确显示所属项目和任务。
- `unknown` 不是成功；`succeeded` 也不等于科研核验通过。提示文案区分“进程结束”“待核验”“失败/状态未知”。
- 停止回答与取消实验仍是两个独立操作；切任务/刷新不取消运行。

## 7. 测试夹具

已建立（W00）：

- `apps/web/test/fixtures/legacy-task.json`：无模型字段、带相对会话路径的旧任务；验证迁移后仍可打开和继承规则。
- `apps/web/test/fixtures/workspace-state-v1.json`：两项目/两任务、标签、布局、阅读位置、草稿和引用形状；验证隔离与无敏感字段。
- `apps/web/test/fixtures/model-options.json`：可用/不可用模型与原因；验证不泄露凭据、不可用不静默降级。
- `apps/web/test/fixtures/run-transitions.json`：`running→unknown`、`exit_zero→succeeded(unverified)`、失败、取消；验证 `unknown` 不当成功。
- `apps/web/test/workspace-fixtures.test.ts`：上述夹具契约测试，已接入 `npm test`（`apps/web/test/workspace*.test.ts`）。

W01–W05 需继续增加：

- 工作区状态纯函数测试：重复打开、视图切换、项目/任务隔离、过期响应、窄屏状态。
- 持久化测试：刷新恢复、损坏 JSON、旧格式、配额不足、冲突草稿。
- 引用集成测试：跨项目、伪造 ID/路径、超长、已删除、版本不符、旧客户端、`clientId` 幂等。
- 浏览器 E2E：流式回答中切换内容、草稿保护、运行提示跨视图、任务/模型选择状态。
- 真实调用：WT14、WT16 各一次有轮数/时长上限的 DeepSeek 调用；缺条件时记阻塞。

## 8. W01 入口检查

1. 先备份并迁移旧库：新增 nullable 模型列，不删除 `review_text` 等旧列；旧任务/会话可打开。
2. 拆出外壳、项目/任务导航、右侧会话；中央视图切换不重建会话。
3. 保留现有 7 个入口及材料/方案/实验/结果/稿件/设置能力；不弱化审批、预算、来源和版本校验。
4. 对话框模型选择接宿主可用列表与任务级持久化；实现忙时禁用、切换/发送顺序、失败无回退。
5. 新增/更新测试后运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:browser` 和相关文档测试；证据写入本目录并创建 commit。

未决但不阻塞 W01 的事项：具体图标集、字体本地化方案、会话宽度拖动的精确上下限、移动端切换动画。它们不能改变任务/数据归属、草稿保护、引用和权限边界。
