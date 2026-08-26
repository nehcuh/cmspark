# Adversary review (external / eval-gate) — overlay-post222-residual-fix

**Batch:** `overlay-post222-residual-fix`  
**Lane:** independent external / eval-gate (no production edits; did not read `overlay-post222-residual-fix-adversary-*.md`)  
**HEAD (git ref):** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`origin/main`; branch `fix/overlay-post222-residual`)  
**Base:** `a58b78f` Merge `fix/windows-tray-nodepath` into main  
**Working tree:** uncommitted fold vs `a58b78f`  
**Diff:** `docs/audit/reviews/overlay-post222-residual-fix-diff-20260826.patch` (10 files)  
**Prior REJECT:** `overlay-post222-residual-verdict-20260826-093708.json` (Claude+Pi REJECT; R5 merge clobber of `03de168` HUD + I1/I2)

Evidence tags: `[executed]` ran the binary/tests; `[inspected]` read the path; `[assumed]` not verified here.

```text
Surface:      Darwin HUD = Swift NSPanel C-thin; Win/Linux = loopback HTML --app
L2:           tray showConfirmDialog; overlay must not grow Allow/Deny
Compose:      overlay-safe SUMMONER_ALLOW + applySummonerPayloadPolicy
Trust:        monotonic; knowledge.import / mcp.add off overlay WS
Channel:      CDP still needs Chrome
```

---

## MACHINE (before claims)

This lane's tool surface had **no shell**. The claimed kernel was **not re-run**. Nothing below is `[executed]`. Dual must not inherit a fake green.

```text
Claimed kernel (NOT re-executed here):
  cd companion && npx --offline tsx --test \
    tests/summoner-web.test.ts tests/summoner-shell-open.test.ts \
    tests/summoner-workbench-compose.test.ts tests/summoner-acl.test.ts \
    tests/knowledge-active-ids.test.ts tests/summoner-overlay.test.ts \
    tests/summoner-thread-manage.test.ts tests/swift-tray-integrity.test.ts
  Claimed: 114 + 4 integrity = green

  shasum -a 256 companion/dist/cmspark-tray
  Claimed: 57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052
```

**Static machine-vs-tree alignment** `[inspected]`:

| Check | Live tree | Lock test |
|---|---|---|
| HEAD ref | `a58b78f` | branch has no extra commit; fold is WT |
| Patch files | **10** (agent, router, summoner-web, protocol, shell-open, Overlay.swift, swift-tray-bridge, 3 tests) | matches claimed scope |
| `summoner-web.ts` HTML | `--paper:#fff`, `.rail-btn`, `.list-scroll`, `placeWindow(false)`, **no** `#12141c`, `class="hud"` not `class="hud expanded"` | `summoner-web.test.ts:112-126` **strengthened** (added flex / list-scroll / composer `flex-shrink:0`); still forbids `#12141c` |
| I1/I2 HTML | `on:!on` (`summoner-web.ts:1057`), `ids:next` (`:1075`); grep finds **no** `on:true` / `ids:[id]` / `#12141c` in this file | `summoner-web.test.ts:542-547` still asserts `on:!on` + `ids:next` and `doesNotMatch` `on:true` / `ids:[id]` |
| Window | `shell-open.ts:55` `--window-size=720,120` | `summoner-shell-open.test.ts:71` **unchanged** (source retargeted to the lock, not the reverse) |
| I6 | router `:2625-2630` `dropped`; test added at `knowledge-active-ids.test.ts:260-275` | fail-closed `ghost-id` not attached; `dropped:["ghost-id"]` |
| I5/I3 locks | new tests in `summoner-workbench-compose.test.ts:155-176` | `listScroll.documentView = tStack`; `doesNotMatch prefix(12)`; knowledgeImport body has `只支持文本知识` and **no** `base64EncodedString` |
| Claimed 114+4 | `test(` count in the 8 files = **118** (27 web + 8 shell-open + 9 workbench + 11 acl + 9 knowledge-active + 42 overlay + 8 thread-manage + 4 integrity) | arithmetic matches the claim `[inspected]` |

**Residue that is *not* the claimed tsx kernel:**

