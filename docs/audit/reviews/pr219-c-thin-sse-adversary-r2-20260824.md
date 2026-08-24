# Independent adversary r2 — PR #219 C-thin P2 thin SSE (B1 only)

> **Lane**: Outcome / Trajectory / Component (Trust + SSE + overlay DoD 4)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **HEAD**: `4e61b9f` (`fix(summoner): map OVERLAY_STANDBY from error_code not English error`)
> **Parent**: `d81444c` (`feat(summoner): SSE so HTML shell does not lie about send`)
> **Prior REJECT**: `docs/audit/reviews/pr219-c-thin-sse-adversary-20260824.md` — B1 (DoD 4)
> **Scope**: incremental rereview of **B1 only**, plus whether the fix opened a new Trust / SSE hole. Remaining nits from r1 that are still true are carried, not re-litigated as blockers.

HEAD matches claimed commit: `.git/refs/heads/feat/steer-nextrun-overlay-hub` → `4e61b9fe54f98bb5fe77f842aafb2c83165a36e6`. Reflog parent of HEAD is `d81444cebe5b96506b5e4343d8a744966a3f01f7`. `[inspected]`

This subagent has no bash in the tool list. `git diff d81444c..4e61b9f` / `companion npm test` were **not** re-executed. Evidence: HEAD ref, `.git/COMMIT_EDITMSG`, reflog, production files + tests at HEAD vs r1 report of `d81444c`. Semantic diff below is reconstructed from those, not a `git show` blob. `[inspected]`

---

## Capability declaration (ADR-020) — unchanged from r1

```text
Surface:      L0 overlay HTML
L2-classes:   none — overlay never Allow/Deny; SSE must not forward confirm chrome
Compose:      unchanged
Autonomy:     same tool-loop
Trust:        monotonic
Channel:      HTML loopback+token; SSE /api/events; page never companion WS
```

This commit does not add types to `SUMMONER_WEB_EVENT_ALLOW`, does not move `/confirm/i`, does not stringify earlier, does not widen `isAllowedWsOrigin`, and does not add Allow/Deny DOM. It only remaps overlay **status copy**. `[inspected]`

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `4e61b9f` | yes | `.git/HEAD` / refs / reflog `[inspected]` |
| Parent is `d81444c` | yes | reflog `[inspected]` |
| companion tests re-run | **not re-run** | `[assumed]` implementer; mapping test exists in source |
| Test drives real router shape | **yes** | `summoner-web.test.ts:411-419` `[inspected]` |
| HTML `statusFromEvent` keys `data.error_code` | **yes** | `summoner-web.ts:766-780` `[inspected]` |
| SSE allowlist / confirm drop / WS Origin changed | **no** | `pushSummonerWebEvent` + Set + lifecycle unchanged `[inspected]` |
| New Trust / confirm-chrome hole | **no** | status-text only `[inspected]` |

---

## Diff (reconstructed `d81444c..4e61b9f`) `[inspected]`

Touched production: `companion/src/summoner-web.ts`. Touched test: `companion/tests/summoner-web.test.ts`. No `lifecycle.ts` / `composer-lease.ts` / `menu-bar-agent.ts` / allowlist edits.

1. **Node helper** `STATUS_LABELS` + exported `summonerWebEventStatus` (`summoner-web.ts:166-193`). Lookup order: `error_code` → `data.error_code` → `error`. Substring fold of `OVERLAY_STANDBY` / `LEASE_REV_MISMATCH` so the English gate sentence still keys the Chinese copy.
2. **HTML twin** `statusFromEvent` (`:766-780`). Same order, `indexOf` instead of `includes`. SSE `chat.error` / `error` now `setStatus(statusFromEvent(d))` (`:787-789`). Claim path `selectThread` now calls it instead of `d.error || "侧栏占用了输入"` (`:656-657`).
3. **Test** `summonerWebEventStatus maps router OVERLAY_STANDBY and claim mismatch` (`summoner-web.test.ts:411-432`) plus HTML greps for `data.error_code` / `statusFromEvent` (`:126-127`).

`pushSummonerWebEvent` body is the r1 allowlist + `/confirm/i` + `JSON.stringify` after drop (`:195-209`). `MAX_SSE_CLIENTS`, Host, POST-only Origin, CSP `connect-src 'self'` untouched.

