# Adversary review (External / spec-honesty) — Overlay HUD Expand B0.5

**Batch**: `overlay-hud-expand-b05`  
**Role**: independent spec-honesty skeptic (did **not** implement; not security/product/impl lane)  
**Spec**: `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md` §2 item 1 / 实现波次 B0.5  
**Prompt**: `docs/audit/reviews/overlay-hud-expand-b05-dual-review-prompt-20260825.md`  
**HEAD**: `2dee37ac` (`feat/knowledge-honesty-wave0`) — B0.5 lives in the **working tree**, not HEAD  
**Evidence**: `[executed]` pin + tsx tests; `[inspected]` ACL / lifecycle / Swift / HTML / router

---

## Review scope (do not merge the rest)

Working tree is a **mixed overlay of several days**, not a B0.5 commit. Do **not** require this review to bless or merge unrelated MM / staged files.

| In scope (B0.5 + HUD it sits on) | Out of scope |
|---|---|
| `companion/src/ws/summoner-acl.ts` | `chrome-extension/**` (`ChatView.tsx`, `PacksPanel.tsx`, `markdown-breaks.test.ts`) |
| `companion/src/ws/lifecycle.ts` | Staged dogfood Slice A/B docs + `142137` verdicts |
| `companion/src/summoner/protocol.ts` | `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md` |
| `companion/src/menu-bar-agent.ts` | Knowledge-honesty Wave 0–2 product work on this branch |
| `companion/src/summoner-web.ts` | |
| `companion/src/tray/SummonerOverlay.swift` | |
| `companion/src/tray/swift-tray-bridge.ts` | |
| `companion/tests/summoner-thread-manage.test.ts` (untracked) | |
| related summoner tests / `client.ts` hits sort | |

`git status`: several **MM** files (`Tray.swift`, `summoner-web.ts`, `swift-tray-bridge.ts`, overlay/web tests). Index still holds earlier Slice-B / C-thin pin leftovers (B0 nit). That is a **commit hazard**, not a B0.5 functional blocker. Re-stage B0.5 files together; leave Chrome Slice A alone.

---

## 1. Outcome — did B0.5 actually ship what it claims?

DoD vs tree. REJECT gates R1–R6 checked.

### DoD 1–2 — rename + trash, not hard-delete

**Holds.** Overlay stdin is `summoner.thread.rename` / `summoner.thread.trash` only (`protocol.ts:105-106`, decode `510-516`). Menu-bar maps those to `thread.update { alias }` and `thread.delete { mode: "trash" }` (`menu-bar-agent.ts:1172-1228`, inbound `1312-1316`).

`applySummonerPayloadPolicy` (`summoner-acl.ts:71-79`) **rejects** overlay `thread.delete` when `mode !== "trash"` (omitted and `"hard"`). No silent coerce to trash on the WS summoner surface. Router default remains hard for tray (`message-router.ts:1606-1608`; test name `thread.delete default hard; explicit trash soft` still in `thread-cleanup-context.test.ts:260`).

HTML DELETE **hardcodes** `mode: "trash"` (`summoner-web.ts:430-437`) then runs the same policy (`dispatchAllowed` `161-169`). A client cannot smuggle hard-delete through that route.

**R1 not triggered.**

### DoD 3 — `thread.update` alias-only

**Holds.** Policy rebuilds `msg.updates = { alias }` after sanitizing (`summoner-acl.ts:81-99`). Empty / whitespace alias → `SUMMONER_ACL`. Extra keys (`tool_whitelist`, `active_knowledge_ids`, and by the same strip `config_override`) are dropped when an alias is present; keys-only payloads are rejected.

HTML PATCH only forwards `body.alias` (`summoner-web.ts:418-427`). Test sends `{ alias, tool_whitelist: null }` and asserts dispatched updates `{ alias: "周报" }` `[executed]`.

**R2 not triggered.** Explicit `config_override` case is not named in tests; the strip is total, so this is coverage nit not a hole.

### DoD 4 — Mac HUD ⋯ / 右键 + NSAlert, no Allow/Deny

**Holds.** `SummonerOverlay.swift:385-448`: ⋯ button, right-click on the title (`sendAction` left+right), `NSMenu` 「重命名」「移到回收站」, `NSAlert` + accessory field / two buttons 「重命名|移到回收站」+「取消」. Overlay source has **zero** `确认|允许|拒绝|Allow|Deny` `[inspected]` `[executed]` overlay + thread-manage scans.

Cancel is `取消`, not the banned 确认 dialect. Confirm stays native `runModal`, not `summoner.confirm.*`.

**R3 not triggered** for HUD chrome.

### DoD 5 — C-thin HTML PATCH/DELETE + buttons

**Holds as a Companion HTTP surface.** Buttons 「重命名」「移到回收站」 (`summoner-web.ts:650-676`); `window.prompt` / `window.confirm` as spec allows for HTML. Origin+Host gated; PATCH/DELETE listed on CORS (`341-357`).

### DoD 6 — after trashing current, switch or create

