# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-12 (S68 daemon lock · #180 OPEN)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守（桌面） | **on main**（#160：L2+re-L2 静默；ADR-021 rev） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；**#179 on main**：soft-continue/pin/双ack/会议 AI 纠错+分段） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Precision Instrument UI | **on main**（#168–#171） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |
| macOS .app daemon 自锁 | **#180 OPEN**（acquireLock 同进程幂等；本地热更可跑） |

## Main tip (remote)

- **`origin/main`**: **`826e4c8`** (#179 merged)
- **Open PR: 1** — **#180** daemon acquireLock idempotent（CI: smoke u+m pass; build/win pending at session-end）

## Recent locks (S68)

- **Daemon UDS handoff**: OPS-02 持锁过 init 必须 **same-process acquireLock 幂等**，否则 self already_running
- **Meeting STT field-ops**: #179 on main
- **Deep-diagnosis / Precision**: 仍在 main（#168–#175）

## Next (optional backlog)

- **合 #180** + 正式 package/DMG（替换 adhoc 热更）
- 真机：会议双 ack / AI 纠错 / 坏二进制硬停；workspace 沙箱；estop TCC
- message-router 续拆；Whisper multi-arch real pins；codesign
- residual：install.manifest 同目录信任边界；DYLD_FALLBACK brew；filesystem MCP allow-dir

## Docs SoT

- User / arch: `docs/README.md`
- Diagnosis closeouts: `docs/audit/deep-diagnosis-*-closeout-2026-08-1*.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md`
- MCP: `docs/mcp.md`
