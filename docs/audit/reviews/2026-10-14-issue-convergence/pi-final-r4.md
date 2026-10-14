# Final independent Pi rereview — convergence wave r4 (base 6594c053)

## Method / what I actually did

- Read `review/context-r4.md` end-to-end (all 14,315 lines: machine card, 39-file manifest, source-identity proof, CI/Office/Cooperation/Availability diffs, full numbered sources, all implementer records, native-Office diagnosis, #576/#577 acceptance, and all three model-eval JSONs), plus `machine.json`, `manifest.json`, `review/source-identity-proof-r4.json`.
- Read in full: `adversary-office-r2.md`, `adversary-cooperation-r2.md`, `adversary-ci-availability-r2.md`, `adversary-ci-r3.md`, `adversary-ci-r4-test-delta.md`, `kimi-r2.md`, `kimi-r3.md`, `kimi-r4-listener.md` (and kimi-r4-listener stderr). `review/pi-final-r4.md` is empty.
- Verified actual frozen-repo bytes directly (`repo/…`) for the paths the review turns on: `mcp/manager.ts`, `mcp/stdio-transport.ts`, `mcp/client.ts`, `orchestrator/fleet-assessment.ts`, `llm/adapter.ts` (`rebuildMessagesFromHistory`), `odf-expansion.ts`, `skills/skill-engine.ts`, `voice/local-stt-adapter.ts`, `tests/integration/allow-dir-reconnect.test.ts`, `companion/package.json`, `docs/office-import-contract.md`. All match the frozen numbered source/diffs.
- **Tooling limitation, stated honestly:** this Pi session exposes only `read`/`grep`/`find`/`ls` — no shell. I could not independently recompute SHA-256 or run any test/build/CI. Machine counts in the card (host 5901/5849/52, front 1527, MCP 483/472/11, delta 4, Linux ARM 233/103+4, both builds 0) are therefore **recorded root machine inputs**, not re-run by me. Source-level identity is corroborated by the independent rehash work in kimi-r4-listener stderr (test `25a07a77…`, `client.ts 03abdd97…`, `manager.ts 96e37fea…`, `stdio 909df9cb…`, `agentStore.tsx 89aba9e1…`) and the r2/r3 adversary rehash reports, all consistent with `manifest.json`.

## Adversary/Kimi conclusions — confirmed or rejected

| Conclusion | Status |
|---|---|
| Office r2 **APPROVE** (component) | **Confirmed.** Office group byte-identical r2→r4; the three separation claims hold in actual bytes. |
| Cooperation r2 **APPROVE_WITH_NITS** | **Confirmed.** 8 hashes unchanged r2→r4; #621 comparison is field-exact, #576 hint is prompt-level. |
| CI/Availability r2 **REJECT CI r2 (P1)** | **Confirmed and now resolved.** The P1 (`prior.close().catch(()=>{})` + delete + replace) was real; r3 closes every named hole at the production boundary. |
| Availability r2 **APPROVE #491/#486** | **Confirmed.** #486 browser hook row was independently supplied. |
| CI r3 **APPROVE** | **Confirmed** at the frozen hashes; r2→r3 P1 negative-to-positive invariant is real. |
| CI r4 test-delta **APPROVE** | **Confirmed** by direct read of `allow-dir-reconnect.test.ts:47-54,85,89`. |
| Kimi r2 **APPROVE_WITH_NITS** (2 client P2s) | **Confirmed**; both client P2s are fixed in r4 (`client.ts:288-291` dedupe, `:215-227` cause chain). |
| Kimi r3 **P1 dormant floating promise** | **Confirmed real**, and **fixed in r4** — original promise is captured and awaited. |
| Kimi r3 **agentStore one-nibble mismatch** | **Rejected/withdrawn** — correct. Actual `agentStore.tsx = 89aba9e1…db807` equals manifest; `tracked_diff_sha256` vs `review_complete_diff_sha256` are intentionally different artifacts (tracked-only vs complete including untracked new files, whose diff headers carry absolute paths). |

No adversary conclusion is contradicted by the actual source.

## Five real paths

1. **Protocol close ≠ process receipt — PASS.** `stdio-transport.ts:122-141`: deadline destroys streams, emits `onerror`, invokes `onclose` once (settles SDK RPCs), **and rethrows** `McpStdioTeardownError`; `client.ts:158-164` fences `_closing`+error without emitting `disconnected`, and `:296-306` keeps the transport. Confirmed.
2. **Manager failed ownership admits no replacement — PASS.** `manager.ts:295-315` (`retireClient` tombstone: entry installed before close, timer cleared, authority revoked/aggregation dropped first, only success deletes), `:197-201` (same-name start awaits the original promise/rejects), `:267-293` (stop doesn't delete-before-close), `:90-95` (shutdown keeps failed receipts), `:352` (`scheduleRestart` fenced), `:598` (`waitForServerReady` fails promptly). Confirmed.
3. **Metadata ≠ model/knowledge body — PASS.** `adapter.ts:692-713` builds document XML from `file.content`; `:722-741` warning only into `files` metadata; `rebuildMessagesFromHistory` (`adapter.ts:437-457+`) emits user messages as `{role,content}` only; `message-router.ts:1033,1797,3935,4076` pass warning as a side field; `thread-manager.ts:263-264` persists it separately. Confirmed.
4. **XML budgets untouched — PASS.** `odf-expansion.ts:208-217` only wraps DOM construction in try/catch→fixed Chinese refusal; `MAX_COLUMNS/MAX_NODES/MAX_TEXT/MAX_DEPTH` and all accounting/namespace/chart branches are unchanged and outside the catch. Confirmed.
5. **No fabricated entity — PASS on the fixed corpus, prompt-enforced not structural.** `fleet-assessment.ts:8` forbids guessing/worker-first-identification/future parent output; `parseFleetAssessment` (`:27-43`) structurally rejects malformed/tool-illegal/duplicate plans but cannot by itself detect a missing entity — that is the model's job. r3 manual inspection of `mixed-api` shows the competitor goal replaced by “不针对特定公司” industry goals. Confirmed as scoped.
6. **Cache + voice stale-generation — PASS.** `skill-engine.ts:479-521,559-583`: computation failure sets index `null`; persistence failure keeps the computed index, marks dirty, retries only when the **current** fingerprint matches, clears dirty on genuine disk load/rebuild. `local-stt-adapter.ts:480-523,826-856`: readiness callback fires only after the acquired handle passes the generation/cancel re-check; late/old handles are aborted without waking a replacement. Confirmed.

## DoD / closure evidence

- #614/#616 implemented with producer fixture and router admission tests; #615 Chinese DOM refusal + synthetic real-producer probes implemented, but the **authorized large multi-sheet business corpus is still externally blocked** — keep #615 open (or an explicit open child).
- #576/#577 main runtime already on main (per acceptance doc; not git-verified here). #576 semantic repair + same-model r3 (8/8, 0 FP, 0 unevaluated, both added semantic cases) supports bounded closure; #577's DoD does not require replaying the missing `vw2ob1` trace. The r1 semantic failure and r2 machine failure are preserved, not re-labelled.
- #619: real React/reducer/DOM harness replaces JSX-child event calls; **no performance/memoization claim** — the StatusRail O(n) observation stays deferred pending measurement.
- #621: only the semantic recovery comparison is implemented; **NaN/Infinity/-0 non-JSON CDP encoding remains deferred** — keep #621 open with explicit remainder.
- #618/#626 external T4 acceptance remains incomplete.

## Ranked findings (code-level; none blocking)

1. **N1 — documentation/reproducibility (Office).** `repo/companion/package.json:42` declares `"officeparser": "^7.2.3"` while `docs/office-import-contract.md:27` and odf-expansion test comments treat the producer as “locked.” `package-lock.json` pins the CI build, so gates are deterministic, but a plain `npm install` can drift to a 7.x minor that changes the very producer quirks the #615 tests encode. Recommend pinning the resolved version (or asserting it in the probe).
2. **N2 — operational, accepted design (CI).** `repo/companion/src/mcp/manager.ts:295-315` + `:197-201` + `:598`: a single 1 s owned-teardown deadline makes the named server permanently unusable for the process-singleton lifetime (`manager.ts:616-619`); the only remedy is a Companion restart and the UI shows only a generic error row. This is the intended conservative “unknown teardown cannot admit replacement” contract (kimi-r3 P2), not a defect — but it deserves a follow-up/operator-visible reason.
3. **N3 — diagnostics (Availability).** `repo/companion/src/skills/skill-engine.ts:479-489`: only the first cache-write failure is logged; subsequent failures are silent until a successful persist, so operators may believe the cache recovered.
4. **N4 — contract wording (Office, pre-existing).** `repo/companion/src/message-router.ts:1792` still appends the render-only vision page-coverage warning into model-visible content. This is the deliberate pre-#614 evidence path (not ordinary conversion metadata), but the README/contract “never model/document body” wording reads broader than the behavior. Confirm intent in the closure note.
5. **N5 — hypothetical resilience (Office UI).** `repo/chrome-extension/src/sidepanel/hooks/useWebSocket.ts:475-476`: a `files`-only `chat.user` frame (empty content, no attachments) would be dropped by the empty-content guard. Unreachable with current producers (content always non-empty), but a future notice-only frame would be silently lost.
6. **N6 — evidence strength (Cooperation).** `repo/companion/scripts/fleet-assessment-eval.cjs:62-65` counts any `status==="suggest"` as a positive regardless of subtask semantic validity; only manual reading plus the two added semantic cases guard against a fluent-but-fabricated proposal. r3 inspection supports the result — keep that manual read in the closure evidence.
7. **N7 — benign (CI).** `repo/companion/src/mcp/manager.ts:166-179` soft-update can call `updateConfig` on a tombstoned client; it cannot re-authorize or spawn (isCurrentClient excludes retiring), so impact is nil.

## VERDICT: **APPROVE_WITH_NITS** (codegate only)

All previously confirmed P1s are fixed and independently verified; there is no remaining code-level P0/P1. N1–N7 are non-blocking nits/observations; #615 external corpus, #621 non-JSON encoding, and #618/#626 T4 remain open and must not be closed by this wave.

**Merge is not authorized.** Required before merge, in order: (1) exact **new-head CI including native Windows** on the frozen 39-file head; (2) then exact **main CI** after landing. No source was edited and no pending CI is claimed as already passed by this review. The machine card's host/Linux/focused results are accepted as root-recorded inputs; my verdict is a source/diff code gate, not a machine-gate substitute.
