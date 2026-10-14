# Independent Windows ownership diagnostics review (#623)

2026-10-14 Asia/Shanghai. Reviewer authored the separate Browser component and therefore reviews **only** the two Windows diagnostics paths here. No approval of own Browser diff, combined wave, release or merge. No source/config/SDK edit, GitHub mutation, real Windows command, app replacement, private process data or credential access.

VERDICT: **APPROVE_WITH_NITS — Windows diagnostics component only.** No confirmed blocking correctness/security regression. Native Windows exact-head CI remains a mandatory separate gate; #623 historical10s incident/root cause remains unproven.

## Frozen identity / scope

Reviewed full `/tmp/cmspark-623.diff` end-to-end; actual frozen `windows-owner.ts` and complete `windows-owner.test.ts`; WindowsJobOwner/prepareWindowsJob/spawnWindowsJob callers; Windows PowerShell path/control-shell source; actual logger redaction/persistence/failure handling. Read #623 original body and complete implementer record in review/context.md, plus final machine card. Structured builtin-code-review workflow applied.

Base **e5b3511bc6e3ed36aca9c71314ec21ae1f3bf5a8**. Complete2-file diff SHA256 **f6eb9be284a0c1ce835ecf215c55dd333024a297e0ed7478aff9189deb91b0c5**, independently verified. Both frozen whole-file hashes independently verified:
- companion/src/process/windows-owner.ts: `b2e8c16ade957b7c3141e2abdd6f9886950eed866152aef97dcee4a00ab5ea4a`
- companion/tests/windows-owner.test.ts: `9e6dd1339cd1d1aadc791131118fd5067bc808a6766e9abd7ecd45b6b4069271`

Entire WindowsJobOwner/PendingOwner/cache/singleflight/cancellation/export tail is byte-identical to main basee5, independently compared; this patch changes only query failure observability and an idempotent settlement/log guard.

## Correctness / resource-lifetime findings

No blocking findings.

`companion/src/process/windows-owner.ts:55–59` retains the exact fixed PowerShell executable resolver, -NoLogo/-NoProfile/-NonInteractive args, .NET parent PID→StartTime→UTC FILETIME query and invariant-culture string. Same utf8 encoding, windowsHide:true, timeout10000ms, killSignal SIGKILL, maxBuffer4096 and passed AbortSignal. No configured child-target env or PATH authority introduced; options.env remains absent as before. Stdout stays only trimmed return data and is never a logged field.

Query still settles only after **both** execFile callback and child close (`45–51`, `59`, `68–70`). AbortError may arrive early via callback, but code does not release/cache before the child's close receipt. Once callback+close are present, the exact original Error instance is rejected; successful output preserves its trimmed FILETIME string. New settled guard prevents duplicate event/promise work; it neither manufactures a process receipt nor retries. Synchronous exec/path failure logs phaseexec with absent child receipts and rejects the original error.

`WindowsJobOwner` validates positive uint64 decimal FILETIME, preserves one shared pending probe and separate waiter cancellation, cancels only the last remaining waiter and awaits its owned query cleanup. Old late success is never cached after controller abort; an overlapping new prepare uses a different pending query. These semantics and all original assertions are unchanged. `windows-job.ts:141–148` still reads owner.created before launching, so ownership initialization failure cannot become guessed PID/uptime identity or successful target spawn.

`child.killed` and error.killed are logged independently as bool/null facts, not interpreted as process-dead certificates. Absence of error.killed stays null. Actual close signal/status and aborted flag are separate. This is particularly important because host AbortSignal cancellation can produce **SIGTERM**, while the unchanged execFile **timeout** option requests SIGKILL. New tests pin actual abort receipt to ChildProcess.signalCode rather than incorrectly forcing SIGKILL. No kill target or native ownership semantics changed.

## Diagnostic privacy / trust

`windows-owner.ts:7–13,29–43` derives only allowlisted error names/signals, bounded signed32/uint32 native status numbers, booleans/nulls and monotonic elapsed numbers. Arbitrary string codes/signals become literal unknown; unknown types do not invoke stringification of command-bearing objects. Phase is fixed exec/launch/probe. Event name/source are fixed. No Error object, message, stack, PID, executable path, command/args, environment, stdout/stderr, FILETIME or user document data reaches logger.

