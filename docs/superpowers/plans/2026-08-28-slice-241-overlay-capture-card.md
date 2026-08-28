# Slice #241 — Overlay Capture 卡片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GitHub:** [#241](https://github.com/nehcuh/cmspark/issues/241)  
> **SoT:** [2026-08-28-overlay-capture-card-design.md](../specs/2026-08-28-overlay-capture-card-design.md)  
> **前序:** #239 ChatShell copy；本票 **supersede** HTML「听写在侧栏」与④主路径（失败仍「请点工具栏 C」）  
> **Blast:** **T3**（overlay ACL 上涨 `meeting.create|start|end`；HTML `voice.stt`；F-I-4 修正：扩展 SW 开侧栏）  
> **对抗 r1：** Impl **REJECT** · Product **REJECT** · Trust **AWN**（B1–B5）。下列 r2 pins 已折。  
> **实现前闸门：** 本 plan **dual**（独立对抗 → Claude+Pi）`both_ok` 后才能写码。实现 PR `Closes #241`（可拆 PR；**禁止** Task 1 单独 `Closes #241`）。

**Goal:** 弹出 HTML 是一张 ~400×520 Capture 卡片：问答、📎、听写、开始/结束会议、打开浏览器并打开侧栏。侧栏视觉与 Mac Swift HUD 不动。

**Architecture:** 原地改 `summoner-web` 单栏。rail/list DOM hide-not-delete、不占格。听写走**专用** `/api/stt/*`（禁止通用 `/api/dispatch`）再经 summonerClient `voice.stt`。会议 create/start/end：handler **per-type** origin + router 传 `surface`。④ = `/api/operate` → tray `sendAppRequest` → companion 无 id 广播 → 扩展 `handleCompanionMessage` 开侧栏。Companion 永不 `chrome.sidePanel.open`。

**Tech Stack:** companion Node/TS + C-thin HTML + chrome-extension SW + existing node:test.

```text
Surface:      L0 Capture 卡片（overlay HTML）
L2-classes:   none
Compose:      file.upload；voice.stt；meeting.create/start/end；ui.open_sidepanel 仅扩展槽
Autonomy:     none
Trust:        overlay never Allow/Deny；F-I-4 修正见 SoT
Channel:      community
```

---

## NEVER

- overlay Allow/Deny；第二扩展；`ws_secret` grant
- Companion / 托盘 Node 调用 `chrome.sidePanel.open` 或把 `openSidePanel()` 当成功
- `list_tabs` / `tab.*` / `ui.open_sidepanel` 进 SUMMONER_ALLOW / HTML dispatch / overlay SSE
- 浮窗「当前页」芯片 / 三条「这一页」
- 贴页浮层、标签栏药丸、锁引擎、Swift 重绘、侧栏换皮肤
- 连续听写 v3；Gemini 星星；#230 整票

---

## Pins（写码前钉死）

