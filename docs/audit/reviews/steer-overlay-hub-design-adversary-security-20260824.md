# Independent adversary — steer/nextRun UI + overlay L0 hub (SECURITY / TRUST)

> **Lane**: Security / Trust (ADR-020). Hostile to Trust elevation.  
> **Role**: independent adversary — did **not** author the spec. Do not rubber-stamp.  
> **Date**: 2026-08-24  
> **Repo**: `/Users/huchen/Projects/cmspark`  
> **Spec**: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`  
> **Scope**: design-only. **No** `companion/src` edits. Live code cited as the contract the spec claims it will reuse.  
> **Evidence tags**: `[inspected]` live source / ADR; `[assumed]` spec prose not yet code.

```text
Surface:      L0 (composer send semantics + overlay chrome)
L2-classes:   (none) — overlay still not an Allow/Deny surface
Compose:      pack.apply from overlay with allowTrust:false only
Autonomy:     single-thread steer / nextRun (already in companion)
Trust:        monotonic — overlay MUST NOT write Trust B
Channel:      summoner ACL expand pack.list + pack.apply; mcp.add stays denied
```

Capability declaration: **present** in the spec. Axes fit on paper (Surface L0 chrome + Composition pack apply, not a new runtime, not a new confirm dialect). Trust monotonicity **does not hold as specified**: overlay `pack.apply` reuses an engine path whose `allowTrust: false` branch **orphans an existing Trust-B cookie**, and "overlay-eligible" is a **client heuristic** the live `pack.list` payload cannot even evaluate. A summoner client that sets `user_gesture: true` (the spec *instructs* Swift to do this) hits today's router which **hardcodes `allowTrust: true`**. The spec's "server forces false" sentence is the entire load-bearing control — and it is underspecified against the engine's cookie/journal/`workspace_path` side effects.

---

## Verdict in one line

PR1 (steer/enqueue, no Trust write) is landable. PR2 as written is **not** a Trust-monotonic overlay apply. Fold the BLOCKs into the spec or do not implement PR2.

---

## What was read `[inspected]`

| Path | Why |
|------|-----|
| spec §0–§8 | claimed gates |
| `companion/src/ws/summoner-acl.ts` | allowlist; `mcp.add` denied; `pack.apply` **currently denied** |
| `companion/src/packs/pack-engine.ts` `applyPack` / `allowTrust` / cookie / journal / `switchingAway` | Trust B write + skip + restore |
| `companion/src/message-router.ts` `pack.apply` / `chat.create` enqueue / `chat.steer` | hardcoded `allowTrust: true`; busy SoT |
| `companion/src/ws/validate.ts` `pack.apply` | `user_gesture !== true` reject |
| `companion/src/ws/lifecycle.ts` handshake surface + ACL + `stampCmsparkSurface` | surface is handshake-stamped, not per-message |
| `companion/src/ws/composer-lease.ts` `stripCmsparkSurface` | "never trust a client-supplied `__cmspark_surface`" |
| `companion/src/mcp/dispatch.ts` overlay confirm retarget | confirm lock |
| `companion/src/ws/l2-conductor.ts` | overlay must not conduct while `host_computer` LIVE |
| `companion/src/tool/companion-dispatch.ts` spawn `allowTrust: false` | spawn is **new thread**, not overlay-on-existing |
| `companion/src/packs/types.ts` `PackListItem` / `HIGH_RISK_NATIVE_TOOLS` | list payload **has no `tools.allow`** |
| builtin `pack.yaml` ×4 | live false-positive corpus |
| `companion/tests/summoner-acl.test.ts` | today **denies** `pack.apply` |
| `companion/tests/packs-engine.test.ts` S46 `allowTrust: false` | skip on **fresh** thread only |
| ADR-014 / ADR-020 | Pack ≠ runtime; Trust B only `user_gesture` + `allowTrust:true`; overlay is L0 |
| `SummonerOverlay.swift` | capture window **420pt**, no confirm dialect |
| Side Panel `App.tsx` composer | busy **disables** textarea; Shift+Enter = newline |

---

## Attack results

### 1. Trust B via overlay despite `allowTrust: false` — **HIT (design)**

**Today's router does not read a client `allowTrust` field. It hardcodes true.** `[inspected]`

```2736:2745:companion/src/message-router.ts
      // allowTrust: only Side Panel user_gesture may write global Trust B.
      // force_takeover: only after UI conflict confirm (still requires user_gesture).
      const forceTakeover = rest.force_takeover === true
      const r = applyPack(rest.pack_id, rest.thread_id, threadManager, skillEngine, {
        workspace_path: rest.workspace_path,
        allowTrust: true,
        forceTakeoverTrust: forceTakeover,
        confirmation_phrase: rest.confirmation_phrase,
      })
