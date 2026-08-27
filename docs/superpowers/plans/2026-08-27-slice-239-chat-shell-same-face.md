# Slice #239 — ChatShell 同一张脸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GitHub:** [#239](https://github.com/nehcuh/cmspark/issues/239)  
> **SoT:** [chat-shell-same-face-design.md](../specs/2026-08-27-chat-shell-same-face-design.md) **r2**  
> **对抗:** [synthesis](../../audit/reviews/chat-shell-same-face-spec-adversary-synthesis-20260827.md)  
> **Spec dual:** Claude **AWN** + Pi **AWN** `chat-shell-same-face-spec-r2-verdict-20260827-153041.json`（`both_ok=true`）。线稿 r2 文案已跟 pin。  
> **Blast:** **T2**（L0 copy/layout；无新 L2；overlay ACL 不涨）  
> **Plan dual r1:** Impl **REJECT** · Trust **AWN**。r2 pins 已折。  
> **Plan dual r2:** Claude **AWN** + Pi **AWN** `chat-shell-same-face-plan-r2-verdict-20260827-155140.json`（`both_ok=true`）。下列 dual nits 已折。  
> **实现 PR `Closes #239`。**

**Goal:** Side Panel empty is the thin ChatShell (page chip + 3 templates). 「弹出对话框」opens overlay HTML with the **same copy**, whole face, **no page chip**. Mac Swift HUD stays the old bar.

**Architecture:** ChatShell is a **copy + layout contract**, not a shared Plasmo tree. Extension React twins C-thin HTML. Pop-out is extension-origin WS `overlay.shell.open` → tray `openSummonerWebShell`. No `list_tabs` on summoner. No filled 贴回.

**Tech Stack:** chrome-extension React + companion Node/TS + existing node:test.

```text
Surface:      L0 ChatShell
L2-classes:   none
Compose:      static chips fill composer
Autonomy:     n/a
Trust:        overlay never Allow/Deny; F-I-4; no tab.* on SUMMONER_ALLOW
Channel:      community
```

---

## NEVER（本刀）

- 标签栏药丸；Allow/Deny；第二扩展；`ws_secret` grant
- `list_tabs` / `tab.*` / `ui.dock` / `sidePanel.open` on overlay / C-thin
- 实心「贴回侧栏」；声称 Mac 热键已换脸
- 芯片直接发送；把标题/DOM 拼进 prompt
- 共享 `ChatView` 进 `summoner-web`；Swift HUD 重绘；Chrome `windows.create` 装卸
- 用 overlay 管 MCP 掩盖 F-S-10；扩 outbound profile

---

## r2 pins（折 plan 对抗 REJECT）

