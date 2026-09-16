# 前端实验 worktree 清理

已按用户要求移除 `.worktrees/variant-a`、`variant-b`、`variant-c`、`variant-d`，仅保留主工作区。没有删除实验分支，所有源码与暂停状态可恢复。

| 分支 | 归档提交 | 内容 |
| --- | --- | --- |
| `exp/variant-a` | `cbe93db4677374e281a3cb6df2f71d0b632b4e2e` | 控制组页面 |
| `exp/variant-b` | `2731613eee35389820d58c19b551adbbc7a220fb` | Anthropic 页面 |
| `exp/variant-c` | `c6ddbd4f25c548bbb9d281279944620f072a2b99` | 暂停的页面改动及归档测试 |
| `exp/variant-d` | `b54509e23048b10659105ff93203273386a7c77a` | 暂停的产品／设计笔记及归档测试 |

C、D 在清理前新增归档测试，验证其已有三组测试通过，再提交未完成的工作；此归档不表示旧实验完成。A、B 清理前工作区干净。移除操作使用精确、已校验的 worktree 路径和 `git worktree remove`，未使用强制递归删除。

如需恢复某一组：`git worktree add .worktrees/variant-c exp/variant-c`（其他组同理）。被移除的目录和其中生成的 Python 缓存可重建，Git 中的源码和笔记均保留。

第一版 Figma、预览、节点归档，以及主仓库 `demo/index.html` 均未删除或覆盖。
