# Implementer-skeptic: overlay-post222-residual

**Lane:** implementer-skeptic (no production edits)  
**HEAD:** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`origin/main`)  
**Range:** `ac0a3be..HEAD`  
**Parents of merge:** `03de168` (main P1 fold) + `dfab3eb` (C-thin flexbox)  
**Date:** 2026-08-26  

Machine kernel first: tests, blob hashes, `shasum`. Then file:line.

```text
Surface:      L0 overlay HUD workbench + C-thin HTML
L2-classes:   none on HUD; mcp.add / stdio enable uses tray L2
Compose:      threads / pack.apply / mcp.toggle / skill / knowledge USE+import
Autonomy:     n/a
Trust:        overlay ACL overlay-safe; mcp.add/knowledge.import off summoner WS
Channel:      community
```

---

## Outcome

`a58b78f` is a **broken merge of `summoner-web.ts`**. The commit message says the HUD file took **main** (`03de168` new HUD). The tree blob is **`dfab3eb`** (pre-P1 HTML). Tests from `03de168` still assert the HUD + I1/I2 folds. Live HTML is `#222` activate-only / replace-all.

| Check | Result | Evidence |
|-------|--------|----------|
| `HEAD:companion/src/summoner-web.ts` | `16149a8e…` | `[executed] git rev-parse` |
| `dfab3eb:companion/src/summoner-web.ts` | `16149a8e…` **same** | `[executed]` |
| `03de168:companion/src/summoner-web.ts` | `e10d8728…` **not in HEAD** | `[executed]` |
| Merge message | "accept main branch version (new HUD design)" | **false vs tree** `[inspected]` |
| `npm test` (companion) | **3599 tests, 3573 pass, 3 fail** | `[executed]` ~46s, node v24.16.0 |
| `SWIFT_TRAY_SHA256` vs `companion/dist/cmspark-tray` | **equal** | `[executed] shasum -a 256` |
| Overlay ACL `mcp.add` / `knowledge.import` / `config.set` | denied | `[executed]` tests |
| Overlay `thread.update` `tool_whitelist` | stripped to `{alias}` | `[executed]` test |

**R5 fires:** I1 and I2 were folded in `03de168` (HTML `on:!on` / `ids:next` + tests). HEAD HTML is still `6ce291d` `on:true` / `ids:[id]`. Tests that mark those folds CLOSED fail.

I3, I5, I6 were never folded. I4 and I8 **are** in HEAD and tests pass. I7 flexbox CSS **is** the `dfab3eb` recipe (inspected, not pixel-run).

---

## Trajectory

```
6ce291d  #222 HUD compose (C-thin I1/I2 bugs land)
   |\
   |  c8d0984  NODE_PATH
   |  dfab3eb  flexbox + window 800×720  (parent = c8d0984; 03de168 NOT ancestor)
   |
   03de168  P1: F-I-5 / PEM END / F-S-1 + C-thin HUD restyle + I1/I2 HTML
   |
a58b78f  merge: message says keep main HUD; blob is dfab3eb
```

`git merge-base --is-ancestor 03de168 dfab3eb` → not ancestor (`exit 1`).  
`git blame -L 924,939 companion/src/summoner-web.ts` → still `6ce291d`.

`03de168` P1 files that **did not conflict** survived: `skill-engine.ts`, `distill.ts`, `content-sanitizer.ts`, `summoner-acl.ts`, `message-router.ts` knowledge.import ACL, tests for I1/I2/HUD. Only the HTML/CSS implementation was replaced.

---

## Component

### Merge lie vs blob (`summoner-web.ts`)

`a58b78f` body:

> Resolved conflicts:  
> - `companion/src/summoner/shell-open.ts`: keep window-size=800,720 (fix branch)  
> - `companion/src/summoner-web.ts`: accept main branch version (new HUD design)

Window size **is** 800,720 (`companion/src/summoner/shell-open.ts:55`). HUD file **is not** main.

Live CSS is the old dark shell (`#12141c`), `dfab3eb` flex-shrink/min-height patches (`companion/src/summoner-web.ts:621-641`). No `--paper`, no `.rail-btn`, no `.list-scroll`, no `placeWindow`.