---

## Must-falsify: B1 (DoD 4)

r1 B1: HTML keyed `labels[d.error || d.error_code]`. Router `chat.error` is **not** `error: "OVERLAY_STANDBY"`. User saw the English gate string. Tests grepped the Chinese literal in the HTML source. 「侧栏占用了输入」 was dead.

### 1. Does the test drive the real router shape?

**Yes.** `[inspected]` `summoner-web.test.ts:411-419`:

```411:419:companion/tests/summoner-web.test.ts
test("summonerWebEventStatus maps router OVERLAY_STANDBY and claim mismatch", () => {
  assert.equal(
    summonerWebEventStatus({
      type: "chat.error",
      error: "OVERLAY_STANDBY: composer is on the other surface",
      data: { error_code: "OVERLAY_STANDBY", holder: "panel" },
    }),
    "侧栏占用了输入",
  )
```

That is `ChatCreateLeaseError` (`composer-lease.ts:30-35,137-142`): `{ type: "chat.error", thread_id, error: gate.error, data: { error_code, holder } }`. Router `chat.create` / `chat.steer` / `file.upload` `return leaseErr` (`message-router.ts:333-334,582-583,606-607`). Grep still finds **zero** `error: "OVERLAY_STANDBY"` exact — the English sentence is still the `error` field. The test no longer pretends otherwise.

Claim mismatch is also driven (`:421-426`) as `{ type: "composer.lease.error", error: "LEASE_REV_MISMATCH", error_code: "LEASE_REV_MISMATCH" }`, which matches `handleComposerLeaseFamily` (`composer-lease.ts:185-190`) minus `thread_id`/`holder`/`rev` (irrelevant to the mapper).

`run_active` exact-key still maps (`:428-431`) — r1 already worked; not regressed in the helper.

### 2. Would production HTML paint that shape?

**Yes, on the live SSE path.** `[inspected]`

Wire (unchanged, still the DoD 4 observable):

1. Overlay `chat.create` is fire-and-forget (`menu-bar-agent.ts:1200-1207`) → HTTP `{ type: "accepted" }` → HTML **已提交** (DoD 3).
2. Companion `handleMessage` returns `leaseErr`. `lifecycle.ts:1329-1334` `ws.send`s it on the **origin** summoner socket (`id` undefined → `JSON.stringify` omits `id`).
3. Tray `onAppMessage` → `pushSummonerWebEvent` (`menu-bar-agent.ts:1418-1421`). `chat.error` is allowlisted. Confirm types still dropped before stringify.
4. HTML EventSource (`:782-789`):

```766:789:companion/src/summoner-web.ts
  function statusFromEvent(d){
    if(!d||typeof d!=="object") return "出错了";
    var data=d.data&&typeof d.data==="object"?d.data:{};
    var raw=String(d.error_code||data.error_code||d.error||"");
    var code=raw.indexOf("OVERLAY_STANDBY")>=0?"OVERLAY_STANDBY": raw.indexOf("LEASE_REV_MISMATCH")>=0?"LEASE_REV_MISMATCH": raw;
    var labels={
      run_active:"本轮还在跑 · 回车纠偏或排队",
      ...
      OVERLAY_STANDBY:"侧栏占用了输入",
      LEASE_REV_MISMATCH:"侧栏占用了输入",
      LEASE_HOLDER_SURFACE_MISMATCH:"侧栏占用了输入"
    };
    return labels[code]||d.error||d.message||"出错了";
  }
  ...
      if(t==="error"||t==="chat.error"){
        setStatus(statusFromEvent(d));
```

Walk of the required object:

| Field | Value | HTML |
|-------|--------|------|
| `d.error_code` | missing | skip |
| `d.data.error_code` | `"OVERLAY_STANDBY"` | `raw = "OVERLAY_STANDBY"` |
| `labels[code]` | `"侧栏占用了输入"` | **this is what `setStatus` gets** |

The `indexOf("OVERLAY_STANDBY")` fold is not required for the real router shape — `data.error_code` first is enough. The fold would also catch a payload that only had the English `error` sentence. r1’s dead lookup (`code = d.error || d.error_code` → full English sentence as key) is gone.

