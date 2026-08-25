# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-25 (S81 · #222 on main · PR #223 P1/nits/Win HUD · NSIS 换装)

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
| Daily assistant · 本机知识诚实 | **on main**（**#222**）；P1/nits/Win HUD 在 **PR #223** |

## Branch lock (S81)

- **`main`**: tip `6ce291db` = squash **#222**（knowledge honesty Wave 0–2 + overlay HUD compose）。
- **`fix/post220-head-p1-fold`**: **PR #223** — post-#222 P1（F-I-5 / PEM / F-S-1）+ residual nits + Win C-thin 折叠居中条。本机 `%LOCALAPPDATA%\CMspark` 已 NSIS 静默换装。
- **不要**：overlay Allow/Deny；summoner WS 上 `knowledge.import`；Project / graph DB；`isAllowedWsOrigin` 加 loopback；Electron；全局 redact 裸 `value`。

## Next (optional backlog)

- CI 绿合 **#223**；Chrome 重载 `Local\CMspark\chrome-extension`；再开召唤器验折叠条
- overlay `pack.apply` peek / import `user_gesture` 服务端 400 仍停住
- 原生 WKWebView/WebView2/GTK 另票
- residual：login-shell 失败重试；WS progress throttle；message-router 续拆

## Docs SoT

- User / arch: `docs/README.md`
- Overlay / C-thin: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`
- steer/nextRun hub: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`
- Overlay brief: `docs/decisions/os-agent-shell-brief-2026-08-22.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
