# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-08 (S52 — 听写+/会议 · D2 · 语音闪烁 · DMG)
- **Main tip**: `e6ffeea` — PR **#147** 语音草稿闪烁 + 热键手输；其前 #142–#146 会议 Mtg0–3 + 听写 D2 + 文档 G22
- **产品**：会议端到端（粘贴/本机录/上传/发言人N）；听写 continuous + hold（侧栏焦点）；指南 `docs/meeting-and-dictation-user-guide.md`
- **Ship 本机**：`/Applications/CMspark.app` 0.4.0（备份 `…bak-20260808-114738`）；DMG `dist-package/CMspark-v0.4.0-macOS.dmg`
- **Next**：真机验收 §4（continuous 不闪、hold、会议）；重载扩展；OS 全局热键/系统混音仍 parking
- **Pitfalls**：processing 必须进 liveOverlay；React effect 勿依赖 hook 返回对象；PR 勿 `git add` audit patches

### 2026-08-07 (S51 — context memory A/B/C · #134 · Wave C)
- **Ship**: PR **#134 MERGED** — scene knowledge + H1 handoff；Wave C `thread_recall` 后续 #135 等已合 main 线
- **Next**: 可选真机 compact+recall；Wave D 思考 UI 按需
<!-- handoff:end -->
