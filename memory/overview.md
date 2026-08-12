# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-12 (S68 three-flag path risk-accept · #183 MERGED)

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
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: **`7e6f638`** — `fix(security): three-flag cruise path risk-accept (#183)`
- **Open PR: 0**

## Recent locks (S68)

- **Three-flag product law**: tools + paths risk-accept; residual floors in `cruise-path.ts` only
- **IMAGE_FETCH**: cruise allows `file://` + skip confirm; SSRF/metadata still hard-block; no-cruise → `file_requires_cruise`
- **CI discipline**: gate/hint tests must lock-step product copy (no stale `Security Block` / `god-mode` action text)

## Next (optional backlog)

- 真机：三旗 file 图 / MCP allow 自动扩 / 危险路径仍拦
- 真机：meeting 双 ack + AI 纠错；workspace 沙箱；Win shell·听写；Mac 值守
- message-router 续拆；Whisper multi-arch real pins；codesign
- residual：install.manifest 同目录信任；DYLD_FALLBACK brew

## Docs SoT

- User / arch: `docs/README.md`
- MCP: `docs/mcp.md`（三旗 allow-dir 语义）
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
