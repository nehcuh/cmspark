# RFC · P3 快速清理批次（L1 / L4 / L9 / L5 / L3）

> **日期**: 2026-07-13 · **Findings**: L1/L4/L9/L5/L3（`audit-report-cmspark-2026-07-09.md`）
> **状态**: ⏳ 待 kimi 裁决（逐项 fork）

5 个 Low-severity 独立清理项，各 1-2h，分独立 PR。Grounding 已核验当前代码位置（审计 07-09 后行号已移）。另：**L7（Mermaid pending 竞态）经核已在 PR #9 修复**（`mermaid.ts:108/109/116/144` pending+isConnected 守卫齐全），本批次不含、标 close。

## L1 — 原型污染守卫过宽/不完整（companion，security）

**现状**（`message-router.ts:1350-1360` `hasPrototypePollutionKey` + `config.ts:498-508` `deepMerge`）：
- `:1356` 值检查：`if (typeof val === "string" && PROTOTYPE_POLLUTION_KEYS.has(val)) return true`——**值等于字符串 "prototype"/"constructor"/"__proto__" 即拒**。误报：MCP server 名为 `prototype`（key 级 :1353 拒，合理）vs server 的 `command`/env 值恰好是字符串 "prototype"（value 级 :1356 拒，**误报无安全收益**——值是字符串不污染原型）。
- `deepMerge`：`{...target}` + `Object.keys(source)`——靠 spread 语义"偶然安全"（JSON.parse 的 `__proto__` 成 own prop，spread 不污染原型链），无显式硬化。

**fork**：
- **L1-a**（推荐）删 value-string 检查（:1356），保留 key 检查（:1353-1354 + 递归）。原型污染威胁在 KEY 不在 VALUE。
- **L1-b** 同时给 deepMerge 显式 skip `__proto__`/`constructor`/`prototype` key（defense-in-depth，去 "by accident"）。
- **L1-c** JSON 边界 `Object.create(null)`。

**推荐 L1-a + L1-b**（删误报 value 检查 + deepMerge 显式 proto-key skip，proportionate；L1-c 过度）。请裁决。

**测试**：`config.set {llm:{__proto__:{polluted:true}}}` 不致 `({}).polluted===true`；`mcp.add` 名 `prototype` 或 command 值 `"prototype"` 成功（修误报）；deepMerge 不传播 proto key。

## L4 — 死代码 InputArea.tsx + ConnectionStatus.tsx（extension，maintainability）

**现状**：两文件存在（`components/InputArea.tsx` 8.5k / `ConnectionStatus.tsx` 2.3k），**全 chrome-extension/src 零 import**。App.tsx 用内联 `InputArea`（:368）。两套 InputArea 逻辑漂移（组件版有 onDrop，内联版无）。

**fix**（无 fork）：删两文件。**风险**：确认零引用后纯删除。

**测试**：plasmo build 绿（引用断会编译失败）；既有 sidepanel-state 测不引这两文件。

## L9 — handleSend 双发（extension，frontend-state）

**现状**（`App.tsx:380 canSend / 446-467 handleKeyDown / 469-532 handleSend`）：唯一守卫 `if(!canSend) return`（:470）；`canSend` 派生自 `isStreaming=!!state.streamingContent`（:378），**不**含 `state.isProcessing`。SET_PROCESSING（:498/516）在 sendMessage（:491/510）之后且不回馈 canSend → WS 往返期间 canSend 仍 true → 快双击/按住 Enter 重入发 N 个 chat.send。

**fix**（无 fork）：`const sendingRef = useRef(false)`；handleSend 顶部 `if(sendingRef.current) return; sendingRef.current=true`；在 sendMessage 派发后 / finally 置 false（chat 分支 setText 后即可释放，因 canSend 据 hasContent 已 false；或显式 finally）。

**测试**：组件测同步两 Enter keydown → 断言 sendMessage/chat.send 一次。

## L5 — 自动滚动与用户争抢（extension，frontend-state）

**现状**（`ChatView.tsx:50-61`）：`useEffect[messages.length, streamingContent]` 内无条件 `container.scrollTop = container.scrollHeight`（rAF）。无 isNearBottom / userPinned 守卫 → 用户上滚读旧消息每 token 被拽回底。

**fix**（无 fork）：加 `pinnedRef=useRef(true)`；`onScroll` 设 `pinned = (scrollHeight - scrollTop - clientHeight) < 60`；effect 内 `if(pinnedRef.current) scrollTop=scrollHeight`。

**测试**：组件测设 scrollTop 上滚 → streamingContent 变 → scrollTop 不被强制拉底。

## L3 — markdown `<a>` 无 target/rel（extension，security）

**现状**（`ChatView.tsx:467-488` DOMPurify config + `:516` dangerouslySetInnerHTML）：`ALLOWED_ATTR` 含 `href` 但**无 target/rel**；无 afterSanitizeAttributes hook；无 click 拦截 → 点 LLM/authored 链接侧栏原地导航到外部 origin（侧栏是普通 tab），无 noopener。

**fix**（无 fork）：
- DOMPurify `afterSanitizeAttributes` hook：`<a>` 加 `target=_blank rel=noopener noreferrer`。
- 容器 onClick capture 拦截 `<a>` click → `e.preventDefault()` + `chrome.tabs.create({url:(e.currentTarget).href, active:false})`（仿 mermaid.ts:133-136 SVG 点击开新标签先例）。
- href 仍经 DOMPurify（已拦 javascript:/data: 导航类）。

**测试**：渲染 `<a href="https://x.example">`；模拟 click；断言 `chrome.tabs.create` 调用 + location 不变。

## 非目标
- L2（storage.local 明文，MV3 无解，doc 威胁模型，defer）、L6（CJK 高亮，需迁移 highlight.js，defer）、L8（agentStore dirty 状态，0.5d，defer）、M13（reconnect placebo，0.5d，defer）、M17（native confirm→ConfirmDialog，触及 6+ 文件，defer）、L14（version 策略，触及 WS 握手，defer）。
- 不重构 god-file（M12/M14，独立大 PR）。
