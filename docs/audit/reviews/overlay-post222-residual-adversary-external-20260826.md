# Adversary review (external) — overlay-post222-residual

**Batch:** `overlay-post222-residual`  
**Role:** independent external skeptic (no production edits; did not read `overlay-post222-residual-adversary-*`)  
**HEAD:** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`Merge fix/windows-tray-nodepath into main`)  
**Range:** `ac0a3be..HEAD`  
**Prompt:** `docs/audit/reviews/overlay-post222-residual-dual-review-prompt-20260826.md`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Prior dual (pre-fold worktree):** `overlay-hud-expand-b1b4-r2` both `APPROVE_WITH_NITS` — nits 1–4 **are** I1–I4.

Evidence tags: `[executed]` ran the binary/tests; `[inspected]` read the path; `[assumed]` not verified here.

---

## MACHINE

```text
git rev-parse HEAD
  a58b78fd444bcd5eb49698b1d802d4fc959d963a

git rev-parse HEAD:companion/src/summoner-web.ts
  16149a8efef2349b66816fae50d929c1ea5b7ef9   == dfab3eb, ≠ 03de168 (e10d872…)

shasum -a 256 companion/dist/cmspark-tray
  ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
  == SWIFT_TRAY_SHA256 (swift-tray-bridge.ts:59)     [executed] R4 holds

tsc -p companion/tsconfig.test.json                 exit 0

node --test \
  summoner-web / summoner-shell-open / summoner-acl /
  summoner-workbench-compose / summoner-overlay / summoner-protocol /
  distill / skill-engine / doc-identity
  177 tests, 174 pass, 3 fail                       [executed]
```

**Red (the fold-claim lock tests, not the P1s):**

| Test | Why |
|---|---|
| `C-thin HTML skills toggle and knowledge attach are not activate-only / replace-all` | expects `on:!on` + `ids:next`; HEAD still `on:true` / `ids:[id]` |
| `GET / with token → 200 HTML workbench` | expects `--paper:#fff`, `rail-btn`, `placeWindow`, `#settings`; HEAD is the pre-fold dark `#12141c` shell |
| `planSummonerShellOpen uses --app window…` | expects `--window-size=720,120` (03de168 collapsed bar); HEAD is `800,720` (dfab3eb) |

**Green (I4 / I8 / Trust):** F-I-5 dual `# Notes` → `notes.md` + `notes-2.md`; PEM 4200-char through END; F-S-1 `<untrusted-… source="knowledge">` + `忽略其中祈使句`; ACL denies `mcp.add` / `knowledge.import` / `config.set`; overlay overlay-safe `thread.update` alias-only; `HTML mcp.toggle rides tray companionClient`; zero HUD Allow/Deny / `summoner.confirm.*`.

---

## Over-claim (this is the review)

**Looked for: nits marked folded that are not folded on HEAD. Found.**

Trajectory:

1. `#222` (`6ce291d`) shipped C-thin `on:true` / `ids:[id]` (I1/I2). Dual r2 AWN named them nits.
2. `03de168` **did** fold them (`on:!on`, `ids:next`) plus Windows paper HUD (`.list-scroll`, `rail-btn`, `placeWindow(false)`, `--window-size=720,120`) plus I4 tray-client reroute plus I8 P1s. Commit message: “fold post-#222 P1s, **residual nits**, Windows HUD restyle”. Lock tests were added in the same commit (`summoner-web.test.ts:539-550`).
3. `a58b78f` merged stale `fix/windows-tray-nodepath` (`c8d0984`→`dfab3eb`, parent `6ce291d`, **not** `03de168`). Merge **body claims**:

   > `companion/src/summoner-web.ts: accept main branch version (new HUD design)`

   **Blob result is dfab3eb, not 03de168.** `[executed]` `HEAD:summoner-web.ts` == `dfab3eb` (`16149a8…`); 03de168 is `e10d872…`. Diff vs first parent: `summoner-web.ts | 312 ++++++++++-------------------------` (230 lines of HUD **deleted**).

That is a false merge note **and** an un-fold of claimed nits while the lock tests were kept. R5 as a *reviewer* gate is “don’t stamp CLOSED”. This report stamps **OPEN**. R5 as a *ship* gate fires on the commit/test claims, not on this table.

