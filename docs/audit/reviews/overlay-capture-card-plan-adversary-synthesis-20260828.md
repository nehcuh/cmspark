# Overlay Capture 卡片 plan 对抗合成 — #241 · 2026-08-28

| 路 | VERDICT |
|----|---------|
| Impl | **REJECT** |
| Trust | **APPROVE_WITH_NITS** |
| Product | **REJECT** |

## Impl blockers（已折进 plan r2 pins 16–31）

- 无 `/api/dispatch`；通用 dispatch 会拆 overlay 窄路由。听写必须专用 `/api/stt/*`，chunk cap ≥ 256KiB。
- `companionClient.send` 不存在 → `sendAppRequest`。
- ④ origin 与 overlay-shell **相反**（tray 请求 / 扩展接收）。
- 会议 handler 不传 `surface` → 只改 handler 仍 `origin_denied`。
- SW 测全文件 `sidePanel.open` 假绿（thread_graph 已有）；必须切 `handleCompanionMessage`。
- CSS regex 对不上 `.rail,.list{display:none}`；`听写在侧栏` 仍在 empty.innerHTML。

## Product blockers（已折）

- Task 1 放会撒谎的会议/④ 钮 + 空态仍「听写在侧栏」= 又一张工作台海报。
- leftover 测锁：`召唤器（实验）`、ghosts、footnote「不能替你打开侧栏」。
- 会议结束无「纪要在侧栏」；会议未展示 v2 就打 stt。

## Trust nits（已折）

- `audio_retained=false`；不加 append_transcript；无 peer → 503；tool catalog 锁；`允许` 不进 HTML。

## Spec

§6 `ui.open_sidepanel` origin 句已改为 tray-request / extension-receive。
