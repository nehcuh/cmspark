# Architecture adversarial review — OS Agent Shell nits (identity SoT)

Lane: **ARCHITECTURE**. Read-only. No production edits. Did not read other lane reports or merge-prep adversary/pi files.

| Field | Value |
|---|---|
| Repo | `/Users/huchen/Projects/cmspark` |
| Branch | `feat/os-agent-shell` (dirty, ahead 1 of origin) |
| HEAD | `659bbcebeca13dd136080c0ef47ed7da1ce3700b` |
| Blast | T3 — identity SoT |
| Date | 2026-08-23 |
| Reviewer | independent architecture lane |

**Hunt:** dual-write, leaky invariants, layering violations around:

1. `composer.lease` exclusive overlay
2. overlay-session generation
3. summoner disconnect release
4. S23 process-continue vs window-rect

---

## Machine `[executed]`

```
cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json --pretty false
```

**exit 0** (no diagnostics).

```
node --test .test-dist/tests/overlay-session.test.js .test-dist/tests/composer-lease.test.js
```

**35 pass / 0 fail / 0 skip.** Duration ~42 ms.

```
shasum -a 256 dist/cmspark-tray
```

`eae29dc748584d4de7e60c621c13da71ec633f2b33b2de1caee970196e7fb67b`

`companion/src/tray/swift-tray-bridge.ts:59` `SWIFT_TRAY_SHA256` is the same digest.

**SHA lockstep: MATCH.**

---

## Identity map `[inspected]`

| Question | Intended SoT | Where it actually lives | Cross-process? |
|---|---|---|---|
| Who holds the composer for thread T? | `ComposerLeaseRegistry` | `companion/src/ws/composer-lease.ts:37-94` process-wide `composerLeases` **in the daemon/server process** | Yes — clients mutate via WS RPC |
| Overlay window still open (cancel in-flight hydrate/claim)? | generation token | `companion/src/summoner/overlay-session.ts:3-23` module globals **in the tray process** | No — tray-local by design |
| Overlay's current thread | lease holder + `summonerThreadId` | tray memory `menu-bar-agent.ts` + disk `config.summoner.last_thread_id` | Dual-write (see NIT-4) |
| Side Panel "can't type" chrome | projection of lease | `agentStore.overlayStandby` | Cache; server gate is still SoT |
| CU FG-yield "this is our UI, continue" | `companion_ui_exe_basenames` minus overlay/tray | `self-ui.ts:41-103` + `config.ts:1159-1168` strip | Server-local, **works** |
| CU click lands on overlay/HUD/tray/pairing | window-rect map | `companion-ui-rects.ts:15` Map, **written only from tray stdout** | **Wrong process — BLOCK-1** |

Production topology is **two Node processes** `[inspected]`:

- `cmspark-agent start` / `daemon start` → `startServer()` only (`index.ts:312-315`, `index.ts:176`).
- `cmspark-agent tray` / SEA double-click / `scripts/menu-bar-launcher.sh` → `startMenuBarAgent()` only (`index.ts:346-355`, `index.ts:457`). `menu-bar-agent.ts` never calls `startServer`; it may spawn `daemon start --daemonize` as a **grandchild** (`menu-bar-agent.ts:353`).

HUD-spike comments calling dual-process "normal tray + server" match this. In-process `getTrayInstance()` inside the daemon is the spike exception, not the shipped path.

---

## Findings

### BLOCK-1 — S23 window-rect SoT is in the tray process; CU executor never sees it

**Layering violation. Dual SoT with a dead half.**

S23's intended split is stated in code:

- Process-level continue is **forbidden** for overlay/tray/host (`self-ui.ts:53-56`, `isDeniedCompanionUiProcess` at `self-ui.ts:91-102`).
- Clicks on companion UI are **hard-denied by window-rect**, not by silent FG continue (`companion-ui-rects.ts:71-78`, `executor.ts:1371-1383`).

Process-continue is wired on the **server** and is real:

