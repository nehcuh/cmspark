# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-09 (S57 end)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；Windows 旁路 bin） |
| Outbound MCP | 已有（ADR-022 相关） |

## Main tip (remote)

- **`origin/main`**: `c11a7e9`（含 S57 session-end memory）
- **#157** Windows Python discovery cascade (Scheme D) — MERGED
- **#156** MCP filesystem@home + L2 allow-dir expand — MERGED
- **Open PRs**: none (as of 2026-08-09 session end)

## Recent product locks (S57)

- **Python**: `findPythonBase` config → isolated → well-known → manager seed-only → PATH/py；Store fail-closed；≥3.10；absolute pin；winget `pythonInstallHint`；`basePythonAvailable` CTA
- **MCP FS**: default allow home；L2 expand outside home（见 #156 / docs/mcp.md）

## Next (optional backlog)

- Whisper win-x64：stage `cmspark-whisper-win-x64.exe` + ggml/whisper DLL 旁路打包（可能仍在 local stash）
- 真机听写/会议验收；host-integrity 打包纪律

## Docs SoT

- User / arch: `docs/README.md`
- Python discovery: `docs/superpowers/specs/2026-08-09-windows-python-discovery-design.md`
- MCP: `docs/mcp.md`