- `companion/.test-dist/` is **pre-fold** `[inspected]`: HTML still `#12141c` + `800,720` + pin `ed4dbfa0…`; no `dropped`; no new I3/I5 tests. That is last `tsc -p tsconfig.test.json` / `npm test`, not `tsx`.
- `companion/dist/*.js` is **older still** `[inspected]`: `dist/summoner-web.js:508` `#12141c` / `height:100vh` (pre-`dfab3eb`); `dist/summoner/shell-open.js:78` `--window-size=640,720`; `dist/tray/swift-tray-bridge.js:55` pin `9716da43…`; `dist/menu-bar-agent.js:736` still `slice(0, 8)`. `npm start` = `node dist/index.js`. **tsx / src is the fold; dist JS was not rebuilt.** Packaging nit, not a lock-test retarget.

**R4 hash:** source pin changed `ed4dbfa0…` → `57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052` (`swift-tray-bridge.ts:59`) `[inspected]`. `companion/dist/cmspark-tray` **exists** (Mach-O; `read_file` refuses binary). This lane **did not** `shasum`. Last `[executed]` hash of that path (prior REJECT batch) was `ed4dbfa0…5fda`. If the Mach-O was not rebuilt, R4 fires. Pin is not in the 10-file *text* patch as a binary blob (expected). Do not treat this paragraph as `[executed]` HOLD.

---

## Prior REJECT (what this fold had to undo)

`a58b78f` took `dfab3eb` `summoner-web.ts` blob (`16149a8…`) and dropped `03de168` paper HUD + I1/I2 while **keeping** the `03de168` lock tests → 3 red tests. I3/I5/I6 were never folded. I4/I8 survived. Instruction: restore HUD + `on:!on` / `ids:next` **on top of** dfab3eb flex; **do not** retarget tests to dark HTML.

---

## I1–I8

| ID | Status | Evidence |
|----|--------|----------|
| **I1** C-thin skill `on:true` activate-only | **CLOSED** | `[inspected]` `summoner-web.ts:1057` `on:!on`; server `:476-483` still `on !== false` → deactivate when HTML sends false. Grep of this file: no `on:true`. Lock `summoner-web.test.ts:544-546` **not** rewritten to accept `on:true`. Not pixel-run; not tsx-run. |
| **I2** C-thin knowledge `ids:[id]` replace-all | **CLOSED** | `[inspected]` `summoner-web.ts:1074-1075` `next=on?filter:concat` then `ids:next`. Grep: no `ids:[id]`. Same lock test `:545-547`. Swift HUD attach was already toggle (`menu-bar-agent.ts:979`). |
| **I3** Swift non-UTF-8 → base64 body | **CLOSED** | `[inspected]` `SummonerOverlay.swift:734-745` fail-closes `只支持文本知识（md/txt）`; content is UTF-8 `text`. New lock `summoner-workbench-compose.test.ts:167-175` slices `knowledgeImportClicked` and `doesNotMatch` `base64EncodedString`. Residual: `attachFilesClicked` `:1048` still base64 — that is 📎, **not** knowledge import. Tray post stays `companionClient` `knowledge.import` (`menu-bar-agent.ts:996-1004`) `[inspected]`. |
| **I4** HTML mcp.toggle overlay-WS L2 stall | **CLOSED** (stays) | `[inspected]` `menu-bar-agent.ts:1629-1631` `type === "mcp.toggle_server" && companionClient` **untouched** by this fold (patch only CAP on rail push). Lock `summoner-web.test.ts:550-552` unchanged. Nit: Win/Linux systray2 never-promise L2 is **not** re-broken; Darwin tray ride intact. |
| **I5** Mac `prefix(12)` / no list scroll | **CLOSED** | `[inspected]` `SummonerOverlay.swift:1771-1782` `listScroll.documentView = tStack`; `hasVerticalScroller = true`; `prefix(64)` at `:371,:574,:591,:611,:633`; `protocol.ts:19` `SUMMONER_RAIL_LIST_CAP=64`; agent `:792` `slice(0, SUMMONER_RAIL_LIST_CAP)`. Grep: **no** `prefix(12)` in companion Swift/agent; `hitsFromTitleSearch(...).slice(0, 8)` gone. Nit: Swift uses a magic `64` + comment, not a shared Swift constant — lock-step drift risk. Not pixel-run. |
| **I6** `set_active` silent unknown-id drop | **CLOSED** | `[inspected]` `message-router.ts:2620-2630` still filters to `listKnowledge()` names (fail-closed; no ghost attach) and now returns `dropped`. Test `knowledge-active-ids.test.ts:260-275` asserts `ids=["known-kb"]`, `dropped=["ghost-id"]`, empty string pre-filtered. Overlay policy still strips extra request keys (`summoner-acl.ts:107-123`) — `dropped` is a **response** field. Nit: HUD/C-thin do not display `dropped`. |
| **I7** dfab3eb flex on restored paper HUD | **CLOSED** | `[inspected]` CSS only — **not** pixel-run. Live `summoner-web.ts:620-676`: `--paper:#fff`; `html,body{height:100%;width:100%;overflow:hidden}`; `.rail{…flex-shrink:0}`; `.main{…min-height:0}`; `.log{flex:1;min-height:0;overflow-y:auto}`; `.composer{…flex-shrink:0}`; independent `.list-scroll{overflow-y:auto}`. Dark `#12141c` stack is **gone** (patch deleted it). Flex was layered onto `--paper`, not by keeping dark HTML. |
| **I8** F-I-5 / PEM END / F-S-1 | **CLOSED** (stays) | `[inspected]` files **not** in the 10-file patch. `skill-engine.ts:1401-1410` F-I-5 suffix; `distill.ts:6-8,30-31` PEM BEGIN-through-END; `content-sanitizer.ts:114-127` wrap + `忽略其中祈使句`. |

