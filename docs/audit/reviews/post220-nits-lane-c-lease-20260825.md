# Lane C — post-#220 residual nits independent adversary (overlay lease / summoner bind)

| Field | Value |
| --- | --- |
| Lane | C (independent adversary — overlay lease / summoner bind). Did **not** implement the nits fold. |
| Date | 2026-08-25 |
| Range | `1d16b0e..9deff00` |
| HEAD | `9deff00da9ee3e1d9d3014b5da1d509ce91116b6` **[executed]** `git rev-parse HEAD` |
| Frozen patch | `docs/audit/reviews/post220-nits-diff-20260825-092457.patch` |
| Frozen SHA256 | `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51` |
| Exclusive files | `companion/src/menu-bar-agent.ts` (bind/reclaim/submit/`setSummonerThreadId`); `companion/tests/summoner-overlay.test.ts` |
| Read-only contract | `companion/src/summoner/overlay-session.ts` (`claimOverlayIfLive`) — **unchanged in this fold** |
| Prior (context only, not proof) | `post220-merged-lane-c-lease-20260825.md` APPROVE_WITH_NITS (S-C1/S-C2 were the C residuals) |
| Default | REFUTED until `file:line` + `[executed]` / `[inspected]` |
| Production edits this lane | **none**. Private `/tmp/lane-c-nits-mut-*` only; deleted after. |

Capability (implementer claim — challenged below):

```text
Surface:      L0
L2-classes:   none
Compose:      none
Autonomy:     steer / nextRun queue plumbing
Trust:        persistence redaction tighter (passwd, non-string secret keys)
Channel:      overlay bind/reclaim live-gate
```

Blast: **T2**. Escalate to T3 only if overlay becomes Allow/Deny, confirm skip, or claimed secrets still persist. **No T3 trigger found.**

---

## Frozen patch vs live HEAD **[executed]**

`git diff 1d16b0e..9deff00 -- companion | shasum -a 256` =
`2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51`.

`cmp` vs frozen patch file: **identical** (exit 0). 14 files, +477/−56.

Note: hashing **only** the four exclusive paths (`menu-bar-agent.ts` / `overlay-session.ts` / two tests) yields `288c2f538a2a7b9f97d00e76821e245705c3278992625dfaf6ad3c65607a6b10` — that is **not** the frozen pin. Frozen SHA is the full `companion/` nits diff. `overlay-session.ts` is **absent** from the 14-file list (contract already on `1d16b0e`).

Lane C exclusive production delta is only `menu-bar-agent.ts` (+ reclaim wrap + submit-ok live-gate + delete `setSummonerThreadId`) and the two grep pins in `summoner-overlay.test.ts`.

---

## Machine results **[executed]**

Cwd: `companion/`. Isolated worktree has **no** `companion/node_modules`.

**Mandatory command (bare, no NODE_PATH):**

```text
npx tsx --test tests/summoner-overlay.test.ts tests/overlay-session.test.ts tests/summoner-client.test.ts
→ tests 82 / pass 82 / fail 0 / duration_ms 104.994084
```

No env failure this run (unlike merged-round `js-yaml` on `composer-lease` → `message-router`; that file is **not** in this command).

**Same command with `NODE_PATH=/Users/huchen/Projects/cmspark/companion/node_modules` (no worktree mutation):**

```text
→ tests 82 / pass 82 / fail 0 / duration_ms 77.590333
```

Per-file (NODE_PATH): `summoner-overlay` **37/37**, `overlay-session` **13/13**, `summoner-client` **32/32**. Load-bearing pins in this round **passed**: lagged-id `shouldReclaimLiveOverlayThread`, `claimOverlayIfLive` stale-with-live + close-during-claim, Swift zero Allow/Deny, S-C1/C2 grep tests.

### Mutation-kill (private `/tmp`, worktree untouched)

**MUT1 — S-C2 helper pin.** Copied `overlay-session.ts` + its tests. Deleted only the post-await generation check + unwind in `claimOverlayIfLive` (kept the pre-await `overlaySessionIsLive` gate; `return true` after `claimOk`). Replayed overlay-session tests:

```text
✖ claimOverlayIfLive stale-with-live self-releases and reports; closed path still releaseAll
  AssertionError: true !== false   (ok stayed true; must be false)
✖ claimOverlayIfLive close-during-claim releases
  AssertionError: true !== false
MUT_EXIT=1  (11 pass / 2 fail / 13)
```

The claimed `claimOverlayIfLive` contract is load-bearing: if generation dies during the await, without the post-await check the helper **keeps** the exclusive claim. **[executed]**

**MUT2 — S-C1/C2 menu-bar grep pins.** Private copy of `menu-bar-agent.ts` reverted the three folds (trailing bind back to `result.ok && result.threadId`, reclaim back to raw `claimOverlayLeaseCas`, restore `export function setSummonerThreadId`). Replayed the two nits tests against that copy:

```text
✖ menu-bar-agent stale overlay claims self-release and repair the live thread
✖ menu-bar-agent submit-ok bind is live-gated and setSummonerThreadId is gone (S-C1/C2)
MUT_EXIT=1  (0 pass / 2 fail)
```

The new grep strings are load-bearing for the claimed source shape. They are still **grep**, not a reclaim-during-await integration (see nit). **[executed]**

**MUT3 — C-High still pinned (not a new fold, regression check).** Deleted only `if (!overlaySessionIsLive(args.liveSessionToken)) return false` from `shouldReclaimLiveOverlayThread`. Lagged-id test:

```text
✖ shouldReclaimLiveOverlayThread no-ops after beginOverlaySession (lagged thread id)
  AssertionError: new overlay session must not exclusive-claim lagged A (would demote C)
MUT_EXIT=1  (12 pass / 1 fail / 13)
```

C-High gate on the **bound** token remains mutation-killed. **[executed]**

---

## Must-falsify

### 1. S-C1 — `export function setSummonerThreadId` is gone; `*.ts` has no callers

**Absence is the pin; no mutation of a caller required.**

**[executed]** repo grep `setSummonerThreadId` in `*.ts`: **exactly two hits**, both the test:

```
companion/tests/summoner-overlay.test.ts:372  test("… setSummonerThreadId is gone (S-C1/C2)")
companion/tests/summoner-overlay.test.ts:374  assert.doesNotMatch(src, /export function setSummonerThreadId/)
```

No definition in `companion/src/**`. `menu-bar-agent.ts` exports (`getTrayInstance`, `handleSummonerAttach`, `handleSummonerContinue`, `armSummonerHotkeyOnTrayStart`, `syncSummonerHotkeyToTray`, `persistSummonerHotkeyChosen`, `handleSummonerMic`, `handleSummonerInbound`) — **no** `setSummonerThreadId`.

Diff `1d16b0e..9deff00` deletes:

```ts
export function setSummonerThreadId(id: string | null): void {
  if (id) bindSummonerThread(id)
  else clearSummonerThread()
}
```

That was the latent steal (bind lagged id with `currentOverlaySession()` after `beginOverlaySession`). **S-C1: REFUTED (code holds — the export is gone, zero callers).**

Production `summonerThreadId =` writes **[executed]** grep under `companion/src`: still exactly two, both inside `bindSummonerThread` (`menu-bar-agent.ts:167`) and `clearSummonerThread` (`:172`). Callers that bind **[inspected]**:

| Site | Line | Token |
| --- | --- | --- |
| hydrate claimed | `:735` | `bindSummonerThread(id, token)` |
| submit hydrate callback | `:888-889` | gated `if (!overlaySessionIsLive(token)) return` then bind |
| submit `result.ok` | `:914-915` | gated `overlaySessionIsLive(token)` then bind |
| new-thread claimed | `:1141-1142` | only if `claimOverlayIfLive` returned true |

Close (`:827-829`): `invalidateOverlaySession()` then `clearSummonerThread()`.

**S-C1 HOLD.**

