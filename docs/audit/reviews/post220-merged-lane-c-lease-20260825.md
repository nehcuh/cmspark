# Lane C — post-merge independent adversary (overlay lease / summoner session)

| Field | Value |
| --- | --- |
| Lane | C (independent adversary — overlay lease / summoner session) |
| Date | 2026-08-25 |
| Range | `c5b4242..1d16b0e` |
| HEAD | `1d16b0ed8b7a8eb0fc75c529cd88e24089f9c2bb` **[executed]** `git rev-parse HEAD` |
| Frozen patch SHA256 | `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021` **[executed]** file + `git diff c5b4242..1d16b0e -- ':!docs/audit/reviews'` |
| Exclusive files | `overlay-session.ts`, `summoner/client.ts`, `composer-lease.ts`, `lifecycle.ts` (close/stamp), `menu-bar-agent.ts` (bind/reclaim/session only), matching tests |
| Prior r2 | `post219-kimi-nits-lane-c-r2-20260825.md` APPROVE_WITH_NITS — **not cited as proof**; re-executed |
| Default | REFUTED until `file:line` + `[executed]` / `[inspected]` |

Capability (implementer claim — challenged below):

```text
Surface:      L0 (steer/nextRun composer + overlay hub; no new L2)
L2-classes:   none
Compose:      none (overlay-eligible pack already on main)
Autonomy:     steer / nextRun queue
Trust:        overlay never Allow/Deny; persistence redaction must not leak
Channel:      composer lease / overlay session token
```

Blast: **T2**. No new confirm skip, overlay-as-Trust, or persistence leak found → do not escalate to T3.

---

## Machine results **[executed]**

Cwd: `companion/`. Isolated worktree has **no** `companion/node_modules` (tsx cannot resolve `js-yaml` when `composer-lease.test.ts` dynamically imports `message-router`).

**Mandatory command (bare):**

```text
npx tsx --test tests/overlay-session.test.ts tests/composer-lease.test.ts tests/summoner-overlay.test.ts tests/summoner-client.test.ts
→ tests 117 / pass 116 / fail 1 / duration_ms 177.300917
```

The single fail is env, not the C-High gate:

```text
✖ followUpCreateFromQueue stamps summoner so overlay nextRun drain keeps the lease
  Error: Cannot find module 'js-yaml'
  Require stack: companion/src/threads/markdown-export.ts → companion/src/message-router.ts
```

