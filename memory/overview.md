# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-09 (S61 session-end · #160 merged)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守（桌面） | **on main**（#160：L2+re-L2 静默；ADR-021 rev） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；Windows 旁路 bin） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Health + deep-diagnosis 安全 | **on main**（#159 + #160） |

## Main tip (remote)

- **`origin/main`**: **`56da82f`** — Merge #160 deep-diagnosis P0–P2 + unattended silence
- **#160** MERGED（deep-diagnosis fanout hardening + 值守全程静默）
- **#159** MERGED earlier（health-fanout P0–P2）
- **#157** Windows Python · **#156** MCP filesystem@home — earlier

## Recent locks (S57–S61)

- **Unattended（S61）**: armed = risk-accepted；initial L2 + mid-task re-L2 silent；hard deny throw；docs/matrix honesty
- **Python**: Scheme D `findPythonBase` cascade（#157）
- **MCP FS**: default allow home + L2 expand（#156）
- **P0 security**: thread path · mcp stdio L2 · tool-tape redact · generation CAS · originWs · cuPidForWindow · PATH whisper opt-in · require_grant true
- **Deep-diagnosis**: config redact · cookie trust scope · forceConfirm · worker deny · WS maxPayload · protocol negotiate

## Next (optional backlog)

- Mac 真机：武装值守后 host_computer 无逐步 L2/re-L2
- Executor unattended reL2 回归测（对抗 nit）；estop≠disarm toast
- Whisper multi-arch **real** SHA256 pins + win-x64 sidecar packaging（S56）
- God-file split (`server.ts` / `message-router.ts`)
- Developer ID / Authenticode；真机听写/会议验收

## Docs SoT

- User / arch: `docs/README.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md` · `docs/computer-use-user-guide.md` §5.1
- Deep-diagnosis: `docs/audit/deep-diagnosis-fanout-2026-08-09.md` + p0/p1/p2 closeouts
- Health: `docs/audit/health-fanout-2026-08-09.md` + closeouts
- MCP: `docs/mcp.md`