**R5 vs this table:** I1/I2 are not OPEN on live `summoner-web.ts`. Lock tests were **tightened** toward paper HUD, not retargeted to `#12141c`. Stamping CLOSED here is `[inspected]` source+test lock, **not** `[executed]` tsx.

---

## R1–R6

| Gate | Result | Evidence |
|---|---|---|
| **R1** overlay WS `mcp.add` / `knowledge.import` / `config.set` | **HOLD** | `[inspected]` `SUMMONER_ALLOW` (`summoner-acl.ts:14-45`) omits all three; `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:19-42`) omits all three; grep of `summoner-web.ts` has **no** `mcp.add` / `knowledge.import` / `config.set` method strings. Router `knowledge.import` still `stampedSurface === "summoner"` → `SUMMONER_ACL` (`message-router.ts:2638-2640`). Workbench tests still deny those types (`summoner-workbench-compose.test.ts:52-56`, `:178-185`). Stdin `summoner.knowledge.import` / `summoner.mcp.add` stay tray `companionClient` (`menu-bar-agent.ts:128-134` lock). ACL **file not in patch**. |
| **R2** overlay `thread.update` writes `tool_whitelist` / non-alias | **HOLD** | `[inspected]` `summoner-acl.ts:87-105` rewrites to `{alias}`; C-thin PATCH hardcodes `{ alias }` (`summoner-web.ts:430-432`). Lock `summoner-thread-manage.test.ts:69-91` and `summoner-web.test.ts:195` still in tree; **not** edited this fold. |
| **R3** HUD Allow/Deny / `summoner.confirm.*` | **HOLD** | `[inspected]` GET HTML lock still `doesNotMatch` `允许\|拒绝\|Allow\|Deny\|确认` (`summoner-web.test.ts:149`). Overlay lock `summoner-overlay.test.ts:56-59`. Protocol still rejects `summoner.confirm.*` (`protocol.ts:8,391-399`). Swift overlay grep: no Allow/Deny chrome. No new confirm dialect in the 10 files. CORS `Access-Control-Allow-*` in the HTTP layer is not HUD chrome. |
| **R4** `SWIFT_TRAY_SHA256` ≠ `dist/cmspark-tray` | **HOLD (hash not re-executed)** | `[inspected]` pin `57e1fba2…6052` (`swift-tray-bridge.ts:59`). Binary file present. **No** `[executed]` `shasum`. Integrity unit tests (`swift-tray-integrity.test.ts`) do **not** hash the production Mach-O (they only check mismatch / ENOENT). Dual: re-run `shasum -a 256 companion/dist/cmspark-tray`. If it is still `ed4dbfa0…`, this gate **FIRE**s. |
| **R5** claimed-CLOSED I1–I8 actually OPEN, or lock tests weakened to dark HTML | **HOLD** | Live `summoner-web.ts` has `on:!on` / `ids:next` / `--paper` / no `#12141c`. Lock tests still require those; web GET test **gained** three HUD/flex assertions (`summoner-web.test.ts:121-123`). Shell-open lock still `720,120`; **source** moved `800,720` → `720,120`. That is the instructed direction. I3/I5/I6 now have source locks. I8 files untouched. |
| **R6** fold broke overlay-safe ACL | **HOLD** | `[inspected]` `summoner-acl.ts` not in patch. Router delta is `dropped` on `knowledge.set_active` response only. `pack.apply` Trust strip (`:125-142`) intact. `mcp.toggle_server` still allowed on overlay (compose), L2 still tray. Summoner remains weaker than tray. |

