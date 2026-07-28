# Project Knowledge

## Technical Pitfalls

### CMspark config: env var must not override user-provided API key
- `DEEPSEEK_API_KEY` environment variable used to take unconditional priority in both `getConfig()` and `saveConfig()`, causing UI-set keys to be overwritten and then saved as empty strings
- Fix: only fall back to env var when no user-provided (non-masked, non-env) key exists; persist user-provided keys to disk; mask only when the saved value equals the env var
- Files: `companion/src/config.ts`, `companion/src/message-router.ts`, `companion/src/settings-web.ts`

### Masked API key detection must be consistent across modules
- `isMaskedApiKey()` had divergent implementations in `config.ts`, `settings-web.ts`, `background/index.ts`, and `useWebSocket.ts`; some required `length >= 12` and missed shorter UI masks like `sk-****xyz`
- Fix: unified rule — `"***"`, any substring `"****"`, or `"...."` dot-masking (length >= 10); exported from `config.ts` and reused where possible

### Module-level config cache breaks test isolation
- `config.ts` keeps `cachedConfig` at module scope; tests that mutate `process.env.DEEPSEEK_API_KEY` or `config.json` can see stale cached state across test cases
- Fix for tests: export `clearConfigCache()` (test-only helper) and reset file + cache in `before()` hooks
- Files: `companion/src/config.ts`, `companion/tests/config.test.ts`

### Quick Action ID collision in companion-client.ts
- `Object.assign(msg, params)` would overwrite `msg.id` with `params.id` (actionId), causing request/response ID mismatch and timeout
- Fix: renamed to `actionId` field in params

### systray2 `update-menu` does NOT refresh `internalIdMap`
- `systray2` builds `internalIdMap` once at init (mapping `__id` → MenuItem). Calling `sendAction({ type: "update-menu" })` updates the visible menu but **leaves the internal map stale**
- When menu structure changes (e.g. Quick Actions count varies), subsequent clicks return stale `__id`s, causing clicks to map to the **wrong action** (e.g. clicking "Settings" triggers a Quick Action)
- Fix: kill + recreate the tray instance on every rebuild instead of using `update-menu`

### Chrome extension `thread.delete` field name mismatch
- Frontend (`ThreadList.tsx`) sends `thread_id` (snake_case) but `background/index.ts` reads `message.threadId` (camelCase)
- Result: companion receives `undefined` thread_id, deletion never executes
- Fix: read `message.thread_id || message.threadId` in background for backward compatibility

### CMspark .app 部署:不能只换 cmspark-agent.js(依赖漂移)
- `/Applications/CMspark.app/Contents/Resources/node_modules` 是打包时冻结的。当前源码 `dist/mcp/client.js` 深路径 `require('@modelcontextprotocol/sdk/client/index.js')`,而 `bundle:exe` 把该包 externalize → 只换 bundle 会启动即崩(MODULE_NOT_FOUND)
- 必须整机重打包:`make package-macos`(或 package-windows/linux)—— scripts/package.sh 会把 companion/node_modules 一起 stage 进新 .app
- app 未签名,文件可换;但 node_modules 必须与 bundle 同步更新

### Mermaid 图表渲染的三个坑（2026-07-01，详见 docs/adr/009）
- **mermaid 11 在 MV3 strict CSP 下可客户端直跑**：spike 验证（prod 构建，`script-src 'self'`）无 `securitypolicyviolation`；静态扫描全 bundle，`eval`/`new Function`/string-timer/constructor-escape 全 0，唯一 `Function("return this")()` 是 lodash `_root.js` 取全局的写法，浏览器里被 `self`（`=window`）短路永不执行。**无需** sandbox/offscreen/server。
- **`@mermaid-js/parser` 的 exports map 缺 `default`**：mermaid 11 拆出 `@mermaid-js/parser@1.2.0`，其 `package.json` `exports` 只有 `import` 条件 → Plasmo 0.90.5 的 Parcel resolver 解析失败（build 报 `Failed to resolve '@mermaid-js/parser'`）。修：`package.json` 加 `"alias": { "@mermaid-js/parser": "@mermaid-js/parser/dist/mermaid-parser.core.mjs" }`。
- **`htmlLabels:false` 是 mandatory**：mermaid 默认 `htmlLabels:true` 把节点标签渲成 `<foreignObject>`，而 DOMPurify 的 SVG profile（`USE_PROFILES:{svg:true,svgFilters:true}`）**剥 `foreignObject`** → 节点文字消失（只有 `<text>` 的边/箭头标签存活，症状"有些字有、有些没有"）。修：root-level `htmlLabels:false` 强制纯 `<text>`/`<tspan>`。特权扩展页面下不可信 SVG 务必 `securityLevel:'strict'` + 我们的 DOMPurify SVG profile 二次过（纵深防御，C1）。

### 诊断 Node daemon CPU spin：`ps pcpu` 是衰减平均，必须用 `top -l 2` 取瞬时（2026-07-13）
- 现象：daemon 刚重启（uptime < 5min）后 `ps -o pcpu`（或 `top -pid <PID>` 单次）显示 ~30%，看似仍在 spin；但 `top -l 2 -pid <PID>`（取第二次采样）瞬时 = 0.0%，`sample` = 100% 在 `uv__io_poll`（libuv idle block）。
- 根因：macOS `ps pcpu` / `top` 单次是**过去一分钟的衰减平均**，把启动尖峰 + extension 重连 burst 的 CPU 留在衰减尾巴里——刚启动的进程即使瞬时 idle 也显高。
- 修法（诊断流程）：判 spin **必须**用 `top -l 2 -pid <PID> -n 0`（`-l 2` 采样两次，第二次才是瞬时稳态）；配合 `sample <PID> <秒>` 看 `uv__io_poll`（idle）vs `OnUvRead`/`Writev`（活跃 IO）的采样占比。**真 spin 的特征是主线程阻塞 → 日志静默**（心跳/事件全停）；若日志持续输出 + healthz 响应正常，则非 spin。
- 教训：2026-07-13 部署 spin fix（PR #64，O(N²) 流式越狱扫描 → 有界窗口 O(N)）时被 30% 误判"fix 没生效仍在 spin"，实为 idle。`sample` + 日志连续性才是真相，`ps pcpu` 不是。详见 [[spin-rc-on-squared-jailbreak-scan]]。

