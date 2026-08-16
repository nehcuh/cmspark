# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-17 (S72 · #191 Windows ACP spawn MERGED)

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
| **编程接力 / Mode C** | **on main**（**#190** Panel+Mode C；**#191** Windows spawn/诚实 L1） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: merge PR **#191** (`33022bd`) — Windows ACP spawn + Mode C honesty  
- **Open PR**: 以 `gh pr list` 为准（#191 已 MERGED）

## Recent locks (S71)

- Mode C dual-process honesty（Stop 只杀桥；snapshot 字段）
- Ghostty：`open -na --args -e`；无静默回退 Terminal
- `buildAcpAgentEnv` 登录 shell 对等 API key
- applyable on session.event pending_diffs

## Next (optional backlog)

- 真机：#191 重启 Companion + 重载扩展；Windows 侧栏启动 Claude/Pi + Mode C 不假 L1
- 真机：#190 Ghostty Mode C + Stop 文案（mac）
- residual：login-shell 失败重试；WS progress throttle
- 真机：三旗 / meeting / workspace / Win shell backlog
- message-router 续拆；Whisper multi-arch pins；codesign

## Docs SoT

- User / arch: `docs/README.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- Mode C: `docs/decisions/acp-dual-open-terminal-mode-c-2026-08-14.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