1. **测试命令：** 扩展 `cd chrome-extension && npm test`。Companion 点名文件：`cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/<file>.test.js`。不要 `npx tsx`。
2. **Lockstep：** 新 WS 类型 = `validate.ts` key **+** `message-router.ts` `case`。测 `ws-router-validator-lockstep.test.ts` 自动覆盖。
3. **`ui.open_sidepanel` 与 `overlay.shell.open` 同级：** 扩展槽。handler 读 `session.origin`，不读 payload.origin。广播 **无 `id`**。summoner surface → `SUMMONER_ACL`。
4. **④ 不走 HTML dispatch。** `POST /api/operate`（同 `/api/attach`）在 tray 上用 **`sendAppRequest`**（有 id）。失败 JSON「请点工具栏 C」。`summoner-web.ts` 不得出现字符串 `ui.open_sidepanel`。
5. **会议 origin：** `create/start/end` 用 `isVoiceSttOriginAllowed`（扩展 **或** `cmspark-tray://local` + `surface==="summoner"`）。`generate_minutes` / `auto_diarize` / `import_text` 仍 `isChromeExtensionOrigin` only。
6. **HTML dispatch 新加：** `voice.stt.start|chunk|end|abort|partial_request`、`meeting.create|start|end`。SSE 新加：`voice.stt.partial` / `voice.stt.result` / `voice.stt.error` / `meeting.created` / `meeting.started` / `meeting.ended` / `meeting.error`。
7. **隐私文案 lockstep：** 听写 = `VOICE_PRIVACY_ACK_V2_CLAUSES`；会议 = MeetingPanel 五条。每开一扇窗 ack 一次（不读 chrome.storage）。
8. **窗尺寸：** `shell-open.ts` 与 `placeWindow` 都改 `400,520`。现测 `/var w=720,h=expanded\?520:120/` 必须翻红再绿。
9. **单栏：** `.hud.expanded .body` 不得再 `grid-template-columns:var(--rail) var(--list)`。`.rail`/`.list` `display:none`（节点仍在）。现测 `/class="rail-btn"/` 与 `data-sec="mcp"[^>]*hidden` **保留**。
10. **F-I-4 grep 新文件：** `ui-open-sidepanel.ts`、`/api/operate` hunk、④ 按钮。不要要求整个 `background/index.ts` 没有已有 `sidePanel.open`。
11. **Toast：** 浮窗用卡片底 `#status` / 错误条。禁止 `SET_PROCESSING_STATUS`。
12. **`srcFile` helper** 新测文件自带（拷 `summoner-web.test.ts` 23–32 行），不假设共享。
13. **SW：** `ui.open_sidepanel` 加入 bulk-forward 白名单（`background/index.ts` overlay.shell.open 旁）。收到 companion 推送则 `chrome.sidePanel.open`；扩展自己发出的 echo 忽略。
14. **Mic 未就绪：** 文案「侧栏 ⋯ → 设置 → 听写 → 下载组件/模型」。不开假麦。
15. **Swift HUD / `SUMMONER_MIC_SIDEBAR` 常量不改名。** HTML 空态与 `#mic` **停止注入**该句。Swift 不翻。

## r2 pins（折 Impl/Product REJECT + Trust nits）

