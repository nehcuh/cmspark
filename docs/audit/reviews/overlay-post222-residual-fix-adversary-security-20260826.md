# overlay-post222-residual-fix — Security / Trust adversary

**Lane:** independent Security/Trust (no production edits; did not read `overlay-post222-residual-fix-adversary-*.md`)  
**HEAD:** uncommitted working tree on `fix/overlay-post222-residual` (git ref still `a58b78fd444bcd5eb49698b1d802d4fc959d963a`)  
**Base:** `origin/main` `a58b78f` Merge `fix/windows-tray-nodepath` into main  
**Patch:** `docs/audit/reviews/overlay-post222-residual-fix-diff-20260826.patch` (exactly 10 files)  
**Prior REJECT:** I1/I2 merge regression (`a58b78f` took `dfab3eb` dark HTML, dropped `03de168` `on:!on` / `ids:next`); R1–R4/R6 already held  
**Evidence tags:** `[inspected]` live path / lock-test vs source; `[executed]` not available in this subagent (no shell). Verdicts below do not rely on the implementer’s “114 + 4 green” claim.

刻意边界遵守：不把「MCP 工具执行走 Side Panel」判 BLOCK；HUD 不做 Allow/Deny；不要求 `knowledge.import` 上 overlay WS。Win/Linux systray2 never-promise L2 标 nit。未做 C-thin 像素拖拽。

---

## Outcome

**DoD holds on the working tree.** Live C-thin HTML is paper HUD (`--paper:#fff`, `.rail-btn`, `.list-scroll`, `placeWindow(false)`, no `#12141c`) with dfab3eb flex layered on (`html,body{height:100%;width:100%;overflow:hidden}`, `.rail{flex-shrink:0}`, `.main{min-height:0}`, `.log{min-height:0}`, `.composer{flex-shrink:0}`). I1/I2 source is `on:!on` / `ids:next` (no `on:true` / `ids:[id]`). Overlay ACL still overlay-safe. `knowledge.import` / `mcp.add` / `config.set` stay off summoner WS. HUD has no Allow/Deny / `summoner.confirm.*`. Swift import fail-closes non-UTF-8. `knowledge.set_active` still filters unknown ids (now reports `dropped`). `pack.apply` Trust extras still stripped.

Prior batch R5 (I1/I2 claimed CLOSED while HEAD was `on:true` / `ids:[id]` + red lock tests) is **repaired in source**. Lock tests were **strengthened** toward paper+flex, not retargeted to dark HTML.

| ID | Claim | Live | This review |
|----|--------|------|-------------|
| I1 | C-thin skills `on:!on` | `summoner-web.ts:1057` `on:!on`; no `on:true` in file | **CLOSED** `[inspected]` |
| I2 | C-thin knowledge `ids:next` | `summoner-web.ts:1074-1075` `ids:next`; no `ids:[id]` | **CLOSED** `[inspected]` |
| I3 | Swift non-UTF-8 fail-close; no base64 body | `SummonerOverlay.swift:734-742` | **CLOSED** `[inspected]` |
| I4 | HTML mcp.toggle rides tray `companionClient` | `menu-bar-agent.ts:1629-1631` untouched | **CLOSED** `[inspected]` |
| I5 | Mac list `NSScrollView`; cap 64 | `listScroll.documentView = tStack` `:1778`; `prefix(64)` ×5; no `prefix(12)` | **CLOSED** `[inspected]` |
| I6 | `set_active` fail-closed unknown ids + `dropped` + unit test | `message-router.ts:2624-2630`; `knowledge-active-ids.test.ts:260-275` | **CLOSED** `[inspected]` |
| I7 | dfab3eb flex **onto** `--paper` HUD | CSS `:620-676`; no `#12141c` | **CLOSED** `[inspected]` (not pixel-run) |
| I8 | F-I-5 / PEM END / F-S-1 untouched | not in the 10-file patch; `taken.delete` 0 hits under `companion/src` | **CLOSED** `[inspected]` |

| Gate | Result |
|------|--------|
| R1 overlay WS `mcp.add` / `knowledge.import` / `config.set` | **HOLD** |
| R2 overlay `thread.update` → `tool_whitelist` / non-alias | **HOLD** |
| R3 HUD Allow/Deny / `summoner.confirm.*` | **HOLD** |
| R4 `SWIFT_TRAY_SHA256` ≠ `companion/dist/cmspark-tray` | **HOLD** `[inspected]` (pin updated with Swift; binary present; live shasum not executed this lane — see nit) |
| R5 claimed-CLOSED I1–I8 actually OPEN, or lock tests weakened to dark HTML | **HOLD** |
| R6 new fold breaks overlay-safe ACL | **HOLD** |

