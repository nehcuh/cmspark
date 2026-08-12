# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-13 (S69 · #184 thread-id / skill zip / download recovery MERGED)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守 / 三旗巡航 | **on main**（#160 值守静默；**#181** 工具面+MCP+DSML；**#183** 路径风险自担） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；**#179 MERGED** soft-continue/AI refine） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Precision Instrument UI | **on main**（#168–#171） |
| Thread list ID + large skill install | **on main**（**#184**） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: **`5713089`** — Merge PR **#184** (thread IDs, large skill zips, download timeout recovery)
- **Open PR: 0**

## Recent locks (S69)

- Thread list/rail always-visible `#id` + copy + richer local search
- skill_install: monorepo subtree, shared L2 picker, atomic overwrite, raised budgets
- browser_download: timeout recovery time-floored; respects `force_redownload`

## Next (optional backlog)

- 真机：#184 重载 dist-package + dashiai zip install + multi-skill fail
- 真机：三旗 file 图 / MCP allow 自动扩 / 危险路径仍拦
- 真机：meeting 双 ack + AI 纠错；workspace 沙箱；Win shell·听写；Mac 值守
- message-router 续拆；Whisper multi-arch real pins；codesign

## Docs SoT

- User / arch: `docs/README.md`
- MCP: `docs/mcp.md`（三旗 allow-dir 语义）
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