16. **禁止通用 `/api/dispatch`。** 听写用 `/api/stt/start|chunk|end|abort`（服务端填 `type`，HTML 不能自选任意 type）。测：POST `type=list_tabs|generate_minutes|ui.open_sidepanel|security.confirmation.response` → 403。`JSON_BODY_MAX` **保持 64KiB**；chunk 路由单独 cap ≥ **base64(`STT_MAX_CHUNK_BYTES`) ≈ 350KiB 线体**（256KiB 解码后 ≈ 342KiB base64），**不要**抬到 `FILE_BODY_MAX`。
17. **`companionClient.send` 不存在。** ④ RPC = `sendAppRequest`（有 id，等 `ui.open_sidepanel.accepted`）。广播给扩展 = **无 id**。`sendAppMessage` 不能当 await。error 体带 `msg.error` 会 **reject** promise → `/api/operate` **try/catch** 映射「请点工具栏 C」。
18. **④ origin 与 overlay-shell **相反**。** 请求：`cmspark-tray://local` + `surface!=="summoner"`。扩展 origin 请求 → `UI_OPEN_SIDEPANEL_ORIGIN`。**不要**镜像 `overlay-shell.ts:25-26`。SoT §6 已改成 tray-request / extension-receive。
19. **SW 测必须切 `handleCompanionMessage` 函数体**（同 `chat-shell-popout.test.ts:51-57`）：切片内同时有 `ui.open_sidepanel` **与** `sidePanel.open`。全文件 `chrome.sidePanel.open` 已有 thread_graph，会假绿。bulk-forward `case` 另切，只证明误发会进 companion（handler 拒扩展 origin），**不是**打开侧栏。
20. **会议 `surface` 必须进 ctx。** `MeetingHandlerContext` + `message-router.ts` meeting 调用传 `session?.surface`（对照 stt `:2398-2403`）。unit 测：tray origin **无** surface → `origin_denied`；`surface:"summoner"` → create/start/end 过；`generate_minutes` + summoner 仍拒。file map **含** `message-router.ts`。
21. **overlay `meeting.start` 强制 `audio_retained=false`，剥 `retain_days`**（`applySummonerPayloadPolicy`）。测它。
22. **不加** `meeting.append_transcript` / `set_transcript` / `list` / `get` 到 overlay ACL。录音分段走 `voice.stt.*`；结束文案 **「纪要在侧栏」**。
23. **`ui.open_sidepanel` 字符串禁止出现在 `summoner-web.ts`**（保 #239 `overlay-shell-open.test.ts:57-64`）。operate 错码用 `OPERATE_SIDEPANEL_UNAVAILABLE`。tool-catalog + `getToolDefinitions()` 源码锁不含该 type。
24. **无扩展 peer：** `/api/operate` 在 broadcast 前若 `pickAuthenticatedClientWs()==null` → 503 +「请点工具栏 C」，不要 `{type:"ok"}`。`accepted` ≠ opened（同 overlay.shell.accepted）。
25. **Task 1 不放会撒谎的「开始会议」「打开浏览器并打开侧栏」。** 那两钮分别进 Task 3 / 4。Task 1 只换脸：单栏、400×520、标题 `CMspark`、空态无「听写在侧栏」、📎 在作曲区左侧、placeholder「问 CMspark…」、expanded **隐藏** `.ghosts` 与排队 hint、privacy 面板默认 `hidden`。**禁止** Task 1 PR `Closes #241`。
26. **翻掉 leftover 工作台锁**（`summoner-web.test.ts`）：`CMspark 召唤器（实验）` → `CMspark`；`听写在侧栏` doesNotMatch 全文。**Task 4** 拿掉 cta-foot 默认可见的 `我们不能替你打开侧栏`（失败 toast 用「请点工具栏 C」）；并翻 `summoner-web.test.ts:157` / `:622` 的 `SUMMONER_ATTACH_FOOTNOTE` 锁。黄条只在 Chrome 掉线；不与 ④ 抢第一屏。
27. **CSS 测对齐 grouped selector：** `assert.match(r.body, /\.rail,\.list\{[^}]*display:none/)`。commit 必须包含 `summoner-shell-open.test.ts`。
28. **会议隐私栈 = 本窗若未 ack 听写 v2，先出六条再出会议五条**（或「开始会议」一屏两节）。禁止未展示 v2 就带 `privacy_ack_v2:true` 打 stt。
29. **麦克风失败文案禁止汉字「允许」**（保 `doesNotMatch(/允许|拒绝|Allow|Deny/)`）。用「请在系统设置中打开 127.0.0.1 的麦克风」。
30. **F-I-4 grep 含** `menu-bar-agent.ts` operate 注入 hunk。`startSummonerWebServer` 早退路径必须 **重绑** `requestOpenSidePanel`（与 dispatch/attachChrome 同一行）。
31. **空态注入：** `empty.innerHTML` 去掉 `${SUMMONER_MIC_SIDEBAR}`。改成 spec 句「回车发送。附件和听写不用开浏览器。」看山：空态加与侧栏同族的 mark（可用纯 CSS 圆 + 「山」，不抄 Gemini 星星）。

---

## File map

| File | Role |
|------|------|
| `companion/src/summoner/shell-open.ts` | `--window-size=400,520` |
| `companion/src/summoner-web.ts` | 单栏卡 CSS/HTML；📎/🎙/会议/④；dispatch+SSE allow；`/api/operate`；隐私屏 |
| `companion/src/summoner/client.ts` | ④ 失败句「请点工具栏 C」；去掉 HTML 用的「听写在侧栏」 |
| `companion/src/ws/summoner-acl.ts` | `meeting.create\|start\|end` **only** |
| `companion/src/ws/validate.ts` | `ui.open_sidepanel` |
| `companion/src/message-router.ts` | `case "ui.open_sidepanel"`；meeting 调用传 `surface` |
| `companion/src/message-router/handlers/ui-open-sidepanel.ts` | **Create.** tray origin → broadcast to extension |
| `companion/src/meeting/meeting-handlers.ts` | create/start/end origin = stt allow |
| `companion/src/menu-bar-agent.ts` | inject `requestOpenSidePanel`；ignore `ui.open_sidepanel` echo |
| `companion/tests/summoner-web.test.ts` | 尺寸/单栏/入口/隐私/operate |
| `companion/tests/overlay-capture-acl.test.ts` | **Create.** ACL + origin |
| `companion/tests/ui-open-sidepanel.test.ts` | **Create.** origin/surface |
| `chrome-extension/src/background/index.ts` | bulk-forward + open side panel |
| `chrome-extension/tests/ui-open-sidepanel.test.ts` | **Create.** SW 源码锁 |
| `PRODUCT.md` `docs/DESIGN.md` | Honesty |

