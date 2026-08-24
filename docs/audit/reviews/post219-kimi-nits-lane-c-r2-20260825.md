# Lane C r2 — Incremental re-verify (reclaim steal High)

| Field | Value |
| --- | --- |
| Lane | C (independent adversary) |
| Date | 2026-08-25 |
| Prior | `post219-kimi-nits-lane-c-lease-20260825.md` → **REJECT** (High: lagged `summonerThreadId` reclaim steals newer overlay) |
| This pass | C-High / Bind / Tests only — no source edits |
| Default | REFUTED until live call sites + `[executed]` races hold |

---

## Machine results **[executed]**

```text
cd companion
npx tsx --test tests/overlay-session.test.ts tests/composer-lease.test.ts tests/summoner-overlay.test.ts
→ 85 tests, 85 pass, 0 fail (~533ms)
```

Includes claimed gates:

- `shouldReclaimLiveOverlayThread no-ops after beginOverlaySession (lagged thread id)` **pass**
- `shouldReclaimLiveOverlayThread ignores siblings that are not the bound thread` **pass**
- `#219 dual summoner…` / lifecycle survivingSummoners grep **pass** (no regress)

---

## Claimed folds

| ID | Claim | Verdict |
| --- | --- | --- |
| C-High | `shouldReclaimLiveOverlayThread` requires `overlaySessionIsLive(token)`; new `beginOverlaySession` → old token not live → reclaim no-ops | **HOLDS** |
| Bind | `bindSummonerThread(id, token)` captures generation; `clearSummonerThread` on close; all production assigns via bind/clear | **HOLDS** (with latent API nit) |
| Tests | lagged token → false; sibling ≠ bound thread → false | **HOLDS** `[executed]` |

---

## Must-falsify

### 1. Steal interleaving vs LIVE `reclaimLiveSummonerThread` **[inspected]**

Prior High timeline:

1. Session₁ binds `A` @ token `T1` via `bindSummonerThread(A, T1)`.
2. Session₂ `beginOverlaySession()` → generation `T2`. Bound fields still `{A, T1}` until Session₂ succeeds.
3. Session₁ stale claim demotes `A` → `onStaleClaim` → `reclaimLiveSummonerThread`.

LIVE gate (`menu-bar-agent.ts:687-695` + `overlay-session.ts:48-56`):

```ts
shouldReclaimLiveOverlayThread({
  liveThreadId: summonerThreadId,           // still "A"
  liveSessionToken: summonerThreadSessionToken, // still T1
  siblings,
})
// → overlaySessionIsLive(T1) === false after begin(T2) → false → return
```

**No exclusive re-claim of lagged `A`.** Session₂’s later `bindSummonerThread(C, T2)` is not demoted by this path.

Same-session repair still works: bound token still live + sibling matches bound id → reclaim allowed (unit test asserts true before second `begin`).

**Prior High: FIXED.**

### 2. Remaining `summonerThreadId =` skipping bind? **[inspected]**

`companion/src/menu-bar-agent.ts` assignments:

| Line | Form |
| --- | --- |
| 167 | inside `bindSummonerThread` only |
| 172 | inside `clearSummonerThread` only |

Production success paths all call `bindSummonerThread(..., token)` with the session token in hand:

- hydrate claimed → `:728` `bindSummonerThread(id, token)`
- submit hydrate callback → `:882` `bindSummonerThread(id, token)` (gated by `overlaySessionIsLive(token)`)
- submit ok → `:908` `bindSummonerThread(result.threadId, token)`
- new thread claimed → `:1140` `bindSummonerThread(created.id, token)`

Close → `:822` `clearSummonerThread()` after `invalidateOverlaySession()`.

**No bare production assign.** Bind claim holds.

### 3. `setSummonerThreadId(id)` → bind without explicit token **[inspected]**

```932:935:companion/src/menu-bar-agent.ts
export function setSummonerThreadId(id: string | null): void {
  if (id) bindSummonerThread(id)  // token ?? currentOverlaySession()
  else clearSummonerThread()
}
```

**Attack:** after `beginOverlaySession()`, `setSummonerThreadId("A")` pairs lagged id `A` with the **new** generation → `shouldReclaimLiveOverlayThread` would return true if `A ∈ siblings` → steal returns.

**Production call sites:** repo-wide grep finds **only the definition** — zero callers (tests, tray, web shell, none). Not exercised after `begin` in production today.

**Nit (not High):** exported footgun; prefer delete, or require explicit token, or refuse bind when `!overlayIsOpen()`.

### 4. Dual-summoner `survivingSummoners` **[inspected]**

`lifecycle.ts:1346-1370` unchanged algebra: `clients.delete` + `wsAuth.delete` **before** counting remaining auth `surface==="summoner"`. Last socket → 0 → release; survivor → skip. Helper tests still green. **No regress.**

### 5. Grep theater in `summoner-overlay.test.ts` **[inspected]** — note only

`:361-367` still `assert.match` on `releaseOverlayLeaseAtRev` / `onStaleClaim` / `reclaimLiveSummonerThread` / `released_siblings` anywhere in file — does **not** prove token gate wiring. Per instructions: note only; do not REJECT solely for this while production hold + helper races are real.

---

## Findings

| Sev | Item | File:line |
| --- | --- | --- |
| ~~High~~ | Prior reclaim steal | **Cleared** by `shouldReclaimLiveOverlayThread` + bound session token |
| Nit | `setSummonerThreadId` re-binds with `currentOverlaySession()` — latent steal if ever called post-`begin` with lagged id | `menu-bar-agent.ts:932-934` |
| Nit | menu-bar reclaim/submit wiring still grep theater | `summoner-overlay.test.ts:339-367` |

---

## Verdict rationale

C-High production interleaving no longer steals: reclaim is gated on the **bound** session token, which dies when `beginOverlaySession` bumps generation, even while `summonerThreadId` string still lags. Bind/clear funnel is complete for production assigns. Claimed tests exist and pass under `[executed]`. Residual: unused `setSummonerThreadId` API + grep theater notes — insufficient to keep REJECT.

---

VERDICT: APPROVE_WITH_NITS
