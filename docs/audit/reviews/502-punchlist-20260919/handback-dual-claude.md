Review complete. All probes and tests were run in a scratch dir and cleaned up; no source files were touched.

---

# Dual re-review (claude)
HEAD: dba48161 + uncommitted collect_handback diff

Scope: classification + copy + premature-collect gate on `collect_handback` (incident 3r2frm / worker 286ryj: math `{ C_n(X) + F_n(...) }` in a ~10k C2C report was brace-extracted and JSON.parse'd 鈫?misleading `handback JSON parse failed`). Board still rejects prose with `success:false`; ADR-016 intact.

## Per-claim

- **C1 incidental braces 鈫?FIXED** 鈥?`companion/src/board/schema.ts:335-348`. The `JSON.parse(candidate)` catch now returns `prose-only handback; no JSON structure` (same code `HANDBACK_MISSING_STRUCTURE`) instead of `handback JSON parse failed`. The comment at :338-341 is accurate: `extractFirstJsonObject` (:398-427) only ever returns a *balanced* fragment or `null` 鈥?an unclosed truncated object never returns to depth 0, so it takes the null 鈫?prose-only branch, never this catch. The catch is reachable only for balanced-but-invalid JSON (math fragments), which is genuinely prose. **[executed]** probes: unclosed `{"schema_version":1,"facts":[{"claim":"partial` 鈫?prose-only, not accepted; prose containing a valid *non-handback* object (`{"answer":42}`) 鈫?rejected by `HandbackPayloadSchema` (`schema_version` literal gate); fenced ```json``` with incidental math braces in surrounding prose 鈫?still parses (existing test `prefers fenced JSON over incidental braces` passes). Truncated *fenced* JSON 鈫?`fenced JSON present but not a valid handback object`. Nothing silently accepted.

- **C2 in-flight gate 鈫?FIXED** 鈥?`companion/src/board/service.ts:798-813` (`workerLooksInFlight`), gate at :873-892 placed **before** `ensureBoard` (:894-909). Returns `WORKER_STILL_RUNNING`, `recoverable:true`, `data.suggested_action:"wait_workers"`, audits `board.handback_rejected`. No mutation anywhere 鈥?the function reads worker messages and writes only the host board; siblings are untouched by construction. **[executed]** ordering probe: phase 1 (live worker) 鈫?reject with `board: null` (gate does not init the board); phase 2 (same worker finishes with fenced JSON) 鈫?`success:true`, fact merged, board created 鈥?so yes, a later successful collect still inits the board. The false-positive attack fails: failed tools persist `result: {success:false,鈥` (`adapter.ts:1945/2204`, INTERRUPTED/aborted fillers in `tool-batch-heal.ts:101-120,211-215`) 鈥?`result: null` rows and `status:"running"` rows **never exist in companion thread storage** (rows are appended only post-execution; `status:"running"` is a live-UI shape only). The branch that actually fires in practice is the assistant one (`finish_reason:"tool_calls"` or absent on a trailing tool_calls assistant). See N-3 for the one residual stale-in-flight state.

- **C3 prose copy 鈫?FIXED** 鈥?`service.ts:951-965`. `prose` requires `error_code === HANDBACK_MISSING_STRUCTURE` **and** non-empty string content; every other `applyHandbackPayload` failure keeps the precise zod error. Empty/whitespace content is caught earlier at :911-930 with its own honest message. Other workers unaffected is true (no cross-thread writes). **[executed]**: strengthened assertions in `board-collect-handback.test.ts:140-142` pass; copy matches claim 3.

- **C4 UI hint vs archive stub 鈫?FIXED** 鈥?`ChatView.tsx:1072-1078` reads **top-level** `result.error_code`, gated on `result.success === false` (:1066). **[executed]** stub probe: `archiveToolPayload("collect_handback", 鈥? persistFull=false)` on a `WORKER_STILL_RUNNING` failure envelope 鈫?`{success:false, error(鈮?00), error_code:"WORKER_STILL_RUNNING", data:{suggested_action:"wait_workers"}, redacted:true, len, sha256, omission:"archive"}` 鈥?`stubFailureResult` keeps `error_code` (`tool-persistence-redact.ts:361`) and machine `data` keys (:362-369), drops the 10k `last_assistant` body. So the hint fires live **and** after reload, and the report body does not hit disk. `data.user_hint_zh` preference (:1068-1071) doesn't collide (collect failures carry none).

- **C5 catalog 鈫?FIXED** 鈥?`tool-definitions-catalog.json:1252` is the single SoT (imported by `tool-definitions.ts:5`); description now warns not to collect while live and names both error codes. Params (`worker_id` required, `expect_structured`) unchanged and match the executor `companion-dispatch.ts:664-705` (鈫?`forceStructured`). Lock-step holds; one copy drift noted in N-1.

## New findings (only if grounded)

### N-1 鈥?NIT
- File: `companion/src/bridge/tool-definitions-catalog.json:1252` vs `companion/src/board/service.ts:859-861`
- Evidence: [inspected]
- Failure mode: the new catalog sentence is unconditional ("Do not call while that worker is still running 鈥?that returns recoverable WORKER_STILL_RUNNING"), but the gate sits *behind* the board-mode early return 鈥?board-off collect of a live worker still returns `success:true` with the mid-round `last_assistant` (ADR-015 free-text compat). Copy overclaims for the board-off case; behavior itself is pre-existing and intended.

### N-2 鈥?NIT
- File: `chrome-extension/src/sidepanel/components/ChatView.tsx:1072-1078`
- Evidence: [inspected]
- Failure mode: the two new Chinese hint strings have no unit test (and the hint function is component-embedded, consistent with every other hint branch there 鈥?sandbox/cookie/tool_not_allowed are equally untested). A future reword or reordering of the `dataHint` preference could silently break the honesty copy. Matches surrounding convention, so non-blocking.

### N-3 鈥?NIT (residual state, not introduced by the gate)
- File: `companion/src/board/service.ts:809-811`
- Evidence: [inspected]
- Failure mode: after a hard companion kill mid-tool (no result row, no entry heal yet), the trailing tool_calls assistant makes the gate report `WORKER_STILL_RUNNING` for a worker that is dead, not running 鈥?until that worker's next run entry-heals INTERRUPTED fillers. Recoverable (rerun heals; orchestrator still receives the partial content via failure `data.last_assistant`), and strictly more honest than the old behavior of parsing a mid-round assistant as a final handback. Related observation: the new test fixture (`board-collect-handback.test.ts:112-115`, `status:"running", result:null`) exercises a shape that never occurs in companion storage 鈥?the branch is defensive-only; harmless but slightly misleading as documentation.

## ADR-020

- **Surface**: L0 鈥?tool-card hint copy + tool-result classification; no new UI chrome, no new tool.
- **L2-classes**: none 鈥?no new confirmation family, no gate bypass; `collect_handback` stays non-L2.
- **Compose**: composes existing Fleet (ADR-015) / MissionBoard (ADR-016) surfaces; no second runtime.
- **Autonomy**: no new arm 鈥?the gate explicitly does not stop workers; collect only reads worker messages and writes the host board.
- **Trust**: unchanged/monotone 鈥?board mode still requires structured Fact/Intent JSON, prose rejected `success:false`, provenance/trust stamping untouched; archive stub actually *reduces* persisted failure bodies to diagnostics + fingerprint.
- **Channel/Blast**: community / T1. Declaration block in the prompt matches the diff. No originWs / god-mode / P1-watchlist surface touched.

## Notes

Verification: [executed] `tsc --noEmit` clean; 66/66 pass across `board-{schema,service,complete,intent-claim,collect-handback}` + `fleet-latest-tool` (includes the 2 new tests and the strengthened prose-copy assertions); 7 adversarial probes on parse/gate/stub all behave as claimed. Working tree left untouched (probe files removed). CHANGELOG entry is accurate. The prompt's item "hint fires only on `success===false`" is confirmed true today and is the function's contract 鈥?a future `success:true`-with-warning shape would need its own channel, not a change here.

VERDICT: APPROVE_WITH_NITS
