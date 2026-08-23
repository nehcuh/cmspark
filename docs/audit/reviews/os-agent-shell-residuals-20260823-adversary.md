# Independent adversary — OS Agent Shell residuals (H1 / H2 / H4 / H5 / H6)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Role | **Independent** adversarial reviewer. Did **not** implement this batch. Hostile to grep-theater. |
| Repo | `/Users/huchen/Projects/cmspark` |
| Branch | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` **+ dirty tree** |
| Blast | T3 — composer.lease identity + computer-use S23 self-UI continue |
| Claim | Close Pi nits H1, H2, H4 (and cheap H5/H6) |
| Priors | `os-agent-shell-vs-main-20260823-synthesis.md` (3 BLOCKs, already closed last batch); `os-agent-shell-merge-prep-20260823-adversary.md`; `os-agent-shell-merge-prep-20260823-pi.md` |
| Isolation | Production source **not** modified. Implementer session not treated as evidence. |

```text
Surface:      OS summoner overlay (L0 capture) + Side Panel composer.lease
L2-classes:   computer-use FG-yield self-UI recovery (S23)
Compose:      none
Autonomy:     single
Trust:        overlay lease is SoT for who may chat.create;
              companion_ui_exe_basenames is a UX heuristic that must NOT skip
              re-L2 when FG yields to cmspark-tray / com.cmspark.agent
Channel:      community
```

This review scores **whether the named Pi nits are actually closed**, not whether the original vs-main BLOCKs reopen. Those BLOCKs stay closed unless a residual restores the named failure.

---

## MACHINE `[executed]`

All commands re-run this session from `/Users/huchen/Projects/cmspark/companion` on the dirty tree. Implementer's board is not trusted.

| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsc -p tsconfig.test.json --pretty false` | **0 errors** (`TSC_EXIT:0`) |
| `node --test` overlay-session + composer-lease + summoner-overlay + summoner-talk + computer-self-ui | **86 pass / 0 fail** (`NAMED_EXIT:0`) |
| `node --test --test-name-pattern "S23\|cmspark-tray\|companion_ui\|Darwin"` config + computer-executor | **5 pass / 0 fail** (`S23_EXIT:0`) |
| `shasum -a 256 dist/cmspark-tray` | `b8651ce18b8746632270f42654636cc9060d4029849a8aeeeedd1f919841acdc` |
| `SWIFT_TRAY_SHA256` `swift-tray-bridge.ts:59` | **equal** (lockstep) |
| tray binary vs `Tray.swift` mtime | binary `22:06` after Swift `22:05`; pin comment "H1 applyHydrate guard + dead mic tooltip" |

SHA moved from the prior merge-prep pin (`402de162…`) — expected after the Swift rebuild. Pin and artifact match **this** tree.

Direct identity probe `[executed]` (compiled `isCompanionUiOwner`, not a test file):

| fgOwner | allow-list | result |
|---------|------------|--------|
| `com.google.Chrome` | defaults (includes `com.google.chrome`) | **true** (`allow.has(raw)` + last-seg) |
| `com.google.Chrome` | `["chrome"]` only | **true** (last-seg / chrome heuristic) |
| `com.cmspark.agent` | defaults (`cmspark-agent` present) | **false** |
| `com.cmspark.agent` | `["chrome","cmspark-agent","agent"]` | **false** (deny beats last-seg `"agent"`) |
| `com.cmspark.agent` | allow-list contains `"com.cmspark.agent"` | **false** (deny beats `allow.has(raw)`) |
| `com.cmspark.host` | defaults | **false** |

Binary strings `[executed]`:

| needle | in `dist/cmspark-tray` |
|--------|------------------------|
| `按住说话` / `也可按住说话` / `说点什么，或按住说话` | **ABSENT** |
| `听写暂未开放` | **PRESENT** (1) |
| `回车发送到当前线程` | **PRESENT** (1) |
| `说点什么` | ABSENT as cstring (SSO-sized placeholder; same as prior Pi note) |

---

## Hunt scorecard (mandatory)

