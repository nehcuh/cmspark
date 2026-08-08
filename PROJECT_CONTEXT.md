# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-08 (S55 — 听写 UX · Whisper M2 · 0.5.0 · DMG · #310)
- **Main tip**: `91c0b1c` — **#154** React #310 settings hooks；其前 **#153** 0.5.0 文档、**#152** 听写/会议/M2、**#151** TinyClick 清
- **产品 0.5.0**：package 对齐；`CHANGELOG.md`；会议入口 装配›场景›会议；热键按键盘录制；设置 NL/语音；本机 M2 渐进假设流
- **Ship 本机**：`/Applications/CMspark.app` **0.5.0**（备份 `…bak-20260808-163229`）；DMG `dist-package/CMspark-v0.5.0-macOS.dmg`；扩展已 `npm run build`（#154 后需 chrome://extensions 重载）
- **Next**：真机 §4 听写/会议；若扩展仍是 DMG 内嵌旧 hash 再打 DMG；打包产生的 `host-integrity.ts` 脏改勿塞功能 PR
- **Pitfalls**：hooks 禁止放 early-return 后；Whisper partial 勿 cancel-restart

### 2026-08-08 (S54 — 0.5.0 文档切点 · 中间态)
- 文档/版本 #153；当时 DMG 目标 0.5.0（S55 已装）
<!-- handoff:end -->