### macOS tray 配对码窗口不显示：accessory app 需 `orderFrontRegardless`（2026-07-14）
- 现象：packaged macOS tray 点「🔑 显示配对码」毫无反应（无窗口、无通知）；菜单/状态图标正常。
- 根因：macOS 14+ 弃用 `NSApp.activate(ignoringOtherApps:)`。Swift tray 是 `.accessory` app（且从 `LSBackgroundOnly` 的 .app 派生），配对码窗口**被创建**（`isVisible=true`、有时 `isKeyWindow`）但**不真正到前台**，静默留在后面 → 用户看不到。菜单/图标靠鼠标事件驱动不受影响，掩盖了失败。
- 诊断关键：一度被"shipped 二进制坏了"误导——其实 `build-tray.sh` 产出与 shipped 哈希一致（`10a586ea`），Tray.swift `git diff` 为空（手动 `swiftc` 哈希不同 `de53a716` 只是内嵌源码路径元数据差异，功能等价）。破局点是写**最小 `.accessory` Swift harness**（同 activate/makeKeyAndOrderFront），它**能**弹窗 → 证明策略/API 没问题，失败是窗口**排序**不是创建。
- 修法（PR #65，9315d31）：`Tray.swift` `PairingController.show()` 在 `makeKeyAndOrderFront` 后加 `window.orderFrontRegardless()`（AppKit「即使激活被压制也强制到前台」原语，无 Dock 闪烁）。配套 `SWIFT_TRAY_SHA256` `10a586ea`→`46d866a6`（A8 lock-step）。
- 教训：① 任何 Swift tray/NSWindow 弹窗：`makeKeyAndOrderFront` 后**必加** `orderFrontRegardless()`，别依赖已弃用的 `activate(ignoringOtherApps:)`。② 诊断"窗口不显示"先分清 **create vs order**——最小 harness + 打印窗口属性（isVisible/isOnActiveSpace/isKeyWindow/frame）是客观证据，别只靠肉眼、别被哈希差异带偏。③ Tray.swift 改动 → `bash companion/src/tray/build-tray.sh` 重编 → 更新 `companion/src/tray/swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`（build-tray.sh 末尾提示 `menu-bar-agent.ts` 是**错的**，常量实际在 `swift-tray-bridge.ts`）。

### Swift tray SHA256：hash mismatch 禁止自动 rebuild（S-P0-2，Native HUD 继承）
- 改 `Tray.swift` 后必须 `bash companion/src/tray/build-tray.sh`，把 digest 写入 `swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`
- **Hash mismatch ≠ 缺失 binary**：缺失可 dev rebuild；mismatch 视为可疑，拒绝 spawn、不静默 rebuild（防 TOCTOU / 篡改证据被覆盖）
- HUD 与 tray 同一 binary 时，所有 HUD 改动都触发同一 hash 更新路径

### Grok Rhai workflow：`fn` 不捕获外层 `let`（2026-07-28 docs reorg）
- 现象：`docs-reorg-phase12` 在 Phase1 外审门崩溃：`Variable not found: root` / 同类对 `output_schema`
- 根因：Rhai 函数**不捕获**外层局部变量；`run_external(...)` 内写 `root` 或 `external_schema` 会在**调用时**才炸（canned smoke 可能过、真跑 fail）
- 修法：① 参数显式传入（`repo_root`）；② schema **在 fn 内**字面构造；③ 或**内联** dual-review agent 调用（phase34 采用）
- 相关：`.grok/workflows/docs-reorg-phase12.rhai` → continue / phase34

### Dual-review Claude 429 ≠ 内容 REJECT（2026-07-28 p3）
- `scripts/dual-external-review.sh` 对空/失败输出会映射 VERDICT；Claude 全文 `API Error 429` 额度时脚本仍落 `REJECT`
- **勿把 429 当文档/代码否决**；应用 Pi（或 adversarial）+ 额度后复跑 Claude；verdict json 应注明 `infra_429`
- 同日 Kimi 也可能 403 usage limit — 双审工具链要有配额/替代审查者预案

### Computer Use 文档：全局开关勿写成「侧栏生物识别一键开」（2026-07-28）
- 0.3.0 用户实用路径：`~/.cmspark-agent/config.json` 的 `computer.coordinateEnabled`
- Companion 有 `computer.set_enabled`（可生物识别），但 **Side Panel/托盘未接线**；Apps「坐标操作」只读 `computer.get_state`
- 用户指南/ADR-017 必须诚实写 UI 债；checklist 不能要求「面板拨开全局」
- Files: `docs/computer-use-user-guide.md`, `docs/adr/017-computer-use.md`, `companion/src/computer/handlers.ts`

### Confirm multi-surface：晚到响应 wire 保持 `unknown`，勿发明 `already_resolved`（2026-07-27）
- `SecurityConfirmationManager.respond` / `respondFrom` 删除 pending 后晚到调用返回既有 **`unknown`** 语义
- Brief/plan 散文可说 “already resolved”，**wire symbol 不改名**（旧扩展兼容 + N5 lock）
- 多 surface 清理靠 **NEW** fan-out（`onTerminal` → cancel tray + cancel HUD + resolved 通知），不是改 outcome 枚举

