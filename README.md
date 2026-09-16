# ScholarFlow
An Agentic Research Workspace powered by Pi

## 前端 Demo

- [Light Workspace v2](demo/workspace-light.html)：明亮的 IDE 工作台设计，原生 HTML/CSS/JS，包含六个功能页和 Mock 交互。
- [原始 Demo](demo/index.html)：保留不覆盖。
- [第一版 Figma 设计](https://www.figma.com/design/rQ8doN3vOtVhHFFrhhPxFp?node-id=10-2) / [第一版截图](.experiments/frontend-bakeoff/scholarflow-ide-v1.png)：保留不覆盖。

从仓库根目录运行 `python -m http.server 8811 --bind 127.0.0.1`，打开 <http://127.0.0.1:8811/demo/workspace-light.html>。支持 `?view=notes`、`?view=reading` 等直接查看功能页；字体与图标均为本地资源。

验证：`./tests/workspace-light.tests.ps1`（需要 Python、Node 和 Chrome/Edge）。新页面的实现范围、截图与局限见 [v2 评审说明](.experiments/frontend-bakeoff/LIGHT_V2_REVIEW.md)，旧实验目录的恢复方式见 [worktree 清理记录](.experiments/frontend-bakeoff/WORKTREE_CLEANUP.md)。