1. **Tray 必须另挂 `onAppMessage`。** 现有 `menu-bar-agent.ts:1832` 只处理 `security.confirmation.request` 然后 `return`。`companion-client` fan-out ≠ 已订阅。只挂 **`companionClient`（tray）**，不挂 `summonerClient`（防双开）。
2. **广播无 `id`。** 带 `id` 会被当成 RPC 响应，进不了 `appMessageCbs`。payload 可枚举键只有 `type` + `thread_id`（无 token/port/url）。
3. **打开失败要 fail-closed。** 不能 broadcast 完就 `overlay.shell.opened`。tray 未连 / `openSummonerWebShell` 抛错 → `{ type:"error", error_code:"OVERLAY_SHELL_UNAVAILABLE" }`。侧栏 toast 必须走 `sendMessage` **callback**（`useWebSocket.send` 无 cb）。
4. **`thread_id` 必须进 HTML。** `openSummonerWebShell` 今开 `threads[0]`。改签名传入 `thread_id`，空态 `selectThread(thread_id)`。
5. **锁步文件点名：** `companion/tests/ws-router-validator-lockstep.test.ts`。新类型 = `validate.ts` key **+** `message-router.ts` `case "overlay.shell.open"`。lockstep 测不用改（自动覆盖）。
6. **整张脸 = `setExpanded(true)`，不是只 `placeWindow(true)`。** `.body` 默认 `display:none`，只改窗口高度仍是收起条。更新现有 `summoner-web.test.ts:138` `/placeWindow\(false\)/`。新测锁 `setExpanded(true)` 或 `classList.toggle("expanded"` 默认开。
7. **Overlay 空态 copy 必须无页：** 要匹配 `要我帮你做什么`，**禁止**空态出现 `要对这页做什么` / `当前页`。现 `:966` 已是页标题，测必须红。
8. **Lockstep 路径：** companion 测 `__dirname` = `.test-dist/tests`，ROOT=`path.resolve(__dirname,"..","..")` 是 `companion/`。扩展文件 = `path.join(ROOT,"..","chrome-extension","src","sidepanel","chat-shell-copy.ts")`。
9. **弹出按钮常驻 ChatShell 顶栏**（有消息也在），不进 EmptyState 滚走。StatusRail 不动。
10. **`background/index.ts` 必改：** `overlay.shell.open` 加入现有 bulk-forward 白名单。否则 SW `default` 未知类型。
11. **Handler 读 `session.origin`，不读 payload.origin。** 测：`msg.origin=chrome-extension://forged` + `session.origin=cmspark-tray://local` → `OVERLAY_SHELL_ORIGIN`。thin case 传整个 `session`。
12. **芯片 click = `fillComposer(chip.fill)`**，不 `chat.create`、不拼 `tab.title`。`pageChip` React 文本节点，无 `dangerouslySetInnerHTML`。`omitPage` 不调 `config.set` / 白名单 / `tabUrlCache`。
13. **ACL 测加宽：** `list_tabs`、`tab.`、`ui.dock`、`ui.open_sidepanel`、`overlay.shell.open` 均不在 `SUMMONER_ALLOW` / `SUMMONER_WEB_DISPATCH_ALLOW` / `SUMMONER_WEB_EVENT_ALLOW`。保留现有 MCP `hidden` 测（`summoner-web.test.ts:131`）。
14. **测试命令：** 扩展 = `cd chrome-extension && npm test`（`tsc -p tsconfig.test.json && node --test .test-dist/tests/*.test.js`）。**不要** `npx tsx`（tsx 只在 companion）。tabs 查询用 `{ active: true, lastFocusedWindow: true }`（同 `ContextStrip`）。
15. **F-I-4 grep 只对新文件：** `overlay-shell.ts`、弹出按钮、menu-bar Task 4 hunk。不要要求整个 `background/index.ts` 没有已有的 toolbar `sidePanel.open`。
16. **新 companion 测文件自带 `srcFile` helper**（定义在 `summoner-web.test.ts:23`，不自动共享）。
17. **`thread_id` 进 HTML：** `openSummonerWebShell(threadId)` 把 id 放进 loopback URL query（或首包 `thread.select`）。测：`summoner-web.ts` 空态启动 **没有** 无条件 `selectThread(threads[0].id)`；有 query/select 指定 id。
18. **弹出错误通道：** SW bulk-forward 立即 `{ok:true}`（`background/index.ts:1393-1401`），`OVERLAY_SHELL_*` 走 companion 帧 → `handleCompanionMessage` → UI。侧栏听该 error 帧 toast，**不要**指望 `sendMessage` cb 带回业务错误。双进程 tray 不在时允许 fail-closed-by-silence，但 UI 必须订阅 error 帧。
19. **忽略 echo：** no-id broadcast 会回到发起源的扩展 WS。SW/UI **忽略** `overlay.shell.open` 推送（只处理 `opened` / `error`）。
20. **Task 3 copy 测：** 源码锁 `CHAT_SHELL_TITLE_NONE` 标识符（或 `client.ts` 常量），不要要求 HTML 字符串字面量（模板注入后源码里没有中文）。

---

## File map