**Mac: holds.** `handleSummonerThreadTrash` (`menu-bar-agent.ts:1222-1228`) re-lists, takes `hitsFromTitleSearch(remaining)[0]` (now **sorted** `updated_at` desc — `client.ts:76-81`, B0 unsorted nit **folded**), else `handleSummonerNewThread`. `thread.list` defaults to active only (`message-router.ts:1853-1869`), so the just-trashed row is gone.

**HTML: weaker.** After DELETE, `refresh()` then `threads[0]` or `#newThread.click()` (`summoner-web.ts:670-675`). `thread.list` order is `index.threads` (`thread-manager.ts:656-660`), which **unshifts on create** (`570`) and does **not** re-order on `updated_at`. HTML “最近一条” = newest-created still in the index, not last-touched. Mac/HTML lockstep on DoD 6 is not byte-identical. Not R5 (it does switch); honesty nit.

### DoD 7 — pin lockstep

**Holds `[executed]`.**  
`SWIFT_TRAY_SHA256` (`swift-tray-bridge.ts:59`) = `shasum -a 256 companion/dist/cmspark-tray` =  
`e068754969612ff74341cbd12719d7358e1301960396caf610252869e1bd0a3e`.  
Binary mtime 17:25, overlay source 17:24. **R4 not triggered.**

Comment above the pin still says “无左轨” (`swift-tray-bridge.ts:58`) — stale vs B0 52pt rail. Cosmetic.

### DoD 8 / R6 — no knowledge.* / mcp.add / overlay confirm dialect / restore / batch

**Holds.** `SUMMONER_ALLOW` grew **only** `thread.delete` + `thread.update` (`summoner-acl.ts:22-23`). Still has pre-existing `pack.apply` / `mcp.list` (B0/B1-eligible, not this slice’s new Trust). No `knowledge.*`, `mcp.add`, `thread.restore`, `thread.batch_delete`. HTML `SUMMONER_WEB_DISPATCH_ALLOW` matches (`summoner-web.ts:19-36`); web test still asserts `knowledge.import/list/preview` and `mcp.add` absent `[executed]`.

**R6 not triggered.** Latent HTML `POST /api/packs/apply` (`summoner-web.ts:487-499`) is **not** new B0.5 UI and is not R6; see trajectory.

### Tests `[executed]`

`npx tsx --test` on summoner-thread-manage + web + protocol + overlay + talk + client: **155 pass / 0 fail**. Includes the eight B0.5 contract tests. Dual-prompt “131” is a different file set, not a contradiction.

Caveat: most B0.5 tests are **source greps + HTTP contract**, not a live NSPanel click. Honest residual, not a REJECT gate.

---

## 2. Trajectory — over-claim, scope creep, leftover B0

### “脱离浏览器插件” — Mac AND HTML, not the whole workbench

**True for B0.5 thread management data path. False if quoted as the §0 product lock.**

Spec §0 (`overlay-hud-expand-design.md:30`): 对话管理、场景、知识、技能、MCP **不经过扩展**. That is the **full expand program**. B0.5 only delivers §2.1 rename+trash.

| Surface | Thread rename/trash without Side Panel? | Still a browser / plugin? |
|---|---|---|
| **Mac HUD** | Yes. stdin → menu-bar → summoner WS (`cmspark-tray://local`). No `chrome-extension://`. Overlay copy **forbids** `去侧栏` (`summoner-overlay.test.ts:110-114`). | Native `NSPanel`. Not Chromium `--app`. **Honest.** |
| **C-thin HTML** | Yes for the API: loopback HTTP → `summonerClient.sendAppRequest` (`menu-bar-agent.ts:1406-1423`, `1438-1439`). Page never upgrades companion WS (`summoner-web.ts:1-6`). | Still a **browser**. `shell-open.ts:1-5,52-56` prefers Chromium/Edge `--app`. Darwin `handleAction "summoner"` still opens this HTML shell (`menu-bar-agent.ts:1469-1470`) for Win/Linux / non-Swift trays. **Not the plugin; still Chrome-the-browser.** |

HTML **product copy is still Side-Panel-bound** for everything except threads:

- badge 「批准在侧栏」 (`summoner-web.ts:599`)
- hint 「听写/知识配置/批准去侧栏处理」 (`610`, `698-699`)
- web tests **lock that copy in** (`summoner-web.test.ts` asserts `/听写\/知识配置\/批准去侧栏处理/` and `/去侧栏处理/`)

So: **do not claim the HTML workbench “脱离浏览器插件”.** Claim: HTML can rename/trash without the extension. Dictation / knowledge CONFIGURE / approve still tell the user to go to the Side Panel. That is honest deferral of B2–B4, not B0.5 delivery of §0.

Mac MCP confirm copy still says 「MCP 工具需在 Chrome 侧栏批准」 (`client.ts:359-364`). Spec wants **tray** native confirm, not overlay Allow/Deny and not Side Panel. Residual from earlier slices; does **not** block rename/trash; do not let B0.5 PR text pretend confirm already left Chrome.

### Scope creep — B1 packs / knowledge CONFIGURE