### Tests that claim the lost HUD `[executed]`

Companion `npm test`: **fail 3**.

1. `planSummonerShellOpen uses --app window when browser path is known`  
   expects `--window-size=720,120` (`03de168` collapsed strip). Live: `800,720`.  
   `companion/tests/summoner-shell-open.test.ts:71` vs `companion/src/summoner/shell-open.ts:55`.

2. `GET / with token → 200 HTML workbench`  
   expects `--paper:#fff`, `--indigo:#4f46e5`, `class="rail-btn"`, **not** `#12141c`.  
   `companion/tests/summoner-web.test.ts:118-122`. Live HTML is `#12141c` (`summoner-web.ts:621`).

3. `C-thin HTML skills toggle and knowledge attach are not activate-only / replace-all`  
   expects `skill_name:s.name,on:!on` and `ids:next`; forbids `on:true` and `ids:[id]`.  
   `companion/tests/summoner-web.test.ts:539-544`. Live: `on:true` / `ids:[id]` at `summoner-web.ts:924,939`.

Passing (relevant): F-I-5, PEM-through-END, overlay ACL composition, `thread.update` alias-only, HTML mcp.toggle rides tray client, `knowledge.set_active` payload policy.

---

## I1–I8

### I1 C-thin skills tab `on:true` only-activate — **OPEN** (R5)

`03de168` folded this. Merge dropped it.

Live HTML always POSTs `on:true`:

```924:924:companion/src/summoner-web.ts
            api("/api/skills/toggle",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,skill_name:s.name,on:true})}).then(function(){setStatus("已切换技能")});
```

Server treats anything except explicit `false` as on (`summoner-web.ts:476` `const on = body.on !== false`) → always `skill.activate`. Cannot deactivate from C-thin.

Mac HUD path is toggle (`SummonerOverlay.swift:688` `on: !on` → `handleSummonerSkillToggle`). C-thin is the bug.

Test that asserts CLOSED **failed** `[executed]`.

### I2 C-thin knowledge `ids:[id]` replace-all — **OPEN** (R5)

Same merge drop.

```939:939:companion/src/summoner-web.ts
            api("/api/knowledge/active",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({thread_id:threadId,ids:[id]})}).then(function(){setStatus("已挂到当前对话")});
```

Router writes that array as the full selection (`message-router.ts:2620-2628`). One click unpins every other doc.

Mac HUD computes union/difference (`menu-bar-agent.ts:978`). C-thin does not.

Test that asserts CLOSED **failed** `[executed]`.

### I3 Swift knowledge import non-UTF-8 as `base64EncodedString()` body — **OPEN**

Not touched by `03de168` / `dfab3eb`. Source still:

```715:720:companion/src/tray/SummonerOverlay.swift
    jsonLine([
      "type": "summoner.knowledge.import",
      "name": url.lastPathComponent,
      "mime": mimeTypeForAttach(url: url),
      "content": String(data: data, encoding: .utf8) ?? data.base64EncodedString(),
    ])
```

Tray then POSTs **`content` as markdown**, dropping mime (`menu-bar-agent.ts:995-1003`). Non-UTF-8 (PDF, GBK, zip) becomes a base64 *document body*, not a file payload. Pin matches this Swift-era binary (see I3/pin below), so the running HUD has the same bug.

### I4 C-thin disabled stdio MCP → overlay L2 45s stall — **CLOSED**

HTML still hits `/api/mcp/toggle` → `mcp.toggle_server` (`summoner-web.ts:456-464`). Dispatch **reroutes to tray client**:

```1628:1631:companion/src/menu-bar-agent.ts
  if (type === "mcp.toggle_server" && companionClient) {
    // HTML C-thin cannot answer overlay L2; ride tray client like the Swift HUD.
    return companionClient.sendAppRequest(type, params, 60_000)
  }
```

Stdio enable still L2 on that session (`message-router/handlers/mcp.ts:394-410` `requireMcpStdioSpawnConfirm`). Overlay WS still *allows* `mcp.toggle_server` (`summoner-acl.ts:35`) — latent if a future client skips the tray ride — but the specified C-thin HTML path is the tray ride.

