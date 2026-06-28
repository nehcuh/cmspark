# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-06-28 (session-end)
- 根因定位+修复: tray↔daemon WebSocket skill.list 请求/响应死循环 → 两进程空闲 ~60%/45% CPU、本地 socket 29MB/s、累计 ~108GB。daemon 响应不带请求 id,tray 把响应误当 push 再发请求
- 已合并 main: PR #4 (squash, 3e60cc5)。两处互补修复: server.ts 响应透传 id + companion-client.ts 移除 skill.list push 误触发 + 守卫注释。bug 在共享 TS → Windows/Linux 同样中招,一份修复覆盖全平台
- 验证: kimi 改动前复审 APPROVE×2、tsc 绿、ws-roundtrip 5/5、部署后实测 CPU 60%→0
- 部署坑: .app 不能只换 bundle(node_modules 依赖漂移,缺 @modelcontextprotocol/sdk)→ 必须 make package-macos 整机重打包
- 沉淀: 个人技能 kimi-gated-fix(~/.config/skills/kimi-gated-fix/)——定点修复改动前 kimi 复审的动态工作流
- 运行环境: /Applications/CMspark.app 已是修复版(0% CPU);旧版备份 CMspark.app.bak-20260628-190734(可删)
- Next: 确认稳定后删旧 app 备份;Windows/Linux 出包重装(make package-windows/linux)

### 2026-06-10 (16:30)
- Windows tray stability — fixed 3 root causes:
  - systray2 icon: pass file path (not raw base64) because resolveIcon() checks fs.pathExists()
  - tray rebuild dedup: updateStatus/updateAutostart/setQuickActions/setRecentThreads now skip rebuild when value unchanged (was killing tray every 3s poll)
  - onExit recovery: tray process exit no longer kills Node — retries after 3s
- Global crash logger: uncaughtException/unhandledRejection write to ~/.cmspark-agent/logs/crash.log
- Cross-platform build: replaced `chmod` with Node.js one-liner in package.json
- NSIS installer: shortcuts now use cmspark.ico (generated from app icon)
- **Unpushed**(历史): `e05bce5` 当时 push 失败
<!-- handoff:end -->