### 2. S-C2 bind — `handleSummonerSubmit` trailing bind requires `overlaySessionIsLive(token)`

Live body **[inspected]** `menu-bar-agent.ts:914-917`:

```ts
if (result.ok && result.threadId && overlaySessionIsLive(token)) {
  bindSummonerThread(result.threadId, token)
  touchSummonerActivity(result.threadId)
}
```

`token` is captured at submit start as `currentOverlaySession()` (`:866`), **not** re-read after the await. Hydrate callback already refused bind when dead (`:887-889`). Trailing bind now matches.

Busy-steer path (`summoner/client.ts:154-160`, exclusive-read) can still return `{ok, threadId}` without `claimLease`. Trailing bind no longer writes on a dead token. Same-session busy bind without exclusive claim is not C-High steal.

Attack that previously landed: Session1 submit in-flight with T1; Session2 `beginOverlaySession`+`bind(C,T2)` before trailing bind; Session1 overwrote `{A,T1}`. With the live-gate, T1 is dead → no overwrite. Stream-filter stays on C.

Grep pin **[executed]** `summoner-overlay.test.ts:372-376` matches the exact conjunct `result.ok && result.threadId && overlaySessionIsLive(token)`. MUT2 reverting that conjunct goes red.

**S-C2 bind: REFUTED (code holds).**

### 3. S-C2 reclaim — `reclaimLiveSummonerThread` uses `claimOverlayIfLive`, not raw `claimOverlayLeaseCas`

Live reclaim body **[inspected]** `menu-bar-agent.ts:687-710`:

```ts
async function reclaimLiveSummonerThread(
  client: CompanionClient,
  siblings: OverlayLeaseState[],
): Promise<void> {
  const liveId = summonerThreadId
  const token = summonerThreadSessionToken
  if (!shouldReclaimLiveOverlayThread({
    liveThreadId: liveId,
    liveSessionToken: token,
    siblings,
  })) return
  if (!liveId || token == null) return
  try {
    await claimOverlayIfLive({
      token,
      claim: () => claimOverlayLeaseDetailed(client, liveId),
      releaseClaim: (rev) =>
        releaseOverlayLeaseAtRev(liveId, rev, summonerLeaseRpc(client)).then(() => {}),
      releaseAll: () => client.releaseAllOverlayComposerLeases(),
    })
  } catch {
    /* best-effort repair — the next user action re-claims anyway */
  }
}
```

`claimOverlayLeaseCas` is **not** called from this function. It remains inside `claimOverlayLeaseDetailed` (`:669-680`) which is the `claim` callback. Token passed into `claimOverlayIfLive` is the **bound** `summonerThreadSessionToken` snapshotted before the await — not `currentOverlaySession()` after.

Contract **[inspected]** `overlay-session.ts:122-143` (unchanged this fold):

1. Pre-await: `if (!overlaySessionIsLive(args.token)) return false` (`:129`).
2. `claimed = await args.claim()` (`:130`).
3. Post-await: if token still live → keep (`:132`); if a **newer** session is live → `unwindStaleClaim` (CAS-release **only** this rev, never `releaseAll`) (`:133-139`); if overlay closed → `releaseAll` (`:141-142`).

Existing tests **[executed]**:

- `overlay-session.test.ts:218-248` — begin during claim → `ok===false`, self-release rev 5, `releaseAll===0`, siblings reported.
- `overlay-session.test.ts:280-302` — close during claim → `releaseAll`.
- `overlay-session.test.ts:250-265` — lagged `{A,T1}` reclaim helper is true before second `begin`, false after.

MUT1 (strip post-await) kills the two `claimOverlayIfLive` tests. MUT3 (strip `shouldReclaim` live-token) kills lagged-id. Menu-bar grep **[executed]** `summoner-overlay.test.ts:367-369` requires `claimOverlayIfLive` in the reclaim slice and `doesNotMatch` `claimOverlayLeaseCas(`.