**No B1 pack apply chrome on the HUD.** Rail non-对话 still 「这一类下一刀开放」 (`SummonerOverlay.swift:485-488`). `applyPacks` remains a no-op. Overlay has no `pack.apply` / `knowledge.*` `[inspected]`.

**No overlay knowledge CONFIGURE.** ACL unchanged for `knowledge.*`. HTML copy still 知识配置去侧栏. That is the opposite of shipping B4 T3 on overlay.

**Latent B1 HTTP:** `POST /api/packs/apply` is still live on the C-thin server and still tested. Pre-existing overlay-eligible `pack.apply` on both ACLs (`summoner-acl.ts:36`, web allowlist `:31`). Not a B0.5 Trust bump, not R6. Do not describe B0.5 as “packs stayed off the wire” — the HTML origin can still apply a pack if someone POSTs. HUD cannot.

`handleSummonerPackApply` still wired from stdin (`menu-bar-agent.ts:1321-1322`). Dead for B0 HUD (overlay does not emit it). Fine as B1 hook; not this slice’s feature.

### Leftover B0 nits — what this slice **should** have folded

Folded because it **would** have broken DoD 6 on Mac:

- `hitsFromTitleSearch` now `sortRecentFirst` (`client.ts:76-81`). B0 left list order = `thread.list` dump. B0.5 trash-current depends on “最近”. **Correctly folded.**

Did **not** need folding for thread management:

- Stale **MM index** / Slice-B pin `367b3e29` (B0 both-AWN nit). Commit hazard only.
- `applyPacks` / `applyMcp` no-ops; dead `sendButton`. B1+.
- Overlay height 810pt; rail `slice(0, 8)` vs UI `prefix(12)` (`menu-bar-agent.ts:787`, `SummonerOverlay.swift:350`). Search `#` still finds others. Does not block rename/trash of visible rows.
- 📎 size cap only in Swift. Unrelated to threads.

`canBecomeKey` (B0) is a **dependency** for the rename `NSTextField` (`SummonerOverlay.swift:90` / overlay test). Still present. If it had been dropped, B0.5 rename would have been a keyboard-dead alert — it was not dropped.

### Over-claim in the machine card

- “C-thin HTML can rename and trash **without Chrome**” is the **test title** (`summoner-thread-manage.test.ts:152`). The test greps source. It does not prove Chrome-the-process is absent. `[inspected]` over-naming.
- “DELETE … **ignores hard**” (`summoner-web.test.ts`) never sends a hard body; the handler ignores the body entirely. Behavior is safe; the test name over-claims what it proved.
- Dual prompt “131 pass” — this tree’s summoner subset is 155 green via tsx. Don’t treat 131 as SoT.

---

## 3. Component — file:line residual risks

| Sev | Where | Risk |
|---|---|---|
| NIT | `summoner-web.ts:670-675` vs `client.ts:76-81` | HTML post-trash picks `threads[0]` (create-unshift order). Mac picks last-`updated_at`. DoD 6 wording “最近一条” is Mac-true, HTML-loose. |
| NIT | `summoner-web.ts:599,610` + web tests locking `去侧栏` | HTML workbench still advertises Side Panel for 听写/知识/批准. Fine for B0.5 **if** PR text does not say §0 is done. |
| NIT | `summoner-web.ts:487-499` | C-thin can still `pack.apply`. Not HUD. Don’t sell “no packs on overlay surfaces.” |
| NIT | `client.ts:359-364` | Overlay error copy still sends MCP approve to **Chrome 侧栏**, not tray NSAlert. Spec: tray confirm. Not thread-mgmt. |
| NIT | `swift-tray-bridge.ts:58` | Pin comment “无左轨” is false after B0. Hash itself matches `[executed]`. |
| NIT | MM index (`Tray.swift`, `swift-tray-bridge.ts`, …) | `git commit` without re-add can land rejected C-thin pin. Operational, not a B0.5 logic bug. |
| NIT | `summoner-thread-manage.test.ts` | Lifecycle/menu-bar/HUD checks are regex on source. No live click-through of NSAlert → trash → hydrate. |
| residual | CDP tools | Webpage computer-use still needs the extension. Spec said so. Thread rename/trash does not. |

No component finding that overlay can hard-delete, write `tool_whitelist` / knowledge ids, or grow ACL to `knowledge.*` / `mcp.add` / restore / batch.

---

## Verdict rationale

B0.5’s **narrow** claim is true: Companion-owned rename + trash on Mac HUD **and** C-thin HTML, overlay-safe payload policy, pin lockstep, no overlay Allow/Deny, no knowledge CONFIGURE, no B1 pack chrome on the HUD. R1–R6 stay dark.

What is **not** true, and must not ride this batch’s merge text:

1. Spec §0 “场景、知识、技能、MCP 不经过扩展” is **not** done.  
2. HTML is **not** “脱离浏览器”; it is “脱离扩展” for thread APIs only.  
3. Unrelated MM Chrome / Slice-A files are **not** part of B0.5.

Nits are honesty, HTML/Mac recency mismatch, latent pack HTTP, and commit hygiene — none of them make overlay hard-delete or Side-Panel-only thread management.

VERDICT: APPROVE_WITH_NITS