Load-bearing overlay tests (lagged-id reclaim, exclusive claim, #219 survivingSummoners, Swift zero Allow/Deny) **passed** on this run.

**Same command with `NODE_PATH=/Users/huchen/Projects/cmspark/companion/node_modules` (no worktree mutation):**

```text
→ tests 117 / pass 117 / fail 0 / duration_ms 275.913709
```

Per-file (NODE_PATH run): `composer-lease` 36, `overlay-session` 14, `summoner-client` + `summoner-overlay` 67. `followUpCreateFromQueue` **pass**.

**Mutation-kill (private `/tmp/lane-c-overlay-mut-*`, worktree untouched):** deleted only

```ts
if (!overlaySessionIsLive(args.liveSessionToken)) return false
```

from a copy of `shouldReclaimLiveOverlayThread`. Replayed the lagged-id test against the mutant:

```text
✖ shouldReclaimLiveOverlayThread no-ops after beginOverlaySession (lagged thread id)
  AssertionError: new overlay session must not exclusive-claim lagged A (would demote C)
  true !== false
  MUT_EXIT=1
```

The claimed test is load-bearing: without the generation match it goes red. **[executed]**

---

## Must-falsify

### 1. C-High — Session1 lagged `{A, T1}` reclaim must not steal Session2 live overlay

**Attack timeline (stated):**

1. Session1 binds thread A @ token T1.
2. Session2 `beginOverlaySession()` bumps generation to T2; bound fields may still lag `{A, T1}`.
3. Session1 stale claim → `onStaleClaim` → `reclaimLiveSummonerThread`.
4. LIVE must **NO-OP** reclaim (must not exclusive-claim lagged A / demote newer C). Gate = bound session token still live (`overlaySessionIsLive` / generation match), **not** merely a lagged thread-id string.

**Production gate [inspected]**

`companion/src/summoner/overlay-session.ts:48-56`:

```ts
export function shouldReclaimLiveOverlayThread(args: {
  liveThreadId: string | null | undefined
  liveSessionToken: number | null | undefined
  siblings: OverlayLeaseState[]
}): boolean {
  if (!args.liveThreadId || args.liveSessionToken == null) return false
  if (!overlaySessionIsLive(args.liveSessionToken)) return false
  return args.siblings.some((s) => s.thread_id === args.liveThreadId)
}
```

`overlaySessionIsLive` is `live && token === generation` (`overlay-session.ts:17-18`). `beginOverlaySession` increments generation then sets `live=true` (`:6-9`). After step 2, `overlaySessionIsLive(T1)` is false even while `summonerThreadId === "A"`.

`reclaimLiveSummonerThread` (`menu-bar-agent.ts:687-703`) **does** pass the bound token, not a fresh `currentOverlaySession()`:

```ts
if (!shouldReclaimLiveOverlayThread({
  liveThreadId: summonerThreadId,                 // lagged "A"
  liveSessionToken: summonerThreadSessionToken,   // lagged T1
  siblings,
})) return
```

Stale-claim unwind (`overlay-session.ts:80-91`, used from `hydrateOverlayIfLive:110-116` and `claimOverlayIfLive:133-139`):

- CAS-releases **only** the stale claim rev via `releaseOverlayLeaseAtRev` (`composer-lease.ts:310-327`; mismatch is a no-op, never a steal).
- Never `releaseAll` while `live` (would kill Session2’s hold).
- Then hands `released_siblings` to reclaim, which no-ops on dead T1.

**Unit pin [executed]:** `overlay-session.test.ts:250-265` — reclaim `{A, T1}` is true before second `begin`, false after. Mutation removing the live-token line makes this assertion `true !== false`. Sibling mismatch (`:267-277`) still false when bound id is `C` and siblings are `[A]`.

**C-High: REFUTED (code holds).** Reclaim of lagged A after generation bump does not exclusive-claim A.

Residual (not C-High steal): `reclaimLiveSummonerThread` then calls raw `claimOverlayLeaseCas` with no second `overlaySessionIsLive` check around the await (`menu-bar-agent.ts:698-699`). For the stated timeline the token is already dead at the first check, so the TOCTOU does not re-open C-High. A *later* `beginOverlaySession` during that await could still exclusive-claim. Nit, not BLOCK.

### 2. All production assigns of summoner thread id go through `bindSummonerThread` / `clearSummonerThread`

**Hunt [executed] grep** `summonerThreadId =` under `companion/src`: **exactly two** writes:

| Line | Site |
| --- | --- |
| `menu-bar-agent.ts:167` | inside `bindSummonerThread` |
| `menu-bar-agent.ts:172` | inside `clearSummonerThread` |

No stray `summonerThreadId = cmd.hits[0].id` (pinned `summoner-overlay.test.ts:281`). Search 1-hit hydrates via `hydrateSummonerThread` (`menu-bar-agent.ts:918-920`).

Production binds pass the session token in hand **[inspected]**:

| Call | Line | Token |
| --- | --- | --- |
| hydrate claimed | `:728` | `bindSummonerThread(id, token)` |
| submit hydrate callback | `:881-882` | gated `if (!overlaySessionIsLive(token)) return` then bind |
| submit `result.ok` | `:907-909` | `bindSummonerThread(result.threadId, token)` — **not** re-gated |
| new-thread claimed | `:1139-1140` | only if `claimOverlayIfLive` returned true |
| close | `:820-822` | `invalidateOverlaySession()` then `clearSummonerThread()` |

**Bind funnel: HOLDS** for production assigns. See nit on the ungated submit-ok bind.

### 3. `setSummonerThreadId` — r2 called it latent; confirm or BLOCK

**[executed]** repo-wide grep of `*.{ts,js}`: **only the definition** `menu-bar-agent.ts:932-935`. No test, tray, web-shell, or lifecycle caller. Importers of `menu-bar-agent` (`lifecycle.ts`, `server.ts`, `index.ts`, `l2-admission.ts`) use `getTrayInstance` / `startMenuBarAgent` only.

```ts
export function setSummonerThreadId(id: string | null): void {
  if (id) bindSummonerThread(id)  // token ?? currentOverlaySession()
  else clearSummonerThread()
}
```

**Attack (latent):** after `beginOverlaySession()` (T2 live), `setSummonerThreadId("A")` pairs lagged A with **live** T2 → `shouldReclaimLiveOverlayThread` true if A ∈ siblings → steal returns.

**Mission rule:** production callers exist → BLOCK. They do not. **Nit**, not BLOCK. Prefer delete / require explicit token / refuse when `!overlayIsOpen()`.

### 4. Composer-lease grep tests — dual-candidate vs CI `.test-dist`

r1 S2: `../../src` from compiled output ENOENT.

LIVE tests use `candidates.find(p => fs.existsSync(p))` **[inspected]**:

- `composer-lease.test.ts:194-199` message-router: `../src` then `../../src`
- `:210-215` lifecycle stamp: same
- `:552-557` #219 close handler: `../../src` **first**, then `../src`
- `summoner-client.test.ts:33-43` / `summoner-overlay.test.ts:13-21`: `ROOT=../..` then `__dirname/../src`
- `companion-ui-rects.test.ts:82-87` (overlay rect pin): same dual as composer-lease

**Path probe [executed]** (node `existsSync` for both layouts):

| `__dirname` | `../src/…ts` | `../../src/…ts` | pick |
| --- | --- | --- | --- |
| `companion/tests` (tsx) | EXISTS (`companion/src`) | ENOENT (repo `/src`) | first |
| `companion/.test-dist/tests` (CI `tsc -p tsconfig.test.json`, `outDir: .test-dist`) | ENOENT (`.test-dist/src/*.ts` not emitted) | EXISTS (`companion/src`) | second |
| `companion/.test-dist` (flat, hypothetical) | EXISTS (`companion/src`) | ENOENT | first |

#219’s reversed order still picks an existing file in every layout. Dual-candidate **works** for CI `.test-dist/tests` and for tsx `companion/tests`. Grep tests `message-router chat.create uses composer lease gate`, `lifecycle stamps __cmspark_surface`, `#219 lifecycle close handler counts surviving authenticated summoner clients` **passed** under tsx **[executed]**.

`tsconfig.test.json`: `rootDir: "."`, `include: src + tests` → compiled tests live at `.test-dist/tests/*.js`. Candidates correctly read **source `.ts`**, not compiled `.js`.

### 5. Overlay must NOT become Allow/Deny Trust surface. No new confirm skip.

**[inspected + executed]**

- Diff in exclusive production files adds **no** `securityConfirmations.request`, `auto_approve`, `forceConfirm`, `originWs`, or confirm-skip branch (`composer-lease.ts` / `overlay-session.ts` / overlay call sites in `menu-bar-agent.ts` / `client.ts` mapping).
- `client.ts:331-333` still routes Trust/pack failures to Side Panel copy (`pack_not_overlay_eligible` → 「这个场景要去侧栏确认」; `pack_trust_cookie_present` → 「当前对话有 Trust 快照，去侧栏换场景」). Overlay does **not** inherit looser L0 to skip Trust.
- `client.ts:358-364` MCP pending → `MCP_CONFIRM_PENDING` error, not overlay Allow/Deny.
- Swift chrome: `summoner-overlay.test.ts:54-58` **pass** — `doesNotMatch` `/允许|拒绝|Allow|Deny|确认/` and `showConfirm|allowClicked|denyClicked`; close emits `summoner.closed` not `chat.abort` (`:165-169`).
- `mapChatMessageToSummonerCmd ignores unrelated / confirm frames` **pass** (`summoner-client.test.ts`).
- Channel only: `stampCmsparkSurface` overwrites client spoof (`composer-lease.ts:115-119`); `LEASE_HOLDER_SURFACE_MISMATCH` (`:169-177`); `gateChatCreateOnLease` OVERLAY_STANDBY (composer mutex, not confirm skip).

**No new confirm skip. Overlay is not a Trust surface.**

---

## ADR-020 dual-review checklist

| Check | Result |
| --- | --- |
| 1. Axes fit | **Channel / L0 hub.** Session generation + composer lease are Channel. Not a middle-agent runtime. Declaration matches. |
| 2. Pack-first | No new primary Side Panel chrome. Overlay already experimental hub. Pack apply still error-routes ineligible/Trust cookies to Side Panel. |
| 3. Confirm dialects | None added. |
| 4. Trust monotonicity | Deeper Trust (pack cookie, MCP confirm) does **not** inherit overlay L0 “just send”. Copy forces Side Panel. **Holds.** |
| 5. originWs | No new `securityConfirmations.request`. N/A; no regression. |
| 6. No new runtime | Lease map + generation counter. Not a second agent framework. |
| 7. Experimental | Overlay title lock 召唤器（实验） still pinned. |
| P1-1..4 | No `auto_approve_*` / evaluate / shell / originWs confirm in exclusive diff. |

Capability declaration is present and accurate for this slice. Missing-declaration BLOCK does not apply.

---

## Independent attacks beyond r2 (do not rubber-stamp)

### A. Submit-ok bind is not live-gated **[inspected]**

Hydrate callback (`menu-bar-agent.ts:881-882`) refuses bind when `!overlaySessionIsLive(token)`. The trailing bind (`:907-909`) does not:

```ts
if (result.ok && result.threadId) {
  bindSummonerThread(result.threadId, token)
```

If Session1 `claimOverlayIfLive` returned true (T1 still live at claim-end), then Session2 `beginOverlaySession`+`bind(C,T2)` races in before this line, Session1 overwrites bound fields to `{A, T1}` (now dead). Reclaim then no-ops (dead token) — **not** C-High steal — but `summonerCmdMatchesThread(cmd, summonerThreadId)` (`:1526`) would drop C’s stream. Pre-existing ungated `summonerThreadId = result.threadId` was the same id overwrite; the new token field makes reclaim safer, not worse. **Nit.**

Busy-steer path in `submitSummonerTalk` skips `claimLease` and can still return `{ok, threadId}` → same trailing bind. Steer does not exclusive-claim. **Nit.**

### B. Reclaim is not wrapped in `claimOverlayIfLive` **[inspected]**

Same-session repair (`shouldReclaim` true) exclusive-claims via raw `claimOverlayLeaseCas` (`menu-bar-agent.ts:698-699`) with no post-claim generation check / unwind. Stated C-High already killed T1 before `shouldReclaim`. Tight TOCTOU only if another `begin` lands during the RPC. **Nit.**

### C. menu-bar reclaim wiring is still grep theater **[inspected]**

`summoner-overlay.test.ts:361-367` `assert.match`es `releaseOverlayLeaseAtRev` / `onStaleClaim` / `reclaimLiveSummonerThread` / `released_siblings` anywhere in the file. Does **not** prove `liveSessionToken: summonerThreadSessionToken` is the argument. Helper races + production read of that field are real; do not REJECT solely for grep. **Nit.**

### D. `#219` survivingSummoners **[inspected + executed]**

`lifecycle.ts:1349-1370`: `clients` / `wsAuth` drop the closing socket **before** counting remaining `authenticated && surface === "summoner"`. Last → 0 → `broadcastOverlayLeasesOnSocketClose` releases; survivor → skip (`composer-lease.ts:333-341`). Tests `:515-550` behavioral + `:552-563` grep **pass**. Handshake `surface` is client-claimed; a secret-holding peer can already act as tray (stronger). Not a new Trust skip.

---

## Findings

| Sev | Item | Evidence |
| --- | --- | --- |
| ~~High~~ | C-High lagged-id reclaim steal | **REFUTED.** Gate = `overlaySessionIsLive(bound token)` `overlay-session.ts:54` + `menu-bar-agent.ts:691-695`. Mutation-kill **[executed]** |
| Nit | `setSummonerThreadId` binds lagged id with `currentOverlaySession()` — steal if ever called post-`begin` | `menu-bar-agent.ts:932-935`; zero callers **[executed]** |
| Nit | submit-ok bind not live-gated (stream-filter / repair-miss if it overwrites Session2 bind) | `menu-bar-agent.ts:907-909` vs `:881-882` |
| Nit | reclaim RPC not re-checked for generation | `menu-bar-agent.ts:698-699` |
| Nit | menu-bar reclaim/submit wiring grep-only | `summoner-overlay.test.ts:361-367` |

No BLOCK. No new confirm skip. Dual-candidate grep paths hold on `.test-dist/tests` **[executed]**.

---

## Verdict rationale

C-High does not reproduce on live `1d16b0e`. Reclaim is gated on the **bound** overlay session token; `beginOverlaySession` kills that token while `summonerThreadId` may still lag. Production thread-id writes funnel through `bindSummonerThread` / `clearSummonerThread`. The lagged-id unit test is mutation-killed (goes red if the token gate is removed). Overlay stays Channel/L0: Swift has zero Allow/Deny chrome; pack/MCP Trust still bounce to Side Panel. Residual nits are unused `setSummonerThreadId`, an ungated submit-ok bind, and grep theater — not steal.

Independent of r2: mutation-kill executed here; ungated submit-ok bind and raw reclaim RPC called out as extra nits r2 did not list as steal.

VERDICT: APPROVE_WITH_NITS
