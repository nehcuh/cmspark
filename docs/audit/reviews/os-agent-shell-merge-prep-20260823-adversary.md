# Independent adversary — OS Agent Shell merge-prep (composer.lease + S23 + overlay copy)

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Role | **Independent** adversarial reviewer. Did **not** implement this batch. Hostile to grep-theater, self-congratulation, and “tests green ⇒ identity SoT is correct”. |
| Repo | `/Users/huchen/Projects/cmspark` |
| Branch | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` **+ dirty tree** (this batch is uncommitted) |
| Blast | T3 — composer.lease identity + computer-use S23 self-UI continue |
| Prior synthesis | `docs/audit/reviews/os-agent-shell-vs-main-20260823-synthesis.md` — MERGE **NO**; three BLOCKs |
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

Axes fit: Surface L0 overlay composer + L2 `host_computer` FG-yield. Trust monotonicity is the whole point of BLOCK 2 — a UX heuristic must not collapse CU re-L2.

---

## MACHINE

**This subagent had no shell.** The brief's required re-run (`tsc`, named `node --test`, `shasum -a 256 companion/dist/cmspark-tray`) was **not** executed here. Implementer's green board is **untrusted**.

What *was* verified:

| Item | Evidence | Tag |
|------|----------|-----|
| `companion/.test-dist/tests/composer-lease.test.js` contains exclusive-claim + `release_overlay` cases | compiled artifact present | `[inspected]` — compile happened; **pass/fail unknown** |
| `computer-self-ui.test.js` / `config.test.js` / `computer-executor.test.js` contain the new S23 cases | same | `[inspected]` |
| `chrome-extension/.test-dist/tests/overlay-standby.test.js` exists | same | `[inspected]` |
| `SWIFT_TRAY_SHA256` in source is `402de16271176902d5b0c86b3ab23b46955ccba45da15cac4f4e95d93f69b960` | `swift-tray-bridge.ts:59` | `[inspected]` |
| `companion/dist/cmspark-tray` exists | `companion/dist/` listing | `[inspected]` |
| Pin lockstep with binary | **not hashed this session** | `[assumed]` |
| computer-executor “12 pre-existing re-L2 failures” | **not re-run** | `[assumed]` — cannot confirm count or that S23 didn't add any |

Judges who require MACHINE-first may stop here. I still scored the three BLOCKs on production-path inspection, because that is the identity SoT question the synthesis asked.

---

## DoD checklist — the three BLOCKs

From vs-main synthesis MERGE gate:

| # | DoD (external observable) | Primary production path | Status |
|---|---------------------------|-------------------------|--------|
| **1** | Switch thread / close overlay: release **ALL** overlay-held leases (or release old id before claim). Broadcast so Side Panel is not stuck `OVERLAY_STANDBY` on a leaked thread. | `ComposerLeaseRegistry.claim` exclusive; `handleSummonerClosed` → `release_overlay`; `message-router` sibling/release broadcasts; Side Panel `shouldApplyStreamEvent` + `APPLY_COMPOSER_LEASE` | **CLOSED** on the named paths. Residual races below do **not** restore the original “claim T2, T1 stays overlay forever” leak. |
| **2** | Production default `companion_ui_exe_basenames` must **NOT** include `cmspark-tray`; FG yield to tray must **NOT** silent-continue (must re-L2 or hard-reject). Window-rect S23 remains for clicks. | `DEFAULT_CONFIG` omit + load/save strip + `isCompanionUiOwner` hard-deny; executor `isSelfUiYield`; `assertClickClearsCompanionUi` on click/scroll/drag | **CLOSED** for path/basename identity (Win + unpackaged Darwin). Residual: Darwin FG identity is **bundleId**, and `com.cmspark.agent` is still a hard-coded continue. |
| **3** | Placeholder must not advertise 按住说话 while mic is hidden; empty/detached overlay must still show 发送 if L0 send is claimed available. | `summonerTalkPlaceholder`; `applyPhase` `footRow`/`sendButton` | **CLOSED**. Tests are grep; source is the SoT. |

**None of the three named BLOCKs is still open on the path the synthesis specified.** Residuals are nits / P1 follow-ups, not a reopen of X2/X4/X7.

---

## Outcome

### BLOCK 1 — lease exclusive + close-all + broadcast

**Original hole (X2):** `hydrateSummonerThread` claimed the new id and never released the old; close released only `summonerThreadId`. Side Panel on the leaked thread stayed `OVERLAY_STANDBY`.

**What actually holds now** `[inspected]`:

1. Overlay is a **singleton composer** in the registry. Overlay `claim` writes T2 then `releaseAllOverlay(T2)` demotes every other overlay hold and bumps sibling rev:

```44:57:companion/src/ws/composer-lease.ts
  claim(args: { thread_id: string; holder: ComposerHolder; rev: number }): LeaseMutationResult {
    // ...
    this.leases.set(args.thread_id, next)
    const released_siblings =
      args.holder === "overlay" ? this.releaseAllOverlay(args.thread_id) : []
    return { ok: true, state: next, released_siblings }
  }