| File | Role |
|------|------|
| `chrome-extension/src/sidepanel/chat-shell-copy.ts` | **Create.** titles / chips / `当前页：` |
| `chrome-extension/src/sidepanel/empty-state-copy.ts` | Wrap ChatShell copy; computer 邀请不进三芯片 |
| `chrome-extension/src/sidepanel/components/ChatView.tsx` | EmptyState + 当前页芯片；弹出按钮 |
| `chrome-extension/tests/empty-state-copy.test.ts` | Flip to r2 copy |
| `chrome-extension/tests/chat-shell-copy.test.ts` | **Create.** 无页/有页 |
| `companion/src/summoner/client.ts` | Same string constants (lockstep) |
| `companion/src/summoner-web.ts` | HTML 空态整张脸、无页、rail 仍 hide-not-delete、cta-box 保留 |
| `companion/src/ws/validate.ts` | `overlay.shell.open` |
| `companion/src/message-router/handlers/overlay-shell.ts` | **Create.** thin handler |
| `companion/src/message-router.ts` | Thin case arm |
| `companion/src/ws/summoner-acl.ts` | **Do not** add the type |
| `companion/src/tray/companion-client.ts` | Push `overlay.shell.open` to appMessageCbs (already fans out) |
| `companion/src/menu-bar-agent.ts` | On push → `openSummonerWebShell` |
| `companion/tests/overlay-shell-open.test.ts` | **Create.** ACL + origin + no tab verbs |
| `companion/tests/summoner-web.test.ts` | Empty copy / default height / no 允许拒绝 |
| `PRODUCT.md` `docs/DESIGN.md` | Honesty |

**How tests run:**  
Extension: `cd chrome-extension && npm test`  
Companion: `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/overlay-shell-open.test.js .test-dist/tests/summoner-web.test.js .test-dist/tests/chat-shell-copy-lockstep.test.js .test-dist/tests/ws-router-validator-lockstep.test.js`  
（编译产物保留 `.test.js` 后缀。）

---

### Task 1: Copy module + lockstep

**Files:**
- Create: `chrome-extension/src/sidepanel/chat-shell-copy.ts`
- Modify: `companion/src/summoner/client.ts` (append constants)
- Create: `chrome-extension/tests/chat-shell-copy.test.ts`
- Create: `companion/tests/chat-shell-copy-lockstep.test.ts`

- [ ] **Step 1: Write the failing extension test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { chatShellEmpty, CHAT_SHELL_PAGE_CHIP_PREFIX, CHAT_SHELL_CHIPS } from "../src/sidepanel/chat-shell-copy"

test("no page: title 要我帮你做什么, no chips, no pageChip", () => {
  const e = chatShellEmpty(null)
  assert.equal(e.title, "要我帮你做什么？")
  assert.equal(e.pageChip, null)
  assert.equal(e.chips.length, 0)
})

test("page: 要对这页做什么 + 当前页 prefix + 3 static fills", () => {
  const e = chatShellEmpty("vibesop 交互报告")
  assert.equal(e.title, "要对这页做什么？")
  assert.equal(e.pageChip, `${CHAT_SHELL_PAGE_CHIP_PREFIX}vibesop 交互报告`)
  assert.equal(e.chips.length, 3)
  assert.deepEqual(e.chips.map((c) => c.label), CHAT_SHELL_CHIPS.map((c) => c.label))
  assert.ok(!e.pageChip.includes("正在看"))
  assert.ok(!e.pageChip.includes("分享"))
  for (const c of e.chips) {
    assert.ok(!c.fill.includes("vibesop"))
  }
})
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

`cd chrome-extension && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/chat-shell-copy.test.js`

- [ ] **Step 3: Implement `chat-shell-copy.ts`**

```ts
export const CHAT_SHELL_TITLE_PAGE = "要对这页做什么？"
export const CHAT_SHELL_TITLE_NONE = "要我帮你做什么？"
export const CHAT_SHELL_PAGE_CHIP_PREFIX = "当前页："
export const CHAT_SHELL_CHIPS = [
  { label: "总结这一页", fill: "请总结当前页面的要点" },
  { label: "用更简单的话讲这一页", fill: "用更简单的话讲这一页在干什么" },
  { label: "列出我能在这页替你做的操作", fill: "列出当前页我可以替你执行的操作" },
] as const

export function chatShellEmpty(pageTitle: string | null): {
  title: string
  pageChip: string | null
  chips: { label: string; fill: string }[]
} {
  const title = (pageTitle || "").trim()
  if (!title) {
    return { title: CHAT_SHELL_TITLE_NONE, pageChip: null, chips: [] }
  }
  return {
    title: CHAT_SHELL_TITLE_PAGE,
    pageChip: `${CHAT_SHELL_PAGE_CHIP_PREFIX}${title}`,
    chips: CHAT_SHELL_CHIPS.map((c) => ({ label: c.label, fill: c.fill })),
  }
}
```

- [ ] **Step 4: Companion lockstep constants + test**

