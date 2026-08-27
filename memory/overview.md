# Project Overview (Cold layer)

> Low-frequency status. Prefer session.md for hot work; this file is remote-synced snapshot.

**Updated**: 2026-08-27 (0.5.3 lockstep · #227 on main · remaining = GitHub #228–#230)

## CMspark — 产品 0.5.3

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| CU 实验定位 | **仅 Qwen3-VL**；Chrome CU one-shot L2 **on main**（#215） |
| 无人值守 / 三旗巡航 | **on main** |
| 听写+ / 本机 Whisper / 会议 | 交付（ADR-023/024） |
| Outbound MCP | 交付 opt-in |
| Precision Instrument UI | 被消费级助手 canon 替换（**#196 MERGED**） |
| Thread list ID + large skill install | **on main**（#184） |
| **编程接力 / Mode C** | **on main**（#190 / #191） |
| Thread hygiene | **on main**（#193） |
| 站点负知识 site-op-memory | **on main**（**#213**） |
| OS summoner overlay（L0） | **on main**（**#219** C-thin HTML + Mac NSPanel） |
| steer/nextRun busy composer | **on main**（#218 + #219 UI + **#220/#221** nits） |
| Daily assistant · 本机知识诚实 | **on main**（**#222** / **#223** / **#226** Wave 3） |
| 形态切片 1–3 | **on main**（**#226**）：outbound-grant + L8 + 召唤器诚实文案 |
| 切片 5 空态看山 | **on main** |
| 切片 6 IDF + 本轮步骤 | **on main**（**#227**）；v1 勾选基本只能点（#230） |

## Branch lock (S83 · 0.5.3)

- **`main`**: #227 已合；产品版本 **0.5.3** lockstep。
- **活票**：[#228](https://github.com/nehcuh/cmspark/issues/228) T1 bake-off（P0）· [#229](https://github.com/nehcuh/cmspark/issues/229) 召唤器 P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) 残留。正交 #69/#70/#71。
- **不要**：overlay Allow/Deny；summoner WS 上 `knowledge.import`/`knowledge.get`；第二只 Chrome 扩展；`ws_secret` 当 grant；T1 没跑就扩 outbound profile；不经确认改 live `config.json`。

## Next

- **P0** #228 T1 真人 bake-off（需操作员 SSO URL + 本机 companion 来自 main + bake-off 会话 `require_grant=true` / `auto_approve_dangerous=false`）
- 然后 #229；#230 不挡 T1、不许顺便扩 overlay ACL
- 需求设计必须先开 GitHub Issue（CONTRIBUTING / `.github/ISSUE_TEMPLATE/design.md`）

## Docs SoT

- User / arch: `docs/README.md`
- Overlay / C-thin: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`
- steer/nextRun hub: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`
- Overlay brief: `docs/decisions/os-agent-shell-brief-2026-08-22.md`
- 编程接力: `docs/coding-handoff-user-guide.md`
- MCP: `docs/mcp.md`
- Meeting/dictation: `docs/meeting-and-dictation-user-guide.md`