| Hunt | Answer | Tag |
|------|--------|-----|
| Does `applyHydrate` guard apply to **SummonerController**, not HUD? | **Yes.** HUD `applyHydrate` at `Tray.swift:1058` has **no** `isOpen` guard and does **not** call `open()`. Summoner `applyHydrate` at `:1625` is the second definition; first statement is `guard isOpen else { return }`. | `[inspected]` |
| Can HUD still hydrate? | **Yes, by design.** `hud.hydrate` → `hudController.applyHydrate` (`:536-537`). Updates fields on an existing HUD; reopen is only `showConfirm` (`:1114-1116`). Not the overlay-lease identity. | `[inspected]` |
| Does `allow.has(raw)` still continue Chrome? | **Yes.** Defaults now include `"com.google.chrome"`. `raw` is lowercased, so Darwin `com.google.Chrome` continues via `allow.has(raw)` **and** last-seg `"chrome"` **and** `MAC_COMPANION_BUNDLE_IDS`. Probe `[executed]`. | `[executed]` |
| Does last-segment `"agent"` matching `cmspark-agent` still continue `com.cmspark.agent`? | **Must be false — is false.** Deny-list runs first (`self-ui.ts:54-56`, `:100-101`). Last-seg of `com.cmspark.agent` is `"agent"`, which is **not** `"cmspark-agent"` anyway. Even with `"agent"` or `"com.cmspark.agent"` on the allow-list, result is false. Probe `[executed]`. | `[executed]` |
| lifecycle uses `closedAuth.surface` AFTER `delete` — is surface still available? | **Yes.** `const closedAuth = wsAuth.get(ws)` then `wsAuth.delete(ws)` then `overlayLeasesOnSummonerDisconnect(closedAuth?.surface)` (`lifecycle.ts:1348-1353`). `delete` removes the WeakMap entry; the local object is intact. `undefined` auth → `surface` undefined → helper returns `[]`. | `[inspected]` |
| hydrate sets `summonerThreadId` before abandon — leftover identity? | **Yes.** `hydrateSummonerThread` assigns `summonerThreadId = id` **before** `hydrateOverlayIfLive` (`menu-bar-agent.ts:637-638`). Abandoned hydrate does not roll it back. Search/select then always `touchSummonerActivity` (`:762-764`, `:772-773`) even on abandon. Lease is **not** held; this is resume-id leftover, not OVERLAY_STANDBY. | `[inspected]` |
| Tests that only grep? | **Yes, several.** Overlay Swift + menu-bar-agent + lifecycle **wiring** tests are `readFileSync` + `assert.match`. Load-bearing evidence is `overlay-session.test.ts`, `composer-lease.test.ts` disconnect case, `computer-self-ui.test.ts`, executor Darwin S23, config save-strip. | `[inspected]` + `[executed]` |

---

## H1 — overlay-session generation

**Pi ask:** generation token on hydrate/new-thread; `summoner.closed` invalidates in-flight claims; Swift `applyHydrate` must not `open()` when `isOpen == false`.

### What holds `[inspected]` + `[executed]`

1. Process-wide generation in `companion/src/summoner/overlay-session.ts`. `beginOverlaySession` / `invalidateOverlaySession` bump `session`. `overlaySessionIsLive(token)` is equality.

2. `hydrateOverlayIfLive` abandons **without** apply/claim if invalidated during `selectMessages`; if invalidated **after** claim it `releaseAllLeases` (`overlay-session.ts:32-38`). Behavioral tests `[executed]`:
   - `close during thread.select does not claim overlay lease`
   - `close during claim releases the overlay lease it just took`
   - `second beginOverlaySession invalidates the first in-flight hydrate`

3. `handleSummonerClosed` invalidates **then** releases (`menu-bar-agent.ts:692-697`):

```692:697:companion/src/menu-bar-agent.ts
export async function handleSummonerClosed(): Promise<void> {
  invalidateOverlaySession()
  const client = summonerClient
  if (!client) return
  await client.releaseAllOverlayComposerLeases()
}
```

4. Summoner `applyHydrate` cannot resurrect a **closed** overlay:

```1625:1642:companion/src/tray/Tray.swift
  func applyHydrate(_ json: [String: Any]) {
    guard isOpen else { return }
    // ...
    if window?.isVisible != true {
      open(threadId: threadId)
    } else {
      window?.makeFirstResponder(composer)
    }
  }
```

   `hide()` / `windowWillClose` both `emitClosedIfOpen()` which sets `isOpen = false` then emits `summoner.closed` (`:1619-1622`, `:1770-1778`). After that, stdin `summoner.hydrate` is a no-op. HUD is a different type and is **not** gated — see hunt.

Named Esc-during-1-hit path: close invalidates → in-flight select abandons (no claim) **or** post-claim `releaseAll`. Swift will not reopen. Side Panel is not left `OVERLAY_STANDBY` on a gone overlay **via hydrate**. **H1 as Pi specified is CLOSED.**

