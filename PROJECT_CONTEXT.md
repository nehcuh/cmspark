# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-01 (S103 END · #265 当轮活计划 · 0.5.7 换装)
- **Workspace**：`origin/main` **`2cd41f1d`**（PR #266 squash Closes #265）。本地 main 可 ahead session-end，**勿擅自 push**。无开放 PR。产物 `dist-package/CMspark-v0.5.7-macOS.dmg`。
- **Ship**：T3 当轮活计划（聊天列 01+02 sticky 可勾清单；`run_progress_propose` + 首个 PAGE_TOOL `PROPOSE_REQUIRED`）。lockstep 0.5.7；`ditto` 换 `/Applications/CMspark.app`；`cmspark-agent v0.5.7` `ws://127.0.0.1:23401`。无 bak。
- **Next**：重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/` 狗食本轮步骤。#258–#260 排期。
- **Do not**：StatusRail C / Wave 2 FocusBand；overlay Allow/Deny；`xattr -cr`；`pgrep -f /Applications/CMspark.app`；#230 整票；扩 outbound profile。

### 2026-08-31 (S102 END · 本机 0.5.6 DMG 换装)
- **Workspace**：当时 `main` == `origin/main`。产物 `dist-package/CMspark-v0.5.6-macOS.dmg`（已被 0.5.7 替换）。
- **Ship**：`make package-macos` → ditto 换 `/Applications/CMspark.app`（从 0.5.3）；用户不要备份，已删全部 `~/CMspark.app.bak-*`。
- **Next**：unpacked 扩展重载（S103 仍欠）。#258–#260 排期。
- **Do not**：`xattr -cr`（SIP provenance）；`pgrep -f /Applications/CMspark.app`；留 bak；#230 整票；扩 outbound profile。
<!-- handoff:end -->
