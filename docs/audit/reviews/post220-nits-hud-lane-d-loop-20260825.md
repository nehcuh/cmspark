# Lane D — Independent adversary: history redact / router nits (post-#220 nits fold + HUD)

**Date**: 2026-08-25  
**Lane**: D (history redact / router nits)  
**Reviewer**: independent adversary — did **not** implement this increment; no production source edits  
**Range**: `d4cbbfae..8f5c94c6`  
**HEAD**: `8f5c94c6325a9bd1081a6cc400062532e81d71ff` (`8f5c94c6 fix(summoner): restyle Windows C-thin HTML to paper HUD workbench`) `[executed]`  
**Base**: `d4cbbfaefe38ce32dd6e0bc771bcab2c32f07c13` (P1 fold already r2 AWN)  
**Frozen patch SHA256**: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` `[executed]` matches `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`  
**Blast**: T2 (Trust-adjacent: 30-day `history.db` + overlay Compose reads). **No escalate to T3** — overlay WS still cannot `knowledge.import` / `mcp.add` / `config.set`; exclusive files add no Allow/Deny chrome.

Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`. Do not treat the implementer session as proof. Do not re-open folded P1s unless this increment **regressed** them.

Exclusive files (this lane):

- `companion/src/history/store.ts`
- `companion/src/message-router.ts`
- `companion/tests/history.test.ts`
- `companion/tests/single/files.test.ts` (read-only: `thread.select` / `knowledge.import` were touched; **0 diff** in this range)

Exclusive diff this range: **+38 / −42** across 3 files (`store.ts` +7/−6, `message-router.ts` +10/−31, `history.test.ts` +23). `files.test.ts` unchanged `[executed]`.

P1 r2 Lane D residuals this increment claimed to fold (from `head-6ce291db-post220-p1-r2-lane-d-loop-20260825.md`):

| ID | Claim | This round |
|----|-------|------------|
| D-N1 | history `evaluate` `result_summary` 200-char cap, not collapse | must-falsify 1 |
| D-N2 | `pin_thread_id` no 32-cap / no `knowledge_selection_mode: "manual"` | must-falsify 2 |
| D-N3 | drain peek/take TOCTOU | **intentionally not folded** — must-falsify 6 HOLD |
| D-N4 | `knowledge.import` handler itself has no summoner deny | must-falsify 3 |
| D-N5 | dead `injectKnowledgeName` + directory comments still claim silent overwrite | must-falsify 4 |

HUD-adjacent add: `thread.select` returns `active_skill_ids` / `active_knowledge_ids` (must-falsify 5).

---

## Capability (ADR-020) — challenge

Implementer claim (shared prompt):

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel + Win C-thin HTML restyle)
L2-classes:   none on HUD; mcp.toggle HTML now rides tray client
Compose:      threads / pack.apply overlay-safe / knowledge USE / skill toggle
Autonomy:     n/a
Trust:        overlay ACL: pack.apply extras stripped; knowledge.import still denied on summoner WS
              HTML restyle is visual only — no new confirm dialect, no Allow/Deny