### macOS computer-use inject：截图坐标与 inject 原点必须同闸（bestDist < 24）（2026-07-26）
- 现象：前台切换 OK、截图 OK，模拟点击全「成功」但 UI 不变（#mvt4t8 / #32c2b0 / #i4x6pm 前期）。
- 根因：`cuScreenshot` 仅在 AX↔CG 帧距 `bestDist < 24` 时采用 AX client 原点；`cuClientOriginScreen`（inject）原先**无此闸**，微信多窗口时绑到错误 AX 框 → client(0,0) 屏坐标与 CG 框差约 (-68,-46)，点击整片偏移。
- 修法：inject 与截图 lockstep 的 `bestDist < 24`；失败则退回 CG 框原点。
- 教训：凡「截图定标 + 注入」双路径，client 原点算法必须**同一函数/同一门限**，禁止截图严格、inject 宽松。

### SkyLight `SLEventPostToPid` 对微信/网易云可静默无效，仍 ok:true（2026-07-26）
- 现象：坐标修对后 inject 仍无效；JSON `ok:true`，甚至 `verified:true`（像素微变），用户肉眼零反应（#i4x6pm）。
- 根因：Approach C 用 SkyLight per-PID 服务 Chrome 后台注入；微信/网易云等 AppKit/Electron **可不消费**该通道且不报错。`slPostToPid` 只证明 SPI 调用返回，不证明 UI 生效。
- 修法：inject 前 `activate(options: .activateIgnoringOtherApps)`；**SkyLight + HID `CGEvent.post(.cghidEventTap)` 双投递**（`delivery: skylight+hid`）；需 cmspark-host Accessibility（本机 `axTrusted:true`）。
- 环境：`CMSPARK_SKYLIGHT_NO_ACTIVATE=1` / `CMSPARK_INJECT_NO_HID=1` 可回退 canary。
- 教训：① 私有 SPI 交付必须有**可观察 ground truth**（TextEdit 正文 / 真实 UI 状态），不能只信 ok JSON。② 像素 verified 不足以证 click 语义成功。③ 热换 `cmspark-host` 必须同步 `CMSPARK_HOST_SHA256`（`host-integrity.ts` + 打包 agent.js），否则 inject 被 integrity 拒。

### Mail `message 1 of inbox` 是最旧不是最新（2026-07-26 #mxz27i）
- 现象：host_read 永远读到 iCloud 2023 welcome；Exchange 有新信读不到。
- 根因：AppleScript 统一收件箱 index 1 常为最旧；非按 date 排序。
- 修法：`messages of inbox whose date received ≥ cutoff`（30d→365d）取 max date；编译 `read-mail.scpt` 与 app `host-scripts` 同步。
- 教训：Mail 脚本禁止假设 index 顺序 = 时间序；大收件箱用 whose + 近窗，勿全量扫。

### macOS 26 Tahoe TCC 按 bundle 级签名评估，不是 per-binary（2026-07-23 regression）
- 现象：DMG 安装的 `CMspark.app` 反复弹 ScreenCapture 授权，即使系统设置里已经显示"已授权"。用户每次启动都要重新点允许。
- 根因：`create-dmg.sh` 历史上没有 codesign 步骤，DMG 里的 `.app` bundle **整体未签名**。即使内部 binary（`cmspark-host`、`node`）单独签了，macOS 26 Tahoe TCC **按 bundle 级签名评估**，未签名 bundle = 每次启动重新评估授权 = 反复弹窗。用户从 DMG 拖 `.app` 到 `/Applications` 还会**覆盖**之前手工重签的版本，把问题带回来。
- 修法（commit `198bfe9`）：`create-dmg.sh` 在 `cp staging`（Step 3）和 `hdiutil create`（Step 4）之间加 Step 3.5：`codesign --force --deep --sign - --options runtime --entitlements <host.entitlements> "${APP_BUNDLE}"` + `codesign --verify` 硬门（失败 `exit 1`）+ 打印 CDHash/Identifier/flags 便于诊断。所有 step 标签从 `[X/5]` 改成 `[X/6]`。
- 教训：① **打包脚本必须 codesign 整个 .app bundle**，不能只签内部 binary；TCC 看的是 bundle 级签名。② 诊断"TCC 反复弹已授权权限"先 `codesign -dv --verbose=4 /Applications/CMspark.app` 看 `flags=runtime` 是否在、`CDHash` 是否非空 —— 缺失就是 bundle 未签名。③ 长期解法仍是 Apple Developer ID + notarize（TCC 看 TeamID 不看 cdhash）；短期缓解：DMG 流程必须包含 `codesign --force --deep`。详见 [[tcc-cdhash-vs-activate]]。

### Windows estop：死 PID 留下 ready.json tombstone → 心跳 stale 数天（2026-07-28）
- 现象：`host_computer` / emergency-stop 报 `heartbeat stale (430532579ms)` 量级（约 5 天），estop 不可用。
- 根因：`computer-estop.ps1` 写 `%TEMP%/cmspark-computer/estop-ready.json`；helper 进程死掉后 **tombstone 仍在**，TS 侧把旧 ready 当存活、用陈旧 mtime 算心跳。
- 修法（`96548e1`）：读 ready 时检测 PID 是否存活；死 PID → 清 tombstone；spawn 前再清一次，避免复活后读到旧文件。
- 教训：凡「文件心跳 / ready 标记」健康检查，**必须**附进程 liveness（PID + kill(0)/OpenProcess），不能只信 mtime；crash 后磁盘 artifact 会伪装成 healthy。
- Files: `companion/src/computer/estop.ts`, `companion/tests/computer-estop.test.ts`