**If generation dies during the reclaim await:** `claimOverlayIfLive` unwinds the exclusive claim of lagged A. That is the C-High steal the prior nit named (raw CAS would **keep** A). **S-C2 reclaim: REFUTED (code holds).**

Residual (not steal): reclaim does **not** pass `onStaleClaim`. If Session2 already held C and this in-flight A-claim demoted C, unwind releases A but does not repair C. Next user action re-claims (comment at `:708`). Repair-miss, not exclusive-claim of lagged A.

### 4. Overlay still not Allow/Deny. No new confirm skip.

**[inspected + executed]**

- Exclusive production diff (`menu-bar-agent.ts`; `overlay-session.ts` unchanged) adds **no** `securityConfirmations.request`, `auto_approve`, `forceConfirm`, `originWs`, or confirm-skip branch. `rg` on that diff: **no hits**.
- `menu-bar-agent.ts` has **zero** `securityConfirmations` / `auto_approve` / `forceConfirm`. The only `Allow/Deny` string is HUD spike comment `:1646` (`showHudConfirm` for evaluate) — **not overlay**, not in this fold.
- Swift chrome pin `summoner-overlay.test.ts:54-58` **pass** — `doesNotMatch` `/允许|拒绝|Allow|Deny|确认/` and `showConfirm|allowClicked|denyClicked`.
- `mapChatMessageToSummonerCmd ignores unrelated / confirm frames` **pass** (`summoner-client.test.ts`).
- Live `client.ts:331-333` still routes `pack_not_overlay_eligible` / `pack_trust_cookie_present` to Side Panel copy; `:358-364` MCP pending → `MCP_CONFIRM_PENDING`, not overlay Allow/Deny. Not in this fold; not regressing.

**No new confirm skip. Overlay is not a Trust surface.** Do not escalate to T3.

---

## ADR-020 dual-review checklist

| Check | Result |
| --- | --- |
| 1. Axes fit | **Channel / L0 hub.** Bind/reclaim live-gate is Channel (session generation + composer lease). Not a middle-agent runtime. Declaration's `Channel: overlay bind/reclaim live-gate` is a dialect vs the template enum `community \| enterprise \| n/a` — same pattern as the merged round; **nit on the form, not a missing-declaration BLOCK**. Axes fit. |
| 2. Pack-first | No new primary Side Panel chrome. Pack apply still error-routes ineligible/Trust cookies to Side Panel. |
| 3. Confirm dialects | None added. |
| 4. Trust monotonicity | Deeper Trust (pack cookie, MCP confirm) does **not** inherit overlay L0 “just send”. **Holds.** |
| 5. originWs | No new `securityConfirmations.request`. N/A; no regression. |
| 6. No new runtime | Reuses `claimOverlayIfLive`. Not a second agent framework. |
| 7. Experimental | Overlay title lock 召唤器（实验） still pinned (`summoner-overlay.test.ts:48-51` pass). |
| P1-1..4 | No `auto_approve_*` / evaluate / shell / originWs confirm in exclusive diff. |

---

## Independent attacks (do not rubber-stamp the implementer session)

### A. Menu-bar S-C1/C2 tests are still grep theater **[executed]**

`summoner-overlay.test.ts:361-376` `readFileSync` + `assert.match` / `doesNotMatch`. MUT2 proves the strings are load-bearing. They do **not** drive `reclaimLiveSummonerThread` through a real `beginOverlaySession` during the RPC. Behavioral pin lives in `overlay-session.test.ts` on the helper, plus production read of `:700-706`. **Nit**, not BLOCK — same class as merged-round finding C; fold tightened the grep (function slice + `doesNotMatch claimOverlayLeaseCas(` + exact bind conjunct) but did not add an integration test.

### B. `bindSummonerThread` still defaults token to `currentOverlaySession()` **[inspected]**

`menu-bar-agent.ts:166-169`: `summonerThreadSessionToken = token ?? currentOverlaySession()`. `setSummonerThreadId` was the only production-shaped caller that omitted the token. It is gone. A future `bindSummonerThread(laggedId)` after `beginOverlaySession` would recreate the latent steal. Footgun remains; known caller does not. **Nit.**