- DEFAULT_CONFIG omits `cmspark-tray` (`config.ts:446-451`).
- `stripCompanionUiProcessContinueDeny` runs on load and save (`config.ts:659`, `config.ts:1234`, `config.ts:1159-1168`).
- Hard deny of `cmspark-tray` / `com.cmspark.agent` / `com.cmspark.host` even if the allow-list contains them (`self-ui.ts:91-102`).
- Executor FG-yield then `isCompanionUiOwner` → `forceForeground` + `continue` **does not fire** for those identities (`executor.ts:1614-1632`). Tests cover path + Darwin bundle id (`computer-executor.test.ts:1212-1238`, `computer-self-ui.test.ts:44-72`).

Window-rect is **not** on the server:

- Swift emits `companion.ui.rect` on overlay open/hide/relayout (`Tray.swift:41-58`, `Tray.swift:1616-1621`, `Tray.swift:2257`) and HUD/tray/pairing.
- The **only** production writer is `swift-tray-bridge.ts:538` `applyCompanionUiRectEvent(event)` in the **tray** process.
- The **only** production reader is `executor.ts:60,1371-1383` `assertClickClearsCompanionUi` in the **daemon** process.
- There is no WS type, no `handleMessage` case, no shared memory. `companion-ui-rects.ts:15` is a module-level `Map` — per process.

Consequence `[inspected]`: in the shipped topology the executor's map is always empty. `screenPointHitsCompanionUi` returns `null` (`companion-ui-rects.ts:62-68`). `assertClickClearsCompanionUi` is a no-op. S23's "hard-deny this click" never runs.

Process-continue deny does **not** substitute: it runs **after** inject (`executor.ts:1393+`), and only changes "silent continue" into re-L2. The click (or HUD Allow press, if CGEvent hits the floating window) has already happened. That is the opposite of S23's law.

Unit tests for rects (`companion-ui-rects.test.ts`) and SHA-locked Swift emit are in-process tautologies. They do not bind tray stdout to the daemon Map.

**Required fold (architecture, not a drive-by patch):** rect events must land in the **same process as the executor**. Either:

1. forward `companion.ui.rect` over the already-authenticated tray/summoner WS and apply in the daemon, or
2. have the daemon spawn Swift (reject — tray owns the binary), or
3. drop the window-rect claim and keep S23 as process-continue-only, documented as P1 residual.

Until (1) or (3), the dirty tree **asserts a SoT it does not own**.

---

### MAJOR-1 — Overlay-holder identity is a flag, not a connection

`handleComposerLeaseFamily` (`composer-lease.ts:160-185`) accepts `holder: "overlay"|"panel"` from **any** authenticated peer. Summoner ACL allows the four lease RPCs (`summoner-acl.ts:19-22`); tray/extension are ungated.

Server stamps `__cmspark_surface` from handshake (`lifecycle.ts:991`, `lifecycle.ts:1046`, `composer-lease.ts:115-119`) and `chat.create` maps `summoner→overlay`, else `panel` (`composer-lease.ts:96-98`, `message-router.ts:305`). That gate is sound for **sends**.

Mutations are not bound to the summoner socket:

- Side Panel can `composer.lease.claim` `holder:"overlay"` and lock **itself** into `OVERLAY_STANDBY` while overlay (or anyone) types.
- `release_overlay` from any peer drops every overlay hold.
- `overlayLeasesOnSummonerDisconnect` releases **all** overlay holds when **any** `surface==="summoner"` socket dies (`composer-lease.ts:295-301`, `lifecycle.ts:1353`). Correct iff there is exactly one summoner WS. Construction today: one `summonerClient` (`menu-bar-agent.ts:1274-1294`). Not an invariant of the registry.

Exclusive-thread overlay (`claim` then `releaseAllOverlay(except)` at `composer-lease.ts:55-56,76-90`) **is** enforced. Exclusive-**connection** overlay is not. The SoT answers "which thread" not "which socket".

Not a merge-stopper if the product stays one overlay WS. It is a leaky identity: holder is spoofable by the extension the lease is supposed to protect.

---

### MAJOR-2 — Close release is best-effort; generation is not the server's backstop

Happy path is right:

1. `handleSummonerClosed` invalidates generation then RPC `release_overlay` (`menu-bar-agent.ts:698-702`).
2. Summoner WS `close` broadcasts panel leases (`lifecycle.ts:1353`).
3. In-flight hydrate/claim rechecks the token and `releaseAllLeases` (`overlay-session.ts:39-46,53-57`).

