# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-23 (S77 · overlay isolated on `feat/os-agent-shell` · #213 on main)

## CMspark — 产品 0.5.2

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**；Chrome CU one-shot L2 **on main**（#215） |
| 无人值守 / 三旗巡航 | **on main** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024） |
| Outbound MCP | 交付 opt-in |
| Precision Instrument UI | 被消费级助手 canon 替换（**#196 MERGED**） |
| Thread list ID + large skill install | **on main**（#184） |
| **编程接力 / Mode C** | **on main**（#190 / #191） |
| Thread hygiene | **on main**（#193） |
| 站点负知识 site-op-memory | **on main**（**#213**） |
| OS summoner overlay（L0） | **WIP** `feat/os-agent-shell` — **勿合 main** |

## Branch lock (S77)

- **`main`**: 最新 Chrome 插件形态。tip `fc18725` = merge **#213** site-op-memory。
- **`feat/os-agent-shell`**: 插件 + 独立召唤窗（Raycast/uTools 形态，**不是**第二 Side Panel）。`c48aded` = `origin/main` + 21 summoner commits。跟踪 origin。稳定前不合。
- **不要**：把 overlay 当插件家；overlay 上 Allow/Deny；LLM `openChrome` 工具；把 journeys WIP 混进 memory commit。

## Next (optional backlog)

- Overlay：journeys spec/tests 仍脏；8+5 用户证伪；GOAL.md/ADR-020 一句话仍冻到 P0 证伪
- Overlay 稳定后再谈合 main / 打含召唤窗的包
- 本机 23401 可能是官方 CMspark.app tray（worktree daemon 已退）
- residual：login-shell 失败重试；WS progress throttle；message-router 续拆；Whisper multi-arch pins；codesign

## Docs SoT

- User / arch: `docs/README.md`
- Overlay brief: `docs/decisions/os-agent-shell-brief-2026-08-22.md`
- Overlay plan: `docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
