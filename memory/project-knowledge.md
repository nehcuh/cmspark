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

## Architecture Decisions

### Quick Actions: delegation vs direct execution (2026-06-09)
- **Decision**: Quick actions from tray no longer execute tools directly; instead they create a thread and broadcast to the extension, which starts a normal chat
- **Why**: Previous direct execution + result server approach was fragile and all actions were failing. Delegating to the extension leverages the existing chat pipeline (streaming, tool calling, error handling) and displays results naturally in the Side Panel
- **Tradeoff**: Requires Chrome extension to be connected; no offline/standalone quick actions
