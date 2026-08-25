# Adversary review (Product / UX) — NSPanel restore after HTML `--app` reject

**Batch**: `overlay-nspanel-restore-20260825`  
**Role**: independent Product/UX skeptic (did **not** implement)  
**Lane**: user said 类似 Raycast/uTools 悬浮窗 after rejecting Chromium `--app`  
**Evidence**: `[inspected]` source. Machine suite green is **not** a product pass.  
**Blast**: T2 product IA.

```text
Surface:      L0 overlay HUD restore (Darwin NSPanel) + L0 Side Panel markdown/pack
L2-classes:   (none)
Compose:      pack apply via overlay rail; knowledge USE only via thread ids
Autonomy:     n/a
Trust:        overlay ACL must not grow; no confirm dialect
Channel:      community
```

---

## Claim under test

“Mac 快捷提问 is now a Raycast/uTools-like floating HUD.”

**Falsified.** Darwin is a **titled 640pt mini workbench** (traffic-light NSPanel + 200pt 对话/MCP/场景 rail + transcript + 发送). That is Side Panel shrink, not a one-bar HUD. Comments that say “Raycast/uTools 形态” are a **product lie**.

---

## Must-answer questions

### 1. One-bar launcher or mini titled workbench?

**Mini titled workbench.**

- `SummonerOverlay.swift:1029-1038` — `styleMask = [.titled, .closable, .nonactivatingPanel]`, title `CMspark 召唤器（实验）`, width **640**, min height 140.
- `SummonerOverlay.swift:966-1000` — `makeRail()` **200pt**: 对话 / MCP / 场景.
- `SummonerOverlay.swift:1437-1444` — horizontal root: rail + main stack.
- `Tray.swift:374-376` — comment stamps the rejected metaphor on `summonerController.open(threadId: "")`.

**[inspected]**

### 2. Does painting 📎/🎙 = dogfood Q1 fixed?

**No. Chrome ≠ path.**

- 🎙 path exists (hold-to-talk → `summoner.mic.*` → `voice.stt.*`) but tooltip vs 0.35s latch is dishonest.
- 📎 is a **user-visible lie (BLOCK)**: `attachFilesClicked` always sends `"type": ""` (`SummonerOverlay.swift:646-664`). Overlay mapper does not handle `file.upload_error`. User: picker → HUD unchanged.

**[inspected]** (Impl lane executed the MIME reject.)

### 3. Did restoring NSPanel re-introduce the mini-chat + rail IA?

**Yes — same IA, native paint, extra rails.** HTML 220px 对话 rail + log + composer was rejected. NSPanel re-ships it and **adds** MCP/场景. Native vs Chromium is **not** the distinction the user named.

### 4. Knowledge Q4 — CONFIGURE refused? Overpromise?

**CONFIGURE still refused.** ACL has no `knowledge.*`. Swift overlay has **zero** knowledge UI. Darwin hint (`summonerTalkHint`) has **no** 「配置去侧栏」 line that HTML has. MCP copy 「这里可直接调用」 overreaches.

### 5. Outcome DoD — would a Raycast-wanting user still complain?

**Yes.** Named closable 640 window, left app rail, chat log + 发送, 📎 that does nothing visible, comments claiming Raycast.

---

## Findings

### BLOCK

1. **IA is workbench, marketed as HUD.** `Tray.swift:375` / `swift-tray-bridge.ts:58`.
2. **📎 painted success, broken honesty.** Empty MIME + no HUD mapping of `file.upload_error`.
3. **Rejected IA restored then fattened.**

### NIT

4. Slice A (markdown breaks + pack radio) looks done — not this HUD.
5. Mac lost knowledge honesty copy that HTML has.
6. 🎙 tooltip vs latch; leftover hidden `ctaBox`/`attachButton`.
7. `NSApp.activate(ignoringOtherApps: true)` fights `.nonactivatingPanel`.

---

## Layers

- **Outcome**: user wanted a fast floating command bar. Tree delivers mini-CMspark. Fail.
- **Trajectory**: correct next move after `--app` reject was **thin the native HUD**. Actual: restore fat NSPanel and write Raycast on the comment.
- **Component**: Darwin NSPanel overgrown; ACL did not grow `knowledge.*`.

VERDICT: REJECT