### Windows estop：Node `spawn({detached:true})` 让 powershell -File 秒退（2026-07-28，用户验收）
- 现象：tombstone 修完后仍 `estop helper ready file missing (helper not running)`；ensure 轮询 ~8s 失败。
- 根因复现：`spawn(powershell, [-File computer-estop.ps1], { detached: true, stdio: 'ignore', windowsHide: true })` → **exit 1、无 ready.json**；同脚本 `detached: false` 或 `Start-Process` 正常写心跳。
- 修法（`7c7611b`）：`spawnEstopHelper` 改 `detached: false`（helper 与 companion 共生命周期 + `unref` 不挡事件循环）；脚本缺失时把路径并入 refusal reason。
- 部署：全量 `build-windows-exe.ps1` 可能被 `dist-package/**/debug.log` 锁失败 → 可热覆盖 `cmspark-agent.exe` + 确保旁置 `host-scripts-win/`。
- 教训：Windows 上「后台常驻 ps1」**不要**想当然 `detached:true`；先最小 harness 比只改 ready 解析快。
- 用户验收：host_computer 过 estop preflight 成功。

### Side Panel `t.skills is not iterable`：skill.list 载荷非数组（2026-07-27）
- 现象：扩展运行时 TypeError `t.skills is not iterable`（store / BottomBar / slash skills）。
- 根因：`SET_SKILLS` 等路径把 **undefined/非数组** 当数组 spread/iterate；companion `skill.list` 异常或旧协议时 payload 形状漂移。
- 修法（`0108fd4`）：`Array.isArray` 守卫 + 默认 `[]`（agentStore、useWebSocket、BottomBar、SlashCommandPopover、App）。
- 教训：跨进程 list 载荷一律 **归一成数组再入 store**；禁止信任 wire 上「一定是 array」。

### BottomBar「更多」被裁切 + 用户加载 dist-package 扩展（2026-07-27）
- 现象：点「更多」看不到菜单项（像被遮挡/无选项）。
- 根因链：① 父级 `overflow`/`overflowX:auto` 裁切 absolute 菜单；② InputArea 绘制序盖住菜单；③ **用户加载的是 `dist-package/...` 里的扩展，不是 `chrome-extension/build`** — 本地改 build 不生效。
- 修法：菜单改 `position:fixed` + 视口定位（`2536320`/`725197f`）；验收前 **重打 Windows 包把扩展同步进 dist-package**（debug.log 被锁时可 stage 到 `dist-package-new`）。
- 教训：修 UI 前先问/确认 extension 加载路径；packaged 用户路径与 monorepo `build/` 不是同一 artifact。

### Enterprise L2：allowlist/task 授权 ≠ 跳过 forceConfirm（2026-07-27 A+B）
- 现象：netsec 已 allowlist 仍每 op 弹 L2；用户期望 session 一次允许 / 全局 enterprise god-mode。
- 根因：`shell_exec` / `netsec_port_scan` 走 `capabilityForceConfirm`；**`auto_approve_dangerous` 与 host session-trust 不自动覆盖 enterprise forceConfirm**。
- 产品解：
  - **A** thread-scoped enterprise session trust（per-family `netsec`|`shell`）；idle 30m + hard 8h from last **interactive** grant；auto-approve 不 touch 续期
  - **B** `security.auto_approve_enterprise_tools`（default false；phrase gate；`FORBIDDEN_PACK_KEYS`）
- Gate algebra **G1**：`mustInteract = (!skipConfirmation || forceConfirm) && !hostComputerTrustSkip && !enterpriseSkip`
- 文档：`docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`
- 教训：多层安全「跳过」必须写清代数；allowlist/task auth/L2/forceConfirm/god-mode 不是同一开关。

## Reusable Patterns

### Broadcast pattern for cross-client actions
- When tray triggers an action that should execute in the Chrome extension, companion creates the entity then **broadcasts** a start message to ALL WebSocket clients
- The extension picks it up and initiates its own request through its connection, so streaming flows naturally
- Avoids needing to modify the chat/streaming pipeline to support cross-client routing
- Files: server.ts `broadcast` fn → message-router.ts broadcasts `quickAction.start` → extension forwards to sidepanel → sidepanel sends `chat.send` through its own WS connection

### P0 batch-fix + 对抗后 Claude/Pi 双外部审（2026-07-25，可复用）
- Workflow: `.grok/workflows/p0-batch-fix.rhai`；脚本 `scripts/dual-external-review.sh`
- 链：Design → Implement → 内部对抗(2 skeptics, fail-closed) → **仅对抗通过后** 分别起 `claude -p` 与 `pi -p` → 双 APPROVE/APPROVE_WITH_NITS → build → commit
- Claude：`--permission-mode acceptEdits` + Read/Grep/Glob/Bash；**不要**用 plan mode（终稿 VERDICT 会吞进 plan 文件 → 脚本判 UNKNOWN）
- Pi：`-p --no-session -t read,bash`；可能长时间空 stdout 挂起 — 可用户 waive，用 Claude + 对抗 + host 定向测推进，事后补 verdict 文件
- **Pi 机读行**：提示词要求最终一行 **英文** `VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT`（中文「审查结论」易被脚本漏匹配 → UNKNOWN）
- 产物目录：`docs/audit/reviews/`；批次报告 + claude/pi md + verdict json + patch
- 诊断 fanout 姐妹流：`.grok/workflows/deep-diagnosis-fanout.rhai`（子系统 10 + 横切 6 + 对抗 16 + 综合）
- **设计/plan 也可用同一脚本做 Task 0 门**（例：`native-hud-p3a-spike-plan`）；APPROVE_WITH_NITS 后 nits **必须折入文档再写代码**

