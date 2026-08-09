# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-09 (S60 session-end · #159 merged)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；Windows 旁路 bin） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Health security P0–P1 | **on main**（#159 / `e4316bb` dual r2） |

## Main tip (remote)

- **`origin/main`**: **`e4316bb`** — Merge #159 health-fanout P0+P1/P2
- **#159** MERGED（含 P0 安全 8 High + VOICE/MCPO + P1/P2）
- **#158** also MERGED historically；权威栈以 #159 为准
- **#157** Windows Python discovery · **#156** MCP filesystem@home — MERGED earlier

## Recent locks (S57–S60)

- **Python**: Scheme D `findPythonBase` cascade（#157）
- **MCP FS**: default allow home + L2 expand（#156）
- **P0 security**: thread path · mcp stdio L2 · tool-tape redact · generation CAS · originWs · cuPidForWindow · PATH whisper opt-in · require_grant true
- **P1**: voice origin + privacy_ack_v2 · pin fail-closed · meeting retain_until GC · CU set_enabled UI · release preflight+SHA256SUMS
- **P2 partial**: CI Node 22 · run-tests.mjs · package version lock · WS strict · auth protocol_version

## Next (optional backlog)

- Whisper multi-arch **real** SHA256 pins + win-x64 sidecar packaging（S56）
- God-file split (`server.ts` / `message-router.ts`)
- Developer ID / Authenticode；full startServer integration
- 真机听写/会议验收；Pi nits（multi-agent cap leak on file.upload/regenerate supersede）
- DESIGN↔tokens；audit/reviews archive

## Docs SoT

- User / arch: `docs/README.md`
- Health: `docs/audit/health-fanout-2026-08-09.md` + p0/p1-p2 closeouts
- Python discovery: `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md`
- MCP: `docs/mcp.md`
