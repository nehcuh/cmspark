# Project Context

## Session Handoff

<!-- handoff:start -->

### 2026-09-27→28 S117 · 0.6.9 拉取 · 三条 BLOCKING 修复 · cut 0.6.10 发布

- **拉取**：0.6.9（`59931595..b5a7396a`，12 提交）。本机 Windows 编译 `CMspark-Setup-v0.6.9.exe`（sha256 `c61a949e…`）并换装 `C:\Users\HuChen\AppData\Local\CMspark`，daemon `:23401`。备份 `CMspark-backup-20260927-225703.zip`。
- **⚠️ 本机现装的这份自报 `cmspark-agent v0.6.9`，但含 `ad7f0980`/`b5a7396a` 两个提交的行为**（它们晚于 `v0.6.9` tag）—— 正是 #547 描述的「同版本号两份二进制」。官方 `v0.6.10` 已发布，是同一份代码（fc5935e2）的正确版本化构建；建议换装官方包以消除歧义。
- **四路对抗评审 REJECT**：三条 BLOCKING 全实机复现 → **#544（P0）** pivot 指令投递进 untrusted 通道（rule 11 明令禁止遵循）；**#545** fleet 快照读路径无条件释放 worker 租约；**#546** Windows argv 超限致测试静默空转。连带 **#548**（pivot 在其声称场景不可达）、**#550**（SOFT_RESERVED 窄时序）。
- **修复与发布**：PR **#549** 修三条 BLOCKING（`d1ee60a6`）→ PR **#551** cut 0.6.10、归档 Unreleased、17 文件版本锚 lock-step（`c8d3741f`）→ PR **#553** 落地 `scripts/release-guard.sh` 防复发（`aa3c786b`）。四路评审全程 APPROVE_WITH_NITS；pi 两 PR 均多轮 REJECT 后转通过，抓出 6 处真实缺陷（含操作者自己写错的两处 over-claiming）。
- **Release**：https://github.com/nehcuh/cmspark/releases/tag/v0.6.10 —— 三端 zip + Windows Setup.exe + SHA256SUMS。`Setup` sha256 `59d49e08…`、`windows-x64.zip` sha256 `3958cbb4…`。tag `v0.6.10` == main HEAD `fc5935e2`（#547 脱节闭环）。
- **release-guard dogfood**：v0.6.10 是 `release-guard.sh` 首次在真实 tag push 中运行 —— preflight 的 guard step `completed success`，未误挡正常发布。
- **Next**：换装官方 v0.6.10（消除本机 0.6.9 自报歧义）；重载 unpacked 扩展 `chrome-extension/build/chrome-mv3-prod/`。不要提交 `host-integrity.ts`。#230 仍冻，禁扩默认 outbound profile。#552 follow-up（ps1/create-dmg/installer 三入口未接守卫、cli-version 硬编码正则）另票。
- **Do not**：`xattr -cr`、`pgrep -f /Applications/CMspark.app`、换装留 bak、`kimi -p` 后面紧跟 `--output-format`。

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
