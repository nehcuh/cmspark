# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-09-23 S116 · #524 租手确认 · 0.6.9 换装发布

- **Ship**：#524 合 main 后切 **0.6.9**（`488252bf`）。本机 `/Applications/CMspark.app` 已换装，CDHash `37d554d0…`，daemon `:23401`，`cmspark-agent v0.6.9`。无 bak。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.9 （三端 zip + Windows Setup.exe + SHA256SUMS）。Linux 断言曾因 `napi-v6` 失败，标签已移到修复提交。
- **Next**：重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻，禁扩默认 outbound profile。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后面紧跟 `--output-format`。

### 2026-09-15 S109 END · VibeSOP 8.5.0 配置刷新

**Workspace**：CMspark main 工作树原有未提交内容保持不变；本次仅新增/刷新本地 agent 配置。

**完成**：`.vibe/dist/` 五个平台产物已重建；项目 `.claude/` 与 `.grok/`、全局 Claude/Grok/Kimi/Pi/OpenCode 配置已同步至 VibeSOP 8.5.0。额外 skill、`.grok/workflows`、Claude 本地设置和模型配置保留。

**验证**：Claude、Grok、Kimi、OpenCode、Pi 独立 `vibe verify` 全部通过；Cursor 未配置，未改动。

**Next**：重启相关 Agent；审阅是否将 `.grok/rules/` 与 `vibesop-*` hooks 纳入仓库版本控制。
<!-- handoff:end -->