Channel:      community
```

Lane D challenge (this slice is **Trust persistence + router nits**; HUD CSS/HTML is out of exclusive files):

| Check | Result |
|-------|--------|
| Axes fit | Redact fold is Trust (`history.db`). Pin cap + `thread.select` ID reads are Compose. Drain is Autonomy and **unchanged**. No new Surface tool, no L2-class, no confirm dialect. `[inspected]` |
| New tools / gates / primary UI | **None** in exclusive files. Missing-declaration BLOCK does not apply. |
| Trust monotonicity | Code-tool `result_summary` now always hash-collapsed (stricter than 200-char keep). Overlay import deny added in-handler (defense in depth on top of `SUMMONER_ALLOW`). No `auto_approve_*`, no overlay-as-confirm. |
| originWs | N/A — exclusive files do not grow `securityConfirmations.request`. |
| Overlay T3 | `knowledge.import` / `knowledge.import_directory` return `SUMMONER_ACL` when `stampedSurface === "summoner"` **before** payload load / native picker `[executed]`. Lifecycle allowlist still omits both. C-thin `SUMMONER_WEB_DISPATCH_ALLOW` still omits `knowledge.import` `[inspected]`. Stay T2. |

---

## Method

1. Confirm HEAD `8f5c94c6` + frozen patch SHA256 `[executed]`
2. `git diff d4cbbfae..HEAD` exclusive files + confirm `adapter.ts` / `run-queues.ts` absent from the 21-file range `[executed]`
3. Read live `redactForStorage`, `thread.select`, `knowledge.import*`, `drainNextRun` `[inspected]`
4. Mandated machine (companion cwd, isolated `CMSPARK_DATA_DIR` under `.tmp-adv-nits-hud-d/` so Windows `os.homedir()` cannot touch the user `history.db`):  
   `npx tsc --noEmit`  
   `npx tsx --test tests/history.test.ts tests/single/files.test.ts tests/message-router-nextrun-drain.test.ts` `[executed]`
5. Private probes in `.tmp-adv-nits-hud-d/probe.ts` against **unmodified** production modules `[executed]`
6. Mutation-kill (private copy only): restore 200-char cap in a rewritten `store-mut.ts` → `short-eval-secret` persists `[executed]`
7. Delete `.tmp-adv-nits-hud-d/` after this report. Production files untouched.

---

## Machine `[executed]`

```text
cd companion && npx tsc --noEmit
→ exit 0 (typescript@5.9.3)

cd companion && npx tsx --test tests/history.test.ts tests/single/files.test.ts tests/message-router-nextrun-drain.test.ts
→ tests 138, pass 138, fail 0
   including: HistoryStore.record() collapses evaluate result_summary even under 200 chars
   drain suite green (peek/take path still wired)

private probe .tmp-adv-nits-hud-d/probe.ts
→ tests 11, pass 11, fail 0