Claim HTTP path (r1 item 4): `selectThread` now `setStatus(statusFromEvent(d))` when `d.error` / `error_code` / `composer.lease.error` (`:656-657`). `LEASE_REV_MISMATCH` is a top-level `error_code` and an exact `error` key, so it paints 「侧栏占用了输入」 instead of the identifier. `composer.lease.error` is **not** in the SSE allowlist — claim is request/response, which is the right channel.

### 3. Is the tested function the paint function?

**No — twin.** `[inspected]` `summonerWebEventStatus` is exported and unit-tested. HTML does **not** call it (inline page, no Node). Live paint is `statusFromEvent`, still only grepped (`summoner-web.test.ts:125-127`: `/侧栏占用了输入/`, `/data\.error_code/`, `/statusFromEvent/`).

r1’s allowed fix was: *assert the HTML mapping, **or** extract the label function.* They extracted **and** rewrote HTML. For the required object the two implementations agree (hand-walked). That closes B1. The twin is a **nit**, not a leftover blocker: a later HTML-only edit can re-kill DoD 4 while the TS test stays green.

Small twins, not behavioral for this shape:

- TS rejects array `data`; HTML treats arrays as objects (`typeof [] === "object"`). Router `data` is a plain object.
- TS `includes` vs HTML `indexOf`.
- TS does not substring-fold `LEASE_HOLDER_SURFACE_MISMATCH`; both have an exact label key. Production claim mismatch uses exact `error` + `error_code` (`composer-lease.ts:172-176`).

### B1 verdict

**Closed.** DoD 4 copy is reachable for the real `chat.error` gate. The test is not source-grep theater on that object. HTML paint for that object is 「侧栏占用了输入」, not the English sentence.

---

## New Trust / SSE hole?

**Could not find one.** `[inspected]`

| Surface | r1 | r2 |
|---------|----|----|
| `SUMMONER_WEB_EVENT_ALLOW` | 15 types; no `security.confirmation.request` | **same** |
| `/confirm/i` except `mcp.confirm.pending` | drop before stringify | **same** (`:199-200`) |
| Payload strip | type-only, full `JSON.stringify(msg)` | **same** |
| GET `/api/events` Origin | not checked | **same** |
| `isAllowedWsOrigin` | rejects loopback HTTP | **untouched** |
| HTML Allow/Deny | absent | **absent** (`doesNotMatch` `/允许\|拒绝\|Allow\|Deny\|确认/` still at test `:129`) |
| CSP `connect-src 'self'` | yes | **same** |

`includes("OVERLAY_STANDBY")` / `indexOf` can mis-label some other `chat.error` whose English `error` happens to contain that token (e.g. a thrown `e.message`). Overlay still cannot Allow/Deny; SSE still does not grow types or fields. That is copy-collision, not Trust elevation, not confirm chrome. Companion generates these frames.

`send()` HTTP still `setStatus(d.error)` (`:715`) and does **not** use `statusFromEvent`. Overlay create/steer/abort/upload HTTP is `{ type: "accepted" }` (`menu-bar-agent.ts:1200-1207`), so OVERLAY_STANDBY does not ride that branch. Residual honesty if fire-and-forget is later turned into `sendAppRequest` — not a new hole in this commit.

No new L2 dialect. `mcp.confirm.pending` still notice-only.

---

## DoD 4 vs production (r2)

| # | Observable | r1 | r2 |
|---|------------|----|----|
| 4 | Lease claim failure surfaces **侧栏占用了输入** | **FAIL** | **pass** `[inspected]` — SSE `chat.error` + HTTP claim both key `error_code` / `data.error_code` |

DoD 1–3, 5–8 were pass at `d81444c` and are not re-opened by this mapping-only commit.

---

## Carried findings (still true)

Not blockers. Same IDs as r1 unless noted.

### MAJOR (unchanged)

**M1 — `SUMMONER_WEB_EVENT_ALLOW` is not frozen; tests only probe two memberships.** Still `summoner-web.test.ts:354-355`. Set still includes `tool.start` / `mcp.confirm.pending` / `run_status`. Snapshot + explicit absences (`computer.task.event` / `config.updated` / `security.confirmation.*` / `hud.spike.show_confirm`) still missing.