**How tests run:**  
`cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/summoner-web.test.js .test-dist/tests/overlay-capture-acl.test.js .test-dist/tests/ui-open-sidepanel.test.js .test-dist/tests/ws-router-validator-lockstep.test.js`  
`cd chrome-extension && npm test`

---

### Task 1: 单栏卡 + 窗尺寸 + 📎 第一眼

**Files:**
- Modify: `companion/src/summoner/shell-open.ts`
- Modify: `companion/src/summoner-web.ts` CSS + empty + composer row
- Modify: `companion/tests/summoner-web.test.ts`
- Modify: `companion/tests/summoner-shell-open.test.ts`（现断言 `--window-size=720,520`，翻成 400,520）

- [ ] **Step 1: 翻红窗尺寸与网格**

在 `summoner-web.test.ts`「GET / with token → 200 HTML workbench」把

```ts
assert.match(r.body, /var w=720,h=expanded\?520:120/)
```

改成：

```ts
assert.match(r.body, /var w=400,h=expanded\?520:120/)
assert.doesNotMatch(r.body, /grid-template-columns:var\(--rail\) var\(--list\)/)
assert.match(r.body, /\.rail,\.list\{[^}]*display:none/)
assert.doesNotMatch(r.body, /id="operateOpen"|id="meetingStart"/)
assert.doesNotMatch(r.body, /要对这页做什么|当前页：|听写在侧栏|召唤器（实验）/)
assert.match(r.body, /问 CMspark/)
assert.match(r.body, /附件和听写不用开浏览器/)
assert.match(r.body, /<title>CMspark</)
assert.match(r.body, /\.hud\.expanded \.ghosts\{[^}]*display:none/)
```

📎 现有断言（`type="file"` / `for="files"`）保留。`class="rail-btn"` 与 mcp `hidden` **保留**。

- [ ] **Step 2: 跑测确认红**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/summoner-web.test.js
```

Expected: FAIL on `w=400` and grid-template.

- [ ] **Step 3: 改 CSS / placeWindow / shell-open**

`shell-open.ts` args: `` `--window-size=400,520` ``

`summoner-web.ts`：

```css
.body{display:none;flex:1;min-height:0;border-bottom:1px solid var(--line);overflow:hidden}
.hud.expanded .body{display:flex;flex-direction:column}
.rail,.list{display:none}
.main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
```

`placeWindow`: `var w=400,h=expanded?520:120`

空态：`CHAT_SHELL_TITLE_NONE` + 「回车发送。附件和听写不用开浏览器。」**去掉** `${SUMMONER_MIC_SIDEBAR}`。看山 CSS 圆。placeholder「问 CMspark…」。📎 移到 textarea **左侧**。`.hud.expanded .ghosts{display:none}`。`<title>CMspark</title>`。

本任务 **不要** `#meetingStart` / `#operateOpen`，**不要** enable `#mic`。翻 `summoner-shell-open.test.ts` 的 `--window-size=400,520` 并 **git add 该测**。

- [ ] **Step 4: 测绿**

