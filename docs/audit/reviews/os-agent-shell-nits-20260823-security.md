# Independent adversary — OS agent shell nits fold (SECURITY / Trust)

> **Lane**: SECURITY (S23 / lease / Trust). Did **not** implement this. Did **not** read other lane reports or prior merge-prep adversary/pi files.
> **Role**: independent adversary — do not rubber-stamp.
> **Date**: 2026-08-23
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` **+ dirty tree**
> **Blast**: T3 · S23 / lease / Trust
> **Production code**: not modified (reviewer compiled `companion/.test-dist` only).

```text
Surface:      L2 host_computer (mid-task FG yield + overlay click deny) + L0 overlay composer
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        S23: overlay/tray/host MUST NOT silent-continue CU FG yield (even if allow-listed);
              window-rect hard-deny on overlay/HUD/tray/pairing clicks; re-L2 on tray FG;
              overlay chat.create blocked while CU LIVE (L2_CONDUCTOR_ELSEWHERE);
              lease broadcasts only from server-side mutations; summoner ACL on release_overlay;
              stdin cannot persist/trigger overlay continue
Channel:      community
```

Must-falsify (this fold):

1. `isCompanionUiOwner` denies `cmspark-tray` and Darwin `com.cmspark.agent` / `com.cmspark.host` even if allow-listed.
2. `loadConfig` / `saveConfig` strip `cmspark-tray` including full path.
3. Executor FG yield to those identities re-L2s (never silent self-UI continue).
4. Overlay lease broadcast authenticity (no client-forged `composer.lease` SoT).
5. Summoner ACL actually gates `composer.lease.release_overlay`.
6. Stdin cannot persist / trigger tray overlay `continue`.

---

## MACHINE

Commands (cwd `companion/`) `[executed]`:

```text
./node_modules/.bin/tsc -p tsconfig.test.json     # exit 0 (dirty tree → .test-dist)
node --test --test-name-pattern "S23|cmspark-tray|companion_ui|Darwin|full-path" \
  .test-dist/tests/config.test.js \
  .test-dist/tests/computer-executor.test.js \
  .test-dist/tests/computer-self-ui.test.js