Actual logger `logger.ts:117–140` surrounds path/rotation/redaction/JSONL write with a catch and its ordinary fallback. The new data is scalar/plain, so logging does not promote raw exception payloads. The component does not add a logger override or callback that changes query authority. Exact field inventory and fake credential exclusions are asserted from actual producer output in the new tests.

Independently faulted the **actual** logger fs.appendFileSync with owned EACCES while driving actual queryWindowsOwner and a controlled ChildProcess boundary: rejection remained the identical original EIO probe Error. Observed2 safe logger fallback calls, including initialization activity; count is not claimed to equal2 probe events. Initial probe assumed exactly1 total fallback call and that auxiliary assertion failed; corrected the probe's scope to require actual disk failure observed while retaining exact-error assertion. Production code was not edited and no failure was hidden. Final actual probe exit0, output `{logger_disk_fault_preserves_original_error:true,observed_logger_faults:2}`. It never ran PowerShell or signaled a real process.

## Independent focused evidence

Node22.23.2 via nvm; canonical isolated runner on exact frozen compiled `windows-owner.test.js`: **18/18 PASS**,0fail/skip/cancel,41.207ms. `/tmp/cmspark-623-adversary-focused.log`. No full suite repeated. Tests cover original owner cache/singleflight/validation/unprepared spawn plus failure after spawn, absent-spawn ENOENT, callback-before-close abort, synchronous exception, successful close-before-callback trim and adversarial raw error payload exclusion.

Real host execFile/logger case uses a test-owned Node process only in place of the fixed Windows executable. It actually aborts/reaps the child, proves ESRCH after rejection, reads actual persisted JSONL and checks no forbidden keys/secret sentinel. Independently observed sanitized receipt:

```json
{"event":"process.windows_owner_probe.failed","data":{"phase":"probe","timeout_ms":10000,"spawn_elapsed_ms":1.098,"callback_elapsed_ms":3.848,"close_elapsed_ms":3.913,"returned_elapsed_ms":3.917,"close_exit_status":null,"close_signal":"SIGTERM","error_code":"ABORT_ERR","error_killed":null,"error_signal":null,"child_killed":true,"aborted":true}}
```

This is actual host child/logging proof, **not native Windows/.NET ownership or cold-start acceptance**. The allowlisted event omits the owned PID/command/stderr sentinel rather than relying on generic redaction to sanitize them later.

Supplied shared-machine card: host5926 total/5874pass/52existing platform skips/0fail or cancel, frontend1527pass, both production builds0. Fresh LinuxARM64 Companion153total/148pass/5existing Windows-only skips; Extension50pass; both builds0. Those totals belong to the combined wave and do not constitute this reviewer approving own Browser source. Linux skips are not native Windows PASS. Exact-head native Windows CI and exact merged-main CI were marked pending in the supplied card; no assumption of completion here.

## Nonblocking interpretation nits / acceptance boundary

1. `windows-owner.ts:65` spawn receipt proves only Node observed its OS child spawn. phaseprobe does **not** establish PowerShell module/.NET query startup or where cold-start time was spent. launch means no spawn receipt observed; it is not a measurement of internal Windows process initialization. Keep the implementer boundary in user/issue summaries.
2. `windows-owner.ts:38–50` returned_elapsed_ms is sampled **at failure reporting immediately before log writing and rejection**, not a post-Promise-return timestamp. It excludes subsequent synchronous log-write cost/caller microtask delay. Describe it as failure-report/settlement-entry elapsed when analyzing tail latency; do not use it to assert exact end-to-end await duration. This is a metric interpretation nit, not a reproduced control-flow defect.
3. No new wall-clock bound on delayed child-close was introduced. Original callback+close discipline remains; 10s timeout is still not proof that all cleanup completed exactly at10s. The patch intentionally reports receipts rather than treating timeout/kill attempt as success.
4. #623 requested minimal sanitized observability is implemented. The original timeout incident has **no diagnosed/fixed native root cause** from this patch or later green runs. Keep original incident/cold-start investigation visible or disposition the telemetry portion explicitly; do not close as “Windows timeout eliminated.” Native exact-head acceptance remains required before landing.

No speculative timeout increase, retry-loop, PID/uptime fallback, logger exception dumping or child-close bypass requested. Component is review-ready with these exact boundaries; whole-wave synthesizer and native CI decide merge readiness.

Final verdict: **APPROVE_WITH_NITS (Windows diagnostics only); no self-approval of Browser, no merge/release claim.**