mutation: restore 200-char cap on private store copy
→ short-eval-secret PERSISTS (official pin is real)
```

---

## Must-falsify

### 1. evaluate / osascript `result_summary` always hash-collapsed, even <200 chars

`[inspected]` `companion/src/history/store.ts:159-163` — `SENSITIVE_CODE_TOOLS` branch no longer keeps/truncates plaintext:

```text
params = redactCodeParams(params)
result_summary = `<redacted:len=${result_summary.length}:sha256=${shortHash(result_summary)}>`
```

`evaluate` and `osascript_eval` are both in `SENSITIVE_CODE_TOOLS` (`:26-40`). `host_computer` already collapsed on the earlier branch (`:153-158`). The 200-char keep path is **gone**.

| Probe | Persist plaintext? | Evidence |
|-------|--------------------|----------|
| Official `short-eval-secret` on `evaluate` (`history.test.ts:867-888`) | **No** | suite pin passed `[executed]` |
| Live `evaluate` `result_summary: "short-eval-secret"` | **No** | `<redacted:len=17:sha256=16a7f73fb675>`; `history.db` bytes lack the marker `[executed]` |
| Live `osascript_eval` same secret | **No** | same hash-collapse marker `[executed]` |
| Restore 200-char cap on a **private** `store-mut.ts` | **Yes** — `summary= short-eval-secret` | mutation `[executed]` |

**FOLDED.** Replay of `short-eval-secret` does not land in `result_summary` or in `history.db` bytes on the claimed path.

Residual (not a failed fold): `HistoryStore.record` writes `op.error` unredacted (`store.ts:513`). Adapter (`llm/adapter.ts:1286-1289`, out of exclusive) puts failed-eval `toolResult.error` there and leaves `result_summary` empty. Live `error: "short-eval-secret"` **did** persist in the error column `[executed]`. Pre-existing call-site; claimed fold is `result_summary`. Nit.

### 2. `knowledge.import` `pin_thread_id` caps at 32 + `knowledge_selection_mode: "manual"`

`[inspected]` `message-router.ts:2649-2654`:

```text
const ids = Array.from(new Set([...(t.active_knowledge_ids || []), imported.id])).slice(0, 32)
threadManager.update(tid, { active_knowledge_ids: ids, knowledge_selection_mode: "manual" })
```

| Probe | Result | Evidence |
|-------|--------|----------|
| Empty thread, pin one import | `active_knowledge_ids: ["hellopin"]`, mode `"manual"` (was `"auto"`) | `[executed]` |
| Pre-fill 32 ids, pin a 33rd | length stays 32, **old** ids kept, new `imported.id` sliced off, mode still `"manual"` | `[executed]` |
| Overlay stamp on import | never reaches pin (ACL first) | must-falsify 3 |

**FOLDED** for the claimed cap + mode write. `threadManager.update` accepts `"manual"` (`thread-manager.ts:803-807`) `[inspected]`.

Residual: at cap the new id is dropped (keep-old, not rotate) **and** mode still flips auto→manual. Fail-closed on growth, fail-open on “the pin I just imported is active”. Nit. `files.test.ts` does not pin cap/mode (0 diff). Completeness nit; live probe holds.

### 3. `knowledge.import` and `import_directory` return `SUMMONER_ACL` if `stampedSurface === "summoner"`

`[inspected]` both checks run **before** side effects:

- `knowledge.import` `:2638-2640` then `loadKnowledgePayload` (URL fetch / parse)
- `knowledge.import_directory` `:2661-2663` then `pickFolderNative()` (native dialog)

Stamp is lifecycle overwrite (`lifecycle.ts:1053` `stampCmsparkSurface` after allowlist; `stripCmsparkSurface` at `message-router.ts:395`). Client cannot keep a forged `"tray"` on the WS path `[inspected]`.

| Probe | Result | Evidence |
|-------|--------|----------|
| `handleMessage({ type:"knowledge.import", content, __cmspark_surface:"summoner" })` | `{ type:"error", error_code:"SUMMONER_ACL" }`; doc not written | `[executed]` |
| `handleMessage({ type:"knowledge.import_directory", __cmspark_surface:"summoner" })` | same ACL; **no native picker** | `[executed]` |
| Panel (no stamp) `knowledge.import` | `{ type:"knowledge.list", imported.id }` | `[executed]` |

Defense in depth, not the only gate: `SUMMONER_ALLOW` (`summoner-acl.ts:14-45`) still omits both methods; C-thin `SUMMONER_WEB_DISPATCH_ALLOW` omits `knowledge.import` (`summoner-web.ts:19-42`) `[inspected]`. Overlay T3 escalate does **not** fire.

**FOLDED.** P1 r2 D-N4 (handler-level deny) is present.

### 4. `injectKnowledgeName` dead helper is gone; directory comments no longer claim silent overwrite

`[executed]` grep + source read of exclusive `message-router.ts`:

- `function injectKnowledgeName` — **absent**
- call `\binjectKnowledgeName\s*\(` — **absent**
- `"silently overwrite each other"` — **absent**
- directory comment `:2728-2729` now: `nameOverride = vault-relative path so same heading in two folders still allocate distinct stems (allocator suffixes; no overwrite).`

Diff vs base is a 30-line helper deletion plus the comment rewrite (`git diff` hunk after `drainThreadOnSupersede`) `[executed]`.

**FOLDED.** (Out-of-slice leftover: `skill-engine.ts:1452-1454` still narrates silent overwrite as the without-`nameOverride` failure mode. Allocator suffixes even without it. Not exclusive; not scored.)

### 5. `thread.select` returns `active_skill_ids` / `active_knowledge_ids` — overlay-safe reads, not Trust writes

`[inspected]` `message-router.ts:2061-2070` — both arrays are on the return object **outside** the summoner `pending_tools` omit (`:2058-2060`). No `threadManager.update` in this case.

C-thin consumes them: `GET /api/thread` → `dispatchAllowed("thread.select")` (`summoner-web.ts:420`); HUD JS reads `pair[1].active_skill_ids` / `active_knowledge_ids` for toggle chrome (`:1020`, `:1036`) `[inspected]`. Writes stay on `skill.activate` / `knowledge.set_active` (Compose USE), not on select.

| Probe | Result | Evidence |
|-------|--------|----------|
| Panel select after seeding skills+knowledge ids | arrays echoed | `[executed]` |
| Summoner-stamped select | same arrays; `pending_tools === undefined` | `[executed]` |
| Thread JSON before vs after select | **byte-equal** (no write) | `[executed]` |
| `knowledge_selection_mode` stays `"auto"` | no accidental mode flip | `[executed]` |

**FOLDED.** Overlay-safe **read**. Not a Trust write.

Residual: `files.test.ts:283-321` still only asserts messages / `run_status` / `pending_tools`. Does not pin the new fields. Completeness nit; live probe holds.

### 6. #221 drain / leftover HOLDs — exclusive drain path unchanged or still HOLD

Intentionally **out of slice**: D-N3 drain peek/take TOCTOU.

`[executed]` range file list: **no** `companion/src/llm/adapter.ts`, **no** `companion/src/llm/run-queues.ts`. Frozen patch has zero adapter / run-queues hunks.

Exclusive `message-router.ts` drain:

- `drainThreadOnSupersede` body **unchanged** (`:189-197`); the only adjacent hunk **deletes** dead `injectKnowledgeName`.
- `drainNextRun` (`:268-324`) still `peekNextRunCount` (`:275`) **then** gate pre-check **then** `takeNextRun` (`:317`). Recursive `handleMessage(followUpCreateFromQueue(...))` still after take. D-N3 window remains.

Mandated `tests/message-router-nextrun-drain.test.ts` **passed** as part of 138/138 `[executed]`. That is evidence the drain path still works, not evidence the TOCTOU is gone.

**HOLD** as specified. Not a regression of #221 leftover/drain. Not folded.

---

## Residuals (none meet T3 / REJECT)

| ID | Finding | Class |
|----|---------|-------|
| D-N-err | Failed `evaluate` `error` column still stores plaintext (`store.ts:513`; adapter writes `toolResult.error`). `result_summary` fold holds. | nit — pre-existing parallel column |
| D-N-pin-at-cap | 33rd pin is sliced off (keep-old) while `knowledge_selection_mode` still becomes `"manual"`. Cap honored; pin intent dropped. | nit |
| D-N-files-tests | `files.test.ts` exclusive was **read**, not updated: no pin of select ID fields, pin cap, or handler ACL. Official `history.test.ts` **does** pin MF1. | test completeness nit |
| D-N-osa-official | Official suite pins `evaluate` only; `osascript_eval` live-probed. | completeness nit |
| D-N-comment-scope | Comment names evaluate/osascript; code collapses **all** `SENSITIVE_CODE_TOOLS` (Trust-monotonic). | comment nit |
| D-N3 | peek then take still in `drainNextRun`. Explicitly not folded. | HOLD |

Intentionally **not** REJECT: error-column leak (unclaimed); at-cap keep-old; test gaps filled by live probe.

---

## Scores

| Axis | Score | Note |
|------|-------|------|
| Outcome | **Hold claimed folds** | MF1–MF5 `[executed]` + MF1 mutation-kill. MF6 HOLD as specified |
| Trajectory | **Clean** | Exclusive +38/−42; dead helper deletion is the right shape; no adapter/run-queues drive-by |
| Component | **Two hotspots** | `redactForStorage` code-tool branch (`store.ts:159`). `knowledge.import*` ACL+pin (`message-router.ts:2637-2654`). Drain hotspot unchanged |

---

## Eval gate card — `post220-nits-hud` Lane D

**Blast tier**: T2  
**Capability**: Surface L0 · L2 none · Trust tighter history collapse + overlay import deny in-handler · Compose `thread.select` ID reads · Channel n/a this lane

| Gate | Result |
|------|--------|
| MACHINE | **PASS** — `tsc --noEmit` 0; 138/138; 11/11 live probes; 200-cap mutation kills the official pin |
| ADVERSARY | **APPROVE_WITH_NITS** (this report) |
| PI_REREVIEW | N/A this lane |
| MERGE | Not this agent's call. No T3. Nits are error-column / at-cap pin / test completeness / intentional drain HOLD. |

Private `.tmp-adv-nits-hud-d/` copies deleted after this report. Production files untouched.

VERDICT: APPROVE_WITH_NITS
