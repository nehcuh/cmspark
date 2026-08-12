# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-12 (deep-diagnosis P0–P2 + residual #172–#175)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守（桌面） | **on main**（#160：L2+re-L2 静默；ADR-021 rev） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；**Windows SEA+bin sidecar on main #161**） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Precision Instrument UI | **on main**（#168 shell · #169 graph · #170 tokens · #171 P2b+3） |
| Deep-diagnosis fanout hardening | **on main**（#172 P1 · #173 P0 · #174 P2 · #175 residual） |
| multi-OS CI smoke | **on main**（#175 `smoke-os` ubuntu/mac/win） |
| DevSec 默认工作区沙箱 | **on main**（#165 Scheme 1 + #166 nits） |

## Main tip (remote)

- **`origin/main`**: **`6d7e7e8`** — #175 P2 residual closeout
- Prior: #174 P2 · #173 P0 · #172 P1 · #168–#171 Precision
- **Open PR: 0**

## Recent locks (S66–session-end)

- **Deep-diagnosis（2026-08-11–12）**: fanout → 分批 PR；oneshot 校验先于 key；host 一律 integrity；扩展密钥 SoT=Companion
- **Precision UI**: Design token 化 + Thread Graph + motion
- **Default sandbox（S65）**: null workspace → `~/CMspark-projects` runtime only
- **Remote hygiene（S63）**: squash 假阳性勿硬合 stale 支

## Next (optional backlog)

- 真机：未绑定工作区 `workspace_*` 沙箱；Win shell/听写；Mac 值守 L2 静默
- message-router **thread/chat/skill/pack** 续拆（mcp/user_env 已抽）
- fanout 中低：SEC-M* / CORR-M*
- Whisper multi-arch real SHA256 pins；Developer ID / Authenticode
- 清 local worktree / stash（若仍有）

## Docs SoT

- User / arch: `docs/README.md`
- Diagnosis closeouts: `docs/audit/deep-diagnosis-*-closeout-2026-08-1*.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md`
- MCP: `docs/mcp.md`
