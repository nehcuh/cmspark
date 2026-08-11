# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-11 (S63 · #162/#163 + remote hygiene)

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
| multi-adv 残差 Wave0–2 | **on main**（#162） |
| C10 god-file 拆分 A–H | **on main**（#163；`server.ts` ~1k + extract modules） |

## Main tip (remote)

- **`origin/main`**: **`a32659e`** — Merge #163 C10 god-file split A–H + day dual nits
- **#163** MERGED（extract + eager companion-dispatch bind）
- **#162** MERGED earlier（multi-adv deep Wave0–2）
- **#161** MERGED earlier（Windows closeout + shell/netsec token）
- **Open PR: 0** · stale remotes purged (S63)

## Recent locks (S61–S63)

- **Remote hygiene（S63）**: squash 后 `--no-merged` 假阳性；先 PR 历史 + merge-tree，再删支，禁止硬合 stale
- **C10（S63）**: extract 后测试须 eager-bind dispatch runtime
- **shell_exec token（S62）**: issue/validate 必须同 `bindingPayloadFor`
- **Unattended（S61）**: armed = risk-accepted；initial L2 + mid-task re-L2 silent

## Next (optional backlog)

- Windows 真机：新包 shell_exec（enterprise/全自动）+ 听写 hold/continuous
- Mac 真机：武装值守后 host_computer 无逐步 L2/re-L2
- Executor unattended reL2 回归测；estop≠disarm toast
- Whisper multi-arch **real** SHA256 pins
- 可选：`message-router.ts` 续拆（C10 后半）
- Developer ID / Authenticode
- 清 local worktree / stash（esbuild/host-integrity WIP）

## Docs SoT

- User / arch: `docs/README.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md` · `docs/computer-use-user-guide.md` §5.1
- **S62 项目总结+经验**: `docs/audit/voice-pack-windows-closeout-s62-2026-08-09.md`
- C10 / multi-adv reviews: `docs/audit/reviews/c10-godfile-split-*` · `multi-adversarial-*` · `day-20260810-11-full-*`
- MCP: `docs/mcp.md`