In `client.ts` export the **same three title/prefix strings and chip labels/fills** as `CHAT_SHELL_*`.

Test `companion/tests/chat-shell-copy-lockstep.test.ts`：`const ROOT = path.resolve(__dirname, "..", "..")`（companion 根）。扩展文件 `path.join(ROOT, "..", "chrome-extension", "src", "sidepanel", "chat-shell-copy.ts")`。UTF-8 `assert.match` 各常量。不要 `import` 扩展模块。

- [ ] **Step 5: Tests green. Commit**

```bash
git add chrome-extension/src/sidepanel/chat-shell-copy.ts chrome-extension/tests/chat-shell-copy.test.ts companion/src/summoner/client.ts companion/tests/chat-shell-copy-lockstep.test.ts
git commit -m "feat(chat-shell): shared empty copy contract (#239)"
```

---

### Task 2: Flip `emptyStateCopy` + EmptyState tests

**Files:**
- Modify: `chrome-extension/src/sidepanel/empty-state-copy.ts`
- Modify: `chrome-extension/tests/empty-state-copy.test.ts`
- Modify: `chrome-extension/src/sidepanel/components/ChatView.tsx` EmptyState

- [ ] **Step 1: Rewrite tests first (RED if impl still old)**

Replace S0.1 D″ L0: no 「起草」, no 「装配」 in ChatShell items; title still `/要我帮你做什么/`.

Replace L1: `emptyStateCopy("browser", "某页")` title `/要对这页做什么/`; three ChatShell chips; blob includes `当前页：某页`; no `正在看`.

Replace L2: `emptyStateCopy("computer")` **must not** put `cockpit` in ChatShell chips (re-home). Title may still mention 确认台 as hint **or** use no-page title — pick **no-page ChatShell title** + hint `确认在确认台` without chip action.

S2.1: EmptyState may call `chatShellEmpty` / `emptyStateCopy` with pageTitle; still must not contain 畅所欲问.

- [ ] **Step 2: Run tests — RED**

- [ ] **Step 3: Implement `emptyStateCopy(level, pageTitle?: string | null)`** using `chatShellEmpty`. L2: `{ title: CHAT_SHELL_TITLE_NONE, hint: "步骤与确认在确认台。", items: [] }`.

- [ ] **Step 4: EmptyState queries `chrome.tabs.query({ active: true, lastFocusedWindow: true })`（同 ContextStrip）and passes `tab.title`. Chip click → 现有 `fillComposer(it.fill)` only（不 `chat.create`、不拼 title）。`pageChip` 用 React 文本，无 `dangerouslySetInnerHTML`。Hide × → local `omitPage=true` only（不 `config.set` / 白名单 / `tabUrlCache`）。**

Do **not** remove StatusRail from `App.tsx`. Do **not** put 「弹出对话框」inside EmptyState. Do **not** add Allow/Deny.

- [ ] **Step 5: `cd chrome-extension && npm test` green. Commit**

```bash
git commit -m "feat(sidepanel): ChatShell empty with 当前页 chips (#239)"
```

---

### Task 3: Overlay HTML empty = whole face, no page

**Files:**
- Modify: `companion/src/summoner-web.ts`
- Modify: `companion/tests/summoner-web.test.ts`

- [ ] **Step 1: Tests (source contracts)**

Add to `summoner-web.test.ts`:

```ts
test("HTML empty uses ChatShell NO-PAGE title", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /CHAT_SHELL_TITLE_NONE/)
  assert.doesNotMatch(html, /要对这页做什么/)
  assert.doesNotMatch(html, /当前页：/)
  assert.doesNotMatch(html, /正在看/)
  assert.doesNotMatch(html, /正在分享/)
  assert.match(html, /SUMMONER_ATTACH_FOOTNOTE/)
  assert.match(html, /SUMMONER_OPEN_CONFIRM/)
})

test("HTML default expands the face (not 120px bar)", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /setExpanded\(true\)/)
  assert.doesNotMatch(html, /placeWindow\(false\);/)
})

test("MCP rail stays hide-not-delete", () => {
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /data-sec="mcp"[^>]*\bhidden\b|hidden[^>]*data-sec="mcp"/)
  assert.match(html, /mcp.toggle_server/)
})
```

