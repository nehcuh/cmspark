# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-31 (S102 END · 本机 0.5.6 DMG 换装)
- **Workspace**：`main` == `origin/main`。无开放 PR。产物 `dist-package/CMspark-v0.5.6-macOS.dmg`。
- **Ship**：`make package-macos` → ditto 换 `/Applications/CMspark.app`（从 0.5.3）；`cmspark-agent v0.5.6` 在 `ws://127.0.0.1:23401`。用户不要备份，已删全部 `~/CMspark.app.bak-*`。
- **Next**：Chrome unpacked 扩展若仍旧包，重载 `chrome-extension/build/chrome-mv3-prod/`。#258–#260 排期。
- **Do not**：`xattr -cr`（SIP provenance）；`pgrep -f /Applications/CMspark.app`；留 bak；#230 整票；扩 outbound profile。

### 2026-08-31 (S101 END · 评审弧 #261–#264 全闭环)
- **Workspace**：`main` == `origin/main` **`18d843d1`**。无开放 PR，无遗留分支。
- **Ship**：#261 shell W1e fail-closed · #262 run_progress 三态 · #263 UX CTA/错误/K 回显 · #264 voice auto-correct 可恢复 + ADR-022 grant 双轨修订。评审产物 `docs/superpowers/reviews/gate-kimi-fix-20260831-*`；W1e 回归脚本 `scratch/w1e-replay.ts`。
- **Next**：早期评审残余 NIT 可开 follow-up（RunProgress 微 a11y、summoner 流式拽底/收尾跳变、companion-http HITL 审计双写、模型优先级三处复制）；#258–#260 排期。
- **Do not**：#230 整票实现（冻）；扩 outbound profile；宣称默认值绝不进 localModelAutoCorrectedFrom（load 后与显式 medium 不可区分，已文档化）。
<!-- handoff:end -->
