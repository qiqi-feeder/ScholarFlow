# ScholarFlow Light Workspace v2

独立实现：[`demo/workspace-light.html`](../../demo/workspace-light.html)。保留 `demo/index.html` 与第一版 Figma/节点归档/截图，不对第一版追加修改。

使用 figma-design-to-code 工作流，读取第一版 `10:2` 设计上下文及截图后，保留活动栏、项目树、文件标签、阅读/编辑区、Agent 和日志的工作台结构，按仓库原生 HTML/CSS/JS 实现。将石墨色外壳改为浅灰蓝层级，以纯白文档、克制的蓝色选中态与绿色完成态区分内容；不添加 Hero、统计卡片或装饰性渐变。

主要色板：背景 `#eef1f6`，顶栏 `#f4f6fa`，侧栏 `#f7f8fc`，文档 `#ffffff`，正文 `#222936`，次要文字 `#5f6c80`，边线 `#dde3ec`，强调色 `#315fca`，选中背景 `#e9f0ff`。字体与 Figma SVG 本地加载，来源及校验值在 [资源清单](../../demo/assets/ide-light/manifest.json)。

## 范围

六个功能页；标签打开/关闭/空态与键盘导航；命令面板搜索；项目上下文切换；论文筛选；Agent 上下文增删及异步模拟回复；模拟实验与日志；窄屏资源树/Agent 抽屉。Enter 发送、Shift Enter 换行，输入法组字不触发发送。用户输入进行 HTML 转义，新会话取消上个会话的待生成消息。

这是 UI Demo，不连接后端、模型或真实 PDF。项目切换更新项目元数据，但资源正文仍使用医学影像示例；翻页、其他笔记、历史运行、引用以及导入/导出等尚未实现的功能通过提示说明，不声称真实上传或下载。

## 验证与截图

`tests/workspace-light.tests.ps1` 在隔离 headless Chrome/Edge 配置中运行浏览器交互测试，实际 iframe 视口为 1440×900、1280×800、1024×768、390×844。检查六页导航、容器溢出、功能交互、键盘、异步取消、XSS 转义和运行期错误，同时保护第一版文件。`-CheckCleanup` 额外验证仅有主 worktree 且四个实验恢复分支存在。

截图经实际浏览器渲染、逐页目视核验。使用 `tests/workspace-light.preview.html` 固定 iframe 尺寸，避免 headless 浏览器最小窗口宽度导致移动端截图被裁切。

- [首页](previews-light-v2/overview.png) / [手机首页](previews-light-v2/overview-mobile.png)
- [文献](previews-light-v2/sources.png) / [阅读](previews-light-v2/reading.png)
- [笔记](previews-light-v2/notes.png) / [证据](previews-light-v2/evidence.png) / [实验](previews-light-v2/experiments.png)

交付回归验证包括仓库原有四组测试：web-demo、product-design、ui-bakeoff、figma-workspace。清理记录及恢复分支见 [WORKTREE_CLEANUP.md](WORKTREE_CLEANUP.md)。
