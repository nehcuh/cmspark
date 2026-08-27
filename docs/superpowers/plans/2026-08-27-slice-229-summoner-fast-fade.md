# Slice #229 — 召唤器只修快与淡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GitHub:** [#229](https://github.com/nehcuh/cmspark/issues/229)  
> **SoT:** [product-form-deepening](../specs/2026-08-26-product-form-deepening-design.md) §5 / §11 P2 · [summoner-strategy-rethink](../specs/2026-08-26-summoner-strategy-rethink-design.md) §3.6  
> **Blast:** **T2**（L0 Capture 体感；无新 L2；overlay ACL 不涨）  
> **未 dual 不得实现。**

**Goal:** 热键弹出的是收起作曲条，不把前台从 Chrome/Codex 抢走；Esc / 再按热键能把条拿掉。不完成 WorkBuddy 五轨。

**Architecture:** Mac HUD 已经是 `.nonactivatingPanel` + `canBecomeKey`，但 `open()` 仍 `NSApp.activate(ignoringOtherApps: true)`，等于整只 CMspark 抢前台——这是「慢」和「淡不掉」（关条后还停在 CMspark）的根。Capture 路径只 `makeKeyAndOrderFront`，不 `NSApp.activate`。模态 `NSAlert`/`NSOpenPanel`（重命名 / 回收站 / 被藏的导入）可以保留 activate。Win/Linux 仍 C-thin HTML `--app`，本刀不改成原生 HUD。

**Tech Stack:** Swift `SummonerOverlay.swift` + 既有 `companion/tests/summoner-overlay.test.ts` 源码契约；`build-tray.sh` + `SWIFT_TRAY_SHA256`。

```text
Surface:      L0 Capture 召唤器（Mac HUD 为主）
L2-classes:   none
Compose:      none（不涨 overlay WS）
Autonomy:     n/a
Trust:        overlay 永不 Allow/Deny；不碰 confirm originWs
Channel:      community
```

---

## NEVER（本刀）

- 展开工作台；第六轨；把 MCP / 导入知识拉回铬
- overlay Allow/Deny；`knowledge.get` / `mcp.add` 进 overlay WS
- 用 overlay 管 MCP 掩盖 F-S-10（#230）
- Win 原生 HUD / 合并双壳
- CSS 淡出当产品（「淡」= 不抢前台、关得掉）
- 改 live `config.json`

---

## File map

| File | Role |
|------|------|
| `companion/tests/summoner-overlay.test.ts` | 源码契约：`open(threadId:)` 体不含 `NSApp.activate`；热键可见则 `hide`；仍 `nonactivatingPanel` |
| `companion/src/tray/SummonerOverlay.swift` | 实现 |
| `companion/src/tray/swift-tray-bridge.ts` | `SWIFT_TRAY_SHA256` 与重编二进制 lockstep |
| `companion/tests/summoner-workbench-compose.test.ts` | 回归：MCP hide-not-delete、`展开对话` |

不改：`SUMMONER_ALLOW` / `SUMMONER_WEB_DISPATCH_ALLOW`、HTML 壳、grant、确认台。

---

### Task 1: 红测 — Capture `open` 不得抢前台

**Files:**
- Modify: `companion/tests/summoner-overlay.test.ts`（文件末尾加测）
- Modify: 不改 Swift（本任务只红）

- [ ] **Step 1: Write the failing test**

在 `summoner-overlay.test.ts` 末尾追加（沿用文件里已有的 `srcFile` / `fs`）：

```ts
test("#229: Capture open does not NSApp.activate; hotkey toggles hide", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const openStart = overlay.indexOf("func open(threadId:")
  const openEnd = overlay.indexOf("func hide()")
  assert.ok(openStart >= 0 && openEnd > openStart, "open(threadId:) / hide() missing")
  const openBody = overlay.slice(openStart, openEnd)
  assert.match(openBody, /makeKeyAndOrderFront/)
  assert.match(openBody, /makeFirstResponder\(composer\)/)
  assert.match(openBody, /do NOT call NSApp\.activate|must not steal/)
  assert.doesNotMatch(
    openBody,
    /NSApp\.activate\(/,
    "Capture open must not steal the front app; comment may mention NSApp.activate",
  )
  const hkStart = overlay.indexOf("func openFromHotKey()")
  const hkEnd = overlay.indexOf("@objc func hotkeyCandidateClicked")
  assert.ok(hkStart >= 0 && hkEnd > hkStart)
  const hk = overlay.slice(hkStart, hkEnd)
  assert.match(hk, /overlayVisible/)
  assert.match(hk, /hide\(\)/)
  assert.doesNotMatch(hk, /NSApp\.activate\(/)
  assert.match(overlay, /\.nonactivatingPanel/)
})
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/summoner-overlay.test.js
```

