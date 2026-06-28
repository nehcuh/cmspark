# Session Log

## Current Session

### S2 (chrome-extension & windows fixes) [cmspark]
- Fixed 4 Chrome extension issues:
  1. Missing button hover tooltips → added `title` attrs to SecurityConfirmationDialog buttons, settings gear, and "+ 新建"
  2. "Create branch" (🔀) had no effect → background/index.ts was missing `thread.fork` handler entirely
  3. Thread deletion confirmed but not executed → root cause: field name mismatch (`thread_id` sent, `threadId` read in background); fixed + added optimistic UI update
  4. History chat UX → auto-scroll to bottom on message load + `CollapsibleMarkdown` for content >3000 chars (solves get_page_text overflow in history)
- Fixed 2 Windows companion issues:
  1. Clicking "Settings" in tray created new thread instead → root cause: systray2 `update-menu` does not refresh `internalIdMap`; rebuilt menu structure caused click IDs to map to wrong actions. Fixed by kill+recreate tray on rebuild
  2. Windows lacked quick-action entry feel → localized all tray labels to Chinese, added section headers ("快速操作", "最近对话") for visual grouping
- Windows settings open: replaced unreliable `start` command with `explorer` (with fallback)
- 7 files modified across chrome-extension/ and companion/
- Both chrome-extension and companion type-check clean
- Recorded: yes — systray2 internalIdMap pitfall, extension snake/camelCase trap

### S3 (2026-06-28) [cmspark tray↔daemon CPU 死循环]
- 诊断: tray↔daemon 的 WebSocket skill.list 请求/响应死循环(daemon 响应不带请求 id,tray 把响应误当 push 再发请求)→ 两进程空闲 ~60%/45% CPU,本地 socket 29MB/s,累计 ~108GB
- 修复(已合并 main, PR #4 squash 3e60cc5): server.ts 响应透传请求 id + companion-client.ts 移除 skill.list push 误触发 + 守卫注释。kimi 改动前复审 APPROVE×2,tsc 绿,ws-roundtrip 5/5
- 部署: 单换 bundle 因 node_modules 依赖漂移失败 → make package-macos 整机重打包 → 装新 .app → 实测 CPU 60%→0、吞吐 29MB/s→0
- 平台: bug 在共享 TS,Windows/Linux 同样中招,一份修复覆盖全平台
- 沉淀: 个人技能 kimi-gated-fix(~/.config/skills/kimi-gated-fix/)
- Recorded: yes — .app 部署依赖漂移坑、kimi-gated-fix 技能(详见 project-knowledge.md)

## In-Flight Tasks (Cross-Session)

### Quick Actions Runtime Verification
- status: needs-testing
- context: New quick action flow needs end-to-end runtime test
- next_action: Start companion, load extension, click each quick action from tray, verify thread creation and chat execution in side panel
- updated: 2026-06-09