---

## Trajectory

Scope is the 10-file patch. No drive-by on `summoner-acl.ts`, F-I-5/PEM/F-S-1, or I4 tray ride.

```
companion/src/menu-bar-agent.ts          I5 cap
companion/src/message-router.ts          I6 dropped
companion/src/summoner-web.ts            I1/I2/I7 paper+flex
companion/src/summoner/protocol.ts       SUMMONER_RAIL_LIST_CAP=64
companion/src/summoner/shell-open.ts     --window-size=720,120
companion/src/tray/SummonerOverlay.swift I3/I5
companion/src/tray/swift-tray-bridge.ts  R4 pin
companion/tests/knowledge-active-ids.test.ts     I6
companion/tests/summoner-web.test.ts             paper+flex asserts added
companion/tests/summoner-workbench-compose.test.ts I3/I5 source locks
```

Lock tests were **not** retargeted to reverted dark HTML:

- `summoner-web.test.ts:118-126` still requires `--paper:#fff` / `.rail-btn` / `placeWindow(false)` / `doesNotMatch /#12141c/`; **added** flex + `.list-scroll`.
- `summoner-web.test.ts:542-547` still requires `/skill_name:s\.name,on:!on/` and `/ids:next/`, **forbids** `on:true` / `ids:[id]`.
- `summoner-shell-open.test.ts:71` still expects `--window-size=720,120`; source now matches (`shell-open.ts:55`).

`git` ref on this branch is still `a58b78f` — fold is uncommitted. `companion/dist/` is gitignored; stale `dist/tray/swift-tray-bridge.js` pin (`9716da43…`) is a local tsc artifact, not in the patch.

---

## Component

### I1 CLOSED — C-thin skill toggle

`companion/src/summoner-web.ts:1051-1057` `[inspected]`:

```text
var on=ids.indexOf(s.name)>=0;
...
JSON.stringify({thread_id:threadId,skill_name:s.name,on:!on})
```

HTTP `/api/skills/toggle` (`:472-483`) maps `body.on !== false` → `skill.activate` else `skill.deactivate`. `rg on:true` under `summoner-web.ts` **0 hits**. Mac HUD already `on: !on` (`SummonerOverlay.swift:707`).

### I2 CLOSED — C-thin knowledge toggle is a full set, not replace-with-one

`summoner-web.ts:1064-1075` `[inspected]`: `cur` from `active_knowledge_ids`, `next=on?cur.filter(...):cur.concat([id])`, payload `ids:next`. `rg ids:\[id\]` **0 hits**. Router still **sets** `active_knowledge_ids` to the array (not a patch) — C-thin now sends the full next set, matching Mac `handleSummonerKnowledgeAttach` (`menu-bar-agent.ts:979-980`).

### I3 CLOSED — non-UTF-8 is not a document body

`SummonerOverlay.swift:730-742` `[inspected]`:

```swift
guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
  applyError(message: "只支持文本知识（md/txt）", errorCode: "upload_failed")
  return
}
jsonLine([..., "content": text])
```

`base64EncodedString()` remains on **file attach** (`:1048`, `summoner.files` → `file.upload`) and mic wav — correct path, not knowledge body. I3 lock test scopes `knowledgeImportClicked` and `doesNotMatch /base64EncodedString/`. Stdin still rides **tray** `companionClient` (`menu-bar-agent.ts:996-1004`), not summoner WS.

Nit: enforcement is “valid non-empty UTF-8”, not `md/txt` extension. A UTF-8 `.html` still becomes markdown `content` and is F-S-1 wrapped. Fail-closed vs binary/PDF.

### I4 CLOSED — C-thin stdio toggle still not waiting overlay L2

`menu-bar-agent.ts:1629-1631` `[inspected]` (untouched this fold): `mcp.toggle_server && companionClient` → tray `sendAppRequest(..., 60_000)`. Tray `onAppMessage` → `showConfirmDialog` → `security.confirmation.response` (`:1832-1850`). C-thin has no Allow/Deny; copy still “批准去侧栏处理”. Residual: if `companionClient` is null, falls back to overlay 8s RPC — overlay ACL **allows** `mcp.toggle_server`. Click path stays tray-ridden.

### I5 CLOSED — Mac list is a scroll document, cap 64

`[inspected]`:

- Push: `menu-bar-agent.ts:792` `slice(0, SUMMONER_RAIL_LIST_CAP)` (`protocol.ts:19` = 64).
- Render: `SummonerOverlay.swift:371,574,591,611,633` `prefix(64)`; `rg prefix(12)` **0 hits**.
- `listScroll.documentView = tStack` (`:1778`); `hasVerticalScroller = true` (`:1773`).

Swift hardcodes `64` (comment-coupled to TS). Divergence if someone changes only the TS constant — nit.

### I6 CLOSED — unknown ids do not attach; `dropped` reported

`message-router.ts:2620-2630` `[inspected]`: trim/type filter → `slice(0,32)` → `known = listKnowledge() name||id` → `next = ids.filter(known.has)` → `dropped = ids.filter(!known.has)` → write `next` only. Overlay payload policy still strips non-`thread_id`/`ids` keys (`summoner-acl.ts:107-123`), so `tool_whitelist` cannot ride this method.

Unit test `knowledge-active-ids.test.ts:260-275` asserts `ids: ["known-kb"]`, `dropped: ["ghost-id"]`, thread store matches. Empty string is stripped **before** `dropped` (not listed) — still not attached.

This is fail-closed on **unknown identity**, not a 400 of the whole request. Mixed `[known, ghost]` still attaches known. Attacker cannot attach a non-existent doc; they could already send `[known]`. Matches the claimed close, not the prior “please 400” suggestion.

### I7 CLOSED `[inspected]` — paper HUD + flex; not pixel-run

Live CSS has `--paper:#fff`, `.rail-btn`, `.list-scroll{overflow-y:auto}`, collapsed `placeWindow(false)` (`:1148`), no `#12141c`. Flex: `html,body{height:100%;width:100%;overflow:hidden}`; `.rail{flex-shrink:0}`; `.main{min-height:0}`; `.log{min-height:0;overflow-y:auto}`; `.composer{flex-shrink:0}`. Window plan `shell-open.ts:55` `--window-size=720,120`.

### I8 CLOSED `[inspected]` — knowledge P1 wrap still on disk

Not in the 10-file patch.

- F-I-5: `skill-engine.ts:1403-1410` still forbids occupied-stem overwrite; `rg taken.delete` under `companion/src` **0 hits**.
- PEM: `distill.ts:6-8,30-31` `[\s\S]*?` through END or `$`, applied first.
- F-S-1: `content-sanitizer.ts:119-128` heading outside wrap; `</?untrusted` stripped; suffix `sha256("knowledge:"+id)[:12]`.

### R1 HOLD — overlay WS cannot import / add / config.set

`[inspected]` `SUMMONER_ALLOW` (`ws/summoner-acl.ts:14-45`) has no `mcp.add` / `knowledge.import` / `config.set`. C-thin `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:19-41`) same. No C-thin HTTP route for those types (`/api/config` 404 lock still in `summoner-web.test.ts:390-401`). Router second gate: `knowledge.import` / `import_directory` refuse `stampedSurface === "summoner"` (`message-router.ts:2638-2663`). Lifecycle `assertSummonerAllowed` **then** `applySummonerPayloadPolicy` **then** `stampCmsparkSurface` (`lifecycle.ts:1038-1053`).

Stdin `summoner.mcp.add` / `summoner.knowledge.import` → tray `companionClient` (`menu-bar-agent.ts:913-917,996-1004`). C-thin HTML has no import/add UI.

### R2 HOLD — overlay `thread.update` alias-only

`applySummonerPayloadPolicy` rewrites updates to `{ alias }` (`summoner-acl.ts:87-105`). C-thin PATCH only forwards `{ alias }` (`summoner-web.ts:424-432`). DELETE forced `mode: trash` (`:442`).

### R3 HOLD — no HUD confirm dialect

`isSummonerConfirmDialect` still `startsWith("summoner.confirm")` (`protocol.ts:394-399`). `SummonerOverlay.swift` has **0** matches for `Allow|Deny|summoner.confirm|允许|拒绝`. Lock `summoner-overlay.test.ts:56-59` forbids `允许|拒绝|Allow|Deny|确认` and `showConfirm|allowClicked|denyClicked`. C-thin GET HTML lock `doesNotMatch /允许|拒绝|Allow|Deny|确认/`. SSE drops `security.confirmation.request` (`SUMMONER_WEB_EVENT_ALLOW`; test `:423-474`). L2 stays tray `showConfirmDialog`. Settings uses `alert(...)`, not Allow/Deny.

### R4 HOLD `[inspected]` — pin moved with Swift; live digest not hashed here