Holes `[inspected]`:

- `releaseAllOverlayComposerLeases` **returns without RPC** if `_state !== "connected"` and **swallows** errors (`companion-client.ts:364-370`). Generation is already dead, so submit will not retry a claim/release (`claimOverlayIfLive` no-ops).
- Overlay hide does **not** disconnect the summoner WS (client is started at tray boot and kept). Disconnect backstop therefore **does not run on close**. The close RPC is the only server write. If it fails while WS is up, holder stays `overlay`, Side Panel is `OVERLAY_STANDBY` until process death or a later overlay claim.
- `handleSummonerClosed` does not clear `summonerThreadId`. `handleSummonerContinue` sends `chat.create` with **no** generation check and **no** claim (`menu-bar-agent.ts:719-721`). A stale Swift `summoner.continue` after a failed release still writes.

Generation (tray) and lease (server) are correctly **two layers**. They are not a transaction. Close can split them.

---

### MAJOR-3 — Exclusive composer is `chat.create` only

`gateChatCreateOnLease` is applied in `chat.create` (`message-router.ts:305-308`). `chat.regenerate` has trash/pause gates and **no** lease gate (`message-router.ts:1075-1099`). Side Panel can edit/regenerate the overlay-held thread. Overlay ACL does not include regenerate (`summoner-acl.ts:11-28`) — the dual writer is the panel.

S20 comment is "No dual drafts." Regenerating is a second writer on the same thread, not a second textarea. Call it if the law is "one composer surface"; ignore if the law is "one input box." Architecture: the SoT does not cover all thread mutations.

---

## NITS

### NIT-1 — `composer-lease.ts` is a mixed-layer module

Server registry + WS handlers + **client CAS retry** (`claimOverlayLeaseCas` / `releaseOverlayLeaseCas` / `applySummonerComposerVisibility`, `composer-lease.ts:236-376`) live in `ws/`. Tray `companion-client.ts:23,345-367` imports the server module.

`applySummonerComposerVisibility` (`composer-lease.ts:283-292`) encodes open→claim / close→release_all and is **unused in production**. Production uses `hydrateOverlayIfLive` + `handleSummonerClosed`. Two encodings of the same policy will drift (the unused helper already takes a stale `threadId` on close and ignores it — tests lock that).

### NIT-2 — Overlay-session generation is "attempt id", not "window id"

Comment: "Overlay-open generation so in-flight hydrate/claim cannot outlive close" (`overlay-session.ts:1`). `beginOverlaySession` also runs on every hydrate/new-thread (`menu-bar-agent.ts:638,973`), including search-select while the window is already live (`handleSummonerSelect` → `hydrateSummonerThread`). A second begin invalidates the first token (`overlay-session.ts:6-9`, test at `overlay-session.test.ts:80-86`). Submit that captured the old token (`handleSummonerSubmit` at `menu-bar-agent.ts:727`) no-ops and may `releaseAll`. Singleton overlay wants that for thread switches; it is not "window lifetime."

Module globals are process-wide in the tray. Tests mutate the production singleton via `invalidateOverlaySession()`. Acceptable only because overlay is a singleton.

### NIT-3 — Side Panel `overlayStandby` is a filtered projection

`composer.lease` broadcast is dropped unless `leaseTid === activeThread` (`useWebSocket.ts:475-480` + `shouldApplyStreamEvent` at `useWebSocket.ts:93-99`). Thread switch clears standby unconditionally (`agentStore.tsx:801`). No `composer.lease.get` on select. Panel-origin `ADD_MESSAGE` also clears (`agentStore.tsx:824-825`).

Server still denies `chat.create`. UI can show a writable composer on an overlay-held thread until the next send. Cache, not dual-write of the SoT — still a leaky projection.

### NIT-4 — Resume-thread identity is dual-write and the idle function is a stub

`summonerThreadId` (memory) vs `config.summoner.last_thread_id` (disk via `touchSummonerActivity` / `persistSummonerPatch`, `menu-bar-agent.ts:620-625`). `shouldStartNewSummonerThread` (`summoner/client.ts:186-193`) returns true only for `resumeIdleMinutes === 0`; `now` / `lastActivityAt` / 5/10/30/-1 are ignored. Resume identity is not the lease, but it decides which thread the overlay **claims**.

