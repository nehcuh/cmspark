# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-23 (S77 · overlay 独立分支 · session-end)
- **Workspace**: `feat/os-agent-shell` `c48aded`（跟踪 origin）。**不要**把 overlay 合进 main。
- **Main tip**: `fc18725` merge **#213** site-op-memory（浏览器负知识）。产品 0.5.2。
- **Done**: overlay live polish（markdown / 新对话 / 麦 / 热键关 / idle / 静默 Chrome / MCP 复用）已 push；分支整理 = main 插件最新 + overlay 21 commit 独立；#213 已合。
- **Dirty 勿 commit**：`companion/tests/summoner-journeys.test.ts`、`docs/superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md`、以及已改未提交的 summoner/Tray/agentStore/composer-lease。
- **Next**: journeys WIP 单独处理；8+5 证伪；Swift SHA256 锁步；稳定后再谈合 main。
- **Do not**: overlay 上做确认台；GOAL.md 解冻；`git add .`；把 memory commit 混进 overlay 功能文件。

### 2026-08-20 ~13:59 (S76 · #203 MERGED · DMG · session-end)
- **Main tip**: **PR #203 MERGED** `a468925` — LLM DNS/IMDS nits + osascript 批准后不再 regex 二次硬拦；`/Applications` 已换 0.5.1 DMG（备份 `~/CMspark.app.bak-20260820-132406`）
- **Done**: fzbcro 假拒窗根因（token 后再 `checkHighRiskExecution`）+ copy 分流；3 路对抗 + Claude/Pi AWN；折 nits；CI 绿合 main；`make package-macos` 换装
- **Next**: 重载扩展；fzbcro 带 fetch 注入应批准后真跑；合 #196 后再打含 canon UI 的 DMG；P2-A3 钉 IP 未做
- **Do not**: 把 `host-integrity.ts` 打包脏 SHA 提交；dispatch 单测勿绑 `_rt`+HOME；实现者自放行
<!-- handoff:end -->