Test `HTML mcp.toggle rides tray companionClient` **passed** `[executed]`.

Nit: if `companionClient` is null, fallthrough uses overlay client + 8s timeout, not 45s. Fail-closed-ish, not the original stall.

### I5 Mac `prefix(12)` / search `slice(0,8)`, no independent list scroll — **OPEN**

Still hard-capped:

- threads `prefix(12)` `SummonerOverlay.swift:369`
- packs/mcp/skills/knowledge `prefix(12)` `:562,:577,:595,:615`
- title search `hitsFromTitleSearch(threads).slice(0,8)` `menu-bar-agent.ts:791`

Workbench list is a bare `NSStackView` (`SummonerOverlay.swift:1739-1746`). The only nearby `NSScrollView` (`:1532`) is the **composer** text view, not the rail. Chat log has `logScroll`. Lists do not.

C-thin rail is `overflow:auto` (`summoner-web.ts:627`) and does not `prefix(12)` — Mac-only issue.

### I6 `knowledge.set_active` unknown id silent drop, no unit test — **OPEN**

```2616:2629:companion/src/message-router.ts
    case "knowledge.set_active": {
      ...
      const known = new Set(skillEngine.listKnowledge().map((d) => d.name || d.id).filter(Boolean))
      const next = ids.filter((id: string) => known.has(id))
      threadManager.update(rest.thread_id, {
        active_knowledge_ids: next,
        knowledge_selection_mode: "manual",
      })
      return { type: "knowledge.active", thread_id: rest.thread_id, ids: next }
    }
```

Unknown ids vanish. Response is success with the filtered list. No `dropped` field. Overlay policy only keeps string ids (`summoner-acl.ts:107-123`); it does not exist-check. Tests cover payload shape, not unknown id (`summoner-workbench-compose.test.ts:58`). `03de168` did not add that test.

### I7 `dfab3eb` C-thin flexbox scroll — **CLOSED** (CSS inspected; not pixel-executed)

HEAD CSS **is** the `dfab3eb` patch (`blame` on `summoner-web.ts:621-641`):

| Rule | Intent |
|------|--------|
| `html,body` `height/width:100%; overflow:hidden` | viewport bound |
| `header` `flex-shrink:0` | header not crushed |
| `.shell` `flex:1; min-height:0; overflow:hidden` | column can shrink |
| `.rail` `overflow:auto; flex-shrink:0` | left list scrolls, width held |
| `.main` `min-height:0; overflow:hidden` | |
| `.log` `flex:1; overflow:auto; min-height:0` | transcript scrolls |
| `.composer` `flex-shrink:0` | composer not crushed |
| `--window-size=800,720` | taller than 03de168's 720×120 strip |

`[inspected]` structure is the standard nested-flex scroll recipe. `[assumed]` that Chrome `--app` actually paints a scrollable `.log` — this lane did not open the window.

`03de168`'s `--paper` HUD + `.list-scroll` is **not** in HEAD. I7 as specified is the `dfab3eb` old-shell fix, which survived. The restyle tests fail for a different reason (I1/I2/HUD blob).

Nit: `.rail` scrolls tabs+list together; `.log` is also a column flex container (default `min-height:auto` on `.msg` usually still overflows). Not a squeeze of header/composer.

### I8 `03de168` F-I-5 / PEM END / F-S-1 — **CLOSED**

These files did not take the `dfab3eb` side.

**F-I-5** `[executed]` `importKnowledge: ASCII same heading does not silently overwrite (F-I-5)` passed.  
`skill-engine.ts:1403-1405` no longer deletes an occupied preferred stem from `taken`. `allocateDocIdentity` suffixes (`doc-identity.ts:95-104`). Collision → `notes.md` + `notes-2.md`.

**PEM through END** `[executed]` `redactSecrets PEM through END has no 4000-char cap and does not leak body` + DSA test passed.  
`distill.ts:6-8` `[\s\S]*?` to END or EOS, no `{0,4000}`. PEM applied **before** token regex (`distill.ts:31`).