Expected: `#229: Capture open does not NSApp.activate` **FAIL** — `openBody` 现含 `NSApp.activate(ignoringOtherApps: true)`（约 `SummonerOverlay.swift:258`）。其它旧测仍绿。

- [ ] **Step 3: Commit the red test**

```bash
git add companion/tests/summoner-overlay.test.ts
git commit -m "test(summoner): Capture open must not NSApp.activate (#229)"
```

---

### Task 2: 绿 — 从 `open(threadId:)` 拿掉 activate

**Files:**
- Modify: `companion/src/tray/SummonerOverlay.swift` `open(threadId:)` only
- Test: 同上

- [ ] **Step 1: Minimal implementation**

`open(threadId:)` 现为（节选）：

```swift
    applyPhase()
    NSApp.activate(ignoringOtherApps: true)
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    window.makeFirstResponder(composer)
```

改为（注释抄 Confirm HUD，禁止再贴回 activate）：

```swift
    applyPhase()
    // CRITICAL: do NOT call NSApp.activate here. Capture bar is
    // .nonactivatingPanel — steal front app = 慢 / 淡不掉 (#229).
    window.center()
    window.makeKeyAndOrderFront(nil)
    window.orderFrontRegardless()
    window.makeFirstResponder(composer)
```

**留下**（不要删）这些 `NSApp.activate`：

| 调用点 | 为何留 | 用户能看见？ |
|--------|--------|----------------|
| `promptRename` / `promptTrash` | `NSAlert.runModal` 需要 key app | 仅展开对话后的 ⋯ |
| `attachFilesClicked` 📎 | 收起条上的 Capture 手势；注释写 `begin()` 在非 key HUD 上常静默 | **可见**（不是藏入口） |
| `micHoldChanged` 🎙 | TCC / 按住听写 | **可见**；关条后若仍停在 CMspark = **#229 残留 nit**，本刀不重写 TCC |
| `mcpAddClicked` / `knowledgeImportClicked` | 模态；铬 `isHidden = true` | 藏 |

Capture 热键 `open(threadId:)` **不得** activate。在 `open` 上抄 Confirm HUD 注释（`Tray.swift` ConfirmController：「do NOT call NSApp.activate」）。

**不要**改 `hidesOnDeactivate`（非激活面板本来就不该靠 deactivate 藏）。关条路径仍是 `hide()` → `orderOut` + `openFromHotKey` 可见则 hide。

- [ ] **Step 2: Re-run overlay tests**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/summoner-overlay.test.js .test-dist/tests/summoner-workbench-compose.test.js
```

Expected: PASS（含 #229 新测；MCP `isHidden`、`展开对话` 仍在）。

- [ ] **Step 3: Rebuild Swift tray and pin SHA**

```bash
bash companion/src/tray/build-tray.sh
# print SHA256 from script output
```

把 `companion/src/tray/swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256` 换成新哈希（与 `companion/dist/cmspark-tray` 一致）。

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/swift-tray-integrity.test.js
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add companion/src/tray/SummonerOverlay.swift companion/src/tray/swift-tray-bridge.ts companion/dist/cmspark-tray
git commit -m "fix(summoner): do not NSApp.activate on Capture open (#229)"
```

（若 `dist/cmspark-tray` gitignore，只提交源码 + SHA 常量；二进制由 `build-tray.sh` 在 CI/本机编。）

---

### Task 3: 回归锁 + 文档

**Files:**
- Modify: none unless copy 测红
- Optional T0: `docs/superpowers/specs/2026-08-27-post-227-status.md` 一行「#229 实现中」——实现合后再改

- [ ] **Step 1: Copy + ACL 回归**

```bash
cd companion && node --test .test-dist/tests/summoner-workbench-compose.test.js .test-dist/tests/summoner-acl.test.js
```

Expected: PASS。`展开工作台` 仍不得出现；`SUMMONER_ALLOW` 不新增长。

- [ ] **Step 2: Commit only if 测有改**

无代码则跳过。

---

## DoD（外部可观察）

1. 热键开条：前台仍是 Chrome/Codex（不跳到 CMspark.app）；条可输入。**机核 = 源码契约；DoD 1 前台须 Mac 热键对着 Chrome 狗食一眼**（regex 看不见 Dock）。
2. 再按热键或 Esc：条 `orderOut`，不 abort 正在跑的一轮。
3. 默认仍是收起作曲条；展开仍是「展开对话」/ 对话列表，不是工作台。
4. MCP 轨 / ＋导入知识仍藏。
5. overlay 无 Allow/Deny。
6. `SWIFT_TRAY_SHA256` 与本刀 Swift 产物 lockstep。

## 闸门

T2：机核（上述 test）→ **独立对抗** → **Pi 复审**。实现 agent 不自 APPROVE。