同 Step 2。Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add companion/src/summoner/shell-open.ts companion/src/summoner-web.ts companion/tests/summoner-web.test.ts companion/tests/summoner-shell-open.test.ts
git commit -m "feat(overlay): Capture 单栏卡 400x520 (Refs #241)"
```

---

### Task 2: HTML `voice.stt` + v2 隐私屏

**Files:**
- Modify: `companion/src/summoner-web.ts` allowlists + IIFE mic
- Modify: `companion/src/summoner/client.ts`（HTML 不再注入 `SUMMONER_MIC_SIDEBAR` 作 disabled title）
- Modify: `companion/tests/summoner-web.test.ts`
- Create: `companion/tests/overlay-capture-acl.test.ts`（本任务先写 stt dispatch 段）

- [ ] **Step 1: 翻红**

`summoner-web.test.ts` 把

```ts
assert.match(r.body, /听写在侧栏/)
```

改成：

```ts
assert.doesNotMatch(r.body, /听写在侧栏/)
assert.match(r.body, /id="mic"/)
assert.doesNotMatch(r.body, /id="mic"[^>]*\bdisabled\b/)
assert.match(r.body, /privacy_ack_v2/)
assert.match(r.body, /音频经本机 Companion 写入临时文件/)
```

ACL 测文件 `overlay-capture-acl.test.ts`：

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { SUMMONER_WEB_DISPATCH_ALLOW, SUMMONER_WEB_EVENT_ALLOW } from "../src/summoner-web"

test("voice.stt.start is on HTML dispatch and ALLOW", () => {
  assert.equal(assertSummonerAllowed("summoner", "voice.stt.start").ok, true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("voice.stt.start"), true)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("voice.stt.result"), true)
})

test("list_tabs and ui.open_sidepanel stay off overlay", () => {
  assert.equal(assertSummonerAllowed("summoner", "list_tabs").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("list_tabs"), false)
})
```

`SUMMONER_ALLOW` **不要 export**。只用 `assertSummonerAllowed`。

- [ ] **Step 2: 跑测确认红**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/summoner-web.test.js .test-dist/tests/overlay-capture-acl.test.js
```

Expected: FAIL missing `voice.stt.start` on dispatch；HTML 仍有「听写在侧栏」。

- [ ] **Step 3: 实现**

`SUMMONER_WEB_DISPATCH_ALLOW` 加：`voice.stt.start` `voice.stt.chunk` `voice.stt.end` `voice.stt.abort` `voice.stt.partial_request`  
`SUMMONER_WEB_EVENT_ALLOW` 加：`voice.stt.partial` `voice.stt.result` `voice.stt.error`

HTML：`#mic` 去掉 disabled。`#voicePrivacy` **默认 hidden**。第一次 click 再显示 v2 六条（常量复制到 `companion/src/summoner/client.ts` `VOICE_PRIVACY_ACK_V2_CLAUSES`，与 `privacy-copy.ts` lockstep）。「我已了解」后 `getUserMedia` + **`POST /api/stt/start`**（服务端组 `voice.stt.start`，HTML 不传任意 `type`）。chunk → `/api/stt/chunk`（body cap ≥ 256KiB decoded）。**禁止** `/api/dispatch`。

字段对齐 `validate.ts` voice.stt.start（**`v:1`** `sessionId` `modelId` `format:"pcm_s16le"` `sampleRate:16000` `channels:1` `privacy_ack_v2:true`）。PCM 循环参考 **`chrome-extension/src/sidepanel/voice/local-stt-adapter.ts`**（不在 companion/src）。不要 Plasmo。HTML dictation 会进同一 overlay WS，Swift HUD `mapVoiceSttToSummonerCmd` 可能同步填作曲区——不修 Swift，plan 知情。

未就绪 / `voice.stt.error` code 含 model/binary → `#status`：「侧栏 ⋯ → 设置 → 听写 → 下载组件/模型」。