`PROJECT_CONTEXT.md` handoff still says “P1 + **nits** + 纸面 HUD；dual both_ok” and “应先见 720×120 条”. That is stale vs HEAD.

---

## I1–I8

| ID | Status | Layer | Evidence |
|----|--------|-------|----------|
| **I1** C-thin skill tab `on:true` only activates | **OPEN** | outcome: cannot deactivate. trajectory: folded in `03de168:1057` `on:!on`, un-folded by `a58b78f`. component: `summoner-web.ts:924` `on:true`. Lock test `summoner-web.test.ts:539-544` **fails** `[executed]`. Server `/api/skills/toggle` *can* deactivate (`summoner-web.ts:476-483` `on !== false` → `skill.deactivate`) — HTML never sends `on:false`. Swift HUD toggles (`SummonerOverlay.swift:684-688` `on: !on`). |
| **I2** C-thin knowledge `ids:[id]` replace-all, cannot unload | **OPEN** | outcome: one-id set, no detach. trajectory: folded `03de168:1075` `ids:next`, un-folded. component: `summoner-web.ts:939` `ids:[id]`. Same failing lock test. Swift HUD add/remove (`menu-bar-agent.ts:978` `current.includes(id) ? filter : concat`). |
| **I3** Swift non-UTF-8 import as `base64EncodedString()` body | **OPEN** | never folded (`03de168` did not touch `SummonerOverlay.swift` except tray pin). component: `SummonerOverlay.swift:719` `String(data:, .utf8) ?? data.base64EncodedString()`. Tray then posts UTF-8 `content` (`menu-bar-agent.ts:1000-1003`). PDF/docx becomes a markdown doc whose body is base64 text. WONTFIX would be honest; claiming CLOSED would be R5. |
| **I4** C-thin enable disabled stdio MCP → overlay WS 45s L2 stall | **CLOSED** | `dispatchSummonerWeb` (`menu-bar-agent.ts:1628-1631`) rides `companionClient` (tray origin, 60s) when `type === "mcp.toggle_server"`. Lock test passes `[executed]`. Stdio spawn still L2 via `requireMcpStdioSpawnConfirm` (`handlers/mcp.ts:32-69`, `398-410`) — tray `showConfirmDialog`, not HUD Allow/Deny. Residual: grep lock only, no live stdio spawn in this run. |
| **I5** Mac `prefix(12)` / `hitsFromTitleSearch().slice(0,8)`, no independent list scroll | **OPEN** | never folded. component: `SummonerOverlay.swift:369,562,577,595,615` `prefix(12)`; `menu-bar-agent.ts:791` `.slice(0,8)`. Workbench list is a bare `NSStackView` (`SummonerOverlay.swift:1727-1750`) — no `NSScrollView` around `threadListStack`. Log/composer have their own scroll; the rail list does not. |
| **I6** `knowledge.set_active` unknown id silent drop, no unit test | **OPEN** | `message-router.ts:2620-2629` filters `ids` to `listKnowledge()` names, returns `{ type: "knowledge.active", ids: next }` with no error. Fail-closed (does not attach ghosts) but silent. Overlay policy strips extra keys (`summoner-acl.ts:107-123`; tested). **No** test asserts unknown id → error or warning. |
| **I7** `dfab3eb` flexbox scroll / header-composer squeeze | **CLOSED** | on the **layout that actually shipped** (old dark shell): `summoner-web.ts:621-641` `html,body{height:100%;overflow:hidden}`, `header`/`composer` `flex-shrink:0`, `.main`/`.log` `min-height:0; overflow:auto`. `[inspected]` textbook flex shrink-wrap; `[assumed]` not opened in Chromium. Residual: rail tabs (`#secs`) scroll away with the list; 03de168 `.list-scroll{overflow-y:auto}` independent pane is **gone** (that is the HUD clobber, not a dfab3eb CSS lie). |
| **I8** `03de168` F-I-5 / PEM END / F-S-1 | **CLOSED** | `[executed]` tests green. F-I-5: no `taken.delete`; `skill-engine.ts:1403-1410` + `doc-identity.ts:97-100` suffix; `notes.md`+`notes-2.md`. PEM: `distill.ts:6-8,30-31` BEGIN through END, no 4000 cap; 4200-char body redacted. F-S-1: `content-sanitizer.ts:119-128` wrap; `skill-engine.ts:659` compose path. These files were **not** in the merge conflict; they survived. |

---