```

Engine write gate is `packTrust && originUser && allowTrust` (`pack-engine.ts:1514`). Skip audit is `allowTrust_false` (`:1641–1649`). Spawn already passes `allowTrust: false` (`companion-dispatch.ts:157–158`). `[inspected]`

Spec §3/§4: overlay `user_gesture: true`, router **ignores** client `allowTrust: true` when `stampedSurface === "summoner"`. Intent is right. Holes:

| Lie | Why it still elevates or sticks |
|-----|--------------------------------|
| **`user_gesture: true` from overlay** | Spec *requires* Swift to send the same bit validate.ts treats as "Side Panel only" (`validate.ts:816–818`). `user_gesture` is a **client boolean**, not a handshake stamp. After ACL adds `pack.apply`, overlay + `user_gesture:true` + **forgotten force-false** = today's `allowTrust: true` → Trust B write. |
| **Client `allowTrust: true`** | Spec says 无视. If implementer writes `allowTrust: rest.allowTrust !== false` or `allowTrust: rest.user_gesture === true`, overlay elevates. The only safe contract is **`allowTrust: stampedSurface !== "summoner"`** (never read `rest.allowTrust`). |
| **Wrong socket** | Handshake surface is chosen **once** (`lifecycle.ts:990–991`): `rawSurface === "summoner" ? "summoner" : "tray"`. Tray is **not** ACL-gated (`summoner-acl.ts:7–8, 37`). Overlay `pack.apply` on the **tray** `CompanionClient` (menu-bar WS) skips summoner ACL and keeps `allowTrust: true`. Spec stdin `summoner.pack.apply` must be specified as **summoner WS only**, with a MACHINE test that tray-surface `pack.apply` is not what the rail uses. |
| **Same-pack re-apply cookie orphan** | See Attack 1b. Not a write, **worse**: cruise sticks with no restore cookie. |

`stampedSurface` itself is not client-spoofable per message: `stampCmsparkSurface` overwrites, `stripCmsparkSurface` deletes (`composer-lease.ts:115–126`; `message-router.ts:265–267`). `[inspected]` That only helps if the **connection** is summoner.

**Spawn path is not a second overlay write path.** Spawn `applyPack(..., { allowTrust: false })` targets a **new worker thread** with no prior cookie. Overlay apply targets an **existing** thread that may already hold Trust B. Reusing spawn's flag without reusing spawn's "fresh thread" precondition is the design error.

#### 1b. `allowTrust: false` on a Trust-holding thread orphans cruise — **HIT (S46 invariant)**

`applyPack` patch always sets (`pack-engine.ts:1771–1774`):

```text
mission_pack_trust_snapshot: trustSnap ? copy(trustSnap) : null
```

When `allowTrust` is false, `trustSnap` stays `null` even if the pack **has** a `trust:` block (skip branch only audits). Then `else if (!trustSnap) releaseTrustJournalIfMatch(threadId)` (`:1781–1782`). `[inspected]`

S46 test (`packs-engine.test.ts:253–283`) only applies `allowTrust: false` to a **fresh** thread (`mission_pack_trust_snapshot` already null). It does **not** cover re-apply onto a thread that already holds a cookie. `[inspected]`

Hostile summoner (ACL will allow `pack.apply`) + `user_gesture: true` + pack with `trust:` + `allowTrust` forced false:

1. `switchingAway` is false (same pack) → **no** `restoreTrustFromThreadCookie`.
2. Skip write, `trustSnap = null`.
3. Patch **nulls the cookie**. Journal released.
4. Globals (`auto_approve_dangerous` / 三旗 / modules) **stay elevated**.
5. Later `unapply` / trash / delete sees no cookie → **no restore**. Sticky Trust B.

That is a Trust-monotonicity **failure** (elevation persists without a holder). Overlay-eligible "has `trust:` → gray" is **UI**. ACL + `user_gesture` still deliver the RPC.

Switching **away** to an eligible pack (`meeting-minutes`) **does** restore first (`:1498–1506`) — overlay becomes a **Trust-downgrade** surface without `pack.unapply` on the allowlist. Drop is safer than elevate (ADR-020: switch to a no-trust scene must restore). Spec is silent; users can disarm skip_l2 by one-clicking 会议纪要. Disclose, or refuse overlay apply while a cookie is held.

**Fold (BLOCK):**

1. Router: `allowTrust = stampedSurface !== "summoner"`; **never** `rest.allowTrust` / `rest.user_gesture`.
2. Summoner `pack.apply`: reject packs with `trust:` (`overlay_pack_ineligible` / `overlay_trust_forbidden`) **before** `applyPack`.
3. Engine or router: if `!allowTrust` and thread already has `mission_pack_trust_snapshot`, **do not null the cookie** (preserve or refuse). MACHINE: apply Trust pack from panel, then summoner re-apply same id with `allowTrust: true` in payload → globals unchanged, cookie intact, audit `allowTrust_false`.
4. Overlay rail RPCs only on the summoner-handshake socket.

---

### 2. Overlay-eligible heuristic false-positive — **HIT**

Spec §3 "可点 apply" iff:

- no `trust:` block
- `tool_whitelist` (if present) has no L1 browser / host/computer / `shell_exec` / `netsec_*`
- builtin id/prefix `appsec` / `netsec` / `shell` gray even if whitelist empty

对抗 §6: 「非 eligible Pack 不能 apply」. Spec never says the **router** rejects. Gray is not a control. Summoner `pack.apply` today has no pack-id policy at all. `[inspected]`

**`pack.list` cannot evaluate the stated heuristic.** `PackListItem` (`types.ts:86–112`) exposes `min_capability`, `requires_modules`, `has_trust`, `trust_skip_l2`, `mcp_servers`, `tools_summary_zh`. It does **not** expose `tools.mode` / `tools.allow`. `[inspected]` Swift would see "no whitelist" on every pack, including pentest. That **is** the hunt item.

`pack.get` (has `tools`) is **not** on the proposed ACL. Computing eligible only in Swift from list data **will** false-positive.

Live builtins `[inspected]`:

| Pack | `min_capability` | tools | prefix `appsec\|netsec\|shell`? | Spec eligible if tools missing from list? |
|------|------------------|-------|----------------------------------|-------------------------------------------|
| `meeting-minutes` | L0 | `unchanged`, allow `[]` | no | yes (intended) |
| `appsec-prd-review` | L1 | allowlist: `navigate`, `get_page_html`, `screenshot`, … | **yes** (`appsec-`) | gray via prefix (lucky) |
| `netsec-port-survey` | L1 | `netsec_port_scan` | **yes** | gray via prefix |
| `coding-handoff` | L1 | `list_tabs`, `workspace_*`, **`acp_start_session` / `acp_apply_diff`** | **no** | **FALSE POSITIVE** |

`coding-handoff` is a **shipped** L1/ACP composition pack. Overlay one-click would write thread `tool_whitelist` to include workspace + ACP (ACP start/apply are L2-gated at runtime, but Compose expansion from an L0 surface is still a Surface/Compose cheat). Spec non-goal: 「任何以 L1 网页或 L2 宿主为主的 Pack 在 overlay 一键套用」. Prefix carve-out does not mention `coding-handoff` / `acp_*` / `workspace_*`.

Further false-positives the listed heuristic **does not** catch even with a full manifest:

1. **Empty / `unchanged` whitelist pentest.** `meeting-minutes` is `tools.mode: unchanged`, `allow: []`. A user or installed pack with the same shape, id `user-web-audit`, prompt "use evaluate / navigate", **is eligible**. `unchanged` does not add tools; it **keeps** a null/open whitelist. Overlay apply = jailbreak skill + prompt on an unrestricted thread. Spec's "empty whitelist + prefix" only helps ids that start with `appsec`/`netsec`/`shell`.
2. **Denylist incomplete.** Spec names "L1 浏览器工具、host/computer、`shell_exec`、`netsec_*`". Missing: `evaluate`, `osascript_eval`, `get_cookies`, `acp_*`, `workspace_*`, `HIGH_RISK_NATIVE_TOOLS` (`types.ts:185–193`). A pack whose allowlist is **only** `acp_apply_diff` + `use_skill` passes the written rule.
3. **`mcp_servers` ignored.** Eligible pack can set `active_mcp_server_ids` to already-configured servers (`pack-engine.ts:1727–1728` intersect). That is not `mcp.add`, but it **activates** a write/exec MCP on the thread from overlay. Destructive MCP still hits L2 / trust_level — confirm retargets to Side Panel — but first-use/trusted servers can fire without overlay confirm.
4. **`requires_modules` / `min_capability` ignored.** Spec does not require `min_capability === "L0"` or empty `requires_modules`. `computeApplyBlocked` only checks module **enablement**, not overlay policy (`pack-engine.ts:1216–1227`).
5. **`board_mode`.** `appsec-prd-review` sets `board_mode: true`. If prefix ever drifts, overlay apply turns on Mission Board.

Install strips `trust:` (`sanitizeManifestForInstall`, S46 F2). An installed zip with no trust, `unchanged` tools, id `helpful-notes` is overlay-eligible by §3 and can still ship L1-directing skills. `[inspected]`

**Fold (BLOCK):** `isOverlayEligiblePack(manifest)` is a **server** pure function. Summoner `pack.apply` **rejects** if false. Do not compute eligibility only in Swift.

Recommended predicate (narrow; matches the one intended meeting pack):

- `min_capability === "L0"`
- no `trust:` (normalized empty counts as none)
- `requires_modules` empty
- `mcp_servers` empty
- `board_mode` not true
- `tools.mode === "unchanged"` (or allowlist whose effective allow is a subset of a frozen L0 allow-set: `use_skill` only — **not** CDP/host/shell/netsec/acp/workspace)
- builtin deny-ids: `appsec-prd-review`, `netsec-port-survey`, `coding-handoff`, plus prefix `appsec`/`netsec`/`shell`

MACHINE: `coding-handoff` false; `appsec-prd-review` with tools stripped in the list item still false; `meeting-minutes` true; summoner `pack.apply` of `coding-handoff` → error, no whitelist mutation, no trust snapshot.

---

### 3. Overlay confirm lock / `mcp.add` stay denied — **HOLD, with a bind-path hole**

**Confirm dialect:** spec does not add `security.confirmation.response`, `hud.spike.confirm_response`, or overlay Allow/Deny. ACL today denies `security.confirmation.response` (`summoner-acl.test.ts:24–37`). MCP overlay cannot confirm; retarget to Chrome panel (`mcp/dispatch.ts:59–80`). L2 conductor blocks overlay `chat.create` / `chat.steer` while `host_computer` LIVE (`l2-conductor.ts:18–31`). `SummonerOverlay.swift` has **no** confirm handler. `[inspected]`

`force_takeover` lives **inside** `if (packTrust && originUser && allowTrust)` (`:1514–1588`). With allowTrust forced false it is a no-op. Still **strip** it on summoner so overlay cannot become the Trust-unlock confirm surface if the force-false line regresses.

**`mcp.add`:** spec only adds `pack.list` + `pack.apply`. `mcp.add` / `mcp.remove` / `mcp.toggle_server` / `mcp.set_selection` / `pack.install` / `pack.save_user` / `config.*` stay off the list. `mcp.list` already allowed. Engine does not call `mcp.add` on apply (intersect configured ids only). `[inspected]`

Tests **today** assert summoner **denies** `pack.apply`. PR2 must **invert that one assertion** and keep the `mcp.add` deny loop. Do not "expand allowlist to pack.*" .

**`workspace_path` — HIT (Host bind from overlay).** Router forwards `rest.workspace_path` into `applyPack` (`message-router.ts:2740`). Engine writes `workspace_root: opts?.workspace_path ?? thread.workspace_root` with **no folder-picker** (`pack-engine.ts:1768`). ADR-014: workspace_root bind is **native folder-picker only**. Spec Swift payload is `{ pack_id }` only; a summoner WS client can still send `workspace_path: "/etc"` or a repo path. That is L2-adjacent Host composition from an L0 overlay that is not an Allow/Deny surface.

**Fold (BLOCK):** on `stampedSurface === "summoner"`, ignore/drop `workspace_path`, `force_takeover`, `confirmation_phrase`, `allowTrust`. MACHINE: summoner apply with those fields set does not bind `workspace_root`, does not write Trust, does not takeover.

---

### 4. Busy-state SoT (`SET_THREAD_BUSY` vs `abortControllers` vs lease) — **NIT for Trust; MAJOR for PR1 DoD**

Three clocks `[inspected]`:

| Clock | Where | Overlay today |
|-------|--------|----------------|
| `abortControllers` | `message-router.ts` | enqueue (`:349`), steer (`:551`), supersede (`:373–379`) |
| `SET_THREAD_BUSY` / `threadBusyById` | extension `run_status` + tokens + tools + **upload** | summoner `thread.select` **strips** `run_status` (`:1797–1801`) |
| composer lease | `composer-lease.ts` | overlay vs panel; `OVERLAY_STANDBY` |

Spec: overlay busy mapping in **Node** via `abortControllers`, "与 panel 同一 SoT". That is the right SoT for "is there an LLM run to steer?" Side Panel `threadBusy` is a **lagging projection** and is **wider** (uploads, tool cards). Upload also parks an AbortController (`:809`) — overlay would treat upload as LLM-busy and `chat.steer` (`:551` only checks `abortControllers.has`). Steer-during-upload is confusion, not Trust elevation.

Lease already gates `chat.create` and `chat.steer`. Enqueue is `chat.create` + `enqueue:true` → same lease gate. `[inspected]` Good.

**PR1 landmine:** Side Panel **disables** the textarea and send when `threadBusy` (`App.tsx:1771–1776`, `1171–1178`). Busy second send from **panel** is currently **impossible**; supersede is the **overlay** `sendChatCreate` → always `chat.create` (`companion-client.ts:286–290`, `summoner/client.ts:152`). `[inspected]` PR1 must **re-enable** panel input while busy (except `l2_task` / `OVERLAY_STANDBY`) or DoD "busy Enter = steer" is false. Overlay Node mapping must run **before** the supersede block (`:369–379`). If Swift guesses busy and still sends `chat.create` without `enqueue`, companion must remap.

---

### 5. Shift+Enter vs newline — **NIT (not Trust)**

Idle: `Enter` without shift sends; Shift+Enter is newline (`App.tsx:1151–1152`). Spec §5: idle hide 纠偏/排队; idle Shift+Enter = newline (panel) / ignore (overlay single line); **busy** Shift+Enter = enqueue. `[inspected]`

Collision: enabling the busy textarea without `preventDefault` on busy Shift+Enter inserts a newline **and** enqueues. Overlay `summoner.submit` has **no** modifier field today (`summoner/protocol.ts:83`). Spec must add `enqueue` / `shift` on stdin and map in Node.

Also: send-shortcut `Cmd+Enter` / `Ctrl+Enter` users — spec only defines Enter / Shift+Enter. Idle Cmd+Enter senders have no busy enqueue chord. Product nit.

---

### 6. Steer as `chat.user` pairing — **NIT (not Trust)**

Spec: companion already echos steer as `chat.user`; UI must not insert a fake bubble. Overlay optimistic pairing uses `clientMessageId` on `chat.create` (`App.tsx` / `useWebSocket.ts`). `chat.steer` return is `{ type: "chat.steered" }` with **no** echo id in the router case (`:543–568`). `[inspected]` If Swift/panel inserts a local user bubble on steer, pairing can double. Not a Trust issue. Do not send steer as `chat.create` "to get pairing".

---

### 7. Mid-run `pack.apply` + live `tool_whitelist` — **MAJOR (Compose, not Trust-B write)**

Spec §5: 「跑着套 Pack — 允许 composition-only apply；不 abort」. `applyPack` mutates `tool_whitelist` immediately (`:1715–1760`). Current LLM turn already holds the **old** tool catalog; next turn (and some in-turn dispatches that re-read thread) see the new list. `[inspected]`

If overlay-eligible is **wrong** (Attack 2), mid-run apply can **add** `navigate` / ACP / workspace while a loop is live — Compose elevation without a new L2. If eligible is `tools.mode === "unchanged"` only, whitelist should not change; remaining risk is skills/prompt jailbreak (Attack 2.1).

**Fold:** summoner apply either (a) refuse while `abortControllers.has(thread)` **or** (b) keep allow-run but **server-eligible** so whitelist cannot grow to L1/L2. Do not leave "composition-only" as a synonym for "any pack".

---

### 8. Swift 200pt rail vs 420pt capture window / Windows honesty — **NIT (not Trust)**

`SummonerOverlay.swift:862–875`: content width **420**, `minSize.width = 420`. `[inspected]` A 200pt left rail without growing the window leaves ~220pt for transcript + field. Not a Trust bug; can hide MCP chips / pack names and push users to click the wrong scene. Spec should set a new min width (e.g. 420+200) and keep Windows/Linux overlay **no-op** (PR1 Side Panel only) — already in non-goals. Honest.

---

## Hunt checklist

| Hunt | Result |
|------|--------|
| Trust B via overlay despite `allowTrust:false` (user_gesture, client lie, spawn) | **HIT** — gesture bit + hardcoded router + wrong socket + cookie orphan. Spawn is not the overlay thread. |
| overlay-eligible false-positive (empty whitelist pentest) | **HIT** — `pack.list` has no tools; `coding-handoff` misses prefix; `unchanged` empty allow = meeting-minutes shape. |
| busy SoT wrong | **Partial** — Node `abortControllers` is correct if actually used; panel `threadBusy` currently **blocks** input; upload shares the map. |
| Shift+Enter vs newline | **NIT** — spec splits idle/busy; no `preventDefault` / overlay modifier specified. |
| steer as `chat.user` pairing | **NIT** |
| mid-run apply + live tools | **MAJOR** unless eligible is server-enforced and `unchanged`. |
| 200pt rail / Windows no-op | **NIT** — 420pt window; Windows no-op already honest. |
| overlay confirm dialect | **HOLD** if ACL does not add confirm methods and `force_takeover` is stripped. |
| `mcp.add` stays denied | **HOLD** if tests keep denying it after `pack.apply` is allowed. |

---

## ADR-020 / ADR-014 fit

- Pack apply from overlay is **Composition**, not a new runtime. Correct. `[inspected]` ADR-020 §3.B.
- Trust B: ADR-020 exception is **`user_gesture` + `allowTrust:true`**, Side Panel; `spawn_worker` / install must not elevate. Overlay sending `user_gesture: true` **collides** with that sentence unless the spec **redefines** the Trust bit as **`stampedSurface !== "summoner"`**, not the gesture flag. `[inspected]`
- Overlay is not an Allow/Deny surface (claimed). Adding `pack.apply` that can bind `workspace_root` or orphan cruise **violates** "L0 must not inherit L2 bind / Trust write".
- `mcp.add` denied preserves Channel / MCP L2 (stdio add is SEC-B L2). Good.

---

## What already holds (do not regress)

1. `stampedSurface` overwrite + strip — keep; never trust body `surface`.
2. Spawn `allowTrust: false` on **new** workers — keep; do not treat as proof overlay-on-existing is safe.
3. Overlay confirm retarget + L2 conductor + ACL deny `security.confirmation.response`.
4. `mcp.list` read-only already on summoner ACL.
5. Install strips `trust:` / spoofed `origin:user`.
6. `packTrustWritesCruiseFlags` + phrase step-up on the **panel** allowTrust path (C5). Overlay must never reach that branch.

---

## Required spec folds before PR2 is implementable

Must appear in the spec (not only in this review):

1. **`allowTrust` contract (exact):** `applyPack(..., { allowTrust: stampedSurface !== "summoner" })`. Never read `rest.allowTrust`. `user_gesture` remains required (anti-LLM) and is **not** the Trust gate. Copy: "UI gesture only"; Trust: "panel connection only".
2. **Summoner `pack.apply` extra denials:** `isOverlayEligiblePack` server-side; reject ineligible with a stable code. Strip `workspace_path` / `force_takeover` / `confirmation_phrase`.
3. **Cookie invariant:** `!allowTrust` must not null an existing `mission_pack_trust_snapshot`. Prefer refuse overlay apply when a cookie is held (Side Panel unapply / switch). MACHINE included.
4. **Eligible predicate** as in Attack 2 fold; expand `pack.list` with `overlay_eligible: boolean` **computed server-side** (Swift may gray from that bit only). Do not teach Swift to infer from missing `tools`.
5. **Socket:** rail `pack.list` / `pack.apply` only on handshake `surface=summoner`. Document that tray WS `pack.apply` remains the old Side-Panel-class path and **must not** be used by overlay.
6. **ACL tests:** allow `pack.list`/`pack.apply`; still deny `mcp.add`, `pack.install`, `pack.save_user`, `pack.unapply`, `config.set`, `security.confirmation.response`.
7. **Mid-run:** either refuse overlay apply while LLM-busy, or eligible⇒`unchanged` tools so whitelist cannot grow.

PR1 folds (non-blocking for Trust): remap overlay submit in Node before supersede; re-enable panel composer when busy; busy Shift+Enter `preventDefault`; overlay submit modifier.

---

## MACHINE the spec still owes (PR2)

The spec's PR2 MACHINE list is necessary but **not sufficient**:

| Test | Must assert |
|------|-------------|
| summoner `pack.apply` + `allowTrust: true` in body | `trust_applied: false`, globals unchanged, audit `allowTrust_false` / skip |
| summoner `pack.apply` of `coding-handoff` / `appsec-prd-review` | reject, thread whitelist unchanged |
| summoner `pack.apply` of `meeting-minutes` | ok, no trust snapshot, no cruise flags |
| panel apply Trust pack, then summoner re-apply same id | cookie **still present**, cruise still held or explicitly restored — **not** orphaned |
| summoner `pack.apply` with `workspace_path` | `workspace_root` unchanged |
| summoner `mcp.add` | `SUMMONER_ACL` |
| tray-surface `pack.apply` is **not** invoked from overlay client | source lock / unit on the stdin handler |

---

## PR1 vs PR2

| Slice | Trust | This lane |
|-------|-------|-----------|
| PR1 steer / enqueue / stop | no Trust write; `chat.steer` already on ACL | nits only (SoT, Shift+Enter, pairing) |
| PR2 overlay rail + `pack.apply` | **fails** monotonicity as specified | **REJECT** until folds |

Shipping PR1 alone is acceptable. Coupling "两个 PR 连做" does not make PR2's Trust holes landable.

---

VERDICT: REJECT
