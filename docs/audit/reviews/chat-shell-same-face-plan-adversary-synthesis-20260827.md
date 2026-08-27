# ChatShell plan 对抗合成 — #239 · 2026-08-27

| 路 | VERDICT |
|----|---------|
| Impl | **REJECT** |
| Trust | **APPROVE_WITH_NITS** |

Impl blockers（已折进 plan **r2 pins**）：tray `onAppMessage` 现滤掉非确认；broadcast 带 id 进不了 fan-out；`opened` 假成功；`thread_id` 被丢成 `threads[0]`；`placeWindow(true)` 打不开 `.body`；lockstep 路径 ENOENT；弹出埋进 EmptyState 且 SW 未转发；lockstep 文件未点名。

Trust：r2 信任针未重开；nits（SSE/ACL 测加宽、`session.origin`、fill-not-send click、MCP hidden 旧测）已折进同一 r2 节。