### Tab lease 仅 multi-agent：单 agent 多 tab 勿 HARD lease（2026-07-28 PR #81）
- 现象：普通聊天 / AppSec 打开第 3 个 tab 命中 `max_tabs_leased_per_worker=2` → 硬失败
- 修法：`server.ts` early HARD + SOFT + `create_tab` autoHold **仅** `isMultiAgentThread || anyTabLeaseHeld()`；lease 错误进 `classifyError` recoverable
- 教训：ADR-015 排他锁是 **worker 编排** 工具，不能默认套在所有 CDP 线程上
- Files: `server.ts`, `tab-lease.ts`, `security.ts`

### Site knowledge 自动注入必须扩展发 hostname（2026-07-28 PR #81）
- Companion 早已 `resolveKnowledgeIdsForThread(..., hostname)`，但扩展 chat 不带 hostname → `getBySite` 永空
- 扩展：`getActiveTabHostname()` 只传 hostname（不传完整 URL）；chat.create/regenerate/file.upload/quickAction
- Companion：`normalizeHostname` case-insensitive；hostname **只**用于选 knowledge，不是 trust 门
- Files: `active-tab-hostname.ts`, `message-router.ts`, `site-matcher.ts`

### Docs reorg Phase1–4 门控编排（2026-07-28，已合 PR #80）
- 计划：`docs/docs-reorg-plan-2026-07-28.md`；终报：`docs/audit/reviews/docs-reorg-phase1-4-final-report.md`
- Workflows：`.grok/workflows/docs-reorg-phase12.rhai` / `…-continue.rhai` / `…-phase34.rhai`
- 门：实现 → 内部对抗 → **Claude+Pi**（`dual-external-review.sh`）→ nits → 归档 `git mv`（禁首轮 `rm`）
- 恢复套路：workflow 代理断流/Rhai 炸 → **手工**跑 dual-review + 本地 adversarial；Claude 429 → 信 Pi + adversarial，额度后再补 Claude
- 归档锁：勿动 `decisions/coordinate-computer-use-plan.md`、`host-adapter-interface.md`、HUD N1–N10 lock、`superpowers/`

### Grill + lock doc 再写 plan（Native HUD N1–N10，2026-07-27）
- 顺序：product brief → dual-review → **grill N1–N10**（双独立 agent 强制 LOCK|AMEND|OPEN）→ lock 文档 → spike plan → plan dual-review → 才允许代码
- 数值分歧取折中并写进 lock（例：heartbeat Claude 2s vs Pi 3s → **3s**；ping 250 vs 500 → **400ms**）
- Spike 与 production 分层：spike 证明 open/hydrate/confirm/abort/standby；截图 dual-track 单独门禁

### 定点修复: kimi 改动前复审的动态工作流
- 已沉淀为个人技能 `kimi-gated-fix`(~/.config/skills/kimi-gated-fix/),含可移植的 workflow-template.js
- 模式: 对已诊断到代码行的 bug,dynamic workflow pipeline(Design 精确 diff → kimi 改动前复审 → 仅 APPROVE 才 Apply → build 验证);主会话再对完整 git diff 做 kimi 终审
- kimi 调用: Write prompt 文件 → `$KIMI -p "$(<file)" --output-format text`(避开 shell 转义)
- apply 子代理 stall 兜底: 主会话手动补 kimi 复审 + Edit,不重跑整流(实战遇过连 stall 6 次)

### 全量代码审计 via Fuck My Shit Mountain skill（2026-07-09，可复用工作流）
- 技能目录:`~/.config/skills/Fuck_My_Shit_Mountain/fuck-my-shit-mountain/`;盘点脚本 `scripts/project_inventory.py <root> --format json`;报告 lint `scripts/report_lint.py --modes <modes> <file>`。
- 工作流(full 模式):必需输入 = 审计模式 + 报告语言 + 输出格式(用 AskUserQuestion 一次问清);→ 加载 `prompts/full-audit.md` + 6 个 rubrics(severity/confidence/evidence/coverage/scoring/principles) + `templates/{audit-report,issue-card}.md`;→ 按"维度簇"fan-out 并行 general-purpose 子代理(每个深读相关文件返回 file:line 级 issue-card findings);→ 主会话对 Critical 论断做对抗性复核(直接 Read 源码确认,避免子代理误报虚高);→ 综合 + 逐维度打分(0-10,10=最好);→ 按 `templates/audit-report.md` 写报告;→ `report_lint.py` 修到 OK;→ 元数据存 `.claude/audits/`。
- **关键坑(lint 格式)**: finding 头必须是 `### Finding: <title>`(不是 `### 🔴 C1 —`);13 个字段必须是 `- Field: value` **无 `**bold**`**(lint 正则 `^-\s*Field:` 匹配不到 bold);统计表计数必须等于全局 `- Severity:` 行数。初稿用 emoji 头 + bold 字段 → lint 报 count mismatch + 缺维度小节 → 整份重写。一次写对可省一次重写。
- full 模式需 25 个维度小节(section 头须含对应关键词如 "Architecture"/"Code Consistency"/"Comment Coverage"),漏一个 lint 即 FAIL。
- 评分是判断不是扣分:承重墙缺陷(如 WS 信任根缺失)按"系统性 vs 孤立"判,不按个数平均。
- 边界:技能默认只审计出报告,不改源码(除非用户明确要求实现修复)。

## Technical Pitfalls

