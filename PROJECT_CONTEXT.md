# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-24 22:46 S118 · 标签锁与点不到就换路 · 合 main

- **Ship**：[#526](https://github.com/nehcuh/cmspark/issues/526) / [PR #527](https://github.com/nehcuh/cmspark/pull/527) 快进到 `origin/main` `b5a7396a`。CI 四作业绿。版本仍 **0.6.9**，未发版。
- **行为**：只读不占锁；修改只占这一下；worker/编排新建标签 60 秒。点不到可见文字时改读页面、滚动或搜索，不再连失败三次停轮。
- **本机**：`/Applications/CMspark.app` CDHash `8910dba5e15847b4e11954884a3c72831cd2fcd4`，daemon `:23401`。无 bak。`host-integrity.ts` 未提交。
- **Next**：重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。#230 仍冻。禁扩默认 outbound profile。
- **Do not**：`xattr -cr`、`pgrep -f` 应用路径、换装留 bak、把 `mutationHolds` 加进 renew、超时后立刻 FREE。

### 2026-09-23 S116 · #524 租手确认 · 0.6.9 换装发布

- **Ship**：#524 合 main 后切 **0.6.9**（`488252bf`）。本机 `/Applications/CMspark.app` 已换装，CDHash `37d554d0…`，daemon `:23401`，`cmspark-agent v0.6.9`。无 bak。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.9 （三端 zip + Windows Setup.exe + SHA256SUMS）。Linux 断言曾因 `napi-v6` 失败，标签已移到修复提交。
- **Next**：重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻，禁扩默认 outbound profile。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后面紧跟 `--output-format`。
<!-- handoff:end -->