```

   `handleSummonerNewThread` / `hydrateSummonerThread` / `submitSummonerTalk` all go through `claimOverlayComposerLease` → `registry.claim`. Exclusive is **in the registry**, not a caller courtesy. The hunt “claim without exclusive?” is false.

2. Close no longer requires the current thread id:

```678:682:companion/src/menu-bar-agent.ts
export async function handleSummonerClosed(): Promise<void> {
  const client = summonerClient
  if (!client) return
  await client.releaseAllOverlayComposerLeases()
}
```

   Swift `hide()` / `windowWillClose` both `emitClosedIfOpen()` → `summoner.closed` (`Tray.swift:1619-1622`, `:1769-1777`). Idempotent via `isOpen`.

3. 1-hit search no longer silent-swaps `summonerThreadId`. It hydrates (which claims exclusive):

```743:750:companion/src/menu-bar-agent.ts
export async function handleSummonerSearch(query: string) {
  // ...
  if (cmd.hits.length === 1) {
    await hydrateSummonerThread(cmd.hits[0].id)
    touchSummonerActivity(cmd.hits[0].id)
  }
```

4. Broadcast is a **separate** `composer.lease` per sibling, with that sibling's `thread_id`:

```1044:1067:companion/src/message-router.ts
          if (leaseResult.type === "composer.lease.released") {
            for (const sibling of leaseResult.released ?? []) {
              session?.broadcast?.({
                type: "composer.lease",
                thread_id: sibling.thread_id,
                holder: sibling.holder,
                rev: sibling.rev,
              })
            }
          } else {
            session?.broadcast?.({ /* claimed thread */ })
            for (const sibling of leaseResult.released_siblings ?? []) {
              session?.broadcast?.({
                type: "composer.lease",
                thread_id: sibling.thread_id,
                holder: sibling.holder,
                rev: sibling.rev,
              })
            }
          }
```

   `session.broadcast` is `broadcastToClients` (`server.ts` wiring). Authenticated extension peer gets it. Background `handleCompanionMessage` forwards **all** types via `chrome.runtime.sendMessage` (`index.ts:431`) — no `composer.lease` filter hole.

5. Side Panel **does** apply sibling `thread_id` correctly:

```93:99:chrome-extension/src/sidepanel/hooks/useWebSocket.ts
export function shouldApplyStreamEvent(
  msgThreadId: string | undefined | null,
  activeThreadId: string | null | undefined,
): boolean {
  if (msgThreadId == null || msgThreadId === "") return false
  if (activeThreadId == null || activeThreadId === "") return false
  return msgThreadId === activeThreadId
}
```

```475:481:chrome-extension/src/sidepanel/hooks/useWebSocket.ts
        case "composer.lease": {
          const holder = msg.holder === "overlay" || msg.holder === "panel" ? msg.holder : null
          if (!holder) break
          const leaseTid = typeof msg.thread_id === "string" ? msg.thread_id : ""
          if (leaseTid && !shouldApplyStreamEvent(leaseTid, activeThreadRef.current)) break
          dispatch({ type: "APPLY_COMPOSER_LEASE", holder, threadId: leaseTid })
```

   Journey: overlay T1 → switch to T2. Broadcasts: T2 `holder=overlay` (dropped on Side Panel viewing T1) + T1 `holder=panel` (applied → `CLEAR` standby). That is exactly the vs-main stuck-standby bug.

   `SET_ACTIVE_THREAD` also clears standby (`agentStore.tsx:801`). Switching away from a leaked thread is a second belt. Staying on the leaked thread is the broadcast path.

**composer-lease unit tests are behavioral, not grep** `[inspected]` `composer-lease.test.ts:293-387`: exclusive demote, `release_overlay` all holds, `released_siblings` payload, close visibility with **stale** thread id, panel `chat.create` on old thread allowed after exclusive switch. That is the right shape of evidence for BLOCK 1.

#### Residual holes (not the original X2)

**H1. Close-during-hydrate re-claims after release.** `hydrateSummonerThread` sets `summonerThreadId`, **awaits** `selectThreadMessages`, then claims (`menu-bar-agent.ts:627-638`). There is **no generation / overlay-open token**.

Reproduce `[assumed]` timing, `[inspected]` code:

1. Overlay holds T1.
2. User types a `#` query with one hit T2 (auto-hydrate starts).
3. User hits Esc during the `thread.select` RTT.
4. `handleSummonerClosed` `release_overlay` — map empty of overlay holds.
5. Stale hydrate resumes → `claimOverlayComposerLease(T2)` → T2 overlay **while the window is gone**.
6. Side Panel on T2: `OVERLAY_STANDBY` until overlay is opened and closed again.

This is **not** the old “T1 stays overlay after switching to T2”. It is a new (or previously unstated) close/claim race. Plausible because 1-hit auto-hydrate + 150ms search debounce + Esc is a real overlay gesture. **P1, not BLOCK 1 reopen** — exclusive claim still prevents dual overlay holds; the failure mode is “closed overlay still owns one thread”.

**H2. Summoner WS disconnected: close is a no-op.** `releaseAllOverlayComposerLeases` returns immediately unless `_state === "connected"` (`companion-client.ts:364-370`). `ws.on("close")` in `lifecycle.ts:1344` does **not** `releaseAllOverlay` when the summoner socket dies. Overlay leases live in companion memory; Side Panel is a different socket. A WS blip + overlay close leaves T1 overlay until companion restart or a later successful `release_overlay`. `if (!client) return` on close is shutdown-only (`summonerClient` is only nulled on tray teardown). **P1.**

**H3. Concurrent hydrates, last claim wins.** Two in-flight `hydrateSummonerThread` calls: slower T1 completion can overwrite T2 UI **and** re-claim T1 (exclusive, so T2 is demoted). Internally consistent (UI id = lease id) but can disagree with the last user selection. **Nit.**

---

### BLOCK 2 — tray must not silent-continue FG yield

**Original hole (X4):** `DEFAULT_CONFIG.companion_ui_exe_basenames` included `cmspark-tray` → executor `isSelfUiYield` continued.

**What actually holds now** `[inspected]`:

1. Defaults omit it (`config.ts:446-451`): `chrome`, `msedge`, …, `cmspark-agent`. **No** `cmspark-tray`.

2. Dirty disk + WS `config.set` + `saveConfig` all strip the exact name:

```1159:1166:companion/src/config.ts
function stripCompanionUiProcessContinueDeny(cfg: CompanionConfig): CompanionConfig {
  const names = cfg.security?.companion_ui_exe_basenames
  if (!Array.isArray(names)) return cfg
  cfg.security.companion_ui_exe_basenames = names.filter(
    (n) => String(n || "").toLowerCase() !== "cmspark-tray",
  )
  return cfg
}
```

   Called from `loadConfig` (`config.ts:659`) and `saveConfig` after `deepMerge` (`config.ts:1232`). Hunt “stdin `saveConfig` still persist `cmspark-tray`?”: there is **no** tray-stdin `saveConfig`. `settings-cli` / `settings-web` / `config.set` (`handlers/config.ts:128-129` passes `cfg.security` wholesale) all hit `saveConfig`. Strip holds. `config.set` does **not** need its own deny — save is the choke point.

3. Runtime hard-deny even if the name is allow-listed:

```55:58:companion/src/computer/self-ui.ts
  if (base === "cmspark-tray" || raw === "cmspark-tray" || raw.endsWith("/cmspark-tray") || raw.endsWith("/cmspark-tray.exe")) {
    return false
  }
```

   `exeBasename` cuts at first `.` (`guards.ts:107-114`), so `cmspark-tray.exe` → `cmspark-tray`. Windows `C:\...\cmspark-tray.exe` matches `endsWith("/cmspark-tray.exe")` after `\\` → `/`. **Win path covered.** Strip does **not** drop `"cmspark-tray.exe"` from the persisted list; the runtime deny still fires. Dual layer is why BLOCK 2 is closed.

4. Executor still uses the heuristic as **continue**, not as a skip of window-rect:

```1614:1636:companion/src/computer/executor.ts
        const isSelfUiYield =
          fgYielded &&
          isCompanionUiOwner(fgOwnerExe, selfUiBasenames) &&
          !newTopLevel &&
          uiaOpened.length === 0 &&
          // ...
        if (isSelfUiYield) {
          // forceForeground + continue — no re-L2
```

   Click/scroll/drag still `assertClickClearsCompanionUi` (`executor.ts:1371-1382`). Overlay emits `companion.ui.rect` on open (`Tray.swift:1616`) and clears on hide (`:1621`). Window-rect S23 is intact.

5. Behavioral tests exist: `computer-self-ui.test.ts:44-65` (path + allow-list present still false); `computer-executor.test.ts:1212-1235` (allow-list **includes** `cmspark-tray`, FG path is the Mac binary path, expect `DIALOG_PAUSED_DENIED` + `computer.foreground_yielded`); `config.test.ts:892-913` (defaults + **load** strip). These are not grep.

#### Residual (Darwin identity mismatch — not enough to reopen BLOCK 2 today)

Darwin `infoForHwnd` sets `exePath: w.bundleId ?? null` (`darwin-adapters.ts:296`). Host fills `bundleId` from `NSRunningApplication.bundleIdentifier ?? ""` (`host.swift:918-921`).

`cmspark-tray` is a **naked `swiftc` binary** (`build-tray.sh:41-48`), packaged at `CMspark.app/Contents/Resources/bin/cmspark-tray` (`scripts/macos/launcher.sh:10`) — **not** `Contents/MacOS/cmspark-tray`. Command-line tools typically report **nil** bundle id. Then `fgOwnerExe === ""`, `isCompanionUiOwner` fail-closes (`self-ui.ts:47`), `isSelfUiYield` is false, **re-L2**. That is the production Darwin path, and it does **not** silent-continue.

The executor S23 test feeds a **path** (`/Applications/CMspark.app/Contents/MacOS/cmspark-tray`) that **Darwin adapters never produce**. Test theater for macOS FG identity; still a real Windows-shaped case.

**H4.** `MAC_COMPANION_BUNDLE_IDS` still includes `com.cmspark.agent` / `com.cmspark.host` (`self-ui.ts:31-32`). That match is **unconditional** once the allow-list is non-empty (`self-ui.ts:68-69`) — it does not consult `cmspark-tray` deny. If the tray process ever reports `com.cmspark.agent` (Info.plist / codesign identity), S23 **process-continue reopens**. Today the tray is unsigned-as-agent naked swiftc. **P1 residual / future landmine**, not a current BLOCK.

**H5.** No `saveConfig` strip test — only load. Strip-on-save is `[inspected]` only.

---

### BLOCK 3 — honest placeholder + 发送 when L0 is available

**Original hole (X7):** placeholder “按住说话” with mic forced hidden; detached/empty hid 发送.

**What actually holds now** `[inspected]`:

```1436:1437:companion/src/tray/Tray.swift
private let summonerTalkPlaceholder = "说点什么…"
private let summonerTalkHint = "回车发送到当前线程，输入 # 搜标题"
```

```2229:2239:companion/src/tray/Tray.swift
    footRow?.isHidden = searching
    sendButton?.isHidden = false
    continueButton?.isHidden = !(hasTranscript && browserAttached && sawBrowserUnavailable)
    // ...
    micButton?.isHidden = true
```

- Mic always hidden in `applyPhase`. Placeholder does **not** mention 按住说话.
- `footRow` hidden **only** while `#` searching (search is not L0 send). Empty talk + detached: `searching=false` → foot row visible, 发送 visible.
- `submitComposer()` does **not** require `threadId` (`Tray.swift:1890-1899`). Return key in talk mode calls it (`:1847-1850`). Empty/new-thread L0 still has a send affordance (button **and** Return). `handleSummonerSubmit` → `submitSummonerTalk` creates/resolves a thread then claims (`summoner/client.ts:133-155`).

**H6.** `mic.toolTip = "…也可按住说话"` (`Tray.swift:2494`) is dead chrome (button hidden) but still a lie in the binary. **Nit.**

**H7.** BLOCK 3 tests are **grep theater** (`summoner-talk.test.ts:132-164`, `summoner-overlay.test.ts` source matches). They would pass if `applyPhase` were never called. SoT is the Swift above, not the tests. I still score BLOCK 3 **CLOSED** because the production `applyPhase` is unambiguous.

---

## Trajectory

HEAD is still `659bbce` (docs-only commit). This batch is **dirty tree**. Without `git diff` I cannot prove a file-level delta vs the vs-main review, but the production edits sit on the BLOCK files:

| File | Why it's on-BLOCK |
|------|-------------------|
| `companion/src/ws/composer-lease.ts` | exclusive claim, `release_overlay`, close-all helper |
| `companion/src/message-router.ts` | sibling + release broadcasts |
| `companion/src/menu-bar-agent.ts` | close-all, 1-hit hydrate |
| `companion/src/tray/companion-client.ts` | `releaseAllOverlayComposerLeases` |
| `companion/src/config.ts` | default omit + load/save strip |
| `companion/src/computer/self-ui.ts` | tray hard-deny |
| `companion/src/tray/Tray.swift` | placeholder + footRow |
| `companion/src/tray/swift-tray-bridge.ts` | SHA pin |
| tests listed above | intended evidence |

No drive-by into MCP/CU policy/L2 admission/`config.set` arm-phrase was found while hunting these paths. `executor.ts` S23 continue still goes through `isCompanionUiOwner` (pre-existing); this batch's deny is in `self-ui.ts`.

`summoner-overlay.test.ts` / `summoner-talk.test.ts` / `overlay-standby.test.ts` inbound cases remain **readFileSync + assert.match**. That is the same grep culture the vs-main CODE-QUALITY lane called out. It did **not** expand into unrelated modules.

---

## Component — remaining holes (file:line)

| ID | Severity | Hole | Where |
|----|----------|------|--------|
| H1 | P1 | Hydrate/claim after overlay already closed (no generation) | `menu-bar-agent.ts:627-638` await-then-claim; `handleSummonerSearch:747-749` widens the window |
| H2 | P1 | Close / WS drop does not release if summoner client is not `connected`; companion `ws.close` does not drop overlay leases | `companion-client.ts:364-370`; `lifecycle.ts:1344` (no `releaseAllOverlay`) |
| H3 | nit | Concurrent hydrates last-claim-wins vs last user select | `menu-bar-agent.ts:627-638` |
| H4 | P1 landmine | `com.cmspark.agent` bundle id is unconditional self-UI continue | `self-ui.ts:31-32,68-69` vs Darwin `darwin-adapters.ts:296` |
| H5 | nit | `saveConfig` strip untested; strip is exact `"cmspark-tray"` only | `config.ts:1163-1165`; `config.test.ts:902` is load-only |
| H6 | nit | Hidden mic tooltip still says 按住说话 | `Tray.swift:2494` |
| H7 | nit | Overlay Swift + Side Panel inbound tests are grep | `summoner-talk.test.ts`, `summoner-overlay.test.ts`, `overlay-standby.test.ts:176-182` (no `shouldApplyStreamEvent` assertion on lease) |
| H8 | nit | Executor S23 test uses a path Darwin never reports | `computer-executor.test.ts:1221` vs `darwin-adapters.ts:296` |
| H9 | nit | `APPLY_COMPOSER_LEASE` reducer ignores `threadId`; thread filter is only in the WS hook | `agentStore.tsx:808-814` |
| H10 | process | MACHINE (tsc / named tests / shasum) **not independently executed** this session | this review |

H1 is the only remaining way I can still describe a user journey that leaves Side Panel in `OVERLAY_STANDBY` after the overlay is gone. It is a race, not the vs-main exclusive-lease leak. Do **not** treat composer-lease.test.js green as proof H1 is closed — those tests never cancel an in-flight hydrate.

computer-executor “12 pre-existing re-L2 failures”: **not verified**. S23 case is present in `.test-dist` and is fail-closed (`DIALOG_PAUSED_DENIED`). If those 12 are session-trust / pixel-stale / OCR skips, they are outside this batch; I will not rubber-stamp “NOT introduced”.

---

## Test-quality (hostile)

| Suite | Load-bearing? |
|-------|----------------|
| `composer-lease.test.ts` exclusive / `release_overlay` / stale-id close | **Yes** — mutates a real registry |
| `computer-self-ui.test.ts` tray deny + allow-list present | **Yes** — calls `isCompanionUiOwner` |
| `computer-executor.test.ts` S23 | **Yes** on path identity; **No** as Darwin SoT |
| `config.test.ts` defaults + load strip | **Yes** for load; **gap** for save |
| `summoner-overlay.test.ts` “close releases every overlay lease” | **No** — `assert.match` on `menu-bar-agent.ts` source |
| `summoner-talk.test.ts` placeholder / send visible | **No** — greps Swift; does not instantiate `SummonerController` |
| `overlay-standby.test.ts` reducer cases | **Yes** for SET/CLEAR/APPLY |
| `overlay-standby.test.ts` `composer.lease` inbound | **No** — greps `APPLY_COMPOSER_LEASE`, does **not** assert `shouldApplyStreamEvent` |

Grep-green ≠ overlay closed. I scored BLOCK 3 from `applyPhase`, not from those tests.

---

## Nits (non-blocking, fold or own)

1. Generation token on `hydrateSummonerThread` / `handleSummonerNewThread` so `summoner.closed` invalidates in-flight claims (closes H1).
2. Companion `ws.close` when `auth.surface === "summoner"` should `releaseAllOverlay` + broadcast (closes H2).
3. `isCompanionUiOwner`: deny `com.cmspark.agent` **only if** exe basename is `cmspark-tray`, or stop putting tray inside an agent-identity bundle without a distinct bundle id (closes H4).
4. Add `saveConfig({ security: { companion_ui_exe_basenames: ["chrome","cmspark-tray"] } })` persist test; strip `cmspark-tray.exe` too.
5. Executor S23 Darwin case: `exePath: "com.cmspark.agent"` must **re-L2** if product intent is “tray never continue”; today that case would **continue** and the current test would not catch it.
6. Overlay-standby inbound test: dispatch a fake `composer.lease` through the gate helper, not `readFileSync`.
7. Drop dead mic tooltip.
8. Independently `shasum -a 256 companion/dist/cmspark-tray` vs `SWIFT_TRAY_SHA256` before merge — pin is a trust boundary (`swift-tray-bridge.ts:71-86`).

---

## Verdict

The three vs-main BLOCKs are **closed on the production paths the synthesis named**: exclusive overlay claim demotes siblings; close releases **all** overlay holds without the current thread id; sibling leases are broadcast as separate `composer.lease` messages that Side Panel applies only for the active `thread_id`; defaults + load/save strip + runtime deny keep `cmspark-tray` off process-level continue; window-rect S23 remains; placeholder is honest; 发送 stays up for empty/detached talk.

I will **not** APPROVE clean: H1 can still stick Side Panel in `OVERLAY_STANDBY` after Esc during 1-hit hydrate; H2 can stick it across a summoner WS drop; Darwin FG identity is untested; MACHINE was not re-run; overlay UI tests are still grep. None of that is the original X2/X4/X7.

VERDICT: APPROVE_WITH_NITS
