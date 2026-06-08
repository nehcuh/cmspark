# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-06-08 (17:00)
- 修复 click/screenshot/WS 断连 4 个 bug
- Click: 加入 waitForSelector(3s) + scrollIntoView + 修复 fallback 引号转义
- Screenshot: 加入 captureVisibleTab fallback（不需要 debugger）
- Error: "disconnected" 加入 recoverable（之前命中 non_recoverable 导致 LLM 停止）
- WS: 断开时给 pending tool call 5 秒 grace period 让 extension 交付结果
- 修改文件：browser-bridge.ts, security.ts, server.ts
- 待调查：WS 每 3 秒 connect→disconnect 震荡（tray CompanionClient + service worker restart）
- Companion 已从源码重启（PID 35385），刷新扩展即可测试
### 2026-06-08 (16:00)
- 修复 DMG 安装后 daemon 启动失败 — 两个 bug（fork loop + double lock）
- 已验证 daemon start/stop 正常工作
<!-- handoff:end -->
