# Lane C Adversarial Review — post-#219 kimi nits (overlay lease / summoner)

| Field | Value |
| --- | --- |
| Lane | C (independent adversary — did not implement) |
| Date | 2026-08-25 |
| Scope | Composer exclusive SoT / overlay session stale unwind / dual-summoner disconnect / rect routing / stream thread filter / submit_failed |
| Blast | T2 Trust-adjacent (Channel/Surface lease — ADR-020: overlay never Allow/Deny) |
| Frozen patch | `docs/audit/reviews/post219-kimi-nits-wip-20260825.patch` |
| Patch SHA256 | `AD4794DCEFA42671E95C1FFA95466110C790FA9C15E92795743E3A48678F0AE4` **[executed] MATCH** |
| Claimed HEAD | `daf8bc9` (PR #219) |
| Actual HEAD | `c5b4242` (`docs(memory): S78 session-end — #219 overlay + C-thin on main`) **[executed]** |
| WIP | Uncommitted mods on exclusive range (half-fold) |
| Default posture | REFUTED until production call sites + races hold |

No source/test files edited. This is the sole review artifact.

---

## Capability table (ADR-020)

| Axis | This fold | Judgment |
| --- | --- | --- |
| Surface | `surface=summoner` → holder `overlay`; tray → `panel` | Unchanged algebra **[inspected]** |
| Channel | Exclusive overlay lease SoT (`ComposerLeaseRegistry`) | WIP changes *who releases / when / CAS* |
| Trust | Must not invent Allow/Deny on overlay | OK — no Trust write **[inspected]** |
| Risk | Wrong Channel holder ⇒ `OVERLAY_STANDBY` / silent composer steal | **High** reclaim race below |

---

## Machine results **[executed]**

```text
cd companion
npx tsx --test ./tests/overlay-session.test.ts ./tests/composer-lease.test.ts \
  ./tests/summoner-client.test.ts ./tests/summoner-overlay.test.ts \
  ./tests/companion-ui-rects.test.ts
→ 121 tests, 119 pass, 2 fail, duration ~551ms
```

| Fail | Root |
| --- | --- |
| `message-router chat.create uses composer lease gate` | `path.resolve(__dirname,"..","..","src/message-router.ts")` → `cmspark/src/...` ENOENT (should be `../src`) |
| `lifecycle stamps __cmspark_surface from auth after ACL` | same `../../src/ws/lifecycle.ts` ENOENT |

These two are **pre-existing grep path bugs** (present at HEAD; WIP did not fix them). WIP’s newer `#219 lifecycle close handler…` test correctly uses dual candidates — inconsistency proves grep-theater fragility.

Exclusive-range WIP semantics tests that matter for claims **did pass** (overlay-session stale unwind, `releaseOverlayLeaseAtRev`, dual-summoner helper, `summonerCmdMatchesThread`, `forwardCompanionUiRect`, submit_failed source grep).

---

## Claims vs production call sites

| # | Claimed fold | Call site | Verdict |
| --- | --- | --- | --- |
| 1 | Stale hydrate/claim no longer `releaseAll` when another session live; CAS-release own rev + `onStaleClaim` repair | `overlay-session.ts` `unwindStaleClaim` → `menu-bar-agent.ts` `releaseOverlayLeaseAtRev` + `reclaimLiveSummonerThread` | **PARTIAL — self-CAS OK; reclaim UNSAFE** |
| 2 | Summoner socket death keeps overlay leases if another auth summoner survives | `lifecycle.ts` close → `survivingSummoners` → `overlayLeasesOnSummonerDisconnect` | **HOLDS** |
| 3 | `companion.ui.rect`: overlay→summoner (fallback companion); pairing/tray/hud→companion only | `forwardCompanionUiRect` + `menu-bar-agent` `onCompanionUiRect` | **HOLDS** (fallback note) |
| 4 | Cross-thread stream frames must not overwrite overlay transcript | `summonerCmdMatchesThread` after `mapChatMessageToSummonerCmd` | **PARTIAL** |
| 5 | Submit never left tray → `summoner.error` `submit_failed` | `handleSummonerInbound` `.then((ok)=>…)` | **HOLDS** (scope-limited) |
| 6 | Tests are real races, not grep theater | suite mix | **REFUTED** |

---

## Must-falsify attacks

### 1. CAS stale rev vs newer claim — steal? → **NO STEAL** **[inspected]+[executed]**

`ComposerLeaseRegistry.release` requires `args.rev === current.rev`; mismatch → `LEASE_REV_MISMATCH`.

`releaseOverlayLeaseAtRev` (`composer-lease.ts:310-327`) single-shots that rev; on mismatch returns `{ ok:false, error_code: LEASE_REV_MISMATCH }` and **does not retry / does not force**.

Test `releaseOverlayLeaseAtRev returns the just-claimed thread to panel; stale rev is a safe no-op` **[executed] pass**.

**Claim 1 self-unwind: CONFIRMED.**

### 2. `onStaleClaim` / `reclaimLiveSummonerThread` steals when live ≠ demoted sibling? → **YES — HIGH** **[inspected]**

```674:685:companion/src/menu-bar-agent.ts
async function reclaimLiveSummonerThread(
  client: CompanionClient,
  siblings: OverlayLeaseState[],
): Promise<void> {
  const liveId = summonerThreadId
  if (!liveId || !siblings.some((s) => s.thread_id === liveId)) return
  try {
    await claimOverlayLeaseCas(liveId, summonerLeaseRpc(client))
  } catch {
    /* best-effort repair — the next user action re-claims anyway */
  }
}
```

Facts:

- `beginOverlaySession()` / `invalidateOverlaySession()` **do not clear** `summonerThreadId` (only set on successful hydrate/submit/new-thread; cleared on `handleSummonerClosed`).
- `reclaimLiveSummonerThread` ignores overlay session token / generation.
- `claimOverlayLeaseCas(liveId)` is an **exclusive overlay claim** → `releaseAllOverlay(except liveId)` demotes whatever the *newer* live session already holds.

**Interleaving (production):**

1. Session₁ live, `summonerThreadId = A`, overlay lease on `A`.
2. Session₂ `beginOverlaySession()` (Session₁ token stale); starts hydrate/claim of `C`.
3. Session₁ in-flight claim of `B` completes → demotes `A` → `unwindStaleClaim` → `onStaleClaim([{thread_id:A,…}])`.
4. Reclaim reads lagged `summonerThreadId === A` → `claimOverlayLeaseCas(A)`.
5. If Session₂ already claimed `C`, step 4 **demotes `C`** → live overlay loses Channel; Side Panel on `A` hits `OVERLAY_STANDBY`.

Gate: reclaim only runs when `liveId ∈ siblings`. That prevents reclaiming an *unrelated* demoted id when `summonerThreadId` already advanced to `C`. The bug is specifically the **lag window** between `beginOverlaySession()` and `summonerThreadId = <new>`.

Helper tests in `overlay-session.test.ts` only assert siblings are *reported* — they never simulate `reclaimLiveSummonerThread` against a drifted `summonerThreadId`. Grep test in `summoner-overlay.test.ts` only checks identifiers exist.

**Claim 1 repair path: REFUTED at menu-bar call site. Severity: High (Trust-adjacent Channel corruption).**

### 3. `survivingSummoners` off-by-one? → **CORRECT** **[inspected]**

```1344:1371:companion/src/ws/lifecycle.ts
ws.on("close", () => {
  clearInterval(pingInterval)
  clients.delete(ws)
  const closedAuth = wsAuth.get(ws)
  if (closedAuth) {
    clearTimeout(closedAuth.timer)
    wsAuth.delete(ws)
  }
  let survivingSummoners = 0
  if (closedAuth?.surface === "summoner") {
    for (const client of clients) {
      const auth = wsAuth.get(client)
      if (auth?.authenticated === true && auth.surface === "summoner") {
        survivingSummoners += 1
      }
    }
  }
  broadcastOverlayLeasesOnSocketClose(..., survivingSummoners)
```

Delete-before-count is intentional and right:

- Last summoner closes → remaining auth summoners = 0 → `releaseAllOverlay`.
- Counting *before* delete would leave last socket seeing itself → **never** release (the off-by-one the prompt feared).

Unauthenticated close: `surface` unset → skip count / no release. **Claim 2: HOLDS.**

### 4. Overlay rect fallback to companion socket — daemon-drop / ACL leak? → **NO DROP; intentional tray accept** **[inspected]**

`forwardCompanionUiRect`: overlay tries summoner then companion; non-overlay **only** companion.

Daemon (`message-router.ts:1238-1242`): summoner stamped surface → `allowSurfaces={"overlay"}`; tray → `allowSurfaces=undefined` (all surfaces).

Fallback therefore **succeeds** on tray when summoner is down — does **not** reintroduce silent drop. Overlay rects on tray ACL are by design for S23 click-guard continuity, not a pairing/hud leak (those never touch summoner). **Claim 3: HOLDS.**

### 5. `summonerCmdMatchesThread` missing `thread_id` drops all tokens? → **OPPOSITE** **[inspected]+[executed]**

```275:279:companion/src/summoner/client.ts
export function summonerCmdMatchesThread(
  cmd: { thread_id?: string },
  currentThreadId: string | null,
): boolean {
  return typeof cmd.thread_id !== "string" || cmd.thread_id === currentThreadId
}
```

Untagged cmds **pass**. Adapter `chat.token` / `chat.done` include `thread_id` **[inspected]** `llm/adapter.ts`. Residual gap: `tool.start`, `chat.enqueued`, mapped `error` / `chat.error` remain **untagged** → still forwardable across threads (UI flicker / wrong tool chip). **Claim 4: PARTIAL (token/done OK; other cmds Nit/High residual).**

False-negative “drops all tokens” **REFUTED** — concern was inverted.

### 6. `submit_failed` vs router-later failure → **SCOPE OK** **[inspected]**

`handleSummonerSubmit` returns `submitSummonerTalk`’s `ok`:

- early false: no client / empty / create fail / `claimLease === false` / steer|enqueue send false
- after claim: `ok = deps.sendChatCreate(...)` (fire-and-forget boolean)

WS accept + later router `chat.error` does **not** emit `submit_failed` (correct — message left tray; Swift already has `你:` and will get stream/error cmds). **Claim 5: HOLDS.**

Wiring covered only by source grep (`summoner-overlay.test.ts:339-349`) — no behavioral mock of inbound→error.

### 7. Grep theater? → **YES for several WIP tests** **[executed]+[inspected]**

| Test | Kind |
| --- | --- |
| `overlay-session` stale unwind + rev CAS | **Real race** (in-process async session flip) |
| `releaseOverlayLeaseAtRev` / dual-summoner helpers | **Real registry race** |
| `summonerCmdMatchesThread` / `forwardCompanionUiRect` unit | **Real helper** |
| `summoner-overlay` submit_failed / stream filter / stale reclaim | **Grep theater** — `assert.match` identifiers; reclaim test passes if *either/any* symbol appears anywhere in file |
| `#219 lifecycle close handler counts surviving…` | Grep of close slice (better than nothing; still not a WS integration race) |
| `composer-lease` message-router / lifecycle path tests | Grep + **broken paths** → suite red |

**Claim 6: REFUTED.**

---

## Findings (severity)

### BLOCK / High

1. **High — `reclaimLiveSummonerThread` can steal newer live overlay (and block panel on lagged thread)**  
   - Files: `companion/src/menu-bar-agent.ts:674-685` (callers `:707`, `:855`, `:1118`)  
   - Mechanism: lagged `summonerThreadId` + exclusive `claimOverlayLeaseCas` demotes the session that actually went live.  
   - Fix directions (any one sufficient): clear `summonerThreadId` on `beginOverlaySession`/`invalidate`; gate reclaim with `overlaySessionIsLive(token)` of the *newer* session and/or compare intended live thread captured at claim time; or stop auto-reclaim and only repair when `currentOverlaySession` thread matches sibling **and** generation is live.  
   - Missing test: menu-bar-level (or extracted pure) race where Session₂ claims `C` then stale reclaim of `A` must **not** demote `C`.

### Nit / Medium

2. **Nit — Untagged `tool.start` / error / enqueued still pass thread filter**  
   - `companion/src/summoner/client.ts:299-365` + filter `:275-279`  
   - Propagate `thread_id` on those cmds or drop untagged when `summonerThreadId != null`.

3. **Nit — Grep theater for production wiring of claims 1/4/5**  
   - `companion/tests/summoner-overlay.test.ts:339-367`  
   - Replace with behavioral tests (mock tray sendSummoner / lease RPC).

4. **Nit — Exclusive-range suite not green (pre-existing)**  
   - `companion/tests/composer-lease.test.ts:194-212` wrong `../../src` paths  
   - WIP already knows the dual-candidate pattern (`:544-555`) — fold should fix siblings or suite stays red.

5. **Nit — HEAD mismatch vs prompt**  
   - Prompt `daf8bc9` vs actual `c5b4242` — review against live WIP + frozen patch hash (matched).

---

## What actually improved (credit where due)

- Stale-session `releaseAllLeases()` while another overlay is live was a real footgun; CAS self-release at claim rev is the right primitive **[inspected]+[executed]**.
- Dual-summoner disconnect gating is correctly ordered and tested at the registry helper **[executed]**.
- Rect surface routing closes the documented daemon `allowSurfaces=["overlay"]` drop for pairing/hud/tray **[inspected]+[executed]**.
- Token/done thread tags + forwarder filter fix the main transcript overwrite path **[inspected]+[executed]**.
- `submit_failed` closes the silent-drop UX hole when submit never leaves tray **[inspected]**.

---

## Verdict rationale

Default REFUTED. Three of six claims hold cleanly (2, 3, 5). Claim 1’s *self-CAS* holds but its *repair* call site introduces a High Channel steal under a realistic session-flip race the must-falsify list called out — and the test that “proves” repair is grep theater. Claim 4/6 incomplete. Exclusive test command not green.

WIP is explicitly half-fold; shipping the reclaim path as-is is worse than leaving demoted siblings unrepaired until the next user action (comment already admits best-effort), because reclaim can **actively demote the live holder**.

---

VERDICT: REJECT