### 测试隔离：静态 import 会在 `before()` 设环境变量前计算模块级路径
- 现象：companion `security-gates.test.ts` 6 个安全闸门用例静默红（`timeout waiting for security.confirmation.request`），疑似生产 bug。
- 根因：`import { ... } from "../../src/server.js"`（静态）在模块加载时（早于 `before()` 的 `process.env.HOME = tempDir`）就执行了 `src/config.ts` 的 `export const DATA_DIR = process.env.CMSPARK_DATA_DIR || os.homedir()/.cmspark-agent` → DATA_DIR 锁死到**开发者真实 home** → 测试读真实 config（如开了 `auto_approve_dangerous`）→ 确认被自动批准 → 等不到确认请求。
- 修法（两种，等价）：① 加一个「最先 import」的 setup 模块，在 `src/config.ts` 加载前设 `CMSPARK_DATA_DIR` 到临时目录（security-gates 用此）；② 在 `before()` 里**动态** `await import("../src/config")`（config.test.ts / history.test.ts 用此）。两者都让 DATA_DIR 在 config 加载时已指向临时目录。
- 教训：任何「模块级常量读 env/算路径」的模块，测试若要隔离，必须保证 env 在该模块**首次加载前**就位——静态 import + before() 设 env 是经典坑（import 先于 before）。

### node:test + ws：teardown 的异步错误会被判文件失败
- 现象：`security-gates.test.ts` 13/13 用例全过，但 node:test 仍把**整文件**标红 `'test failed'`（无具体断言）。
- 根因：afterEach 里 `terminate()` 一个仍在 CONNECTING（readyState 0）的 client ws，触发异步 `"WebSocket was closed before the connection was established"` → uncaughtException → node:test 标文件失败（不归属任何用例）。诊断：`process._getActiveHandles()` 看到 writeOnly 未销毁 socket；stderr 有 "generated asynchronous activity after the test ended"。
- 修法：给两个 ws 加 `ws.on("error", () => {})` 吞掉预期的 teardown 关闭错误。
- 相关：`security-policy.test.ts` hang = 每次 `issueToken` 的 TTL `setTimeout(..., 120s)` 不 `.unref()` → 进程保活 120s；修 `.unref()`（生产无害，token 在内存随进程消亡）。`daemon-cli.test.ts` hang = 测试 `unlinkSync` 锁文件不关 `net.Server` → handle 泄漏；修 `releaseLock()`（关 server）。

### 验证"竞态"再决定加锁（H5 教训）
- 审计称 `saveConfig` 有 read-modify-write 竞态（高），建议加 mutex。**查证为非 bug**：`saveConfig` 全同步（getConfig→deepMerge→writeFileSync 无 await），JS 单线程下同步函数不会被中途交错；且唯一数组追加 caller（server.ts:598 getConfig→613 saveConfig）中间也无 await。
- 教训：JS 单线程下，**全同步**的 read-modify-write 天然原子，不存在交错竞态——只有 caller「读 → await → 用陈旧快照写」才有竞态。审计/评审提"竞态"时先确认是否有 await 间隙，别为不存在的竞态加锁（cargo-cult）。kimi 终审也独立验证了所有 caller无 await 间隙，确认非 bug。

## Architecture Decisions

### Companion Native HUD N1–N10（2026-07-27 LOCK，P3a 前）
- **Source of truth**: `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md`
- **N1**: 一个 Companion 拉起的 Swift 二进制 = tray + HUD 窗；单一 SHA256 gate（可改常量名，不拆第二 gate）
- **N2**: 每 thread 一个 wide shell；败者收 **`shell.standby`（NEW）**；MinimalConfirm 只在 Panel
- **N3**: `hud.shell` auto|native|extension；healthy = PID + heartbeat ≤**3s** + ping ≤**400ms**；冷启动不挡 open
- **N4**: 关窗 ≠ 停任务/改 CapabilityLevel；无 wide shell → Panel MinimalConfirm + toast
- **N5**: 既有 single-writer；wire 晚到结果仍为 **`unknown`**（禁止改名 `already_resolved`）；**broadcast resolved 是 NEW**
- **N6**: Conductor = active wide shell，服务端强制；LIVE 时 Panel send 排队
- **N7**: Tray「打开确认台」走 N3（修正 D16 where native ships）
- **N8**: 禁止静默切换，除 death/health-fail（toast+fallback）或用户改设置
- **N9**: macOS native first；Cockpit parity CI 全平台
- **N10**: DualTrack 右轨 N≤8 + 内滚动，HUD **与** Cockpit 一致
- **Spike wire 归属**: `SecurityConfirmationManager` + `onTerminal` 在 **`server.ts`**；menu-bar 不建第二 manager；spike fan-out 仅 HUD+tray（WS 多端 deferred）
- **P3a 进度（2026-07-28）**: Task 1–6 源码在 main；Swift 源码有、SHA256 rebuild 待 macOS；Task 7 实现双评未做

### Enterprise session trust (A) + global enterprise auto-approve (B)（2026-07-27）
- **Why**: netsec/shell 在 allowlist 后仍每 op L2（`capabilityForceConfirm`）；用户需要 session 级与全局两档缓解，且不冲垮 pack/host 信任边界
- **A**: `enterprise-session-trust.ts` — thread + family(`netsec`|`shell`)；交互 grant；idle 30m + hard 8h；SafetyStrip revoke；不因 auto-path 续期
- **B**: `config.security.auto_approve_enterprise_tools` default false；phrase gate；`packs/types` FORBIDDEN
- **G1**: enterpriseSkip 与 hostComputerTrustSkip 并列；`forceConfirm` 仍可要求交互，除非 A/B 显式 enterpriseSkip
- **UI**: MinimalConfirm + ConfirmElevated 勾选 A；SettingsSlideout 开关 B
- **Plan + ship**: `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`；commits `5c3f21b`/`c7924bc` + audit reviews
- **Tradeoff**: B 是真 god-mode 子集（仅 enterprise tools），故意独立于 `auto_approve_dangerous`，避免误开全局危险自动批

