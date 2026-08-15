# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-14 (S71 · #190 编程接力 Panel+Mode C MERGED)

## CMspark — 产品 0.5.0 稳定切点

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守 / 三旗巡航 | **on main** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024） |
| Outbound MCP | 交付 opt-in |
| Precision Instrument UI | **on main**（#168–#171） |
| Thread list ID + large skill install | **on main**（#184） |
| **编程接力 / Mode C** | **on main**（**#190** Panel + dual-open terminal + env 对等 + 终端偏好） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: merge PR **#190** (`8708f89`) — Coding Agent Panel + Mode C residual  
  （本地 `main` 可能仍 ahead/behind；以 `git pull` 为准）
- **Open PR**: 以 `gh pr list` 为准（#190 已 MERGED）

## Recent locks (S71)

- Mode C dual-process honesty（Stop 只杀桥；snapshot 字段）
- Ghostty：`open -na --args -e`；无静默回退 Terminal
- `buildAcpAgentEnv` 登录 shell 对等 API key
- applyable on session.event pending_diffs

## Next (optional backlog)

- 真机：#190 重装 app + 重载扩展；Ghostty Mode C + 任务注入 + Stop 文案
- residual：Mode C prompt 文件 unlink；login-shell 失败重试；WS progress throttle
- 真机：三旗 / meeting / workspace / Win shell backlog
- message-router 续拆；Whisper multi-arch pins；codesign

## Docs SoT

- User / arch: `docs/README.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- Mode C: `docs/decisions/acp-dual-open-terminal-mode-c-2026-08-14.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