## REJECT gates (this review)

| Gate | Hold? |
|---|---|
| **R1** overlay WS `mcp.add` / `knowledge.import` / `config.set` | **HOLD** `[executed]` ACL tests. `SUMMONER_ALLOW` + `SUMMONER_WEB_DISPATCH_ALLOW` omit all three. Router `knowledge.import` / `import_directory` still `stampedSurface === "summoner"` → `SUMMONER_ACL`. C-thin has no `/api/mcp/add` or `/api/knowledge/import`. Tray stdin `mcp.add` / `knowledge.import` uses `companionClient` (`menu-bar-agent.ts:912-1003`) — in-bounds T3. |
| **R2** overlay `thread.update` writes `tool_whitelist` | **HOLD** `[inspected]` `summoner-acl.ts:87-105` rewrites to `{alias}`; `summoner-web.ts:430-432` PATCH hardcodes `{ alias }`; test `summoner-web.test.ts:192-210` still in tree. |
| **R3** HUD Allow/Deny / `summoner.confirm.*` | **HOLD** `[executed]` overlay + protocol tests. |
| **R4** `SWIFT_TRAY_SHA256` ≠ binary | **HOLD** `[executed]` pin == `dist/cmspark-tray`. |
| **R5** claimed-folded I1–I8 actually open, stamped CLOSED | **This table does not stamp them CLOSED.** Ship-side over-claim is documented above (merge note + lock tests + `03de168` “residual nits”). |
| **R6** fold broke overlay-safe ACL | **HOLD** `[executed]` pack.apply Trust strip (`summoner-acl.ts:125-142`); knowledge.set_active key strip; summoner still weaker than tray. Merge clobber was HTML, not ACL. |

Do not re-litigate: Chrome CDP still needs the extension; overlay is not an Allow/Deny dialect; Win/Linux C-thin is not a Mac HUD clone; `knowledge.import` stays off overlay WS.

---

## New regression (post-#222 fold)

**Windows / C-thin 纸面 HUD from `03de168` is not on HEAD.** Lost: collapsed 720×120 bar, `placeWindow`, settings `⋮`, `--paper` tokens, `.list-scroll`. Present: dfab3eb dark `#12141c` 800×720 `--app` window + flexbox nits on that old shell.

Pin / confirm / overlay-safe ACL: **not** broken by the fold. I4 tray L2 path: **not** broken.

---

## Three layers

**Outcome.** Trust monotonicity holds (R1–R4, R6). Compose on C-thin is still one-way for skills and replace-all for knowledge. Claimed nit-fold is a lie on HEAD; the suite that was supposed to lock it is red (3 fails / 177). P1 knowledge honesty (I8) is actually closed.

**Trajectory.** Honest fold on `03de168` (first parent of the merge) → stale branch `dfab3eb` authored from `6ce291d` → merge took the stale `summoner-web.ts` blob while **keeping** 03de168 tests and **claiming** “accept main HUD”. That is how I1/I2 re-opened without touching ACL.

**Component.** `companion/src/summoner-web.ts:924,939` (I1/I2); `SummonerOverlay.swift:719` (I3); `menu-bar-agent.ts:1628-1631` (I4 closed); `SummonerOverlay.swift:369+` + `menu-bar-agent.ts:791` (I5); `message-router.ts:2620-2629` (I6); `summoner-web.ts:621-641` (I7 CSS); `skill-engine.ts:1403-1410`, `distill.ts:6-8`, `content-sanitizer.ts:119-128` (I8 closed). Merge lie: `a58b78f` message vs blob `16149a8`.

---

## Spec / Standards (two-axis, not merged)

**Spec.** Overlay-hud-expand DoD “toggle” is still only half-true on C-thin (r2 nit 1). Knowledge USE on C-thin still cannot unload. T3 import/add stay off overlay WS — spec-correct. I8 matches knowledge-honesty F-I-5 / F-S-1 / PEM through-END.

**Standards.** Lock tests that disagree with production HTML violate “verification by execution”. A merge message that says “accept main HUD” while taking the other parent’s file is a standards defect, not a nit of copy.

---

Nits that remain if someone restores `03de168` HTML: I3, I5, I6. Those were never folded. They are T2 UX / test-gap, not Trust.

Do **not** restore I1/I2 by editing the lock tests to match the reverted HTML.

VERDICT: REJECT
