# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-20 (S76 · #203 MERGED · DMG 换装)

## CMspark — 产品 0.5.1（0.5.0 切点 + 用户附图）

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**（TinyClick 已清） |
| 无人值守 / 三旗巡航 | **on main** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024） |
| Outbound MCP | 交付 opt-in |
| Precision Instrument UI | **on main**（#168–#171）；**被消费级助手 canon 替换中**（**#196 OPEN**） |
| Thread list ID + large skill install | **on main**（#184） |
| **编程接力 / Mode C** | **on main**（**#190** Panel+Mode C；**#191** Windows spawn/诚实 L1） |
| Thread hygiene（未命名 / ACP husk） | **on main**（**#193**） |
| Deep-diagnosis fanout hardening | **on main**（#172–#175） |
| multi-OS CI smoke | **on main**（#175 `smoke-os`） |
| DevSec 默认工作区沙箱 | **on main**（#165/#166） |

## Main tip (remote)

- **`origin/main`**: merge PR **#203** (`a468925`) — LLM DNS/IMDS + osascript 批准后不再 regex 二次硬拦  
- **Open PR**: **#196** companion-canon Side Panel（CI 绿 · MERGEABLE；本机 0.5.1 DMG 含 #203 安全，未必含 #196 UI）

## Recent locks (S73)

- 无意义会话 = 无 user 回合；`#id` 徽章不是标题
- ACP 标题闭枚举；handback 正文不当删除谓词
- 整理默认全部时间；薄 husk 预勾；`cleanup_empty` 只硬删 0 消息

## Next (optional backlog)

- 重载扩展验 #203；fzbcro 带 fetch 的 osascript 批准后应真跑
- 合 **#196** 后再打 DMG（现 `/Applications` 0.5.1 含 #203，仍可能不含图钉/portal）
- 真机：#193 重启 Companion + 重载扩展；整理助手验 husk / 簇主
- 真机：#191 Windows Claude/Pi + Mode C 不假 L1
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
