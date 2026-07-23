# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-23 (session-end S14 — macOS computer-use: forceForeground 融合 + bundle 级 TCC codesign 根因)
- 拉远程 `26e29c6`（session-trust）+ `51c959f`（forceForeground 融合）— 上个会话的「方案 A」已合：每动作 `activateTarget` 折叠进 `forceForeground(hwnd)` 单一入口，executor FOREGROUND-YIELD 自家 UI 静默重抢复用同一函数。
- **TCC 反复弹窗 regression 根因定位**：用户报"chrome 插件执行过程中反复弹 CMspark.app 需要截屏权限，系统设置里已显示有权限"。诊断：`codesign -dv` 显示 `/Applications/CMspark.app` **bundle 级未签名** → macOS 26 Tahoe TCC 按 bundle 级评估（不是 per-binary），未签名 = 每次启动重新评估 = 反复弹。用户从 DMG 拖 `.app` 覆盖了手工重签版，问题复发。
- **长期修复**（commit `198bfe9` 已推 origin）：`scripts/create-dmg.sh` 在 Step 3 和 Step 4 之间加 Step 3.5：`codesign --force --deep --sign - --options runtime --entitlements <host.entitlements>` + `codesign --verify` 硬门（失败 `exit 1`）+ CDHash 打印。所有 step 标签 `[X/5]` → `[X/6]`。下次 DMG 重打自动带签名。
- **短期缓解**：手工 codesign 已签 `/Applications/CMspark.app`（CDHash `0e05a4bd...`），`tccutil reset ScreenCapture` + 用户重授。daemon 已重启（pid 22448）跑新代码。
- **Memory 更新**：auto-memory `tcc_cdhash_vs_activate.md` 加 bundle 级签名坑；project-knowledge 加同名 Technical Pitfall 条目。
- **未完成**：① 用户真机跑网易云 e2e（验证 forceForeground + session-trust + bundle 签名三件套联动）；② Phase 2 长期方案（daemon 化 cmspark-host 或 Apple Developer ID）— TaskList #3 仍 pending。

### 2026-07-21 (session-end S13 — cmspark WP3 macOS 坐标链路 live 排障 ×8)
- 触发：用户给了坐标授权但一直过不去。逐环排障，每一环都是阻断性 bug，**WP3 macOS 链路此前从未真机跑通过**（S12 的"待完成 E2E"实锤）。
- 8 修复链（按用户踩到顺序）：①coordinateAllowed 双开关只开了全局 → 帮用户写 config.json；②host-bin.ts 候选路径漏「同目录」→ 打包版找不到 cmspark-host → Touch ID 降级 6 位验证码；③server.ts Windows estop 预检平台分支前无条件跑 → macOS spawn powershell.exe ENOENT → daemon crash；④estop.ts spawnEstopHelper 补 child.on("error")；⑤host.swift **estop 子命令整个没实现** → 补 CGEventTap 热键 + UNIX socket 保活；⑥darwin-estop.ts 三修（spawn error/启动即死/heartbeat 永远误报存活）；⑦cuWindowList 比 kCGWindowOwnerName 显示名（「网易云音乐」≠ com.netease.163music）→ 改 NSRunningApplication 解析 PID；⑧cuScreenshot 把 stderr 扔 nullDevice 藏住错误。
- 部署：`make package-macos` 打 3 次，最终 DMG 含全部 8 修。tsc 干净；577 测试 0 挂。
- **未完成**：装新 DMG → 重授 TCC → 跑网易云坐标任务 e2e。继续到 S14。
<!-- handoff:end -->