### Residuals (do not reopen vs-main X2)

**R1. Submit still claims with no generation — P1, same class as original H1, different entry.** `submitSummonerTalk` `await deps.claimLease(id)` with no token (`summoner/client.ts:149`). `handleSummonerSubmit` does not wrap it in `claimOverlayIfLive`. Return-then-Esc during `listThreads` / `createThread` / claim can overlay-hold a thread after the window is gone. Swift guard blocks UI resurrection; the **lease** can still stick. `claimOverlayIfLive` exists and is used only by `handleSummonerNewThread` — and has **zero tests** (grep of `tests/` is empty).

**R2. Leftover identity — nit.** `summonerThreadId = id` before the live check. Abandoned 1-hit still `touchSummonerActivity` → next open resumes T2. Not a lease leak.

**R3. `isOpen && !isVisible` still `open()` — nit.** Guard is close-identity, not visibility. A live overlay that has been `orderOut` without `emitClosedIfOpen` can still be brought back by hydrate. Closed (`isOpen == false`) cannot.

Do **not** treat summoner-talk's grep of `guard isOpen else { return }` as proof. SoT is the Swift above + SHA lockstep.

---

## H2 — summoner WS drop releases overlay holds

**Pi ask:** companion `ws.close` when `auth.surface === "summoner"` should `releaseAllOverlay` + broadcast. Tray must not.

### What holds `[inspected]` + `[executed]`

```294:301:companion/src/ws/composer-lease.ts
export function overlayLeasesOnSummonerDisconnect(
  surface: string | undefined,
  registry: ComposerLeaseRegistry = composerLeases,
): ComposerLeaseState[] {
  if (surface !== "summoner") return []
  return registry.releaseAllOverlay()
}
```

```1344:1361:companion/src/ws/lifecycle.ts
    ws.on("close", () => {
      clearInterval(pingInterval)
      clients.delete(ws)
      const closedAuth = wsAuth.get(ws)
      if (closedAuth) {
        clearTimeout(closedAuth.timer)
        wsAuth.delete(ws)
      }
      const releasedOverlay = overlayLeasesOnSummonerDisconnect(closedAuth?.surface)
      for (const state of releasedOverlay) {
        broadcastToClients({
          type: "composer.lease",
          thread_id: state.thread_id,
          holder: state.holder,
          rev: state.rev,
        })
      }
```

- Surface after delete: **available** (hunt). Handshake stamps `st.surface = rawSurface === "summoner" ? "summoner" : "tray"` (`lifecycle.ts:991`). Overlay client is constructed with `surface: "summoner"` (`menu-bar-agent.ts:1260-1266`).
- Tray (`"tray"` / omitted / undefined) → `[]`. Overlay holds stay. Overlay socket is the second WS; tray-menu disconnect must not drop them.
- `releaseAllOverlay()` returns **panel** states with bumped rev (`composer-lease.ts:76-89`). Broadcast is a separate `composer.lease` per hold. `broadcastToClients` fans out to **authenticated** `wss.clients` (`:353-364`); the dead summoner socket is already gone. Side Panel applies only matching `thread_id` (prior merge-prep; not re-litigated).
- Client-side `releaseAllOverlayComposerLeases` still no-ops unless `_state === "connected"` (`companion-client.ts:364-370`). That is now the **clean close** path. Socket death is companion-side. **H2 CLOSED.**

Unit test `[executed]`: `summoner socket close releases overlay holds; tray close does not` mutates a real registry. Lifecycle **wiring** test is grep (`summoner-overlay.test.ts:215-218`). Grep-green ≠ `ws.on("close")` ran. Production close handler is unambiguous `[inspected]`.

WS drop does **not** `invalidateOverlaySession`. Correct: overlay window can still be up; in-flight hydrate should re-claim after reconnect. Invalidation stays bound to Swift `summoner.closed`.

---

## H4 — `com.cmspark.agent` / `com.cmspark.host` never silent-continue

**Pi ask:** deny those bundle ids (or give tray a distinct id). Darwin executor case `exePath: "com.cmspark.agent"` must re-L2.

### What holds `[executed]` + `[inspected]`

`MAC_COMPANION_BUNDLE_IDS` is browsers only (`self-ui.ts:19-31`). **No** `com.cmspark.agent` / `com.cmspark.host`.

