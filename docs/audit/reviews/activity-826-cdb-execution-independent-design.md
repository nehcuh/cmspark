# #826 CDB execution preparation — independent bounded rethink

**VERDICT: APPROVE this explicit diagnostic-preparation revision for actual GLM design review.** Add one fixed execution outcome plus actual-close exitCode; increase **only the pre-business CPU qualification CDB work window6s→120s**. Keep post-timeout native6s/browser6s/CIM3s and original MCP20 unchanged. This is a new preparation measurement budget, not an unchanged timeout or a fix for the MCP/SDK problem. No implementation or dispatch is approved by this design report alone.

Read baseline9329 source: actual runBounded826, qualifyCdb826, probe runner ordering and the actual original MCP case, plus the existing checked native-builder120000ms tool budget. Read the independently preserved9329 safe result. No shared source/config edits, network/API/model call, CDB/Windows/native UI launch or dispatch was performed. The prototype below is only a private, source-derived VM.

## Supported gap and decision

The actual qualification reached CDB and returned UNKNOWN with dummyClosed true. Current runBounded collapses timeout, output overflow, process error, nonzero close and signal into `ok:false`; the safe qualification cannot discriminate those outcomes. This is a concrete preparation-result gap. The approximately7-second step duration does not prove which cause occurred.

A closed outcome and actual exit code directly change the next decision: timeout means the chosen preparation window was exhausted; an actual nonzero exit/code points to tool startup/execution, while cap/error/signal are different failures. None proves SDK causation. ExitCode alone is insufficient because a timed-out/killed process can still emit a real close code0. The explicit outcome must preserve the original invalidating event.

The6s qualification work limit was agent-invented, applies to an owned CPU debugger dummy before the MCP test process even starts, and is not a user/native business SLA. Using the project's existing120s native-tool preparation scale is reasonable for a cold installed diagnostic tool. It does not establish that CDB needs120s or will succeed, and the Windows builder's timeout is not empirical CDB evidence. **State the6→120 change transparently.** The runner awaits qualification before launching the actual isolated MCP test child; no part of the original20s acceptance case is lengthened or declared successful by this change.

The smaller alternative, metadata only while retaining6s, can distinguish the next failure but would require another entire VM preparation if the real result is TIMEOUT. Combining a standard bounded tool-preparation window with the minimal classification can obtain that distinction in one purposeful changed-input attempt, without weakening any positive qualification. Do not add retries, prewarm, command changes or another timeout ladder.

## Minimal semantics

1. runBounded returns `ok`, its existing private streams, one closed outcome enum and `exitCode:null|safe integer`. Suitable categories are OK, TIMEOUT, OUTPUT_LIMIT, ERROR, NONZERO_EXIT, SIGNALLED; qualification alone defaults NOT_RUN/null before it invokes CDB. Final literal names can be fixed in implementation; do not include messages or open strings.
2. First invalidating event wins. Timer expiry records TIMEOUT; excess combined output records OUTPUT_LIMIT; process/spawn failure records ERROR. Later kill/error/close must not overwrite those with NONZERO_EXIT or OK. A normal code0/no-signal close alone may yield OK. A signal close is classified without copying its raw signal text into the safe projection.
3. **ExitCode comes only from the actual child close callback** if it supplies a safe integer, otherwise null. Never synthesize kill code1, parse error.code as an exit code, infer code0 from success assumptions, or treat a kill request as close. A no-process failed spawn can return ERROR/null; an actual PID still requires real close.
4. Qualification explicitly copies only these two fields from the actual runBounded result into its safe JSON. Defaults remain NOT_RUN/null for INPUT/TOOL/WORKSPACE/DUMMY_READY refusal. Do not spread captured/stdout/stderr/error objects into the artifact. These fields classify CPU tool preparation only; native/browser capture and original MCP observation schemas stay unchanged.
5. The only timeout value change is the actual qualification's CDB call to120000ms. Ready2s, pong1s, post-timeout query3s, native CDB6s, browser CDB6s, raw512KiB/JSON64KiB, fixed SDK/commands/local symbols and actual-close fences remain. The useful-work limit is not an end-to-end teardown guarantee.
6. OBSERVED/COMPLETE still requires actual real-output parser qualification, qd/pong, actual dummy close and successful workspace cleanup. Classification never supplies a substitute positive. Earlier stoppedAt remains first-failure preserving through finally; new metadata does not relabel an earlier stage.

No product trust/permissions, native process ownership, source inverse, original20s result, installed tool location or network symbol policy changes are needed. Only collector and its focused tests should change; existing runner/status gate remains authoritative.

## Actual source-derived finite control

Node22.23.4 through nvm. `/tmp/cmspark-826-cdb-execution-controls.cjs` and `.log`: **9 controls PASS**.

The private prototype uniquely transforms the actual full helper's bounded-runner result/refusal sites, adds only the two explicit qualification metadata copies, and changes only that qualification call's6s to120s. Other source remains included, and the repository helper is byte-compared unchanged after execution. Only process/OS leaves are controlled. No real debugger, vendor recording, Windows API, native UI or MCP test was executed.

- Six execution classes run through that source-derived full runner: normal0→OK/0; normal17→NONZERO_EXIT/17; timeout followed by actual close0→TIMEOUT/0 (still failed); overflow→OUTPUT_LIMIT with actual close code; actual-process error→ERROR with actual close code; signal close→SIGNALLED/null. Private raw errors are not projected.
- Timeout plus a held close remains pending; a subsequent error cannot change TIMEOUT. Actual close0 then yields TIMEOUT/0. This proves actual close ordering and why outcome is necessary alongside exitCode.
- Actual full qualification with the prototype runner's **real produced result shape**, controlled grammar/IPC leaves and unchanged positive gates yields OBSERVED/COMPLETE and OK/0. It invokes only the qualification120000ms work limit. The control closes immediately; it does not sleep120s or claim real CDB success.
- Actual full post-timeout collector with valid owned facts still uses exactly `[3000,6000,6000]` and unchanged hybrid native-pv/browser-pvr. The actual original MCP source retains its original20000 registration/snapshot deadline.

These validate feasibility and boundary preservation, not the unimplemented final source or historical9329 cause. No broad matrix/framework was introduced.

## Required implementation/source gate

The actual two-file implementation must lock the finite enum/first-event precedence, close-only exitCode, no-PID versus actual-PID error behavior and held-close path. Its qualifier fixtures should consume the actual runner result shape (or faithfully recorded current producer results), avoiding another stale mock schema. Confirm the actual qualification is120s and both post-timeout CDB calls remain6s/CIM3s. Verify safe JSON includes only the two declared new metadata fields, all positive parser/IPC/close/cleanup predicates remain, and original MCP/runner/workflow bytes are unchanged. Reuse unaffected source and machine evidence; no additional design/full-audit round is needed without a concrete new finding.

After independent and actual GLM source gates, the parent may separately authorize one changed-helper invocation. A real execution outcome then guides disposition. It is not permission to rerun unchanged inputs, expand120 again, add native fields or interpret a physical tool result as the old WebView/SDK cause. All four prior NOT_RUN receipts remain; target MCP physical attempts and target stack samples remain zero so far. The historical round limits are not reset by this preparation revision.

**APPROVE design: minimal bounded preparation classification and explicitly revised CPU qualification window; original business/physical observation contracts unchanged.**
