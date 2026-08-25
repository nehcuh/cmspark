# Independent adversary r2 — Lane D (LLM loop / message-router / persistence redact)

**Role**: Lane D r2 — INDEPENDENT ADVERSARY (did not implement #221, #222, or the knowledge wrap; do not rubber-stamp r1 AWN)
**Prior**: `docs/audit/reviews/head-6ce291db-post220-lane-d-loop-20260825.md` → **APPROVE_WITH_NITS**
**HEAD**: `6ce291db1c14b72823e26905df32bfe7d498c7e7` (`feat: knowledge honesty Wave 0–2 + overlay HUD workbench compose (#222)`)
**Base**: `1d16b0ed` (PR #220 squash MERGED)
**Range**: PR #221 (`ac0a3be0`) + PR #222 (`6ce291db`) + live worktree knowledge wrap (`importKnowledge` suffix-on-collision)
**Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`
**SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` `[executed]` `Get-FileHash SHA256` (matches)
**Exclusive files only.** Default REFUTED until `file:line` + `[executed]` / `[inspected]`.

Replay of #221 HOLDs and #222 router claims **after** `importKnowledge` identity wrap (F-I-5 suffix, Lane B / `skill-engine.ts`, **out of exclusive range**). This lane inspects `message-router.ts` `importKnowledge` **call sites only**.

---

## Capability check (ADR-020)

Exclusive files vs last commit: **empty** `[executed]` `git diff` (no numstat). Overlay ACL / loop / redact SoT is unchanged from r1.

| Axis | Live (this lane) | Challenge |
|------|------------------|-----------|
| Surface | L0 chat loop + overlay-stamped `pack.apply` / `knowledge.set_active` | Unchanged. `[inspected]` |
| L2-classes | (none new). Drain still `gateChatCreateOnConductor` before take (`message-router.ts:336-337`). | HOLD. Overlay success drain does not skip CU conductor. `[executed]` S-B2 conductor test |
| Compose | knowledge (`set_active` filter+cap; distill preview; `retrieved_sources` ledger); pack (`pack.apply` overlay branch) | Pack-first preserved. Wrap does not add a router write path. |
| Autonomy | nextRun leftover / drain pre-check | Not a second runtime. |
| Trust | overlay `pack.apply` **forces** `allowTrust: !overlayApply` (`:3037`); summoner `knowledge.import` is **not** gated inside this handler (lifecycle ACL is SoT, out of range) | Overlay cannot elevate Trust B via `pack.apply`. No new confirm family. No `auto_approve` skip in these handlers. `[inspected]` |
| Channel | community | HOLD |
| originWs | no new `securityConfirmations.request` in exclusive files | HOLD |
| Confirm dialects | `pack.apply` reuses `user_gesture`; distill is preview-only | HOLD. Parked `knowledge.import` `user_gesture` 400 is **out of slice**. |
| Blast | T2 compose/redact. Not T3: overlay socket cannot `mcp.add`/`knowledge.import`/`config.set` **from this lane’s handlers + stamped surface**. | Do not escalate. Suffix wrap does not add overlay write. |

**Trust monotonicity**: overlay `pack.apply` cannot write Trust B (`allowTrust: false` + `forceTakeover: false` + `confirmation_phrase` stripped). Overlay `knowledge.set_active` only pins **already-imported** docs after `listKnowledge()` filter. `[inspected]`

---

## MACHINE

Cwd: `companion/`. `[executed]` 2026-08-25.

| Command | Result | Notes |
|---------|--------|-------|
| `git diff` exclusive 7 src + 7 test paths vs `6ce291db` | **empty** | Adapter `retrieved_sources` path **not** broken by wrap (wrap is `skill-engine`, out of range) |
| `node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` | **PASS** exit 0 | Local companion tsc is SoT |
| `npx tsx --test tests/adapter-steer-overflow.test.ts tests/tool-batch-heal.test.ts tests/run-queues.test.ts tests/message-router-nextrun-drain.test.ts tests/orchestrator-l2-flight.test.ts tests/tool-persistence-redact.test.ts tests/history.test.ts` | **PASS** 138/138 | 0 fail. Exclusive suite green at live HEAD + wrap worktree |
| MUT S-A2 (`now.some` global skip, copy under `.tmp-adv-r2-d/` then deleted) | **RED** `0 !== 1` | Pins in-tree S-A2: global first-id skip persists 0 fillers |
| MUT S-A3 (queue-full leftover `dropSteer`, copy then deleted) | **RED** successor `[]` vs `{text, cm-conc}` | Pins leftover must **not** wipe post-take steer |
| MUT S-D1 (strip `passwd` from regex, copy then deleted) | **RED** `hunter2-secret` leaked | Pins `passwd` in `SENSITIVE_KEY_RE` |
| MUT S-D2 (restore string-only leaf, copy then deleted) | **RED** `array-secret` leaked | Pins array/numeric sensitive leaves |
| MUT drain (`return drainedAfterUpload` on copy) | **LIVE KEEP** / **MUT would replace RPC** | Live `doesNotMatch /return drainedAfterUpload/`; copy matches |
| LIVE private probe: `Authorization` header + `passwd` on thread-JSON **and** `history.db` | **PASS** 2/2 | Values gone; generic `value` kept |
| LIVE private probe: `history.db` `evaluate` short `result_summary` | **PASS as nit** | `short-eval-secret` **lands** (200-char class, not thread-JSON collapse) |

Worktree except this report: no production source edits; `.tmp-adv-r2-d/` mutation copies deleted.

---

## HOLD scorecard (#221 replay at live HEAD + wrap)

Default was REFUTED. Status below is after `file:line` + machine.

| ID | Claim | Status | Evidence |
|----|--------|--------|----------|
| **S-A1** | `nextRun` is `{text, clientMessageId?}`; leftover join keeps first id; occupied enqueue echoes | **HOLD** | `run-queues.ts:16-19,47-56,83-84` leftover `.find` first present. Adapter mid-run same rule `adapter.ts:912`. Occupied enqueue `message-router.ts:513-517`; drain `followUpCreateFromQueue` `:268-283` + `:350`. `[executed]` `run-queues.test.ts` two-id `cm-a` not `cm-b`; drain test `cm-enq-1` echo. **Wrap did not touch exclusive files.** |
| **S-A1 leftover / queue-full** | leftover `takeSteer` then queue-full must **NOT** `dropSteer` (wipes successor) | **HOLD** | `convertLeftoverSteerToNextRun` `:78-88` — failed enqueue returns `{dropped}` only; **no** `dropSteer`. Adapter finally `adapter.ts:1764-1774` warns; comment forbids wipe. Adapter has **zero** `\bdropSteer\b` (import is `convertLeftoverSteerToNextRun, takeSteer` only `:43`). `[executed]` in-tree S-A3 unit + adapter source pin; MUT dropSteer **red** (successor `[]`). |
| **S-A2** | persist/heal skip scoped to in-flight assistant contiguous tool block (`assistantId`), not first-id-global | **HOLD** | `tool-batch-heal.ts:168-190` — `asstNow` via `assistantIdResolved`; `blockUntil` walk; `now.slice(asstNow+1, blockUntil).some`. In-flight call `adapter.ts:861` passes `savedAssistantId`. `[executed]` in-tree S-A2 test; MUT `now.some` **red** (`n=0`). |
| **S-B1** | drain pause/trash/**cap** BEFORE `take`. Gate-rejected drain `sendToExtension` error and **KEEP** `file.uploaded` / create success | **HOLD** | `drainNextRun` `:313-347`: not-found / `trashed_at` `:317` / `paused` `:325` / lease `:334` / conductor `:336` / `canAcquireMultiAgentLlmLoop` `:338` **all precede** `takeNextRun` `:347`. Upload `:1244-1248` `sendToExtension(drained)` then **unconditional** `return { type: "file.uploaded" }` (in-tree `doesNotMatch /return drainedAfterUpload/`). Create gate-error `:704-707` `sendToExtension` + `return null`. `[executed]` pause+trash+upload overlay-reject tests; MUT copy would `return drainedAfterUpload`. |
| **S-B2** | regen overlay + conductor still gated | **HOLD** | Regen entry lease/conductor `:1426-1429`; drain pre-check same gates before take. Regen RPC stays `null` (`:1590-1594` never `return drainedAfterRegen`). `[executed]` overlay-rejected regen keeps queue; summoner + CU-live → `L2_CONDUCTOR_ELSEWHERE`, queue 1. |
| **S-D1** | `Authorization`/`Bearer`/`apiKey`/`passwd` redacted; generic `value` not globally wiped; arrays/numbers handled; history.db same regex+leaf | **HOLD** | Thread-JSON `tool-persistence-redact.ts:37,43-77`; history `history/store.ts:49,57-93` — same `SENSITIVE_KEY_RE` + leaf (string / number / boolean / array map / object collapse). Cookie extra keys: thread-JSON `redactSensitiveKeysDeep` then `value` hash (`:209-216`); history params `redactCookieParams` `:192-204`. `[executed]` in-tree S-D1/D2/D3 + N-D1; LIVE probe `headers.Authorization=Bearer …` + `passwd` gone on **both** paths; `value: keep-visible` kept. MUT strip `passwd` **red**. |
| **S-D2** | `plainErrorResult` reconstructs without extra keys; code-tool `data` always collapsed | **HOLD** | Reconstruct `:167-181` (fresh `{success,error,error_code?}`; `data !== undefined` bails). Code-tool `:239-266` always `{redacted,len,sha256}` when `data` present — even `<200` chars. `[executed]` `plainErrorResult drops extra keys` (`stdout`/`stack` gone); `evaluate data payload is always collapsed`. MUT string-only leaf **red**. |

---

## #222 router / adapter handlers (must-falsify) + wrap identity

| Claim | Status | Evidence |
|-------|--------|----------|
| Overlay `pack.apply` forces `allowTrust false` + overlay-eligible + forbidden fields + `user_gesture` server-side | **HOLD** | `user_gesture !== true` → `user_gesture_required` (`message-router.ts:2992-2997`). `overlayApply = stampedSurface === "summoner"` `:3004`. Forbidden `workspace_path` / `force_takeover` / `confirmation_phrase` `:3006-3011`. `isOverlayEligiblePack` `:3017-3022`. Trust cookie present `:3025-3030`. `allowTrust: !overlayApply` `:3037`; `forceTakeover` forced false `:3034`; phrase/workspace stripped `:3036-3039`. Stamp is lifecycle overwrite (`stripCmsparkSurface` at `:425`); not a client-spoofable field **when** the WS path stamps. `[inspected]` |
| `knowledge.set_active` filters ids against `listKnowledge()` and caps | **HOLD** | `:2648-2652` — strings only, `.slice(0, 32)`, `known = listKnowledge().map(d => d.name \|\| d.id)`, `ids.filter(known.has)`. `[inspected]` |
| Distill confirm-import does not auto-write | **HOLD** | Only `thread.distill_preview` (`:2056-2072`) — `distillThreadMarkdown` then return markdown. **Zero** `importKnowledge` on this path. Persist is a later `knowledge.import` (UI confirm). `[executed]` probe `distillWrites: false`. `[inspected]` |
| `retrieved_sources` ledger is server-authored, not model footnotes | **HOLD** | Exclusive `adapter.ts` **unchanged** vs `6ce291db`. `:500-502` from `skillEngine.buildSystemPromptWithSources` only. Persisted on no-tool assistant `:1054-1056`; echoed on `chat.done` `:1127`. Adapter `retrieved_sources` hits = those four + the persist/echo guards. `extractKeyTerms` `attrRe` (`:175`) is CSS-attr matching for site_knowledge, **not** a footnote parser into the ledger. No parse of assistant `content` into `retrieved_sources`. Wrap lives in skill-engine (out of range). `[inspected]` + `[executed]` empty exclusive diff |
| No confirm skip / `auto_approve` path in these handlers | **HOLD** | `knowledge.import` / `set_active` / `distill_preview` / overlay `pack.apply` do not read `auto_approve_*` or skip L2. Overlay Trust write is structurally impossible (`allowTrust` false). `[inspected]` |
| `importKnowledge` now suffixes collisions; router callers must **not** assume overwrite | **HOLD** | Three call sites, none upsert-by-title / delete-then-write. (1) `knowledge.import` `:2673-2683` — `nameOverride` is `undefined`; uses **returned** `imported.id` for `pin_thread_id` append + `Set`; RPC returns `{ type: "knowledge.list", docs: listKnowledge(), imported }`. Probe `assumeOverwriteInImport: false`, `usesReturnedId: true`. Re-import of the same ASCII heading now pins a **new** id (fail-open vs silent replace). (2) `knowledge.import_directory` `:2760/:2766` — `nameOverride=relPath`; ignores return except `imported++`; does not look up existing heading to replace. (3) distill: zero calls. Dead `injectKnowledgeName` (`:209`) is **never called** (probe `injectFnUsed: false`). `[executed]` caller probe + `[inspected]` |

---

## New defects from wrap / r2 (exclusive files)

None blocking. Nits (r1 roll-forward + wrap-adjacent):

1. **D-N1 (pre-existing class, re-executed)** — `history/store.ts:159-164` still **truncates** code-tool `result_summary` at 200 chars; does **not** collapse. LIVE probe: `evaluate` result `"short-eval-secret"` **persists** in `history.db`. Thread-JSON S-D2 collapse HOLD is a different store. Not a #221 regression; do not reopen S-D2. `[executed]`
2. **D-N2 (#222, slightly hotter after wrap)** — `knowledge.import` `pin_thread_id` (`message-router.ts:2674-2679`) appends `imported.id` with **no 32-cap** and no `knowledge_selection_mode: "manual"`. After suffix wrap, a second HITL import of the same heading yields a **new** id, so the pin set **grows** instead of `Set`-collapsing on overwrite. Overlay still cannot reach this handler via summoner ACL (out of range). Fail-open vs `set_active` cap. Not Trust B. `[inspected]`
3. **D-N3** — cap is peeked before take (`:338-347`) but recursive `chat.create` `tryAcquire` still runs **after** take. A same-tick fill of `MULTI_AGENT_LLM_CAP` can drop an already-dequeued nextRun. Rare. Source-order test does not kill this window. `[inspected]`
4. **D-N4** — `knowledge.import` handler itself has no `stampedSurface === "summoner"` deny. Production deny is `assertSummonerAllowed` (out of exclusive range). Defense-in-depth gap only if `handleMessage` is invoked without lifecycle. `[inspected]`
5. **D-N5 (wrap-stale comments / dead helper)** — `injectKnowledgeName` (`:199-227`) is dead. Its comment and the `import_directory` comment (`:2750-2755`) still describe **silent overwrite** as the failure mode. Live allocator suffixes even without the helper. Stale comment only; callers do not implement overwrite. `[executed]` probe `injectFnUsed: false`.

Parked Wave 0b (`knowledge.import` `user_gesture` server 400) — **out of slice**, not scored.

---

## Confirmed-safe

- Exclusive paths vs `6ce291db`: empty. Adapter `retrieved_sources` still Companion-authored from `buildSystemPromptWithSources`; wrap did not splice a footnote parser into `adapter.ts`.
- Leftover `{text, clientMessageId}` + first-id join; queue-full drops **only** that leftover; successor steers survive. Adapter finally does not `dropSteer`.
- Heal skip is in-flight contiguous tool block; older reused `call_*` does not skip the newest unpaired assistant.
- Drain pause/trash/cap/lease/conductor all before `takeNextRun`. Upload/regen never replace the original RPC with a drain frame.
- Regen overlay-standby + overlay CU conductor keep the queue.
- Redact: `passwd` / `Authorization` / `Bearer` / `apiKey`; array + numeric + object bags; generic `value` kept; `plainErrorResult` reconstruct; code-tool data collapsed on **thread JSON**.
- History MCP params use the same regex+leaf (LIVE `Authorization` header + `passwd`).
- Overlay `pack.apply` cannot write Trust B; `set_active` cannot pin unknown ids; distill preview does not write.
- Router `importKnowledge` callers do **not** assume overwrite after F-I-5 suffix: HITL import consumes returned `id`; directory import keys uniqueness on vault-relative `nameOverride` and counts writes, not title replace.

#221 HOLDs **did not regress** under #222’s adapter `retrieved_sources` splice, router knowledge/distill/pack edits, or the subsequent `importKnowledge` identity wrap.

---

VERDICT: APPROVE_WITH_NITS