### NIT-5 — Window-rect cache is fail-open even in a hypothetical in-process world

Independent of BLOCK-1:

- No `windowDidMove` / `windowDidResize` emit; overlay rect updates only on `relayout` (`Tray.swift:2257`). Drag leaves a stale rect.
- Y conversion uses `NSScreen.main` (`Tray.swift:48`), not `window.screen`. Secondary display is wrong Quartz space vs `host.swift` `kCGWindowBounds`.
- `type` / `key` skip `assertClickClearsCompanionUi` (`executor.ts:1332-1368` vs `1369-1383`). Overlay-focused typing is a self-UI continue analogue. S23 prose is 点击; still a hole if CU `type`s while overlay is key window.
- Empty map fail-opens (`companion-ui-rects.ts:71-73`).

### NIT-6 — L2 conductor is a second, coarser identity on `chat.create`

`gateChatCreateOnConductor` (`l2-conductor.ts:19-31`) blocks **all** summoner `chat.create` when `getComputerTaskAbortRegistry().size > 0` — process-wide, not per-thread. `ws/` imports `computer/` registry. Layering is acceptable as a gate; identity is "any CU live" not "this thread's conductor." Overlay continue during an unrelated CU task is denied. Not dual-write of lease.

---

## What holds (do not re-litigate)

These are **not** BLOCKs. Stating them so the REJECT is scoped.

1. **Exclusive overlay lease at the registry** `[inspected]` `[executed]`: overlay claim demotes siblings; panel siblings stay panel; `release_overlay` is the close primitive; broadcasts include `released_siblings`. Tests 35/0 include the exclusive + disconnect cases.

2. **Surface stamp is server-authored** `[inspected]`: `stampCmsparkSurface` overwrites; `stripCmsparkSurface` in `handleMessage` (`message-router.ts:253-254`) before the lease gate. Client `__cmspark_surface` is not trusted.

3. **Overlay-session as cancel token** `[inspected]` `[executed]`: close-during-select does not claim; close-during-claim releases; live hydrate claims once. Right layer (tray) for "did the window outlive this await."

4. **Summoner disconnect release is wired on the server close path** `[inspected]`: `lifecycle.ts:1353` → `broadcastOverlayLeasesOnSocketClose`. Tray WS close does not drop overlay holds (correct: overlay is the second socket).

5. **S23 process-continue is closed on current identities** `[inspected]`: tray basename, path, Darwin `com.cmspark.agent`/`host` cannot silent-continue; config strip + hard deny are two layers that agree. Darwin adapters report `bundleId` as `exePath` (`darwin-adapters.ts:296`) — the bundle-id deny is the one that matches production, not the path-shaped executor test.

6. **Tray SHA lockstep** `[executed]`.

---

## Dual-write / leaky-invariant scorecard

| Invariant | Status |
|---|---|
| At most one thread holds overlay | **Holds** in `ComposerLeaseRegistry.claim` |
| Overlay-visible ⇒ overlay holds | **Holds** if hydrate/claim RPC succeeds; **leaks** if close RPC fails while WS up (MAJOR-2) |
| Overlay-closed ⇒ all overlay holds panel | **Holds** on WS death; **best-effort** on UI close |
| In-flight hydrate cannot outlive close | **Holds** (generation) |
| CU click on overlay/HUD/tray/pairing hard-denied | **Does not hold in production topology** (BLOCK-1) |
| CU FG-yield to overlay does not silent-continue | **Holds** (process deny) |
| One composer writer per thread | **Holds** for `chat.create`; **not** for `chat.regenerate` (MAJOR-3) |

---

## Verdict rationale

Lease + generation + disconnect are the right shapes: server Map with CAS, tray cancel token, close/disconnect release. That part of T3 is mergeable.

S23 was explicitly in blast. The dirty tree added a window-rect module and executor asserts as if the daemon owned that Map. The writer is the tray process. That is not a nit: it is a SoT in the wrong layer, green tests that cannot catch it, and a click gate that fail-opens. Process-continue closing "silent continue" does not close "hard-deny the click."

Do not merge T3 as "S23 window-rect done" until rects are applied where `runComputerTask` runs, or the claim is withdrawn.

VERDICT: REJECT