- [ ] **Step 4: 测绿** 同 Step 2。PASS。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(overlay): HTML 接通本机听写 voice.stt (#241)"
```

---

### Task 3: 会议 create/start/end + 五条隐私

**Files:**
- Modify: `companion/src/ws/summoner-acl.ts`
- Modify: `companion/src/meeting/meeting-handlers.ts`
- Modify: `companion/src/summoner-web.ts` allowlists + `#meetingPrivacy` + start/end
- Modify: `companion/tests/overlay-capture-acl.test.ts`
- Modify: existing `companion/tests/meeting-*.test.ts` origin 测（若有 chrome-extension-only 断言，create/start/end 放行 tray+summoner）

- [ ] **Step 1: 翻红**

```ts
test("meeting.start allowed on summoner; generate_minutes is not", () => {
  assert.equal(assertSummonerAllowed("summoner", "meeting.start").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.end").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.create").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "meeting.generate_minutes").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.start"), true)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("meeting.generate_minutes"), false)
})
```

会议 handler 测（可放同文件）：`handleMeetingMessage({type:"meeting.start", v:1, privacy_ack_v1:true}, {origin:"cmspark-tray://local", surface:"summoner"})` 不得 `origin_denied`。`generate_minutes` + tray origin 仍 `origin_denied`。

无 `privacy_ack_v1` → `need_privacy_ack`。

HTML：`开始会议` 后出现「会创建本地会话产物」五条。

- [ ] **Step 2: 跑红**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/overlay-capture-acl.test.js
```

- [ ] **Step 3: 实现**

`SUMMONER_ALLOW` 加 `meeting.create` `meeting.start` `meeting.end`。

`handleMeetingMessage`：对这三 type 用 `isVoiceSttOriginAllowed(ctx.origin, ctx.surface)`；其他 type 仍 `isChromeExtensionOrigin`。

HTML：**本任务才加** `#meetingStart`「开始会议」。隐私：`#meetingPrivacy` 默认 hidden；本窗若未 ack v2，一屏先六条再五条。然后 `POST` 专用 `/api/meeting/start`（服务端填 type，强制 `audio_retained:false`）。结束钮「结束会议」+ 一句「纪要在侧栏」。`message-router.ts` meeting 调用必须传 `surface: session?.surface`。

- [ ] **Step 4: 测绿**

- [ ] **Step 5: Commit** `feat(overlay): 浮窗开始/结束会议 (#241)`

---

### Task 4: `ui.open_sidepanel` + `/api/operate`

**Files:**
- Create: `companion/src/message-router/handlers/ui-open-sidepanel.ts`
- Modify: `companion/src/ws/validate.ts` `companion/src/message-router.ts`
- Modify: `companion/src/summoner-web.ts` `/api/operate` + ④ click
- Modify: `companion/src/menu-bar-agent.ts` `requestOpenSidePanel` + ignore echo
- Modify: `chrome-extension/src/background/index.ts`
- Create: `companion/tests/ui-open-sidepanel.test.ts`
- Create: `chrome-extension/tests/ui-open-sidepanel.test.ts`

- [ ] **Step 1: companion 翻红**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { handleUiOpenSidepanel } from "../src/message-router/handlers/ui-open-sidepanel"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"

test("not on summoner allow or HTML dispatch", () => {
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
})

test("forged payload origin ignored; session.origin must be tray", async () => {
  const seen: unknown[] = []
  const r = await handleUiOpenSidepanel(
    { origin: "chrome-extension://forged" },
    { origin: "cmspark-tray://local", surface: "tray", broadcast: (d) => seen.push(d) },
  )
  assert.equal(r.type, "ui.open_sidepanel.accepted")
  assert.deepEqual(seen[0], { type: "ui.open_sidepanel" })
})

test("summoner surface denied", async () => {
  const r = await handleUiOpenSidepanel({}, { origin: "cmspark-tray://local", surface: "summoner", broadcast() {} })
  assert.equal(r.error_code, "SUMMONER_ACL")
})

test("extension origin denied (this type is tray→companion)", async () => {
  const r = await handleUiOpenSidepanel({}, { origin: "chrome-extension://abcd", surface: undefined, broadcast() {} })
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_ORIGIN")
})
```

Handler 行为：`surface==="summoner"` → SUMMONER_ACL。`origin` 必须是 `cmspark-tray://local`（tray 自己）。broadcast `{type:"ui.open_sidepanel"}` **无 id、无 token**。无 broadcast → `UI_OPEN_SIDEPANEL_UNAVAILABLE`。

- [ ] **Step 2: 跑红**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/ui-open-sidepanel.test.js
```

- [ ] **Step 3: 实现 handler + validate + router case**

镜像 `overlay-shell.ts` 结构。`validate.ts`：

```ts
"ui.open_sidepanel": () => ({ valid: true }),
```

无必填字段。

- [ ] **Step 4: `/api/operate`**

`summoner-web.ts` 在 `/api/attach` 旁：

```ts
if (pathOnly === "/api/operate" && req.method === "POST") {
  const attach = activeAttachChrome ?? defaultAttachChrome
  const message = attach({ foreground: true })
  if (!activeRequestOpenSidePanel) {
    jsonResponse(res, { type: "error", error: "请点工具栏 C", error_code: "UI_OPEN_SIDEPANEL_UNAVAILABLE" }, 503)
    return
  }
  const r = await activeRequestOpenSidePanel()
  if (r && r.error_code) {
    jsonResponse(res, { type: "error", error: "请点工具栏 C", error_code: r.error_code, attach: message })
    return
  }
  jsonResponse(res, { type: "ok", message })
  return
}
```

`startSummonerWebServer` opts 加 `requestOpenSidePanel?: () => Promise<{ error_code?: string }>`。menu-bar-agent 打开 HTML 壳时注入：tray `companionClient.send({ type: "ui.open_sidepanel" })` 并等待 companion 回 `ui.open_sidepanel.accepted` 或 error（**带 id 的 RPC**，不要用无 id 广播当请求）。

注意：tray **`sendAppRequest`**（有 id）；companion **再**无 id 广播给扩展。Tray `onAppMessage` **忽略**无 id 的 `ui.open_sidepanel` echo。`requestOpenSidePanel` 在 `startSummonerWebServer` **早退重绑**（与 dispatch 同一处）。无扩展 peer → 503。catch `sendAppRequest` reject。

④：**本任务才加** `#operateOpen`「打开浏览器并打开侧栏」。`api("/api/operate",{method:"POST"})`；error → `#status` = `请点工具栏 C`。`summoner-web.ts` **不得**出现字面量 `ui.open_sidepanel`。错码 `OPERATE_SIDEPANEL_UNAVAILABLE`。

- [ ] **Step 5: 扩展翻红**

`chrome-extension/tests/ui-open-sidepanel.test.ts`：**切开 `handleCompanionMessage` 函数**（对标 `chat-shell-popout.test.ts:51-57`）：

```ts
assert.match(companionHandlerSlice, /ui\.open_sidepanel/)
assert.match(companionHandlerSlice, /sidePanel\.open\(\s*\{\s*windowId/)
assert.match(bulkForwardSlice, /case "ui.open_sidepanel"/)
```

Toast「请点工具栏 C」锁在 **HTML / `/api/operate`**，不锁 SW。未知类型：`useWebSocket` 忽略 `ui.open_sidepanel` 推送（同 overlay.shell.open echo）。

`useWebSocket` **忽略** companion 推送的 `ui.open_sidepanel`（与 overlay.shell.open echo 相同），避免当未知类型。

- [ ] **Step 6: SW 实现**

bulk-forward 白名单加 `ui.open_sidepanel`（侧栏误发也会进 companion，handler 会因 extension origin 拒 → 不错成打开）。

`handleCompanionMessage`：`msg.type==="ui.open_sidepanel"` → `chrome.tabs.query({active:true,lastFocusedWindow:true})` → `chrome.sidePanel.open({windowId})`。catch 吞掉（浮窗已有失败通道）。

- [ ] **Step 7: 测绿 + F-I-4 grep**

```bash
rg -n "openSidePanel\(|chrome\.sidePanel\.open" companion/src/message-router/handlers/ui-open-sidepanel.ts companion/src/summoner-web.ts
```

Expected: no matches.

- [ ] **Step 8: Commit** `feat(overlay): 打开浏览器并打开侧栏 (#241)`

---

### Task 5: PRODUCT / DESIGN honesty

**Files:** `PRODUCT.md` `docs/DESIGN.md`

- [ ] 浮窗 = Capture 卡片四件事；HTML 听写不再「在侧栏」；④ 成功=扩展 SW 开侧栏，失败「请点工具栏 C」；Mac 热键仍旧条；F-I-4：Companion 不调 chrome.*。
- [ ] Commit `docs(overlay): Capture 卡片 honesty for #241`

---

## Spec coverage

| SoT | Task |
|-----|------|
| 单栏卡 / 400×520 / 无页芯片 | 1 |
| 📎 第一眼 | 1 |
| voice.stt HTML + v2 | 2 |
| meeting ACL + origin + 五条 | 3 |
| ④ F-I-4 修正 | 4 |
| 失败 toast | 4 |
| 文档 | 5 |
| 永不 Allow/Deny / list_tabs | 2–4 测 |

## Eval gate card — slice-241-plan

**Blast tier:** T3  
**Capability:** 见文首声明  

实现前：本 plan 独立对抗 → Claude+Pi dual `both_ok`。实现后：机核绿 → 对抗 → Pi → CI。禁止实现会话自评 merge-ready。
