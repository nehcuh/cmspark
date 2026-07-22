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

## Reusable Patterns

### Broadcast pattern for cross-client actions
- When tray triggers an action that should execute in the Chrome extension, companion creates the entity then **broadcasts** a start message to ALL WebSocket clients
- The extension picks it up and initiates its own request through its connection, so streaming flows naturally
- Avoids needing to modify the chat/streaming pipeline to support cross-client routing
- Files: server.ts `broadcast` fn → message-router.ts broadcasts `quickAction.start` → extension forwards to sidepanel → sidepanel sends `chat.send` through its own WS connection

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