### Quick Actions: delegation vs direct execution (2026-06-09)
- **Decision**: Quick actions from tray no longer execute tools directly; instead they create a thread and broadcast to the extension, which starts a normal chat
- **Why**: Previous direct execution + result server approach was fragile and all actions were failing. Delegating to the extension leverages the existing chat pipeline (streaming, tool calling, error handling) and displays results naturally in the Side Panel
- **Tradeoff**: Requires Chrome extension to be connected; no offline/standalone quick actions

### CI test glob globstar 坑：`tests/**/*.test.js` 在 dash 只匹配子目录
- 现象：companion `npm test` 的 glob `tests/**/*.test.js` 在 CI(ubuntu dash)下，`**` 无 globstar 支持 → 只匹配 `tests/<subdir>/*.test.js`（8 个子目录文件），**漏掉所有顶层 `tests/*.test.js`**（config/history/file-parser/ws-origin/threads-history/skills/knowledge/… 共 ~20 个文件/~596 测试）。CI 一直"绿"但只跑 <15% 测试。
- 修复：改用 `find .test-dist/tests -name '*.test.js' -not -name '_*'`（递归 + 排除 setup 模块）。+ settings-web.test 需单独 `node --test` 调用（多文件并发时 node:test IPC 崩溃）。
- 教训：shell globstar (`**`) 不是跨 shell 可移植的——dash/sh 默认不支持，bash 需 `shopt -s globstar`。CI 的 `npm test` 脚本里用 `**` 要么确认 CI shell 支持，要么用 `find` 替代。

### MCP capability 推断的 "unknown" 是 critical，god mode 绕不过（2026-07-14）
- 现象：filesystem MCP server（trust_level="trusted"）的 `directory_tree` 工具，即使开了 god mode（`security.allow_all_schemes`）也强制弹确认窗。
- 根因：`classifyMcpCall`（security.ts:381）按 tool name 正则匹配能力（read/write/exec/egress/db-mutate）。匹配不上就返回 `["unknown"]`。而 `CRITICAL_MCP_CAPABILITIES`（security.ts:297）显式包含 `"unknown"` —— "推断不出来就当危险的，强制确认"（§6.3 defense-in-depth）。**god mode 只 bypass UI prompt，不 bypass critical capability 边界**（§6.1.5/§6.2 mirror）。
- `directory_tree` / `walk_files` / `traverse` / `enumerate_records` 这种 read-flavored token 原 regex 不认（既不含 `read/list/find/get/info/...`，也不含 `directory/tree`）→ 落到 unknown → critical。
- 两条修法（互补）：
  1. **代码侧**（C4）：扩 `MCP_NAME_READ` regex 加 `directory|tree|walk|traverse|enumerate` → 推断成 `read-only`（D8 non-critical）
  2. **config 侧**（用户声明）：filesystem server 配置加 `security_capabilities: ["file-read", "read-only"]`（**必须是数组**，给字符串会被 `sanitizeMcpConfig` 静默丢弃，日志见 `mcp.config.security_capabilities_not_array got:"string"`）。merge 逻辑（Option C）：inferred 非空 → 并集；inferred=[unknown] + declared 非空 → 用 declared 解决 unknown
- 诊断入口：日志里 grep `security.mcp_critical_confirmed` 看 `capabilities` 字段是否含 `unknown`，是 → 推断器没认出 + 用户没声明
- 文件：security.ts:297/350/381/439, mcp/manager.ts:466（sanitizeMcpConfig）

### MCP filesystem directory_tree 在 $HOME 必撞 TCC EPERM（2026-07-14）
- 现象：让 agent `directory_tree /Users/huchen`，秒回 `EPERM: operation not permitted, scandir '/Users/huchen/.Trash'` → 整个对话被 `"不可恢复错误"` 杀死。
- 根因链：
  1. macOS TCC 保护 `~/.Trash` / `~/Library/Mail` 等即使进程有 FS 访问权
  2. 上游 `@modelcontextprotocol/server-filesystem` 一遇 EPERM **整次 walk bail**（不 skip-and-continue），返回 JSON-RPC error
  3. companion 收到 error 字符串 `"MCP filesystem/directory_tree returned error: EPERM: operation not permitted, scandir..."` 送进 `classifyError`
  4. `classifyError` 的 non_recoverable 列表只匹配 `"permission denied"` / `"permission not granted"`，**不匹配 `"eperm"` / `"operation not permitted"`** → 落到默认 non_recoverable → 杀对话
- 修复（C5）：`security.ts` recoverable 列表加 `"eperm"` + `"operation not permitted"` → LLM 收到 recoverable 反馈，可改扫 `~/.cmspark-agent/knowledge/global/` 这种窄路径重试。recoverable-loop guard（adapter.ts）会兜底防死循环。
- 注意区分：`"permission denied"`（EACCES）保留 non_recoverable，因为本仓库里它通常是 trust-policy denial（"不在 trusted_domains"），不是 fs TCC。
- 教训：错误分类器要枚举足够多的错误字符串模式；默认 fallthrough 到 non_recoverable 是激进的 —— 对 fs/MCP 上游错误尤其要补 recoverable 模式，否则一次 OSErr 就让 agent 整段对话死掉。
- 文件：security.ts:574-608（classifyError）, security-thread.test.ts

