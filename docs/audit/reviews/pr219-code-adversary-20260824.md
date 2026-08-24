# Independent adversary — PR #219 code (steer / nextRun / overlay L0 hub)

> **Lane**: production call sites (correctness + Trust / ADR-020)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub` HEAD `e58942a7` (`feat(summoner): overlay left rail for threads, MCP, L0 packs`)
> **Base**: `origin/main` `5425da07`
> **Spec r2**: `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md`
> **Evidence**: `[inspected]` live production files. `[assumed]` where this review environment could not execute `git diff` / `npx tsx --test` / `shasum`.

```text
Surface:      L0
L2-classes:   none — overlay never Allow/Deny
Compose:      overlay pack.apply allowTrust FORCED false by surface, not client
Autonomy:     existing steer/nextRun
Trust:        monotonic — overlay cannot write Trust B; refuse apply if thread holds trust cookie
Channel:      summoner ACL +pack.list +pack.apply; mcp.add denied
```

Capability declaration: **present** in spec r2. Axes fit: Surface L0 overlay, Compose pack.apply with server-forced `allowTrust=false`, Autonomy reuses steer/nextRun. This review asks whether production actually implements those gates — not whether the prose is nice.

---

## Scope reconstructed

`git log origin/main..HEAD` reconstructed from `.git/logs/refs/heads/feat/steer-nextrun-overlay-hub` (no shell in this subagent):

| SHA | Subject |
|-----|---------|
| `6db93a91` | docs(spec): steer/nextRun composer + overlay L0 hub |
| `90a071b2` | docs(spec): fold design-adversary BLOCKs; Pi/Kimi/Claude APPROVE_WITH_NITS |
| `8826892e` | feat(agent): busy composer steers; occupied chat.create cannot supersede |
| `beb6d3d8` | feat(pack): overlay-eligible apply without Trust write |
| `e58942a7` | feat(summoner): overlay left rail for threads, MCP, L0 packs |

HEAD commit message claims: CI lockstep `sendChatCreate` no longer includes `isRunActive`; window 640pt / rail 200pt; pack apply Trust-free (server); tray hash updated after rebuild.

Production files read (not a substitute for `git diff origin/main -- companion/src chrome-extension/src`, but these **are** the call sites the prompt named):

- `companion/src/message-router.ts` (`chat.create` occupancy, nextRun drain, `pack.apply`)
- `companion/src/packs/overlay-eligible.ts`, `pack-engine.ts`
- `companion/src/ws/summoner-acl.ts`, `composer-lease.ts`, `lifecycle.ts`, `validate.ts`
- `companion/src/summoner/client.ts`, `menu-bar-agent.ts`, `tray/companion-client.ts`, `tray/SummonerOverlay.swift`, `tray/swift-tray-bridge.ts`
- `chrome-extension/src/sidepanel/App.tsx`, `utils/thread-busy.ts`, `background/index.ts`, `hooks/useWebSocket.ts`
- tests: `single/files.test.ts`, `overlay-eligible.test.ts`, `summoner-talk.test.ts`, `summoner-client.test.ts`, `summoner-acl.test.ts`

---

## MACHINE

**Not executed in this review.** No shell. Do not treat this as a green gate.

Tests that *exist* and were read `[inspected]`:

| Claim | Test | Gap |
|-------|------|-----|
| occupied `chat.create` → `run_active` | `files.test.ts` enqueue-caps | Does **not** assert the test controller is still in `abortControllers` after the reject |
| idle `enqueue:true` → `idle_enqueue` | same test | covers the idle-after-abort case |
| mapper `chat.enqueued` / `run_active` | `summoner-client.test.ts` | pass on the mapper only |
| busy overlay submit no `claimLease` | `summoner-talk.test.ts` | pass on the Node helper; does not hit router drain |
| overlay eligible (meeting / trust / navigate / coding-handoff) | `overlay-eligible.test.ts` | **does not** cover `osascript_eval`, `spawn_worker`, `create_tab` |
| overlay `pack.apply` router (allowTrust lie, cookie, extras, live loop) | **none** | missing |
| overlay nextRun drain under overlay lease | **none** | missing — this is the hole |

`SWIFT_TRAY_SHA256` = `77139e17cd5f48d6c25aa0268806e9ba7275a30b535c2dc82749f4621f53291f` in `swift-tray-bridge.ts`. Binary exists at `companion/dist/cmspark-tray`. **Could not `shasum -a 256`.** Unit tests (`swift-tray-integrity.test.ts`) never hash the real binary. `[assumed]` lockstep until someone runs shasum.

---

## Focus checklist (prompt)

| # | Requirement | Result | Evidence |
|---|-------------|--------|----------|
| 1 | occupied `chat.create` without enqueue → `run_active` and **NOT abort** | **PASS** on the occupied arm | `[inspected]` router `:371–372` returns before `:386–389` `existing.abort()` |
| 2 | idle enqueue → `idle_enqueue` | **PASS** | `[inspected]` `:375–376` |
| 3 | `allowTrust = surface !== summoner` (never `rest.allowTrust`) | **PASS** on the stamped path | `[inspected]` `:2742`, `:2775` `allowTrust: !overlayApply` |
| 4 | `isOverlayEligiblePack` **server** reject | **PARTIAL** — wired, predicate too narrow | `[inspected]` `:2755–2760` vs `overlay-eligible.ts` |
| 5 | overlay `pack.apply`: no trust cookie, no extras, no apply while loop live | **PASS** (stricter than spec’s “composition-only mid-loop”) | `[inspected]` `:2744–2768` |
| 6 | panel busy composer unlocked; Shift+Enter enqueue | **PASS** | `[inspected]` `App.tsx` textarea `disabled` omits `threadBusy`; Shift+Enter `:1161–1164` |
| 7 | overlay `submit.enqueue`; busy no `claimLease` steal | **PASS** at submit helper; **FAIL** at drain (see M1) | `[inspected]` `client.ts` `:154–160`; drain `:540–547` |
| 8 | `mapChatMessageToSummonerCmd` maps `enqueued` / `run_active` | **PASS** | `[inspected]` `client.ts` `:281–318` |
| 9 | `SWIFT_TRAY_SHA256` matches rebuilt binary | **UNVERIFIED** | binary present; no shasum `[assumed]` |

---

## Attack results (must-falsify)

### A. Occupied `chat.create` still supersede?

**Not on the occupied arm.** `[inspected]`

```350:390:companion/src/message-router.ts
      if (rest.enqueue === true && abortControllers.has(rest.thread_id)) {
        // ... enqueueNextRun / empty_enqueue / queue_full / chat.enqueued
      }

      if (abortControllers.has(rest.thread_id)) {
        return { type: "error", error: "run_active", thread_id: rest.thread_id }
      }

      if (rest.enqueue === true) {
        return { type: "error", error: "idle_enqueue", thread_id: rest.thread_id }
      }
      // ...
      const existing = abortControllers.get(rest.thread_id)
      abortControllers.set(rest.thread_id, controller)
      if (existing) {
        logger.info("llm.thread_request_superseded", { thread_id: rest.thread_id })
        existing.abort()
```

The `has()` reject is **before** `existing.abort()`, with **no `await`** in between (lease/conductor/`getConfig` are sync). Dual-WS TOCTOU that used to require “claim before await” is closed for this arm: the first handler sets the controller before yielding; the second hits `run_active`.

The leftover `existing.abort()` after the occupancy check is **dead** for `chat.create` on a single-threaded tick. It is **not** a live supersede hole. Nit: delete it so the next reader does not “fix” occupancy by removing the reject.

`file.upload` (`:808`) and `chat.regenerate` (`:1251–1254`) **still supersede**. Spec r2 §2.1 explicitly keeps those. Residual, not a fold failure.

Panel SW: busy composer sends `steer: true` or `enqueue: true`; enqueue does **not** echo `你:` (`background/index.ts` `:558–560`). Occupied create from a stale client is `run_active`, not abort.

### B. Overlay nextRun drain — **BLOCK (M1)**

Spec §2.1: occupied + `enqueue:true` → `enqueueNextRun`; later drain must `chat.create` the queued turn.

Production enqueue from overlay **can succeed** only when overlay already holds the composer lease (`gateChatCreateOnLease` + busy submit does not steal). That is the happy path of this PR.

Drain:

```537:547:companion/src/message-router.ts
      if (llmLoopGeneration.get(rest.thread_id) === myGeneration) {
        const queued = takeNextRun(rest.thread_id)
        if (queued) {
          return handleMessage(
            { type: "chat.create", thread_id: rest.thread_id, message: queued },
            services,
            session,
          )
        }
      }
```

`handleMessage` **does not read `session.surface`** (lifecycle **does** wire it at `lifecycle.ts` `:1313`). Surface SoT is only `__cmspark_surface` stamped by `stampCmsparkSurface` then **stripped**:

```260:268:companion/src/message-router.ts
export async function handleMessage(...) {
  const { type, ...rest } = msg
  const stampedSurface = stripCmsparkSurface(rest)
  stripCmsparkSurface(msg)
```

The drain object has **no stamp**. `incomingHolderFromSurface(undefined)` is `"panel"` (`composer-lease.ts` `:96–97`). Overlay-held lease → `OVERLAY_STANDBY`. `takeNextRun` already consumed the item. **Queued overlay turn is dropped.**

Consequence matrix `[inspected]`:

| Who holds lease | Overlay enqueue | Drain |
|-----------------|-----------------|-------|
| overlay (overlay started the run) | router accepts | **FAIL** `OVERLAY_STANDBY`, item lost |
| panel (side panel started the run) | `OVERLAY_STANDBY` at enqueue (no steal — spec OK) | N/A |

So overlay Shift+Return nextRun is **dead on the only path that can enqueue**. Panel nextRun still works (undefined surface ≡ panel). Tests never cross overlay lease + drain.

This is not a nit. It is the Autonomy feature this PR ships.

Fix that would close it: stamp the recursive create with `session.surface` / original `stampedSurface` (`__cmspark_surface: session.surface === "summoner" ? "summoner" : "tray"`), **or** skip lease-gate for internal drain. Add a test that claims overlay lease, `__testSetLlmActiveForTests`, enqueue, then simulate drain (or a real short loop) and asserts the successor is **not** `OVERLAY_STANDBY` and `peekNextRunCount === 0` because it ran, not because it was dropped.

### C. Trust / eligible — **BLOCK (M2)**

**allowTrust client lie:** router ignores `rest.allowTrust`. Overlay:

```2771:2777:companion/src/message-router.ts
      const forceTakeover = overlayApply ? false : rest.force_takeover === true
      const r = applyPack(..., {
        workspace_path: overlayApply ? undefined : rest.workspace_path,
        allowTrust: !overlayApply,  // === stampedSurface !== "summoner"
        ...
      })
```

Matches spec (`allowTrust = surface !== "summoner"`). Overlay extras (`workspace_path` / `force_takeover` / `confirmation_phrase`) rejected. Trust cookie → `pack_trust_cookie_present` **before** `applyPack` (so the switch-away restore inside `applyPack` is never reached on overlay). Live loop → `pack_run_active` (stricter than spec’s “skills/prompt only, no whitelist”). Overlay apply goes through `summonerClient` (`surface: "summoner"`), not tray. ACL allows `pack.apply` / `pack.list` / `mcp.list`; denies `mcp.add` / `config.set`. `[inspected]` **PASS** on those arms.

**Predicate hole:** spec §4: eligible iff whitelist empty **or only L0/companion-safe tools**, and lists evaluate / host / shell / … Server reject is `isOverlayEligiblePack`. Regex:

```3:17:companion/src/packs/overlay-eligible.ts
const DENY_ID = /^(appsec|netsec|shell|coding-handoff)([.-]|$)/i
const DANGEROUS_TOOL =
  /^(navigate|evaluate|click|dblclick|type|fill_form|host_|computer|shell_exec|netsec_|acp_|workspace_)/i
...
  const allow = m.tools?.allow || []
  if (allow.some((t) => DANGEROUS_TOOL.test(String(t)))) return false
  return true
```

`HIGH_RISK_NATIVE_TOOLS` in `packs/types.ts` includes **`osascript_eval`**. Catalog has that name. Regex does **not** match it (`evaluate` is a prefix of `evaluate…`, not of `osascript_eval`).

Also **not** matched, still not L0-safe / not “companion-safe only”:

- `spawn_worker` (Autonomy; overlay is not a multi-agent hub)
- `create_tab` / `close_tab` (navigate-class browser write; spec named `navigate` only)
- `board_claim_intent` and friends (spec denies `board_mode: true`, not the tools)

Empty `tools.allow` + `mode: "unchanged"` is eligible and **does not** mean “all tools”: `computeWhitelist("allowlist", [], …)` returns `[]`; `unchanged` keeps current. The design-adversary “empty whitelist pentest pack” is **not** “null = full surface” on allowlist. Default thread `tool_whitelist === null` still means full surface (`thread-manager.ts` `:1068`) — overlay applying an unchanged meeting pack onto a virgin thread does not *add* tools; it also does not *strip* them. Cookie refuse covers Trust-B threads, not “already has evaluate in whitelist without cookie”.

Falsify: user-scene pack `{ trust: omitted, min_capability: L0, tools.allow: ["osascript_eval"] }` → `isOverlayEligiblePack === true` → overlay one-click `pack.apply` writes that whitelist. Overlay still never Allow/Deny; the **next** loop can offer host eval. That is Surface/Trust monotonicity failure for an L0 hub.

Tests only cover meeting / trust block / L1 / navigate / coding-handoff / mcp_servers / board_mode. No router test that `rest.allowTrust: true` on summoner still calls `applyPack({ allowTrust: false })`.

### D. Busy SoT / `chat.done` vs drain

Spec §2.2: `chat.done` **must not** mark UI idle before drain; after drain **claim**, if still occupied, broadcast `run_status: llm`.

Adapter still sends `chat.done` at end of generation (`adapter.ts` `:1096–1102`) **before** router drain. Panel `useWebSocket.ts` `:360–364` `SET_THREAD_BUSY false` on `chat.done`. `run_status` is **only** on `thread.select` (`message-router.ts` `:1807–1819`) — never after drain claim.

With M1 unfixed, overlay drain fails and the thread **is** idle (controller deleted, create rejected) — UI idle is accidentally correct and the queue is gone.

If M1 is fixed, panel will still flash idle between generations; Enter during the flash is `chat.create` → `run_active` (message lost, no abort). Overlay `isRunActive` is a second `thread.select` hop (`companion-client.ts` `:327–334`), so mapping can still send the wrong verb (spec wanted one router beat). **Not supersede.** Named as N1, not a second BLOCK, because occupancy reject holds.

Summoner `thread.select` **does** return `run_status` and omits `pending_tools` (`:1807–1813`). Spec §2.2 overlay mapping: **PASS**.

### E. Panel composer / overlay submit UX

**Panel** `[inspected]`:

- textarea `disabled` is connection / voice overlay / `overlayStandby` — **not** `threadBusy` (`App.tsx` `:1788–1793`). Attach stays disabled while busy (`:1773`).
- `canSend` does **not** include `!threadBusy` (`:880–886`) so 纠偏 / 排队 are live.
- Busy Enter → `handleSend()` → `steer: true`. Busy Shift+Enter → `{ enqueue: true }` (`:1161–1164`, `:1184–1192`). Idle Shift+Enter is not intercepted → newline.
- Hint: `composerBusyPlaceholder("thread_busy")` = `回车纠偏 · Shift+Enter 排队`.

**Overlay** `[inspected]`:

- Swift Return sets `enqueue` from **shift only** (`SummonerOverlay.swift` `:525–526`). Node maps idle → `chat.create` (even if shift), busy+shift → enqueue, busy → steer. Idle Shift+Return therefore does **not** hit `idle_enqueue` (creates instead). Acceptable vs “闲时没有排队按钮”.
- Busy path: **no** `claimLease` (`submitSummonerTalk` `:154–160`). Tests assert that.
- Enqueue: Swift **does not** prepend `你:` (`:572–576`). Spec OK.
- Steer: Swift **does** prepend `你:` not `纠偏:`. Spec preferred `纠偏:`. Nit.
- `summoner.continue` busy = no-op (`menu-bar-agent.ts` `:774–777`). Spec OK.
- Window `640` / rail `200` (`SummonerOverlay.swift` `:939–1015`). Spec OK.
- Pack buttons: `isEnabled = eligible`; tooltip 去侧栏 / 套到当前对话. Ineligible gray; `railPackClicked` still emits apply if enabled (disabled buttons should not fire). Server remains SoT.

### F. Mapper

`chat.enqueued` → `summoner.error` `enqueued` with depth. `type: "error"` with `run_active` / `idle_enqueue` / `queue_full` / `steer_queue_full` / pack codes → labeled `summoner.error`. `OVERLAY_STANDBY` via `chat.error` data.code also maps. `[inspected]` **PASS** for the named codes.

---

## Must-fix before MERGE (do not waive)

| ID | Fix |
|----|-----|
| **M1** | Overlay nextRun drain must run as the **same surface** that owns the lease. Stamp recursive `chat.create` with handshake surface (`session.surface` / leftover `stampedSurface`). Do **not** `takeNextRun` until the successor is allowed to claim. Test: overlay lease + busy enqueue + drain → successor loop, **not** `OVERLAY_STANDBY`, queue empty because it **ran**. |
| **M2** | `isOverlayEligiblePack` must deny the project’s own high-risk catalog, not a regex that forgets `osascript_eval`. Minimum: every `HIGH_RISK_NATIVE_TOOLS` name + `spawn_worker`. Prefer: allowlist of L0/companion-safe names, fail closed. Tests: meeting-minutes true; `osascript_eval` / `spawn_worker` / `appsec*` false. |
| **M3** | Router tests on `stampedSurface === "summoner"`: `rest.allowTrust: true` still `applyPack({allowTrust:false})`; cookie → `pack_trust_cookie_present`; extras → `pack_overlay_forbidden_fields`; live controller → `pack_run_active`; ineligible → `pack_not_overlay_eligible`. Occupied `chat.create` test must assert the **same** AbortController is still registered after `run_active`. |

---

## Residual (named, after must-fix)

- **N1** Spec §2.2 unmet: `chat.done` still idles the panel; no `run_status: llm` after drain claim. Harmless for supersede (occupancy reject); harmful for “flash idle → lost Enter” once M1 works.
- **N2** Client `isRunActive` then send (two hops). Occupancy is SoT for abort; mapping can still `idle_enqueue` / `no_active_run` a turn. Spec wanted one router beat.
- **N3** Swift steer optimistic `你:` not `纠偏:`.
- **N4** Dead `existing.abort()` on `chat.create` after occupancy reject. `file.upload` / `chat.regenerate` still supersede (spec-allowed).
- **N5** Eligible regex still allows `create_tab` / cookie tools / `board_*` if someone allowlists them without `board_mode`. Fold into M2 if taking fail-closed allowlist.
- **N6** Missing pack on overlay apply returns `pack_not_overlay_eligible` rather than not-found.
- **N7** `build-tray.sh` still tells you to paste the hash into `menu-bar-agent.ts`; constant lives in `swift-tray-bridge.ts`.
- **N8** `SWIFT_TRAY_SHA256` not hashed in this review. Run `shasum -a 256 companion/dist/cmspark-tray` before merge; mismatch auto-rebuilds at launcher start, but CI lockstep should be `[executed]`.

---

## DoD scorecard (prompt focus)

| # | Requirement | Result |
|---|-------------|--------|
| 1 | occupied create → `run_active`, no abort | **PASS** `[inspected]` |
| 2 | idle enqueue → `idle_enqueue` | **PASS** `[inspected]` |
| 3 | `allowTrust = surface !== summoner`, never `rest.allowTrust` | **PASS** `[inspected]` |
| 4 | eligible **server** reject | **FAIL** predicate (M2); wire is present |
| 5 | overlay apply: cookie / extras / live loop | **PASS** `[inspected]` |
| 6 | panel busy textarea + Shift+Enter enqueue | **PASS** `[inspected]` |
| 7 | overlay enqueue + no lease steal | submit **PASS**; drain **FAIL** (M1) |
| 8 | mapper `enqueued` / `run_active` | **PASS** `[inspected]` |
| 9 | tray SHA256 lockstep | **UNVERIFIED** |

---

## Why not APPROVE_WITH_NITS

M1 is the overlay nextRun path this PR exists to ship. Occupancy reject without a working drain means busy overlay 排队 is either `OVERLAY_STANDBY` or a silent drop. M2 is the Trust/Surface residual the design adversary already rejected once (eligible must be server SoT, not a gray button plus a leaky regex). Nits-only would require both holes to be hypothetical. They are in the production call sites.

---

VERDICT: REJECT