Deny is **first**, before `allow.has` / last-seg / MAC list / path heuristics:

```54:56:companion/src/computer/self-ui.ts
  if (isDeniedCompanionUiProcess(raw, base)) {
    return false
  }
```

```91:103:companion/src/computer/self-ui.ts
function isDeniedCompanionUiProcess(raw: string, base: string): boolean {
  if (
    base === "cmspark-tray" ||
    raw === "cmspark-tray" ||
    raw.endsWith("/cmspark-tray") ||
    raw.endsWith("/cmspark-tray.exe")
  ) {
    return true
  }
  if (raw === "com.cmspark.agent" || raw.startsWith("com.cmspark.agent.")) return true
  if (raw === "com.cmspark.host" || raw.startsWith("com.cmspark.host.")) return true
  return false
}
```

Darwin adapters still report `exePath: w.bundleId` (`darwin-adapters.ts:296`). The new executor test feeds **that** identity, not the fake `Contents/MacOS/cmspark-tray` path:

```1237:1259:companion/tests/computer-executor.test.ts
test("executor S23: Darwin com.cmspark.agent bundle id FG yield must re-L2", async () => {
  // ...
        ? winInfo({ hwnd: 999999, exePath: "com.cmspark.agent" })
  // ...
    config: testConfig({ companionUiBasenames: ["chrome", "cmspark-agent"] }),
  // expects DIALOG_PAUSED_DENIED + computer.foreground_yielded
```

`[executed]` pass. Self-ui unit `Darwin bundle ids com.cmspark.agent/host never self-UI continue` also `[executed]`.

Last-seg `"agent"` vs allow-list `"cmspark-agent"`: **no match**, and deny would win even if the list contained `"agent"` or the full bundle id. Chrome continue via `allow.has(raw)` is intact. **H4 CLOSED** on current and on the named landmine identity.

Leftover H8: the older executor test still uses `/Applications/CMspark.app/Contents/MacOS/cmspark-tray`, which Darwin adapters never produce. Path-shaped deny still matters for Windows. Nit, not H4 reopen.

---

## H5 / H6 — cheap nits

**H5 CLOSED** `[executed]`. `stripCompanionUiProcessContinueDeny` now strips `cmspark-tray` **and** `cmspark-tray.exe` via `.replace(/\.exe$/, "")` (`config.ts:1163-1166`). Called from `loadConfig` and `saveConfig`. New test `saveConfig strips cmspark-tray from companion_ui_exe_basenames` writes both names and asserts neither survives.

Strip still misses a **full path** persist (`C:\...\cmspark-tray.exe` after `.exe` strip is not equal to `cmspark-tray`). Runtime deny still catches `endsWith("/cmspark-tray.exe")`. Nit.

**H6 CLOSED** `[inspected]` + `[executed]`. `mic.toolTip = "听写暂未开放"` (`Tray.swift:2495`). Source and binary contain **no** `按住说话`. Grep test `hidden mic tooltip does not advertise press-to-talk` is still grep; the binary scan is the artifact evidence.

---

## Trajectory

HEAD is still `659bbce` (docs-only). This batch is **dirty tree**, including untracked `companion/src/summoner/overlay-session.ts` + `companion/tests/overlay-session.test.ts`.

On-BLOCK files vs last merge-prep: `overlay-session.ts` (new), `menu-bar-agent.ts` (invalidate + hydrate wrapper), `lifecycle.ts` (+11 for disconnect release/broadcast), `composer-lease.ts` (`overlayLeasesOnSummonerDisconnect`), `self-ui.ts` (bundle-id deny, MAC list), `config.ts` (`.exe` strip), `Tray.swift` (Summoner `guard isOpen`, tooltip), `swift-tray-bridge.ts` (new pin). No drive-by into MCP / CU admission / `config.set` arm-phrase while hunting these paths.

---

## Component — remaining holes