### Claude Code sandbox 无法触发 osascript GUI 对话框（2026-07-14）
- 现象：从 Claude Code bash 启动的 companion，`osascript -e 'POSIX path of (choose folder)'` 8 秒内返回 `用户已取消 (-128)`，**对话框压根没出现**。
- 根因：Claude Code 的 bash sandbox 没有 WindowServer / GUI session 访问权 → macOS Apple Events 直接当"无权显示 UI"返回 cancel。
- 验证：直接在 Claude bash 跑 `timeout 8 osascript -e 'POSIX path of (choose folder with prompt "test")'`，秒回 -128 + 无对话框 = sandbox 限制；从 Terminal.app 跑正常弹窗。
- 影响：任何用 `pickFolderNative()`（obsidian/folder-picker.ts）或 osascript 的 companion 功能（Obsidian 导出、knowledge.import_directory）都不能从 Claude sandbox 验证。
- 解法：
  1. 用户从 Terminal.app 跑 `cd ~/Projects/cmspark/companion && node dist/index.js start`（Terminal 有 GUI session）
  2. 或用 production tray 启动的 daemon（pid 1 父进程但同 UID，由 tray app 在 GUI session 启动）
- 生产环境影响：tray app 是 GUI app（在 user session 里），它启的 daemon 继承 GUI 访问权，osascript 能弹。Claude sandbox 启的 companion 才有问题。
- 文件：companion/src/obsidian/folder-picker.ts:40-53（pickMacOS）

### `git add -p` 通过 heredoc 实现非交互 partial-stage（reusable pattern）
- 场景：一个文件里有多个主题的改动（如 `message-router.ts` 同时含 knowledge.import_directory / thread.fork / config masking 三件事），想拆 commit。
- 流程：
  1. 列 hunk：`git diff <file> | grep "^@@"`
  2. 计划每 hunk 归属哪个 commit
  3. `git add -p <file> << 'EOF'\ny\nn\ny\ny\nn\nEOF`（每行一个 hunk 的 y/n）
  4. hunk 包含多个主题：答 `s`（split）→ 自动拆成子 hunks → 逐个 y/n
  5. mixed hunk 拆不开的：答 `e` 手动编辑 patch
- 注意：zsh 把 `rm` alias 成 `rm -i`，批量删文件用 `\rm` 或 `command rm` 绕过
- 案例（2026-07-14）：13 文件 +576 -93 改动，按 8 个主题拆 commit；message-router.ts 6 hunks 分到 C1/C2/C3；agentStore.tsx 一个 hunk 同时含 C1（SET_KNOWLEDGE_IMPORT_STATUS reducer）+ C3（SET_SETTINGS_OPEN reducer），用 `s` 拆成两个子 hunk 分别归 commit

### macOS coordinate computer-use: CGWindowListCreateImage deprecated in macOS 15
- Both `CGWindowListCreateImage` and `CGDisplayCreateImage` are marked unavailable (error, not warning) in macOS 15 SDK
- ScreenCaptureKit is the replacement but requires macOS 12.3+ and async APIs
- Workaround: use `/usr/sbin/screencapture -x -R x,y,w,h` subprocess call for window capture
- Files: `companion/src/host-use/darwin/host.swift` (cuScreenshot function)

### Swift multi-file compilation: only one file can have top-level code
- Compiling multiple .swift files (not in a target) requires exactly one "main" file with top-level statements
- Solution: single-file compilation with all functions in one file
- Files: `companion/src/host-use/darwin/host.swift`

### Extension App Tab macOS support requires 3-layer changes
- Adding macOS app support needs: (1) companion add-flow.ts bundleId branch, (2) companion enumerate.ts PlistBuddy scanner, (3) extension AppsPanel.tsx platform guard + bundleId field
- Missing any layer = "应用启动仅 Windows 可用" dead button
- Files: add-flow.ts, enumerate.ts, handlers.ts, apps-utils.ts, types.ts, AppsPanel.tsx

### System prompt app index was platform-gated to win32 only
- `buildAppIndexSection(platform)` returned empty string for non-win32 → LLM never saw mac.app.* tokens
- Fix: also accept "darwin" platform; also update tool-definitions descriptions from "(Windows ONLY)" to "(Windows / macOS)"
- Files: adapter.ts, tool-definitions.ts

### Biometric gate on macOS should prefer Touch ID over nonce challenge
- Default non-win32 fallback was 6-char manual nonce code → 45s timeout kills user experience
- Fix: `requireAppsBiometric` priority chain: win32→Windows Hello / darwin→Touch ID / fallback→nonce
- Touch ID uses `cmspark-host biometric-verify` subcommand with 60s timeout
- Files: biometric-gate.ts, host-use/darwin/index.ts

### VibeSOP SpanWriter metadata serialisation trap
- `SpanWriter.write_span()` serialises `metadata` dict → JSON string (for `redact_sensitive()`)
- `SpanAggregator._read_spans_in_window()` knows this and deserialises back
- `Dashboard._read_jsonl()` did NOT → crash on `/api/spans?skill_id=...`
- Fix: add `_normalize_span_metadata()` to dashboard's _read_jsonl
- Pattern: any consumer of spans.jsonl must handle metadata-as-string

### Instinct feedback signals: neutral vs explicit
- Hot path (routing) must NOT call `record_feedback_outcome(success=True)` — inflates confidence
- Route match ≠ user confirmed success
- Use `times_matched` (neutral counter) in hot path; `success_count/failure_count` only from CLI feedback

### Dashboard XSS: data attributes > inline onclick
- Span/trace IDs embedded in `onclick="showDetail('...')"` are XSS vectors
- Fix: `data-trace-id` + `data-trace-source` on `<tr>` + delegated click on `<tbody>`

### Grill-me + multi-agent adversarial verification workflow
- 3 explore sub-agents parallel → grill-me (5 rounds, Kimi Code answers) → Claude Code final review
- Found 2 blocking issues (schema duplication, feedback semantic error) before implementation
- After implementation, adversarial code review found 8 issues (1 CRITICAL, 1 HIGH)
