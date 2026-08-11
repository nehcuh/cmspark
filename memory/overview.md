# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-11 (S65 · #165/#166 default workspace sandbox)

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
| C10 god-file 拆分 A–H | **on main**（#163） |
| Thread History IA Wave A–C | **on main**（#164） |
| DevSec 默认工作区沙箱 | **on main**（#165 Scheme 1 + #166 nits） |

## Main tip (remote)

- **`origin/main`**: **`06fcd96`** — Merge #166 default-workspace-sandbox nits
- **#166** MERGED（symlink/catalog/ChatView/docs）
- **#165** MERGED earlier same day（Scheme 1 runtime sandbox）
- **#164** Thread History IA（prior）
- **Open PR: 0**

## Recent locks (S63–S65)

- **Default sandbox（S65）**: null `workspace_root` → `~/CMspark-projects` runtime only; no auto-bind; reject symlink root; dual nits same-day follow-up
- **Remote hygiene（S63）**: squash 后 `--no-merged` 假阳性；先 PR 历史 + merge-tree，再删支
- **C10（S63）**: extract 后测试须 eager-bind dispatch runtime
- **shell_exec token（S62）**: issue/validate 必须同 `bindingPayloadFor`

## Next (optional backlog)

- 真机：未绑定工作区时 `workspace_*` 默认沙箱 list/read
- Windows 真机：新包 shell_exec（enterprise/全自动）+ 听写 hold/continuous
- Mac 真机：武装值守后 host_computer 无逐步 L2/re-L2
- Executor unattended reL2 回归测；estop≠disarm toast
- Whisper multi-arch **real** SHA256 pins
- 可选：`message-router.ts` 续拆（C10 后半）
- Developer ID / Authenticode
- 清 local worktree / stash（esbuild/host-integrity WIP）

## Docs SoT

- User / arch: `docs/README.md`
- Mission pack / workspace: `docs/mission-pack-usage.md` · ADR-014
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
- Unattended: `docs/adr/021-unattended-desktop-session.md` · `docs/computer-use-user-guide.md` §5.1
- Sandbox dual: `docs/audit/reviews/default-workspace-sandbox-*`
- C10 / multi-adv reviews: `docs/audit/reviews/c10-godfile-split-*` · `multi-adversarial-*`
- MCP: `docs/mcp.md`
