# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-12 (S67 meeting STT hotfix · #179 OPEN)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守（桌面） | **on main**（#160：L2+re-L2 静默；ADR-021 rev） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；**#179 OPEN**：soft-continue/pin/双ack/会议 AI 纠错+分段） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Precision Instrument UI | **on main**（#168–#171） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: 以 GitHub 为准（S67 前含 #175 residual 等）
- **Open PR: 1** — **#179** meeting STT hotfix + live AI refine

## Recent locks (S67)

- **Meeting STT field-ops**: adversary REJECT → Slice 吸收 → dual both_ok → nits 再 PR
- **会议 AI 纠错**: 段定稿 correct_only + priorContext；drain 后纪要
- **Deep-diagnosis / Precision**: 仍在 main（#168–#175）

## Next (optional backlog)

- **合 #179** + 真机：双 ack、AI 纠错、坏二进制硬停
- 真机：workspace 沙箱 / Win shell·听写 / Mac 值守
- message-router 续拆；Whisper multi-arch real pins；codesign
- residual：install.manifest 同目录信任边界；DYLD_FALLBACK brew

## Docs SoT

- User / arch: `docs/README.md`
- Diagnosis closeouts: `docs/audit/deep-diagnosis-*-closeout-2026-08-1*.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md`
- MCP: `docs/mcp.md`
