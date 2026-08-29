# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-08-28 ~18:18 (S87 END · overlay Capture 卡狗食)
- **Workspace**：`feat/overlay-card-first-paint`。main 已含 #240/#242。本机 `/Applications/CMspark.app` 热替换了 `cmspark-agent.js`。
- **Ship**：360×420 HTML 卡（独立 Chrome profile）；托盘/热键同卡可开关；发送+markdown+新对话+历史；会议台录制开关、~8s 近实时、历史会议、匿名发言人N；STT 用侧栏模型。RPC `tray-N` 不再当会议 id。
- **Next**：关旧浮窗再狗食。未开 PR。扩展需重载才能验「打开侧栏」。#230 冻。
- **Do not**：overlay Allow/Deny；`list_tabs`；Companion `chrome.sidePanel.open`；`pkill -f CMspark.app`；声称 Otter 级认人。

### 2026-08-27 ~20:03 (S86 END · ChatShell PR #240)
- **Ship**：#239/#240 已合 main。侧栏 ChatShell + 弹出 HTML。后续 Capture 卡见 S87。
- **Do not**：overlay Allow/Deny；`list_tabs` 进 summoner ACL。
<!-- handoff:end -->