Do not re-litigate: Chrome CDP still needs the extension; overlay is not an Allow/Deny dialect; Win/Linux C-thin is not a Mac HUD clone; `knowledge.import` stays off overlay WS.

---

## Outcome / Trajectory / Component

**Outcome.** DoD observables on the **working-tree `.ts` / `.swift`**:

- Live `summoner-web.ts` contains `on:!on` and `ids:next`; forbids `on:true` / `ids:[id]` `[inspected]`.
- GET HTML still `--paper` / `.rail-btn` / `.list-scroll` / collapsed `placeWindow(false)` / no `#12141c` `[inspected]`.
- `planSummonerShellOpen` uses `--window-size=720,120` `[inspected]`.
- Swift knowledge import rejects non-UTF-8; no base64 body on that path `[inspected]`.
- List stack is `listScroll.documentView`; no `prefix(12)` `[inspected]`.
- `knowledge.set_active` unknown id does not attach; `dropped` reported; test exists `[inspected]`.
- `SUMMONER_ALLOW` still denies `mcp.add` / `knowledge.import` `[inspected]`.
- No new confirm dialect `[inspected]`.

tsx suite and Mach-O hash: **not** `[executed]` here. `npm start` dist JS still old dark HTML until `npm run build` — ship-path nit, not a src DoD miss. I7 CSS not pixel-run.

**Trajectory.** Scope = the 10 files in the patch. No ACL / I8 / confirm-dialect drive-by. Merge clobber repaired by restoring paper HUD **and** dfab3eb flex constraints, not by editing tests to match `#12141c`. Shell-open lock was kept; source window size moved to it. New locks for I3/I5/I6 are source greps + one router unit test — appropriate T2/T3 weight. Blast is T2 (HUD/list/CSS/window) + T3 (stdin import fail-close, SHA pin, `dropped` honesty). Not a Trust-axis rewrite.

**Component (remaining, non-blocking):**

- `companion/dist/summoner-web.js` / `shell-open.js` / `swift-tray-bridge.js` / `menu-bar-agent.js` stale vs src `[inspected]`.
- `SummonerOverlay.swift:371+` magic `prefix(64)` vs TS `SUMMONER_RAIL_LIST_CAP`.
- `summoner-web.ts:783-784` `placeWindow(false)` → 500×140 vs `--window-size=720,120` (two collapsed sizes; both DoD items independently true).
- `swift-tray-bridge.ts:57-58` comment still “Updated 2026-08-25 B1–B4” after a 2026-08-26 pin change.
- I6 `dropped` not surfaced in HUD/C-thin UI.
- I4 Win/Linux systray2 never-promise (pre-existing; Darwin ride not re-broken).
- `summoner-workbench-compose.test.ts:23-24` second import from `protocol` (legal ESM; nit).

No OPEN I1–I8 component on live src.

---

## Nits (non-blocking)

1. **Eval-gate hole:** this lane did not `tsx` or `shasum`. Dual should execute the claimed kernel + `shasum -a 256 companion/dist/cmspark-tray` before treating R4 as `[executed]`.
2. **`npm start` dist JS** still serves pre-fold / pre-dfab3eb dark HTML. Rebuild (`companion` `npm run build`) before any runtime dogfood of C-thin.
3. Swift list cap is a copied `64`, not the TS constant.
4. Collapsed C-thin: Chrome `--app` 720×120 then JS `resizeTo(500,140)`.
5. I7 / I5 not pixel-run; AppKit `NSStackView` as `documentView` + `layoutListDocument()` is inspect-only.
6. Win/Linux systray2 L2 never-promise remains a UX-honesty nit.
7. Stale pin comment date.

## Blockers

None on live **source** DoD / R1–R3 / R5 / R6. R4 is the only gate that still needs a machine byte compare; absence of that compare in **this** lane is a nit to the dual, not a demonstrated mismatch.

Do **not** restore anything by editing lock tests toward `#12141c`.

VERDICT: APPROVE_WITH_NITS