Source pin `swift-tray-bridge.ts:59` = `57e1fba2c5d7dd5bde0f462a85e92d8839ff7c9c8b7c8e9f5bd897d6285a6052` (was `ed4dbfa0…5fda` at prior batch, which then matched). `companion/dist/cmspark-tray` exists. `checkIntegrity` fail-closes on mismatch and **does not auto-rebuild** (`swift-tray-bridge.ts:207-226`) — wrong pairing refuses spawn (safe direction). The 4 `swift-tray-integrity` tests only use fake bins; they do **not** prove pin == production binary.

This lane had no shell, so `shasum -a 256 companion/dist/cmspark-tray` was **not** `[executed]`. HOLD is from pairing workflow (Swift + pin in the same 10-file fold) + fail-closed mismatch behavior. Operator should still run shasum before merge.

### R5 HOLD — I1/I2 actually closed; tests not weakened

Prior dual REJECT fired R5 because production HTML was `on:true` / `ids:[id]` / `#12141c` while lock tests asserted the opposite. Live source now satisfies those tests **and** extra flex/list-scroll asserts. I3/I5/I6 have new source/unit locks. I4/I8 files untouched.

### R6 HOLD — overlay-safe ACL not widened

`summoner-acl.ts` not in the patch. `pack.apply` still `delete`s `allowTrust` / `workspace_path` / `force_takeover` / `confirmation_phrase` (`:125-129`); C-thin HTTP constructs `{ pack_id, thread_id, user_gesture: true }` only (`summoner-web.ts:542-553`); router overlay path forces `allowTrust: false` and errors leftover forbidden fields (`message-router.ts:2979-3014`). Mac `applyPack()` sends no Trust extras (`companion-client.ts:314-320`). `knowledge.set_active` `dropped` is a response field, not a new inbound capability. `SUMMONER_WEB_DISPATCH_ALLOW ⊆ SUMMONER_ALLOW`.

---

## Tests `[inspected]` (lock-test ↔ live source)

Did not exec `npx tsx --test …` (no shell in this subagent). Static correspondence:

| Lock | Live |
|------|------|
| GET HTML `--paper` / `.rail-btn` / `.list-scroll` / flex / `placeWindow(false)` / no `#12141c` | `summoner-web.ts` CSS+`placeWindow(false)` |
| `on:!on` / `ids:next`; not `on:true` / `ids:[id]` | `:1057`, `:1075` |
| `--window-size=720,120` | `shell-open.ts:55` |
| Swift import UTF-8 fail-close | `SummonerOverlay.swift:734-742` |
| `listScroll.documentView` / no `prefix(12)` / cap 64 | Swift + `SUMMONER_RAIL_LIST_CAP` |
| `knowledge.set_active` dropped | router + new unit test |
| ACL deny `mcp.add` / `knowledge.import` / `config.set` | `summoner-acl.ts` + C-thin allowlist |
| no Allow/Deny chrome | Swift + HTML + protocol |
| overlay `thread.update` alias-only | policy + C-thin PATCH |
| overlay `pack.apply` strips Trust extras | `summoner-acl.ts:124-142` + existing ACL test |

These would be red iff source diverged; it does not.

---

## Nits（non-blocking）

1. **R4 not `[executed]` here.** Run `shasum -a 256 companion/dist/cmspark-tray` vs `swift-tray-bridge.ts:59` before merge. Integrity unit tests never hash the real binary.
2. **Local `npm start` uses gitignored `dist/`.** `dist/tray/swift-tray-bridge.js` still pins `9716da43…` until `tsc`. Mismatch fail-closes tray spawn (safe). `npm run dev` (tsx src) uses the new pin.
3. **I3 copy vs check:** error says `md/txt`; any non-empty UTF-8 file is accepted. MIME is still sent then ignored (`handleSummonerKnowledgeImport` uses `content` as markdown).
4. **C-thin titles switched `textContent` → `innerHTML` + `esc()`** (`summoner-web.ts:791`). `esc` covers `&<>"`. Loopback + escaped titles; prefer `textContent` if this is touched again.
5. Overlay WS still **allows** `mcp.toggle_server`. Keep C-thin/HUD on tray client; do not answer L2 on the summoner socket.
6. Swift `prefix(64)` is a magic number; TS owns `SUMMONER_RAIL_LIST_CAP`.
7. Pin comment still “Updated 2026-08-25 B1–B4”.
8. Win/Linux systray2 `showConfirmDialog` never-promise remains a UX-honesty nit (Darwin tray ride intact).
9. Collapsed JS `placeWindow(false)` uses 500×140 vs shell `--window-size=720,120` — product, not ACL.

## Blockers

None.

---

VERDICT: APPROVE_WITH_NITS
