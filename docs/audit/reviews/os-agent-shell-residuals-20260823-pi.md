# Pi 复审 — OS Agent Shell residuals (H1 / H2 / H4 / H5 / H6) + submit fold

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Role | **Pi 复审 (second judge)**. Did **not** implement. Did **not** write the adversary report. |
| Repo | `/Users/huchen/Projects/cmspark` |
| Branch | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` **+ dirty tree** |
| Blast | T3 — composer.lease identity + computer-use S23 self-UI continue |
| Adversary | `docs/audit/reviews/os-agent-shell-residuals-20260823-adversary.md` — **APPROVE_WITH_NITS** |
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

This review **confirms or rejects** the adversary on named Pi nits H1 / H2 / H4 / H5 / H6, and decides whether the post-adversary **submit fold** closes leftover P1 (R1). vs-main BLOCKs stay closed unless a residual restores the named failure.

---

## MACHINE `[executed]`

All commands re-run this session from `/Users/huchen/Projects/cmspark/companion` on the dirty tree. Implementer board and adversary MACHINE are not trusted.

| Command | Result |
|---------|--------|
| `./node_modules/.bin/tsc -p tsconfig.test.json --pretty false` | **0 errors** (`TSC_EXIT:0`) |
| `node --test` overlay-session + composer-lease + summoner-overlay + summoner-talk + computer-self-ui | **88 pass / 0 fail** (`NAMED_EXIT:0`) |
| `node --test --test-name-pattern "S23\|cmspark-tray\|companion_ui\|Darwin"` config + computer-executor | **5 pass / 0 fail** (`S23_EXIT:0`) |
| `shasum -a 256 dist/cmspark-tray` | `b8651ce18b8746632270f42654636cc9060d4029849a8aeeeedd1f919841acdc` |
| `SWIFT_TRAY_SHA256` `swift-tray-bridge.ts:59` | **equal** (lockstep) |
| tray binary vs `Tray.swift` mtime | binary `22:06:31` after Swift `22:05:38`; pin comment "H1 applyHydrate guard + dead mic tooltip" |

Adversary named-suite count was **86**. This tree is **88** because two tests landed with the submit fold (`submit-style claimOverlayIfLive no-ops after close`; `handleSummonerSubmit claims only if overlay session is still live`). SHA / pin / mtime match adversary.

Direct identity probe `[executed]` (compiled `isCompanionUiOwner` from `.test-dist`, not a test file):

| fgOwner | allow-list | result |
|---------|------------|--------|
| `com.google.Chrome` | defaults (includes `com.google.chrome`) | **true** |
| `com.google.Chrome` | `["chrome"]` only | **true** |
| `com.cmspark.agent` | defaults (`cmspark-agent` present) | **false** |
| `com.cmspark.agent` | `["chrome","cmspark-agent","agent"]` | **false** (deny beats last-seg `"agent"`) |
| `com.cmspark.agent` | allow-list contains `"com.cmspark.agent"` | **false** (deny beats `allow.has(raw)`) |
| `com.cmspark.host` | defaults | **false** |
| `cmspark-tray` | defaults + `"cmspark-tray"` | **false** |

Binary strings `[executed]`:

| needle | in `dist/cmspark-tray` |
|--------|------------------------|
| `按住说话` / `也可按住说话` / `说点什么，或按住说话` | **ABSENT** (0) |
| `听写暂未开放` | **PRESENT** (1) |
| `回车发送到当前线程` | **PRESENT** (1) |
| `说点什么` | ABSENT as cstring (SSO-sized placeholder; same as prior Pi note) |

---

## Hunt scorecard (mandatory)

| Hunt | Answer | Tag | vs adversary |
|------|--------|-----|--------------|
| Does `applyHydrate` guard apply to **SummonerController**, not HUD? | **Yes.** HUD `:1058` has no `isOpen` guard and does not call `open()` (reopen is `showConfirm` `:1114-1116`). Summoner `:1625` first statement is `guard isOpen else { return }`. Two definitions only. | `[inspected]` | Confirm |
| Can HUD still hydrate? | **Yes, by design.** Not the overlay-lease identity. | `[inspected]` | Confirm |
| Does `allow.has(raw)` still continue Chrome? | **Yes.** Probe `[executed]`. Defaults include `"com.google.chrome"`. | `[executed]` | Confirm |
| Does last-segment `"agent"` matching `cmspark-agent` still continue `com.cmspark.agent`? | **Must be false — is false.** Deny first. Probe `[executed]` even with `"agent"` or full bundle id on the allow-list. | `[executed]` | Confirm |
| lifecycle uses `closedAuth.surface` AFTER `delete` — is surface still available? | **Yes.** `const closedAuth = wsAuth.get(ws)` then `delete` then `overlayLeasesOnSummonerDisconnect(closedAuth?.surface)` (`lifecycle.ts:1348-1353`). | `[inspected]` | Confirm |
| hydrate sets `summonerThreadId` before abandon — leftover identity? | **Yes.** `hydrateSummonerThread` assigns `:638` then `hydrateOverlayIfLive`. Search/select still `touchSummonerActivity` after (`:770-771`, `:779-780`). Submit fold also `touch`s whenever `result.threadId` is set (`:758-761`), including abandoned claim. Lease is **not** held. | `[inspected]` | Confirm (still open as nit) |
| Tests that only grep? | **Yes.** Overlay Swift + menu-bar-agent + lifecycle **wiring** remain `readFileSync` + `assert.match`. Load-bearing: overlay-session helper, composer-lease disconnect registry, computer-self-ui, Darwin executor S23, config save-strip. Submit **wiring** is still grep; submit **helper first-check** is behavioral. | `[inspected]` + `[executed]` | Confirm, with the fold's one new behavioral case |

---

## Adversary scorecard

| Claim | Pi |
|-------|----|
| H1 (hydrate generation + Summoner `isOpen` guard) CLOSED | **Confirm** `[inspected]` + MACHINE `[executed]` |
| H2 (summoner-only disconnect release + broadcast) CLOSED | **Confirm** `[inspected]` + registry test `[executed]` |
| H4 (`com.cmspark.agent` / `host` hard-deny + Darwin executor re-L2) CLOSED | **Confirm** probe + executor `[executed]` |
| H5 (saveConfig `.exe` strip) CLOSED | **Confirm** `[executed]` |
| H6 (tooltip / binary 按住说话 gone) CLOSED | **Confirm** source `[inspected]` + binary `[executed]` |
| R1 P1: `submitSummonerTalk` claims with no generation | **Was true at adversary time. Closed by post-report fold** — see below |
| R2 leftover identity on abandoned hydrate | **Confirm** (nit; submit path still touches too) |
| R3 `isOpen && !isVisible` still `open()` | **Confirm** (`Tray.swift:1638-1639`) |
| R4 `claimOverlayIfLive` untested | **Partially closed** — one first-check test `[executed]`; close-during-claim for this helper still missing; submit wiring is grep |
| R5 lifecycle close wiring is grep | **Confirm** |
| R6 overlay Swift tests are grep | **Confirm** |
| H8 path-shaped tray executor is not Darwin SoT | **Confirm** (`:1212-1235` vs `:1237`) |
| MACHINE green / SHA lockstep | **Confirm this session** (88/0 named, not 86) |
| Too loose on a still-open BLOCK? | **No.** Named H-nits stay closed. Leftover P1 does not restore vs-main X2. |

---

## Leftover P1 — does the submit fold close it?

Adversary R1: `submitSummonerTalk` `await deps.claimLease(id)` with no token (`summoner/client.ts:149`); `handleSummonerSubmit` did not wrap `claimOverlayIfLive`. Return-then-Esc during `listThreads` / `createThread` / claim could overlay-hold after the window is gone.

### What holds now `[inspected]` + `[executed]`

Production submit is only `summoner.submit` → `handleSummonerSubmit` (`menu-bar-agent.ts:993-994`). Tests calling `submitSummonerTalk` directly are not a ship path.

```719:731:companion/src/menu-bar-agent.ts
export async function handleSummonerSubmit(thread_id: string, text: string): Promise<boolean> {
  const client = summonerClient
  if (!client) return false
  const token = currentOverlaySession()
  const result = await submitSummonerTalk(thread_id, text, {
    listThreads: () => client.listThreads(),
    createThread: () => client.createThread(),
    claimLease: (id) =>
      claimOverlayIfLive({
        token,
        claim: () => client.claimOverlayComposerLease(id),
        releaseAll: () => client.releaseAllOverlayComposerLeases(),
      }).then(() => undefined),
```

- Token is captured **before** `listThreads` / `createThread`. `handleSummonerClosed` invalidates first (`:693-697`). Return-then-Esc during RTT: `overlaySessionIsLive(token)` is false → **no claim**. Close-during-claim: helper claims then `releaseAll` (`overlay-session.ts:45-54`).
- Helper first-check is behavioral `[executed]`: `submit-style claimOverlayIfLive no-ops after close` captures `currentOverlaySession()`, invalidates, asserts `claimed === false`. That is the named Return-then-Esc claim site, not a grep.
- Swift `submitComposer` (`Tray.swift:1891-1900`) has no `isOpen` guard, but after `hide()` / `windowWillClose` the window is `orderOut` and `emitClosedIfOpen` has set `isOpen = false`. Stdin is a single pipe: Return-then-Esc is submit line then `summoner.closed`. Close-then-submit is not a Swift gesture.

`submitSummonerTalk` itself is still generation-blind. The SoT is the production wrapper. That is enough to close R1 as specified.

**R1 P1 is CLOSED.** Do not reopen H1. Do not reopen vs-main BLOCK 1. Side Panel is not left `OVERLAY_STANDBY` on a gone overlay via submit.

### Fold residuals (not P1)

1. **Discarded boolean — nit.** `.then(() => undefined)` throws away `claimOverlayIfLive`'s `false`. `submitSummonerTalk` still `sendChatCreate` + optional hydrate. Abandoned claim ⇒ holder is panel ⇒ overlay `chat.create` is `OVERLAY_STANDBY` (denied), Swift `applyHydrate` no-ops when `isOpen == false`. Wasted WS round-trip, not a stuck lease.

2. **`claimOverlayIfLive` close-during-claim untested — nit.** Hydrate has the symmetric test. Submit helper does not. Wiring test `handleSummonerSubmit claims only if overlay session is still live` is `assert.match` for `currentOverlaySession` / `claimOverlayIfLive` (`summoner-overlay.test.ts:220-228`). Grep-green ≠ `handleSummonerSubmit` ran.

3. **Post-invalidate `current` is live — nit, not the named race.** `invalidateOverlaySession` only bumps the counter; `currentOverlaySession()` after close is a live token. A submit event processed *after* close (no captured open-generation) would claim. Swift does not emit that. Not Return-then-Esc.

4. **R2 still.** Submit still `summonerThreadId = result.threadId` + `touchSummonerActivity` when resolve succeeded (`:758-761`), even if claim was abandoned.

---

## H1 — overlay-session generation — **CLOSED** (confirm adversary)

Pi ask: generation on hydrate/new-thread; `summoner.closed` invalidates in-flight claims; Swift `applyHydrate` must not `open()` when `isOpen == false`.

**What holds** `[inspected]` + `[executed]`:

1. Process-wide generation in `overlay-session.ts`. `hydrateOverlayIfLive` abandons without apply/claim if invalidated during select; post-claim `releaseAllLeases`. Tests `[executed]`.
2. `handleSummonerClosed` invalidates **then** releases (`menu-bar-agent.ts:693-697`).
3. `handleSummonerNewThread` begins a token and wraps claim+hydrate in `claimOverlayIfLive` (`:967-988`).
4. Summoner `applyHydrate` (`Tray.swift:1625-1642`): `guard isOpen else { return }` before any `open()`. `hide()` / `windowWillClose` both `emitClosedIfOpen()` (`:1619-1622`, `:1770-1778`). HUD is a different type.

Named Esc-during-1-hit path stays closed. Submit is no longer an ungated sibling of that path. **H1 CLOSED across overlay claim sites** (hydrate, new-thread, submit). Leftover identity (R2) and `isOpen && !isVisible` refresh (R3) do not reopen it.

---

## H2 — summoner WS drop releases overlay holds — **CLOSED** (confirm adversary)

```294:301:companion/src/ws/composer-lease.ts
export function overlayLeasesOnSummonerDisconnect(
  surface: string | undefined,
  registry: ComposerLeaseRegistry = composerLeases,
): ComposerLeaseState[] {
  if (surface !== "summoner") return []
  return registry.releaseAllOverlay()
}
```

Wired in `ws.on("close")` after `closedAuth` snapshot (`lifecycle.ts:1344-1361`). Handshake stamps `st.surface = rawSurface === "summoner" ? "summoner" : "tray"` (`:991`). Tray / omitted / undefined → `[]`. Broadcast is a separate `composer.lease` per released hold to authenticated clients.

Unit test `[executed]`: `summoner socket close releases overlay holds; tray close does not`. Lifecycle **wiring** remains grep (R5). Production close handler is unambiguous `[inspected]`. Client-side `releaseAllOverlayComposerLeases` still no-ops unless `_state === "connected"` (`companion-client.ts:364-370`) — that is the clean-close path; socket death is companion-side.

WS drop does **not** `invalidateOverlaySession`. Correct: overlay window can still be up. **H2 CLOSED.**

---

## H4 — `com.cmspark.agent` / `com.cmspark.host` never silent-continue — **CLOSED** (confirm adversary)

`MAC_COMPANION_BUNDLE_IDS` is browsers only (`self-ui.ts:19-31`). Deny runs **first** (`:54-56`, `:91-103`): `cmspark-tray` path shapes + exact/prefix `com.cmspark.agent` / `com.cmspark.host`. Darwin adapters still report `exePath: w.bundleId` (`darwin-adapters.ts:296`). Executor case feeds `exePath: "com.cmspark.agent"` with allow-list `["chrome","cmspark-agent"]` and expects `DIALOG_PAUSED_DENIED` + `computer.foreground_yielded` (`computer-executor.test.ts:1237-1259`) `[executed]`. Self-ui unit `[executed]`. Probe `[executed]`: deny beats `allow.has(raw)` and last-seg `"agent"`. Chrome continue via `allow.has(raw)` intact.

H8 remains: older executor path `/Applications/CMspark.app/Contents/MacOS/cmspark-tray` is Windows-shaped, not Darwin SoT. Nit, not H4 reopen. **H4 CLOSED.**

---

## H5 / H6 — cheap nits — **CLOSED** (confirm adversary)

**H5** `[executed]`. `stripCompanionUiProcessContinueDeny` strips `cmspark-tray` and `cmspark-tray.exe` via `.replace(/\.exe$/, "")` (`config.ts:1163-1166`). Called from `loadConfig` (`:659`) and `saveConfig` (`:1233`). Test writes both names; neither survives. Full-path persist (`C:\...\cmspark-tray.exe` after `.exe` strip ≠ `cmspark-tray`) still missed; runtime deny `endsWith("/cmspark-tray.exe")` still catches. Nit.

**H6** `[inspected]` + `[executed]`. `mic.toolTip = "听写暂未开放"` (`Tray.swift:2495`). Source and binary contain **no** `按住说话`. Grep test is still grep; binary scan is the artifact evidence.

---

## Trajectory

HEAD is still `659bbce` (docs-only). This batch is **dirty tree**, including untracked `companion/src/summoner/overlay-session.ts` + `companion/tests/overlay-session.test.ts`.

On-BLOCK files vs last merge-prep: `overlay-session.ts` (new), `menu-bar-agent.ts` (invalidate + hydrate wrapper + **submit wrap**), `lifecycle.ts` (disconnect release/broadcast), `composer-lease.ts` (`overlayLeasesOnSummonerDisconnect`), `self-ui.ts` (bundle-id deny, MAC list), `config.ts` (`.exe` strip), `Tray.swift` (Summoner `guard isOpen`, tooltip), `swift-tray-bridge.ts` (pin). No drive-by into MCP / CU admission / `config.set` arm-phrase while hunting these paths.

The submit fold is a **post-adversary** edit on the same dirty tree. Adversary R1 description is not stale as a finding-at-the-time; it is stale as current production.

---

## Component — remaining holes

| ID | Severity | Hole | Where | Pi vs adversary |
|----|----------|------|--------|-----------------|
| R1 | ~~P1~~ **closed** | Submit claimed overlay with no generation | `handleSummonerSubmit` now wraps `claimOverlayIfLive({ token: currentOverlaySession() })` | **Closed by fold** |
| R2 | nit | `summonerThreadId` + `last_thread_id` survive abandoned hydrate/submit | `menu-bar-agent.ts:638`, `:758-761`, `:770-771`, `:779-780` | Confirm; submit fold did not close this |
| R3 | nit | Summoner `applyHydrate` still `open()` when `isOpen && window?.isVisible != true` | `Tray.swift:1638-1639` | Confirm |
| R4 | nit | `claimOverlayIfLive` close-during-claim untested; submit **wiring** is grep; abandoned claim still `sendChatCreate` | `overlay-session.ts:45-54`; `tests/overlay-session.test.ts:88`; `summoner-overlay.test.ts:220-228`; `:727-731` | Partial close |
| R5 | nit | lifecycle `ws.on("close")` wiring is grep | `summoner-overlay.test.ts:215-218` vs `composer-lease.test.ts:381-392` | Confirm |
| R6 | nit | Summoner `applyHydrate` / tooltip / placeholder tests remain `readFileSync` + `assert.match` | `summoner-talk.test.ts` | Confirm |
| H8 | nit | Path-shaped tray executor case still not Darwin SoT (bundle-id case **is**) | `computer-executor.test.ts:1212-1235` vs `:1237` | Confirm |

No remaining user journey I can still describe that leaves Side Panel in `OVERLAY_STANDBY` after the overlay is gone, on hydrate **or** submit. R2 is resume-id leftover, not a lease leak.

---

## Test-quality (hostile)

| Suite | Load-bearing for this batch? |
|-------|------------------------------|
| `overlay-session.test.ts` close-during-select / close-during-claim / generation bump | **Yes** — real async helper `[executed]` |
| `overlay-session.test.ts` submit-style `claimOverlayIfLive` no-op after close | **Yes** for helper first-check `[executed]`; **No** as `handleSummonerSubmit` / `submitSummonerTalk` integration |
| `composer-lease.test.ts` `overlayLeasesOnSummonerDisconnect` summoner vs tray | **Yes** — real registry `[executed]` |
| `computer-self-ui.test.ts` Darwin agent/host deny + Chrome still true | **Yes** `[executed]` |
| `computer-executor.test.ts` Darwin `com.cmspark.agent` re-L2 | **Yes** as Darwin identity `[executed]` |
| `computer-executor.test.ts` `cmspark-tray` path | **Yes** as Windows-shaped; **No** as Darwin SoT |
| `config.test.ts` saveConfig strip of `cmspark-tray` + `.exe` | **Yes** `[executed]` |
| `summoner-overlay.test.ts` invalidate / lifecycle import / 1-hit hydrate / submit wrap | **No** — source `assert.match` |
| `summoner-talk.test.ts` second `applyHydrate` + `guard isOpen` + tooltip | **No** — greps Swift |
| `claimOverlayIfLive` close-during-claim | **Missing** (hydrate has it; this helper does not) |

Grep-green ≠ overlay closed. H1 Swift guard scored from `SummonerController.applyHydrate` + SHA lockstep. H2 scored from `lifecycle.ts` close handler + registry helper. Submit P1 scored from `handleSummonerSubmit` wrap `[inspected]` + helper first-check `[executed]`, **not** from the grep that names the identifiers.

---

## Nits (non-blocking, fold or own)

1. Only assign `summonerThreadId` / `touchSummonerActivity` when hydrate/submit actually `"claimed"` / `claimOverlayIfLive` returns true (closes R2).
2. Add `claimOverlayIfLive` close-during-claim test symmetric with hydrate; stop grepping `handleSummonerSubmit` once that exists (closes leftover R4).
3. Honor `claimOverlayIfLive === false` in `handleSummonerSubmit`: skip `sendChatCreate` / hydrate (fold completeness; not a lease leak).
4. Lifecycle close: drive a fake authenticated summoner `ws` through the close handler (or extract the close body) instead of grepping the identifier (closes R5).
5. Summoner `applyHydrate`: keep the `open()` refresh behind `isOpen` (already true) — no change required for H1; drop grep-only overlay UI tests when a host test exists.
6. Strip full-path `cmspark-tray.exe` in `saveConfig` if disk hygiene matters; runtime deny already covers it.

---

## Verdict

Adversary APPROVE_WITH_NITS on **named** H1 / H2 / H4 / H5 / H6 is **confirmed**. MACHINE this session is green (tsc 0; 88/0 named; 5/0 S23/Darwin/config; SHA lockstep; Chrome continues; `com.cmspark.agent` last-seg `"agent"` does not). Independently inspected production paths match the adversary write-up.

Leftover P1 (R1 submit claim with no generation) **was real at report time** and is **closed by the post-adversary fold**: `handleSummonerSubmit` captures `currentOverlaySession()` and wraps `claimLease` in `claimOverlayIfLive`. Helper first-check `[executed]`; wiring grep is not the evidence. Remaining holes are nits (leftover resume identity, discarded claim boolean, grep-only overlay/lifecycle tests, Darwin path-shaped S23 case). None restores vs-main X2/X4/X7 or Pi's named H1 hydrate race.

I will **not** APPROVE clean: R2/R4/R5/R6/H8 still sit on the same files. I will **not** REJECT: leftover P1 is closed and no named H-nit reopens.

VERDICT: APPROVE_WITH_NITS
