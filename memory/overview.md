# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-25 (S79 · #221 on main · post-#220 nits)

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
| steer/nextRun busy composer | **on main**（#218 + #219 UI + **#220/#221** nits） |

## Branch lock (S79)

- **`main`**: tip `ac0a3be` = squash **#221** post-#220 residual nits。前序 `1d16b0e` = **#220**；`daf8bc9` = **#219** overlay hub + C-thin。
- **不要**：overlay Allow/Deny；给 `isAllowedWsOrigin` 加 `http://127.0.0.1`；再给 Swift SummonerOverlay 加功能；Electron；全局 redact 裸 `value`。

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