**F-S-1** `[inspected]` `wrapKnowledgeBlock` (`content-sanitizer.ts:119-128`) hashes `knowledge:${id}` to 12 hex, strips `</?untrusted\b` from body, wraps with ignore-imperatives fence. Wired at retrieve (`skill-engine.ts:659`). **No unit test** of breakout (`grep wrapKnowledgeBlock` in `companion/tests` = 0). Nit, not OPEN: the wrap is on the live retrieve path.

---

## Pin vs binary (R4 / I3)

```
PIN    ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda
BIN    companion/dist/cmspark-tray
SHA256 ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda  match=true  size=441008
```

`companion/cmspark-tray` (packaged root) **missing**; `getSwiftTrayPath()` falls through to `dist/` (`paths.ts:73-80`).

Hash introduced in `#222` `6ce291d`. `03de168` only changed the comment. SummonerOverlay last commit `6ce291d`. **R4 does not fire.**

---

## REJECT gates

| ID | Gate | Fire? |
|----|------|-------|
| R1 | overlay WS `mcp.add` / `knowledge.import` / `config.set` | **no** — ACL deny `[executed]`; C-thin dispatch allowlist has none of them (`summoner-web.ts:19-42`); `unknown / config.set is not dispatched` passed |
| R2 | overlay `thread.update` writes `tool_whitelist` | **no** — policy rewrites to `{alias}` (`summoner-acl.ts:87-105`); test passed |
| R3 | HUD Allow/Deny / `summoner.confirm.*` | **no** — no matches in `SummonerOverlay.swift`; `encoded messages never carry Allow/Deny` passed; SSE drops confirm chrome except `mcp.confirm.pending` copy |
| R4 | pin ≠ `companion/dist/cmspark-tray` | **no** — equal `[executed]` |
| R5 | claimed-folded I1–I8 not actually folded, marked CLOSED | **YES — I1, I2** |
| R6 | new fold breaks overlay-safe ACL | **no** — composition + trash/alias tests passed; `knowledge.import` extra router deny on summoner surface (`message-router.ts:2638-2640`) |

Lifecycle still stamps surface after ACL (`lifecycle.ts:1039-1053`).

---

## Layers

**Outcome.** HEAD is not the P1 C-thin HUD `03de168` claimed. It is `#222` HTML plus `dfab3eb` flex CSS, with `03de168` tests left behind. Companion tests are red (3). Knowledge P1s (I8) and tray L2 ride (I4) survived. ACL did not regress.

**Trajectory.** Two-parent merge with a false resolution note on `summoner-web.ts`. `dfab3eb` never contained I1/I2. Taking that blob un-folded them. Window-size conflict resolved toward `800,720` (good for I7, breaks 720×120 test).

**Component.** Fix is re-merge `03de168` HTML (`on:!on`, `ids:next`, `--paper` HUD) **on top of** `dfab3eb` flex constraints (or port flex onto the HUD). Then retarget `summoner-shell-open.test.ts` to the chosen window size. I3/I5/I6 still need real work; they are not R5.

---

## Status table

| ID | Status | Claimed folded by | Live HEAD |
|----|--------|-------------------|-----------|
| I1 | **OPEN** | `03de168` HTML + test | `on:true` `summoner-web.ts:924` |
| I2 | **OPEN** | `03de168` HTML + test | `ids:[id]` `summoner-web.ts:939` |
| I3 | **OPEN** | (none) | Swift `base64EncodedString()` `:719` |
| I4 | **CLOSED** | `03de168` tray ride | `menu-bar-agent.ts:1628` `[executed]` |
| I5 | **OPEN** | (none) | `prefix(12)` / `slice(0,8)`; list not in `NSScrollView` |
| I6 | **OPEN** | (none) | silent filter `message-router.ts:2624`; no test |
| I7 | **CLOSED** | `dfab3eb` | flex CSS `:621-641` `[inspected]` |
| I8 | **CLOSED** | `03de168` | F-I-5 / PEM / wrap `[executed]`+`[inspected]` |

Nits on CLOSED items: I4 null-tray fallthrough; I7 not pixel-run; I8 no `wrapKnowledgeBlock` unit test.

---

VERDICT: REJECT