| ID | Severity | Hole | Where |
|----|----------|------|--------|
| R1 | P1 | `submitSummonerTalk` claims overlay with no generation; Esc during submit RTT can leave OVERLAY_STANDBY on a closed overlay | `summoner/client.ts:149`; `menu-bar-agent.ts:721-724` |
| R2 | nit | `summonerThreadId` + `last_thread_id` survive abandoned hydrate | `menu-bar-agent.ts:637`, `:762-764`, `:772-773` |
| R3 | nit | Summoner `applyHydrate` still `open()` when `isOpen && window?.isVisible != true` | `Tray.swift:1638-1639` |
| R4 | nit | `claimOverlayIfLive` (new-thread path) has **zero** tests; overlay-session suite only covers `hydrateOverlayIfLive` | `overlay-session.ts:41-50`; `tests/` |
| R5 | nit | lifecycle `ws.on("close")` wiring is grep; helper itself is behavioral | `summoner-overlay.test.ts:215-218` vs `composer-lease.test.ts:381-392` |
| R6 | nit | Summoner `applyHydrate` / tooltip / placeholder tests remain `readFileSync` + `assert.match` | `summoner-talk.test.ts:158-171` |
| H8 | nit | Path-shaped tray executor case still not Darwin SoT (bundle-id case **is**) | `computer-executor.test.ts:1212-1235` vs `:1237` |

R1 is the only remaining user journey I can still describe that leaves Side Panel in `OVERLAY_STANDBY` after the overlay is gone. It is **not** the vs-main exclusive T1 leak, and it is **not** the 1-hit hydrate race Pi named. Do not reopen BLOCK 1. Do not call H1 fully closed across **every** overlay claim site.

---

## Test-quality (hostile)

| Suite | Load-bearing for this batch? |
|-------|------------------------------|
| `overlay-session.test.ts` close-during-select / close-during-claim / generation bump | **Yes** — real async helper `[executed]` |
| `composer-lease.test.ts` `overlayLeasesOnSummonerDisconnect` summoner vs tray | **Yes** — real registry `[executed]` |
| `computer-self-ui.test.ts` Darwin agent/host deny + Chrome still true | **Yes** `[executed]` |
| `computer-executor.test.ts` Darwin `com.cmspark.agent` re-L2 | **Yes** as Darwin identity `[executed]` |
| `computer-executor.test.ts` `cmspark-tray` path | **Yes** as Windows-shaped; **No** as Darwin SoT |
| `config.test.ts` saveConfig strip of `cmspark-tray` + `.exe` | **Yes** `[executed]` |
| `summoner-overlay.test.ts` invalidate / lifecycle import / 1-hit hydrate | **No** — source `assert.match` |
| `summoner-talk.test.ts` second `applyHydrate` + `guard isOpen` + tooltip | **No** — greps Swift; index-of-second is fragile if a third controller appears |
| `claimOverlayIfLive` | **Missing** |

Grep-green ≠ overlay closed. H1 Swift guard scored from `SummonerController.applyHydrate` + SHA lockstep, not from those tests. H2 scored from `lifecycle.ts` close handler + registry helper, not from the lifecycle grep.

---

## Nits (non-blocking, fold or own)

1. Wrap `handleSummonerSubmit` / `submitSummonerTalk` claim in `claimOverlayIfLive` using the live overlay generation (closes R1). Export or store the current token so submit can see it.
2. Only assign `summonerThreadId` / `touchSummonerActivity` when `hydrateOverlayIfLive` returns `"claimed"` (closes R2).
3. Add `claimOverlayIfLive` tests symmetric with the hydrate suite (closes R4).
4. Lifecycle close: drive a fake authenticated summoner `ws` through the close handler (or extract the close body) instead of grepping the identifier (closes R5).
5. Summoner applyHydrate: keep the `open()` refresh behind `isOpen` (already true) — no change required for H1; drop grep-only overlay UI tests when a host test exists.
6. Strip full-path `cmspark-tray.exe` in `saveConfig` if disk hygiene matters; runtime deny already covers it.

---

## Verdict

Named Pi nits **H1 (hydrate generation + Summoner `isOpen` guard), H2 (summoner-only disconnect release + broadcast), H4 (bundle-id hard-deny + Darwin executor re-L2), H5 (saveConfig `.exe` strip), H6 (tooltip / binary 按住说话 gone)** are **closed on the production paths they named**. MACHINE this session is green (tsc 0; 86/0 named; 5/0 S23/Darwin/config; SHA lockstep). Chrome still continues via `allow.has(raw)`. `com.cmspark.agent` last-seg `"agent"` does **not** continue. HUD still hydrates and is not the overlay SoT.

I will **not** APPROVE clean: submit still claims without generation (R1 P1); leftover overlay identity on abandon; `claimOverlayIfLive` untested; overlay Swift / lifecycle wiring tests still grep. None of that restores vs-main X2/X4/X7 or Pi's named H1 hydrate race.

VERDICT: APPROVE_WITH_NITS
