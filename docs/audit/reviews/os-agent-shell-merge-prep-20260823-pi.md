# Pi 复审 — OS Agent Shell merge-prep (composer.lease + S23)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Role | **Pi 复审 (second judge)**. Did **not** implement. Did **not** write the adversary report. |
| Repo | `/Users/huchen/Projects/cmspark` |
| Branch | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` **+ dirty tree** |
| Blast | T3 — composer.lease identity + computer-use S23 self-UI continue |
| Adversary | `docs/audit/reviews/os-agent-shell-merge-prep-20260823-adversary.md` — **APPROVE_WITH_NITS** |
| Isolation | Production source **not** modified. Implementer session not treated as evidence. |

```text
Surface:      OS summoner overlay (L0 capture) + Side Panel composer.lease
L2-classes:   computer-use FG-yield self-UI recovery (S23)
Compose:      none
Autonomy:     single
Trust:        overlay lease is SoT for who may chat.create;
              companion_ui_exe_basenames is a UX heuristic that must NOT skip
              re-L2 when FG yields to cmspark-tray
Channel:      community
```

This review **confirms or rejects** the adversary verdict. Adversary had **no shell**; MACHINE below is this session.

---

## MACHINE `[executed]`

All commands re-run this session from the dirty tree. Implementer board is not trusted.

| Command | Result |
|---------|--------|
| `companion` `./node_modules/.bin/tsc -p tsconfig.test.json --pretty false` | **0 errors** |
| `node --test` composer-lease + summoner-overlay + summoner-acl + summoner-talk + computer-self-ui + l1-actuator + l2-conductor + companion-ui-rects | **96 pass / 0 fail** |
| `chrome-extension` `tsc -p tsconfig.test.json` then `node --test .test-dist/tests/overlay-standby.test.js` | **18/18** |
| `shasum -a 256 companion/dist/cmspark-tray` | `402de16271176902d5b0c86b3ab23b46955ccba45da15cac4f4e95d93f69b960` |
| `SWIFT_TRAY_SHA256` `swift-tray-bridge.ts:59` | **equal** (lockstep) |
| `node --test --test-name-pattern "S23\|cmspark-tray\|companion_ui"` config + computer-executor | **3/3 pass** (defaults omit, load strip, executor tray re-L2) |
| full `computer-executor.test.js` | **93 pass / 12 fail** |

**S23 new case PASSES** `[executed]`: `executor S23: cmspark-tray FG yield must re-L2, never silent continue`.

The 12 computer-executor failures are the named pre-existing re-L2 / budget / zone / blob / same-exe / G4-M1 set. **None** is the cmspark-tray yield test. Do not REJECT this batch for those 12.

| Fail | Name class |
|------|------------|
| 4th explicit-coordinate click / uncrossverified denied | uncrossverified |
| budget exhaustion / paused event budget | budget |
| foreground change / large diff / X1 zone / X1 blob / X1 same-exe / WP2 same-exe DIALOG | zone dialog / yield channel |
| M1 G4 续期窗 | G4 vs budget order |

Tray binary mtime `21:31:17` is **after** `Tray.swift` `21:29:56` and **before** pin update `21:31:26`. SHA pin comment: "Updated 2026-08-23 after honest placeholder + detached send".

---

## Adversary scorecard

| Claim | Pi |
|-------|----|
| Three vs-main BLOCKs closed on the named production paths | **Confirm** `[inspected]` + MACHINE `[executed]` |
| H1/H2/H4 are residual, not BLOCK reopen | **Confirm** (H1 refined below; still P1) |
| Overlay UI tests are grep | **Confirm** `[inspected]` |
| MACHINE not independently executed | **Closed this session** |
| Darwin FG identity untested as bundle-id | **Confirm** — executor S23 feeds a path Darwin adapters never produce |
| computer-executor 12 failures not verified | **Closed this session** — 12 fail, S23 not among them |
| Too loose on a still-open BLOCK? | **No.** Missing layer was MACHINE, now green. |

---

## Outcome

### BLOCK 1 — exclusive overlay + close-all + broadcast — **CLOSED**

Original X2: hydrate claimed the new id and never released the old; close released only `summonerThreadId`; Side Panel on the leaked thread stayed `OVERLAY_STANDBY`.

**What holds** `[inspected]`:

1. Overlay `claim` is exclusive in the registry, not a caller courtesy. After writing T2 it `releaseAllOverlay(T2)` and returns `released_siblings` (`composer-lease.ts:44-57`, `76-90`). Hunt “claim without exclusive?” is false. Behavioral tests `[executed]`: exclusive demote, `release_overlay` all holds, stale-id close, panel `chat.create` allowed on old thread after switch (`composer-lease.test.ts:293-387`).

2. Close does not need the current thread id:

```678:682:companion/src/menu-bar-agent.ts
export async function handleSummonerClosed(): Promise<void> {
  const client = summonerClient
  if (!client) return
  await client.releaseAllOverlayComposerLeases()
}
```

   Swift `hide()` / `windowWillClose` both `emitClosedIfOpen()` → `summoner.closed` (`Tray.swift:1619-1622`, `:1769-1777`). Idempotent via `isOpen`.

3. 1-hit search hydrates (which claims exclusive) instead of silent-swapping `summonerThreadId` (`menu-bar-agent.ts:743-750`).

4. Broadcast is a **separate** `composer.lease` per sibling (`message-router.ts:1040-1067`). `session.broadcast` fans out to **all authenticated** clients (`lifecycle.ts:1297-1307`), not the summoner socket only. Extension `handleCompanionMessage` forwards all types (`index.ts:431`) — no `composer.lease` filter hole.

5. Side Panel applies only the active `thread_id` (`useWebSocket.ts:93-99`, `:475-481`). Journey overlay T1 → switch T2: T2 `holder=overlay` dropped on a T1 panel; T1 `holder=panel` applied → `CLEAR` standby. `SET_ACTIVE_THREAD` also clears (`agentStore.tsx:801`) as a second belt.

BLOCK 1 DoD is met. Residuals do **not** restore “claim T2, T1 stays overlay forever”.

### BLOCK 2 — tray must not silent-continue FG yield — **CLOSED**

Original X4: `DEFAULT_CONFIG.companion_ui_exe_basenames` included `cmspark-tray` → `isSelfUiYield` continued.

**What holds** `[inspected]` + `[executed]`:

1. Defaults omit it (`config.ts:446-451`): browsers + `cmspark-agent`. **No** `cmspark-tray`. Test `[executed]`.

2. `stripCompanionUiProcessContinueDeny` on `loadConfig` (`:659`) and `saveConfig` after `deepMerge` (`:1232`). Exact name `"cmspark-tray"` only. `config.set` passes `cfg.security` wholesale then `saveConfig` (`handlers/config.ts:128-129`, `:278`) — save is the choke point. Load-strip test `[executed]`; save-strip untested (H5).

3. Runtime hard-deny even if allow-listed (`self-ui.ts:55-58`). `exeBasename` cuts at first `.` so `cmspark-tray.exe` → `cmspark-tray`. Windows `C:\...\cmspark-tray.exe` matches `endsWith("/cmspark-tray.exe")` after `\\` → `/`. Dual layer is why BLOCK 2 is closed. Tests `[executed]`: path + allow-list present still false; executor with allow-list **including** `cmspark-tray` expects `DIALOG_PAUSED_DENIED` + `computer.foreground_yielded`.

4. Click/scroll/drag still `assertClickClearsCompanionUi` (`executor.ts:1371-1382`). Overlay emits `companion.ui.rect` on open (`Tray.swift:1616`) and clears on hide (`:1621`). Window-rect S23 remains.

Darwin FG identity is **bundleId** (`darwin-adapters.ts:296` ← `host.swift:918-921`). Naked `swiftc` tray (`build-tray.sh:41-48`) packaged at `Contents/Resources/bin/cmspark-tray` typically reports **nil** → `""` → `isCompanionUiOwner` fail-closes (`self-ui.ts:47`) → re-L2. That is today's Darwin path. H4 is the landmine if that identity ever becomes `com.cmspark.agent`.

### BLOCK 3 — honest placeholder + 发送 when L0 is available — **CLOSED**

Original X7: placeholder “按住说话” with mic forced hidden; detached/empty hid 发送.

**What holds** `[inspected]`:

- `summonerTalkPlaceholder = "说点什么…"` (`Tray.swift:1436`). Hint is 回车发送, not press-to-talk (`:1437`).
- `applyPhase`: `footRow?.isHidden = searching`; `sendButton?.isHidden = false`; `micButton?.isHidden = true` (`:2229-2239`). Empty talk + detached: `searching=false` → foot row and 发送 visible.
- `submitComposer()` does not require `threadId` (`:1890-1899`).
- Tests for this BLOCK are **grep** (`summoner-talk.test.ts:132-164`). SoT is `applyPhase`, not those tests. Still CLOSED because production `applyPhase` is unambiguous.

Binary corroboration `[executed]`: long old placeholder `说点什么，或按住说话` is **absent** from `__cstring` (would not fit Swift SSO). New placeholder is 15 UTF-8 bytes (SSO-sized — not expected as a contiguous cstring). Hint `回车发送到当前线程` **is** in the binary. Tooltip `也可按住说话` **is** in the binary (H6). Combined with mtime lockstep + SHA pin, BLOCK 3 is in the ship artifact.

---

## H1 / H2 / H4 — BLOCK reopen or residual?

### H1 — hydrate/claim after close — **P1 residual, not BLOCK 1 reopen**

`hydrateSummonerThread` sets id, **awaits** `selectThreadMessages`, hydrates, then claims (`menu-bar-agent.ts:627-638`). No generation / overlay-open token. `handleSummonerNewThread` has the same await-then-claim (`:942-958`). 1-hit auto-hydrate (`:747-749`) widens the window.

Adversary framed the failure as “closed overlay still owns T2 → Side Panel OVERLAY_STANDBY”. That is incomplete. Swift `applyHydrate` **re-opens** a non-visible window (`Tray.swift:1637-1638`), and `open()` emits `summoner.ready` (`:1615`) which re-enters `handleSummonerReady`. Typical Esc-during-1-hit race is **overlay resurrection** (close doesn't stick) plus exclusive re-claim — Side Panel standby then matches a window that came back. The “overlay gone, panel stuck” path needs claim without Swift re-open (e.g. `trayInstance` null). Exclusive claim still forbids dual overlay holds. Composer-lease tests never cancel an in-flight hydrate — green is not proof H1 is closed.

Plausible gesture (1-hit + 150ms debounce + Esc + localhost RTT) but not the vs-main deterministic T1 leak. **Do not reopen BLOCK 1.**

### H2 — summoner WS drop — **P1 residual, not BLOCK 1 reopen**

`releaseAllOverlayComposerLeases` no-ops unless `_state === "connected"` (`companion-client.ts:364-370`). Companion `ws.on("close")` (`lifecycle.ts:1344`) does **not** `releaseAllOverlay` when the summoner socket dies. Overlay leases live in companion memory; Side Panel is a different socket. `if (!client) return` on close is shutdown-only (`summonerClient` nulled on tray teardown).

A WS blip + overlay close can leave T1 overlay until a later successful `release_overlay` or process restart (in-memory map gone → default panel, but Side Panel local `overlayStandby` may stay until the next lease event). Localhost drop is uncommon. Not the named switch/close leak. **Do not reopen BLOCK 1.**

### H4 — `com.cmspark.agent` bundle id — **P1 landmine, not BLOCK 2 reopen today**

`MAC_COMPANION_BUNDLE_IDS` includes `com.cmspark.agent` / `com.cmspark.host` (`self-ui.ts:31-32`). That match is **unconditional** once the allow-list is non-empty (`:68-69`) — it does not consult the `cmspark-tray` deny. `exeBasename("com.cmspark.agent")` is `"com"`, so the basename deny never fires.

Today: tray is unsigned-as-agent naked swiftc; Darwin `infoForHwnd` reports bundleId; nil/empty fail-closes to re-L2. `com.cmspark.agent` **is** the app Info.plist and host codesign id (`scripts/macos/Info.plist`, `host-Info.plist`) — if tray is later bundled/codesigned under that identity, S23 **process-continue reopens**. Executor S23 test uses `/Applications/CMspark.app/Contents/MacOS/cmspark-tray`, which Darwin adapters never produce (H8). **Do not reopen BLOCK 2 on current identity.**

---

## Trajectory

HEAD is still `659bbce` (docs-only). This batch is **dirty tree**. Production edits sit on the BLOCK files; no drive-by into MCP / CU policy / L2 admission / `config.set` arm-phrase while hunting these paths.

`summoner-overlay.test.ts` / `summoner-talk.test.ts` / `overlay-standby.test.ts` inbound cases remain `readFileSync` + `assert.match`. Same grep culture the vs-main CODE-QUALITY lane called out. It did **not** expand into unrelated modules.

`executor.ts` S23 continue still goes through `isCompanionUiOwner` (pre-existing); this batch's deny is in `self-ui.ts`.

---

## Component — remaining holes

| ID | Severity | Hole | Where | Pi vs adversary |
|----|----------|------|--------|-----------------|
| H1 | P1 | Hydrate/claim after overlay already closed; Swift `applyHydrate` can re-open | `menu-bar-agent.ts:627-638`; `Tray.swift:1637-1638`; search `:747-749` | Confirm + refine (resurrection, not only silent leak) |
| H2 | P1 | Close / WS drop does not release if summoner client is not `connected`; companion `ws.close` does not drop overlay leases | `companion-client.ts:364-370`; `lifecycle.ts:1344` | Confirm |
| H3 | nit | Concurrent hydrates last-claim-wins vs last user select | `menu-bar-agent.ts:627-638` | Confirm |
| H4 | P1 landmine | `com.cmspark.agent` bundle id is unconditional self-UI continue | `self-ui.ts:31-32,68-69` vs `darwin-adapters.ts:296` | Confirm — not current Darwin path |
| H5 | nit | `saveConfig` strip untested; strip is exact `"cmspark-tray"` only | `config.ts:1163-1165`; `config.test.ts:902` is load-only | Confirm |
| H6 | nit | Hidden mic tooltip still says 按住说话 (in binary) | `Tray.swift:2494` | Confirm `[executed]` bytes present |
| H7 | nit | Overlay Swift + Side Panel inbound tests are grep | `summoner-talk.test.ts`, `summoner-overlay.test.ts`, `overlay-standby.test.ts:176-182` | Confirm |
| H8 | nit | Executor S23 test uses a path Darwin never reports | `computer-executor.test.ts:1221` vs `darwin-adapters.ts:296` | Confirm |
| H9 | nit | `APPLY_COMPOSER_LEASE` reducer ignores `threadId`; filter is only in the WS hook | `agentStore.tsx:808-814` | Confirm |
| H10 | process | Batch uncommitted | dirty tree | Confirm; MACHINE now executed |

No additional BLOCK found.

---

## Test-quality (hostile)

| Suite | Load-bearing? |
|-------|----------------|
| `composer-lease.test.ts` exclusive / `release_overlay` / stale-id close | **Yes** — mutates a real registry `[executed]` |
| `computer-self-ui.test.ts` tray deny + allow-list present | **Yes** `[executed]` |
| `computer-executor.test.ts` S23 | **Yes** on path identity `[executed]`; **No** as Darwin SoT |
| `config.test.ts` defaults + load strip | **Yes** for load `[executed]`; **gap** for save |
| `summoner-overlay.test.ts` close-all / 1-hit hydrate | **No** — source `assert.match` |
| `summoner-talk.test.ts` placeholder / send visible | **No** — greps Swift |
| `overlay-standby.test.ts` reducer cases | **Yes** for SET/CLEAR/APPLY `[executed]` |
| `overlay-standby.test.ts` `composer.lease` inbound | **No** — greps `APPLY_COMPOSER_LEASE`, does not assert `shouldApplyStreamEvent` |

Grep-green ≠ overlay closed. BLOCK 3 scored from `applyPhase` + binary lockstep, not from those tests.

---

## Nits (non-blocking, fold or own)

Agree with adversary 1–7. MACHINE pin (their #8) is **done** this session.

1. Generation token on `hydrateSummonerThread` / `handleSummonerNewThread` so `summoner.closed` invalidates in-flight claims; Swift `applyHydrate` must not `open()` when `isOpen == false` (closes H1).
2. Companion `ws.close` when `auth.surface === "summoner"` should `releaseAllOverlay` + broadcast (closes H2).
3. `isCompanionUiOwner`: deny `com.cmspark.agent` **only if** exe basename is `cmspark-tray`, or give tray a distinct bundle id (closes H4).
4. Add `saveConfig({ security: { companion_ui_exe_basenames: ["chrome","cmspark-tray"] } })` persist test; strip `cmspark-tray.exe` too.
5. Executor S23 Darwin case: `exePath: "com.cmspark.agent"` must **re-L2** if product intent is “tray never continue”.
6. Overlay-standby inbound: dispatch a fake `composer.lease` through `shouldApplyStreamEvent`, not `readFileSync`.
7. Drop dead mic tooltip.

---

## Verdict

Adversary APPROVE_WITH_NITS is **not** rubber-stamped: MACHINE was missing and is now green (tsc 0; named suites 96/0; overlay-standby 18/18; SHA lockstep; S23 tray-yield pass; 12 executor fails are the pre-existing set). Independent inspection of the three vs-main BLOCK production paths agrees they are closed. H1/H2/H4 remain real P1 residuals / a Darwin landmine — they do not restore X2 exclusive-lease leak or X4 tray silent-continue on current identity, and they do not justify REJECT.

VERDICT: APPROVE_WITH_NITS
