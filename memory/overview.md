# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-09 (S62 session-end · #161 merged)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守（桌面） | **on main**（#160：L2+re-L2 静默；ADR-021 rev） |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024；**Windows SEA+bin sidecar on main #161**） |
| Outbound MCP | 交付 opt-in（**require_grant default true**） |
| Health + deep-diagnosis 安全 | **on main**（#159 + #160） |
| shell_exec L2 token 绑定 | **on main**（#161 `validateTokenFor`） |

## Main tip (remote)

- **`origin/main`**: **`57bad96`** — Merge #161 Windows voice-pack closeout + shell/netsec token fix
- **#161** MERGED（closeout + `validateTokenFor` + lockfile engines）
- **#160** MERGED earlier（deep-diagnosis + unattended silence）
- **#159** MERGED earlier（health-fanout P0–P2）

## Recent locks (S57–S62)

- **shell_exec token（S62）**: issue/validate 必须同 `bindingPayloadFor`（command+cwd / netsec targets+ports）
- **Windows package（S62）**: SEA 不内嵌 whisper；stage `bin/`；重编前停 `cmspark-agent`
- **Unattended（S61）**: armed = risk-accepted；initial L2 + mid-task re-L2 silent；hard deny throw
- **Python / MCP FS / P0 security / deep-diagnosis**: 见 #157–#160

## Next (optional backlog)

- Windows 真机：新包 shell_exec（enterprise/全自动）+ 听写 hold/continuous
- Mac 真机：武装值守后 host_computer 无逐步 L2/re-L2
- Executor unattended reL2 回归测；estop≠disarm toast
- Whisper multi-arch **real** SHA256 pins
- God-file split (`server.ts` / `message-router.ts`)
- Developer ID / Authenticode

## Docs SoT

- User / arch: `docs/README.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md` · `docs/computer-use-user-guide.md` §5.1
- Closeout audits: `docs/audit/reviews/voice-pack-windows-closeout-*`
- MCP: `docs/mcp.md`
