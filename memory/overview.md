# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-24 (S78 · #219 on main · overlay + C-thin)

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
| OS summoner overlay（L0） | **on main**（**#219** C-thin HTML + Mac NSPanel） |
| steer/nextRun busy composer | **on main**（#218 remainder + #219 UI） |

## Branch lock (S78)

- **`main`**: tip `daf8bc9` = squash **#219** steer/nextRun + overlay L0 hub + C-thin summon shell。前一 tip `5425da0` = **#218** durable loop。
- **不要**：overlay Allow/Deny；给 `isAllowedWsOrigin` 加 `http://127.0.0.1`；再给 Swift SummonerOverlay 加功能；Electron。

## Next (optional backlog)

- 真机：托盘「召唤器（实验）」Win/Linux `--app` 窗 + Mac NSPanel
- 原生 WKWebView/WebView2/GTK 仍可选（非本线）
- residual：login-shell 失败重试；WS progress throttle；message-router 续拆；Whisper multi-arch pins；codesign

## Docs SoT

- User / arch: `docs/README.md`
- Overlay / C-thin: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`
- steer/nextRun hub: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`
- Overlay brief: `docs/decisions/os-agent-shell-brief-2026-08-22.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