Keep existing `展开对话` **string still in source** (chevron can collapse). Default open is expanded.

Keep `doesNotMatch(/允许|拒绝|Allow|Deny/)` — if HTML comments fail, use a control regex on `<button` inner text only; do not add those words as controls.

- [ ] **Step 2: RED**

- [ ] **Step 3: IIFE 末尾改 `setExpanded(true)`（会 `classList.toggle("expanded")` + `placeWindow`）。空态文案注入 `CHAT_SHELL_TITLE_NONE`（要我帮你做什么），删掉现有 innerHTML「要对这页做什么」。不渲染当前页/三芯片。Keep `#ctaBox`。packs/knowledge/skills rail `hidden` 同 MCP。保留 `summoner-web.test.ts` 现有 MCP hidden 断言（约 :131）；把 :138 `/placeWindow\(false\)/` 改成允许 `setExpanded(true)` 路径。**

- [ ] **Step 4: Tests green. Commit**

```bash
git commit -m "feat(summoner-web): ChatShell empty whole face, no page chip (#239)"
```

---

### Task 4: `overlay.shell.open` protocol

**Files:**
- Create: `companion/src/message-router/handlers/overlay-shell.ts`
- Modify: `companion/src/ws/validate.ts`
- Modify: `companion/src/message-router.ts` (thin `case "overlay.shell.open"`)
- Modify: `companion/src/menu-bar-agent.ts`
- Create: `companion/tests/overlay-shell-open.test.ts`
- Do not edit: `companion/tests/ws-router-validator-lockstep.test.ts`（自动覆盖新 case/validator）

- [ ] **Step 1: Failing tests**

```ts
test("overlay.shell.open is NOT on SUMMONER_ALLOW", () => {
  const acl = fs.readFileSync(srcFile("ws", "summoner-acl.ts"), "utf8")
  assert.doesNotMatch(acl, /overlay\.shell\.open/)
})

test("assertSummonerAllowed denies overlay.shell.open", () => {
  const { assertSummonerAllowed } = require("../src/ws/summoner-acl")
  const r = assertSummonerAllowed("summoner", "overlay.shell.open")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
})

test("validate overlay.shell.open requires thread_id", () => {
  const { validateWsMessage } = require("../src/ws/validate")
  assert.equal(validateWsMessage({ type: "overlay.shell.open" }).valid, false)
  assert.equal(validateWsMessage({ type: "overlay.shell.open", thread_id: "abc123" }).valid, true)
})

test("handler rejects tray origin even if payload.origin is forged", async () => {
  const { handleOverlayShellOpen } = require("../src/message-router/handlers/overlay-shell")
  const r = await handleOverlayShellOpen(
    { thread_id: "abc123", origin: "chrome-extension://forged" },
    { origin: "cmspark-tray://local", surface: "tray", broadcast: () => {} },
  )
  assert.equal(r.type, "error")
})

test("ACL / C-thin / SSE have no tab or dock verbs", () => {
  const acl = fs.readFileSync(srcFile("ws", "summoner-acl.ts"), "utf8")
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  for (const s of [acl, web]) {
    assert.doesNotMatch(s, /list_tabs/)
    assert.doesNotMatch(s, /ui\.dock/)
    assert.doesNotMatch(s, /ui\.open_sidepanel/)
  }
  assert.doesNotMatch(acl, /overlay\.shell\.open/)
})

test("new overlay-shell handler never sidePanel.open", () => {
  const src = fs.readFileSync(srcFile("message-router", "handlers", "overlay-shell.ts"), "utf8")
  assert.doesNotMatch(src, /sidePanel\.open/)
})
```

- [ ] **Step 2: RED** (`tsc` + `node --test`)

- [ ] **Step 3: Implement**

`handleOverlayShellOpen(rest, session)`（thin case 必须传 `session`，同 `voice.stt`）:
- `session.surface === "summoner"` → `{ type:"error", error_code:"SUMMONER_ACL" }`
- `typeof session.origin !== "string" || !session.origin.startsWith("chrome-extension://")` → `OVERLAY_SHELL_ORIGIN`（忽略 `rest.origin`）
- `broadcast({ type: "overlay.shell.open", thread_id })` **无 `id` 字段**
- **不要**在 companion 里假装已打开。若没有 tray 回执：本刀采用 tray 侧打开、RPC 仍 `overlay.shell.opened` **仅当** menu-bar 已注册 opener；单测 handler 时用 fake `broadcast` + 可选 `waitAck`。产品路径：tray 未运行则用户点弹出后 SW 超时/错误 toast（Task 5 callback）。实现选一：**companion 若 `getTrayInstance()` 同进程则直接 `openSummonerWebShell(thread_id)` 并 catch → UNAVAILABLE**；双进程则 broadcast 无 id，tray 必须打开。