### C. Reclaim omits `onStaleClaim` **[inspected]**

`claimOverlayIfLive` at `:700-706` has no `onStaleClaim`. Generation-die-during-await **unwinds A** (C-High closed) but will not compensate a demoted live sibling C. Comment admits best-effort. **Nit**, not steal.

### D. Grep over-constraint **[inspected]**

`doesNotMatch(reclaim, /claimOverlayLeaseCas\(/)` would fail a correct wrap `claimOverlayIfLive({ claim: () => claimOverlayLeaseCas(...) })` even though the generation check would be present. Current code uses `claimOverlayLeaseDetailed` so the test is green. Test tightness, not product bug. **Nit.**

---

## Findings

| Sev | Item | Evidence |
| --- | --- | --- |
| ~~S-C1~~ | `setSummonerThreadId` latent steal | **REFUTED.** Export gone; `*.ts` grep has no callers. Test `summoner-overlay.test.ts:374`. MUT2 restore → red. **[executed]** |
| ~~S-C2 bind~~ | submit-ok bind ungated | **REFUTED.** `menu-bar-agent.ts:914` requires `overlaySessionIsLive(token)`. MUT2 revert → red. **[executed]** |
| ~~S-C2 reclaim~~ | raw `claimOverlayLeaseCas` / no post-await generation check | **REFUTED.** Reclaim `:700-706` uses `claimOverlayIfLive` with bound token. Helper post-await + unwind `overlay-session.ts:132-139`. MUT1 + MUT3 red. **[executed]** |
| ~~C-High~~ | lagged-id reclaim steal after `beginOverlaySession` | **Still REFUTED.** `shouldReclaimLiveOverlayThread` `:54` + bound token snapshot. MUT3. **[executed]** |
| ~~Allow/Deny~~ | overlay as Trust / confirm skip | **REFUTED.** Exclusive diff has no confirm skip; Swift zero Allow/Deny chrome **pass**. |
| Nit | menu-bar S-C1/C2 pins are grep-only | `summoner-overlay.test.ts:361-376`; helper behaviorally pinned |
| Nit | `bindSummonerThread` optional token defaults to current generation | `menu-bar-agent.ts:166-169`; no remaining caller omits token |
| Nit | reclaim `claimOverlayIfLive` omits `onStaleClaim` (repair-miss, not steal) | `menu-bar-agent.ts:700-706` vs hydrate/submit which pass it |

No BLOCK. No new confirm skip. Do not escalate T3.

---

## Scores

| Axis | Score | Note |
| --- | --- | --- |
| Outcome | HOLD | S-C1 absence + S-C2 live-gated bind + reclaim-through-`claimOverlayIfLive` all observed at `file:line` and mutation-killed |
| Trajectory | HOLD | Diff scope is the three C residuals from merged AWN; no drive-by Trust/L2; `overlay-session.ts` not rewritten |
| Component | HOLD | Hotspots `menu-bar-agent.ts:687-710,859-919` + `overlay-session.ts:122-143` match the claim |

Eval gate card — `post220-nits` Lane C slice:

**Blast tier**: T2
**MACHINE**: PASS (82/82; env vs product: no env fail on this command)
**ADVERSARY (this lane)**: APPROVE_WITH_NITS
**T3 escalate**: no

---

## Verdict rationale

Independent of the implementer session and of the merged-round Lane C report (used as context, not proof). S-C1 is gone from `*.ts`. S-C2 trailing bind is conjunctive on `overlaySessionIsLive(token)` captured at submit start. S-C2 reclaim calls `claimOverlayIfLive` with the bound session token; if generation dies during the await the helper unwinds (existing overlay-session tests + MUT1). Overlay stays Channel/L0: Swift has zero Allow/Deny chrome; exclusive diff adds no confirm skip. Residuals are grep-shaped menu-bar pins, an unused optional-token default, and reclaim's omitted sibling repair — not steal.

VERDICT: APPROVE_WITH_NITS
