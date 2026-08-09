# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-09 (S58 P0 commit local)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；Windows 旁路 bin） |
| Outbound MCP | 已有（ADR-022；**require_grant default true** 见 S58） |
| Health P0 安全 | **local commit**（SEC-A–F / VOICE-01 / MCPO-01 dual-approved；待 push） |

## Main tip

- **`origin/main`**: still pre-S58 until push（S57 memory at `0de1760` / prior tip）
- **Local S58**: health-fanout P0 security closeout + dual-review ledger（not on remote yet）
- **#157** Windows Python discovery cascade (Scheme D) — MERGED
- **#156** MCP filesystem@home + L2 allow-dir expand — MERGED

## Recent product locks (S57–S58)

- **Python**: `findPythonBase` config → isolated → well-known → manager seed-only → PATH/py；Store fail-closed；≥3.10；absolute pin；winget `pythonInstallHint`；`basePythonAvailable` CTA
- **MCP FS**: default allow home；L2 expand outside home（见 #156 / docs/mcp.md）
- **P0 security (S58)**: thread path · mcp stdio L2 · tool-tape redact · generation CAS · originWs pending · cuPidForWindow · PATH whisper opt-in · outbound require_grant true

## Next (optional backlog)

- **Push / PR** S58 P0 security batch to main
- VOICE-02 Tier-1 multi-arch pin matrix；startServer 集成测；god-file 拆分；release SBOM/codesign
- Whisper win-x64：stage `cmspark-whisper-win-x64.exe` + ggml/whisper DLL 旁路打包（可能仍在 local stash）
- 真机听写/会议验收；host-integrity 打包纪律

## Docs SoT

- User / arch: `docs/README.md`
- Python discovery: `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md`
- MCP: `docs/mcp.md`