**M2 — Type-only forward, full payload.** `data: ${JSON.stringify(msg)}` unchanged. Safe while confirm types never reach stringify.

### Nits (unchanged unless marked)

**N1 — GET `/api/events` does not check Origin.** Still POST-only (`:325-327`). CORS still non-reflecting / SSE has no ACAO.

**N2 — EventSource token in query.** Inherent. `no-referrer` still on HTML + SSE.

**N3 — `MAX_SSE_CLIENTS = 4` untested.** Still no 5th-client assertion.

**N4 — `/confirm/i` exception for `mcp.confirm.pending` is a footgun.** Unchanged.

**N5 — SSE client does not filter `thread_id` on `chat.user`.** Unchanged (`:791-798`).

**N6 — 30 min idle timer ignores a live SSE.** `lastAccessTime` still on new HTTP (`:252`), not `pushSummonerWebEvent`.

**N7 — `run_status` allowlist entry has no producer.** Unchanged.

**N8 — Dispatch `{ ...payload, type }` (type last).** Unchanged, still good.

**N9 — Tests are still partly source-grep.** Improved: B1 now has a real mapper unit test. Still grep: HTML `statusFromEvent`, tray `pushSummonerWebEvent` lock (`:461-466`), Allow/Deny absence. Cannot see ACL / lease steal / confirm fan-out end-to-end.

**N10 — HTML `statusFromEvent` is a hand-copied twin of `summonerWebEventStatus`.** New, from this fix. DoD 4 live path is the twin. Keep them lock-step or generate the page helper from the exported function (even as a string splice). Prefer exact `error_code` over substring `includes`/`indexOf`.

**N11 — `send()` HTTP errors still paint raw `d.error`.** New residual, not this commit’s regression. Overlay send is accepted+SSE today.

---

## Trajectory

Slice still matches spec P2: loopback SSE, confirm request dropped, `accepted` ≠ 已发送. B1 was the honesty-slice miss on occupancy copy. This commit maps the **actual** gate object, not a fantasy `error: "OVERLAY_STANDBY"`.

TDD: the new test is a direct call of the extracted helper with the router literal. It is not an EventSource DOM assertion and not an HTML-eval of `statusFromEvent`. Good enough to close B1 given the twin was rewritten in the same commit and hand-walks the same object. Not good enough to prevent a future HTML-only drift (N10).

Dead path from r1: `labels.OVERLAY_STANDBY` is **live** in both copies. `run_status` event type is still dead.

---

## Component (file:line) — r2 deltas

| Gate | Location |
|------|----------|
| Node mapper (tested) | `companion/src/summoner-web.ts:166-193` |
| HTML mapper (live SSE / claim) | `companion/src/summoner-web.ts:656-657,766-789` |
| Mapper test (router shape) | `companion/tests/summoner-web.test.ts:411-432` |
| Event allowlist / confirm drop | `companion/src/summoner-web.ts:32-48,195-200` (unchanged) |
| Fire-and-forget `accepted` | `companion/src/menu-bar-agent.ts:1200-1207` (unchanged) |
| `onAppMessage` fan-in | `companion/src/menu-bar-agent.ts:1418-1421` (unchanged) |
| Origin-socket return of `leaseErr` | `companion/src/ws/lifecycle.ts:1277-1280,1329-1334` (unchanged) |
| OVERLAY_STANDBY gate shape | `companion/src/ws/composer-lease.ts:30-35,128-145` (unchanged) |
| WS Origin | `companion/src/ws/lifecycle.ts:196-208` (untouched) |

---

## Attack results (short)

| Threat | r2 |
|--------|-----|
| Confirm/Trust on SSE | **still blocked** (allowlist + regex, stringify after) |
| New confirm type / chrome from this commit | **no** |
| WS Origin widened | **no** |
| DoD 4 Chinese copy | **user-visible** for `{ type:"chat.error", error:"OVERLAY_STANDBY: …", data:{ error_code:"OVERLAY_STANDBY" } }` `[inspected]` |
| Mapper test vs HTML twin | test hits TS; HTML hand-walked equivalent; grep-only for the page |

---

VERDICT: APPROVE_WITH_NITS