`menu-bar-agent.ts`:
- **另** `companionClient.onAppMessage`（不要改确认那条的 early return 去兼岗）：`msg.type === "overlay.shell.open"` → `openSummonerWebShell(msg.thread_id)`。
- `openSummonerWebShell(threadId: string)`：现有 start+openLoopback；HTML 用该 `threadId` `selectThread`，禁止默默 `threads[0]`。
- 不在 `summonerClient.onAppMessage` 上注册 opener。

No `chrome.sidePanel.open` in new files. No new SUMMONER_ALLOW entry. `overlay.shell.open` 保持 **不在** `SUMMONER_WEB_EVENT_ALLOW`。

- [ ] **Step 4: GREEN + lockstep validator test. Commit**

```bash
git commit -m "feat(overlay): extension-origin overlay.shell.open opens HTML shell (#239)"
```

---

### Task 5: Side Panel 「弹出对话框」

**Files:**
- Modify: ChatView **顶栏行**（消息列表之上，空态/有消息都在）。不改 StatusRail Zone A。
- Modify: `chrome-extension/src/background/index.ts` **必改** bulk-forward 白名单加 `overlay.shell.open`
- Test: `chrome-extension/tests/chat-shell-popout.test.ts`

- [ ] **Step 1: Source lock**

```ts
test("popout button is not only in EmptyState and SW forwards overlay.shell.open", () => {
  const chat = readFileSync(join(process.cwd(), "src/sidepanel/components/ChatView.tsx"), "utf8")
  const emptyFn = chat.slice(chat.indexOf("function EmptyState"), chat.indexOf("const markdownCSS"))
  assert.doesNotMatch(emptyFn, /弹出对话框/)
  assert.match(chat, /弹出对话框/)
  assert.doesNotMatch(chat, /贴回侧栏/)
  const bg = readFileSync(join(process.cwd(), "src/background/index.ts"), "utf8")
  assert.match(bg, /overlay\.shell\.open/)
})
```

- [ ] **Step 2: RED**

- [ ] **Step 3: 顶栏按钮 click → `chrome.runtime.sendMessage({ type: "overlay.shell.open", thread_id })`。SW bulk-forward 该 type。业务失败听 companion 帧 `error` / `OVERLAY_SHELL_*`（`handleCompanionMessage`），不是 sendMessage cb。忽略推送到扩展的 `overlay.shell.open` echo。新路径 grep 无 `sidePanel.open`（整份 background 里已有 toolbar open，不要删）。**

- [ ] **Step 4: GREEN. Commit**

```bash
git commit -m "feat(sidepanel): 弹出对话框 opens overlay HTML ChatShell (#239)"
```

---

### Task 6: Docs honesty

**Files:** `PRODUCT.md` · `docs/DESIGN.md` · spec header status if needed

- [ ] PRODUCT Surfaces: Side Panel ChatShell; HTML float same copy; Mac hotkey still collapsed bar; entry = toolbar C not tab pill.
- [ ] DESIGN.md: `弹出对话框`; `当前页：`; chips fill composer; 贴回 is footnote not button.
- [ ] Commit `docs(chat-shell): PRODUCT/DESIGN honesty for #239`

---

## Spec coverage

| r2 pin | Task |
|--------|------|
| Copy contract not shared React | 1 |
| Sidebar page chip | 2 |
| HTML 无页整张脸 | 3 |
| overlay.shell.open | 4–5 |
| No 贴回 button | 5 test + 6 |
| No tab.* ACL | 4 tests |
| Honesty CTAs stay | 3 (cta-box) + 2 (L2 hint) |
| StatusRail stays | 2 (do not touch App StatusRail) |
| Mac HUD unchanged | no Swift files in map |
| Docs | 6 |