```

Specified filter: **9 pass / 0 fail** `[executed]`.

| Test | Result |
|------|--------|
| executor S23: cmspark-tray FG yield must re-L2, never silent continue | pass |
| executor S23: Darwin com.cmspark.agent bundle id FG yield must re-L2 | pass |
| cmspark-tray is NOT process-level self-UI continue | pass |
| cmspark-tray never self-UI continues even if present on the allow-list | pass |
| Darwin bundle ids com.cmspark.agent/host never self-UI continue | pass |
| first-run defaults do not treat cmspark-tray as self-UI continue | pass |
| load strips cmspark-tray from persisted companion_ui_exe_basenames | pass |
| saveConfig strips cmspark-tray from companion_ui_exe_basenames | pass |
| saveConfig strips full-path cmspark-tray.exe | pass |

Independent throwaway probes against `.test-dist` (no worktree mutation beyond compile) `[executed]`:

| Probe | Result |
|-------|--------|
| `cmspark-tray` / `.exe` / mixed case / Darwin path / Win path / NT `\\?\` / 8.3-ish, **allow-list contains `cmspark-tray`** | `isCompanionUiOwner=false` |
| `com.cmspark.agent` / `.helper` / `COM.CMSPARK.AGENT` / `com.cmspark.host` / `.debug`, allow-list contains those ids | `false` |
| default allow + `com.cmspark.tray` (no CFBundleId on current Swift binary) | `false` |
| **`com.cmspark.tray` + full id on allow-list** | **`true` (latent; not named S23 identity)** |
| path `/.../cmspark-agent` (packaged companion basename still on default list) | `true` (intended: not overlay) |
| `decodeSummonerOutbound({cmd:"summoner.continue"})` | `null` |
| `decodeSummonerInbound({type:"summoner.continue"})` | inbound-only (stdout click) |
| hydrate with extra `continue:true` | codec drops the field |
| `shouldBroadcastLease("composer.lease.get", okLease)` | `false` |
| `shouldBroadcastLease("composer.lease.claim", {type:"error"})` | `false` |
| `shouldBroadcastLease("composer.lease.release_overlay", {type:"composer.lease"})` | `false` (wrong result type) |
| `shouldBroadcastLease("chat.create", {type:"composer.lease.released"})` | `false` |
| `CMSPARK_WS_STRICT=1` inbound `type:"composer.lease"` | `{valid:false, Unknown message type}` |
| summoner `release_overlay` | ACL ok |
| summoner `config.set` | `SUMMONER_ACL` |
| overlay `chat.create` while CU map non-empty | `L2_CONDUCTOR_ELSEWHERE` |

---

## Attack results (must-falsify)

### 1. Can `isCompanionUiOwner` silent-continue overlay/tray/host if the operator allow-lists them?

**No for the named identities.** Deny runs **before** allow-list hits `[inspected]` + `[executed]`.

`companion/src/computer/self-ui.ts:41–56` / `:91–103`:

- Empty allow-list fail-closes (`false` → executor re-L2).
- `isDeniedCompanionUiProcess` returns true for basename/`raw`/`.../cmspark-tray`/`.../cmspark-tray.exe`, and for `com.cmspark.agent` / `com.cmspark.host` plus dotted suffixes.
- Then and only then: `allow.has(base) \|\| allow.has(raw)` and Darwin last-segment / `MAC_COMPANION_BUNDLE_IDS`.

`MAC_COMPANION_BUNDLE_IDS` (`self-ui.ts:19–31`) no longer contains `com.cmspark.agent` / `com.cmspark.host` (removed this fold). Browsers remain the self-UI continue set.

Unit tests force allow-list inclusion of `cmspark-tray` and `com.cmspark.agent` and still assert `false` (`computer-self-ui.test.ts:56–72`) `[executed]`.

**Not a bypass of the named S23 set:**

- Packaged **`cmspark-agent` path** still continues (`DEFAULT_CONFIG` keeps `"cmspark-agent"`, `config.ts:446–451`). That is the side-panel-adjacent companion exe, not the Swift overlay. Darwin **bundle id** `com.cmspark.agent` is denied even if that string is allow-listed.
- **`com.cmspark.tray` as a full bundle id on the allow-list** would continue (`[executed]`). Current Tray.swift is unbundled (process name `cmspark-tray`, no `CFBundleIdentifier` in the deny sense). Latent — **NIT-1**.

### 2. Can hand-edited / `saveConfig` persist `cmspark-tray` (including a full path) and skip the deny?

**No for `cmspark-tray` path / `.exe` forms.** Strip on **both** load and save `[inspected]` + `[executed]`.

- `loadConfigFile` → `stripCompanionUiProcessContinueDeny` (`config.ts:659`)
- `saveConfig` → same after `deepMerge` (`config.ts:1234`)
- Filter (`config.ts:1159–1168`): lower-case, `\\`→`/`, last path segment, strip trailing `.exe`, drop iff `=== "cmspark-tray"`.

Tests: defaults omit tray; load drops `cmspark-tray`; save drops `cmspark-tray` / `cmspark-tray.exe`; save drops `C:\\Program Files\\CMspark\\cmspark-tray.exe` (`config.test.ts:892–936`) `[executed]`.

Runtime deny still catches the process even if a weird allow-list token survived strip (padded names, `cmspark-tray.app` as a *list entry*). Strip is belt-and-suspenders; `isDeniedCompanionUiProcess` is the gate. **NIT-2**: strip does **not** drop `com.cmspark.agent` / `com.cmspark.host` strings from the array (runtime deny covers the FG identity).

### 3. Does executor FG yield to overlay/tray/host skip re-L2 (self-UI continue)?

**No.** Self-UI continue is `isCompanionUiOwner(...) &&` quiet dialog channels (`executor.ts:1614–1637`). Tray/agent-bundle fail that predicate → fall through to `reL2(..., ["computer.foreground_yielded"], ...)` (`executor.ts:1638–1644`).

- Tag is in `PROMPT_ALWAYS_TAGS` (`session-trust.ts:117–121`). Session trust **cannot** silent-approve it (`executor.ts:701–709`, `reL2ShouldPrompt`).
- Three-flag cruise also refuses `PROMPT_ALWAYS` (`executor.ts:676–678`).
- **Unattended** still auto-approves *all* mid-task re-L2 including `foreground_yielded` (`executor.ts:656–666`). Pre-existing unattended contract, not S23 self-UI continue. Overlay **clicks** still hit `assertClickClearsCompanionUi` (`executor.ts:1369–1382`) → `COMPANION_UI_CLICK_DENIED` (`companion-ui-rects.ts:71–78`). Fail-closed for inject, not silent continue.

Executor tests with `companionUiBasenames: ["chrome", "cmspark-tray"]` and Darwin `com.cmspark.agent` + `cmspark-agent` both `DIALOG_PAUSED_DENIED` + `computer.foreground_yielded` `[executed]`. No executor test for `com.cmspark.host` FG (matcher is the same function; **NIT-3** test gap).

Re-raise failure of a *true* self-UI yield falls through to re-L2 (`executor.ts:1634–1636`) — fail-safe.

**NIT-4**: `key` / `typeText` skip the rect gate (click/scroll/drag only). Injector is hwnd-targeted; overlay is another process. Residual if a future adapter types to the focused NSPanel.

**NIT-5**: overlay is a floating `NSPanel` (`Tray.swift:2262–2268`, `level = .floating`, `hidesOnDeactivate = false`). After the user returns FG to the target, process-level yield may not fire; S23 then depends on rects. Rects emit on open/hide/relayout (`Tray.swift:1616–1621`, `:2257`) but **there is no `windowDidMove`**. Dragging the titled panel stale-dates the hit-test until the next relayout. Overlay has zero Allow/Deny chrome; overlay `chat.create` while CU LIVE is `L2_CONDUCTOR_ELSEWHERE` (`l2-conductor.ts:18–31`). Stale-rect click-through cannot approve L2. Residual: wasted/mis-aimed click on overlay chrome.

### 4. Can a client forge overlay lease broadcasts / SoT?

**No authentic SoT injection from a wire `composer.lease` frame.**

- Mutations only in `handleComposerLeaseFamily` (`composer-lease.ts:151–211`). Payload is `leasePayload(registry state)` or `releaseAllOverlay()` snapshots — not client `holder`/`rev` echoed on mismatch (mismatch returns `composer.lease.error` and is **not** broadcast).
- `shouldBroadcastLease` (`composer-lease.ts:228–234`): `get` never; claim/release only if `result.type === "composer.lease"`; `release_overlay` only if `result.type === "composer.lease.released"`. `[executed]`
- Router (`message-router.ts:1037–1068`) broadcasts **after** the handler, constructing `{type:"composer.lease", thread_id, holder, rev}` from the result. Sibling demotions included so panel cannot stay stuck.
- Inbound `type:"composer.lease"` (the broadcast shape) is **unknown** → fail-closed under `CMSPARK_WS_STRICT` (`validate.ts:1095–1113`) `[executed]`. Default router arm is `Unknown message type` (`message-router.ts:3501–3502`).
- Surface stamp is overwrite-always from `wsAuth`, never client `__cmspark_surface` (`lifecycle.ts:1045–1046`, `composer-lease.ts:115–118`).
- Summoner disconnect releases overlay holds and broadcasts server snapshots (`lifecycle.ts:1353`, `composer-lease.ts:294–322`). Tray close does not (`overlayLeasesOnSummonerDisconnect("tray")` → `[]`).

**NIT-6**: `claim` trusts client `holder` (`composer-lease.ts:160–172`). `incomingHolderFromSurface` is used only for `chat.create` (`composer-lease.ts:96–98`, `:128–144`), not claim. An HMAC-local tray/extension socket can claim `holder:"overlay"`; a summoner socket can claim `holder:"panel"`. Same-machine authenticated DoS of composer, not CU L2 skip. CAS `rev` still applies.

### 5. Is `composer.lease.release_overlay` actually ACL-gated on summoner?

**Yes — allow-listed, not ungated.** `[inspected]` + `[executed]`

- Handshake `surface` is `"summoner"` iff client sent that string; else `"tray"` (`lifecycle.ts:990–991`). Unauthenticated messages terminate (`lifecycle.ts:1027–1034`).
- `assertSummonerAllowed` runs **before** stamp/route (`lifecycle.ts:1038–1044`).
- `SUMMONER_ALLOW` includes `composer.lease.release_overlay` (`summoner-acl.ts:11–22`, `:31–41`). Trust elevation (`config.set`, `security.confirmation.response`, `mcp.add`, …) still `SUMMONER_ACL`.
- Fail-open on **tray / omitted surface**: they are *not* summoner-ACL'd (`summoner-acl.ts:7–8`, `:35`). `release_overlay` from Side Panel is the safe direction (composer returns to panel). No inbound-MCP path to this type `[inspected]`.
- Validator accepts `release_overlay` with empty body (`validate.ts:80`) — no client-supplied lease fields to spoof into the broadcast.

### 6. Can Companion stdin persist / fire overlay `continue`?

**Cannot fire. Cannot persist as a stdin command.** `[inspected]` + `[executed]`

- Continue is **stdout only**: `continueClicked` → `{"type":"summoner.continue"}` (`Tray.swift:2018–2020`). Protocol comment agrees (`Tray.swift:13–22`).
- `handleCommand` stdin switch (`Tray.swift:456–614`) has `summoner.open|hydrate|token|done|error|close|hotkey.*|dictate|settings|tool|mcp|hits` — **no continue**. Unknown `cmd` → `default: break`.
- TS codec: `decodeSummonerOutbound({cmd:"summoner.continue"}) === null`; inbound `type` is the click path (`protocol.ts:317–379`, `:409–410`) `[executed]`.
- `SwiftTrayAdapter.send` of encoded hydrate does not carry a continue flag; extra `continue:true` on hydrate is dropped by `decodeSummonerOutbound` `[executed]`. Swift `applyHydrate` ignores unknown keys (`Tray.swift:1625–1641`).
- Overlay continue CTA is a **new user `chat.create`**, not L2 replay (`menu-bar-agent.ts:718–721`, `client.ts:159–164`). While a computer task is LIVE, overlay `chat.create` is `L2_CONDUCTOR_ELSEWHERE` (`message-router.ts:305–308`).

**NIT-7**: `sawBrowserUnavailable` is **not** cleared in `applyHydrate`; `open(threadId:)` only resets it when `threadId.isEmpty` (`Tray.swift:1599–1605`, `:1625–1641`). Stdin cannot auto-click continue, but the **CTA visibility** can survive hydrate / reopen with a non-empty thread id until a new empty open. User still has to click; conductor still applies.

---

## Findings

### NIT-1 — latent `com.cmspark.tray` bundle-id continue

If a future Swift build ships `CFBundleIdentifier=com.cmspark.tray` **and** that full id is written into `companion_ui_exe_basenames`, `isDeniedCompanionUiProcess` does not match (only `cmspark-tray` basename + `com.cmspark.agent|host`). `[executed]` `isCompanionUiOwner("com.cmspark.tray", [..., "com.cmspark.tray"]) === true`.

Current binary is unbundled; default list does not contain this id. Fold if/when tray is bundled.

### NIT-2 — strip list vs Darwin bundle deny

`stripCompanionUiProcessContinueDeny` only drops last-segment `cmspark-tray`. Persisted `com.cmspark.agent` / `com.cmspark.host` strings remain in config JSON. Runtime deny still returns `false` for those FG identities. Cosmetic / operator-confusion only.

### NIT-3 — no executor test for `com.cmspark.host` FG yield

`computer-self-ui.test.ts` covers both bundle ids; executor S23 tests tray path + `com.cmspark.agent` only. Matcher is shared; not a logic hole.

### NIT-4 — `key` / `type` skip companion-ui rects

`executor.ts:1367–1382`: rect assert is on scroll/drag/click. Overlay is a different PID; hwnd type/click still the intended CU path. Residual if Darwin key events follow key window (overlay `makeFirstResponder(composer)`).

### NIT-5 — overlay drag does not refresh S23 rects

No `windowDidMove`. Hit-test SoT is stdout `companion.ui.rect` applied only from the hashed Swift binary (`swift-tray-bridge.ts:537–541`, SHA256 + inode TOCTOU). Stale rect after drag is fail-open for *overlay chrome clicks*, fail-closed for L2 (no Allow/Deny on overlay; conductor). Accept for P0; fold `windowDidMove`/`NSWindowDidMove` emit if overlay stays shippable during CU.

### NIT-6 — lease `claim.holder` not bound to handshake surface

Local HMAC DoS of composer (panel↔overlay). `chat.create` still uses stamped surface vs registry holder. Not a confirm-skip.

### NIT-7 — `sawBrowserUnavailable` survives stdin hydrate / non-empty reopen

Does not execute continue. CTA can remain visible. Clear the flag in `applyHydrate` / every `open`.

---

## Trust monotonicity (ADR-020)

- Overlay is **not** a second L2 conductor: no `summoner.confirm.*` dialect (`protocol.ts:268–278`; Swift overlay cmds have zero Allow/Deny). HUD/tray `show-confirm` stays on the same stdin pipe but a **different** window.
- Deeper Surface (CU LIVE) **tightens** overlay (`L2_CONDUCTOR_ELSEWHERE`), does not inherit L0 “just type continue”.
- `auto_approve_dangerous` / cruise / session trust do **not** reopen S23 self-UI continue for tray/host. Unattended remains the documented “all mid-task re-L2 silent” kill-switch; click-on-overlay still hard-denies.

---

## Residual risk (owned)

| Residual | Severity | Owner |
|----------|----------|--------|
| Future `com.cmspark.tray` bundle id + allow-list | NIT-1 | if tray is bundled |
| Multi-monitor / drag stale overlay rects | NIT-5 | Darwin CU ∩ overlay visible |
| Unattended silent `foreground_yielded` | pre-existing | unattended grant |
| Any `chrome-extension://` + HMAC (scheme-level origin) | pre-existing P0-2 | ws origin gate |

No named S23 / lease / stdin-continue **bypass** survived inspection + the required tests + probes.

VERDICT: APPROVE_WITH_NITS
