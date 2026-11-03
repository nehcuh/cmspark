# #826 Mac finite owner/query observation — independent source review

VERDICT: **APPROVE**. No reachable blocker found in the frozen six-path unit. This approves proceeding to the actual GLM source gate and purpose-directed native CI; it does not assert a historical Mac cause or native UI success.

Reviewed 2026-11-03 against base `0666fc8d066ec6a0941c5edec865063a30692cf9` and `/tmp/cmspark-826-mac-observation-source-manifest.json`. Root authored this unit; I independently reviewed the source changes and actual consumers and ran the official isolated family. I did not modify/stage/commit/push source, trigger CI, start native UI, run xcrun/XCTest, or read live configuration. The separately approved Windows unit is not re-reviewed here.

## Frozen source and lineage

The six manifest files match their frozen SHA256 values:

- `companion/tests/helpers/workspace-xctest-owned-705.ts`
- `companion/tests/desktop-native-thread-metadata-476.test.ts`
- `companion/scripts/tests/observation-826-inverse.cjs`
- `companion/scripts/tests/observation-788-inverse.mjs`
- `companion/tests/desktop-workspace-xctest-705.test.ts`
- `companion/tests/desktop-close-observation-826.test.ts`

I read the implementation and actual helper/native changes, the new inverse and its existing inverse integration, and the source-derived tests. Independently executing the inverse against complete files, then comparing with actual `git show` base source, restores both helper and native byte-for-byte under both LF and CRLF. This is stronger than comparing selected authority methods alone. The new inverse checks complete current source hash, exact marker count and complete prior source hash; changed, duplicated, appended or incomplete inserted source refuses. It is used for static lineage only, not to rewrite runtime evidence. Existing 476/788/782 seals remain unchanged and their actual consumers pass.

Evidence: `/tmp/cmspark-826-mac-independent-preservation.log` records six frozen files matched and exact entire-file restoration for both EOL profiles.

## Observation implementation

The owner uses the existing Node `closeClock476`, 250 ms buckets and saturation at 240. The explicitly approved cardinality is nine points, including ROOT_REMOVED. Each point has a separate first-attempt guard, so a failed clock observation cannot later become a misleading timestamp for the first event. Values are closed integers, booleans and exit categories; returned arrays are copies.

The nine sites are actual setup completion, the original xcode spawn call's enter/return, original native exit callback, completion rejection, first cancel request, actual xcode exit, actual xcode close, and successful root removal. Calls are best-effort. The added exit listener writes observation state only: it does not set original xcodeClosed/xcodeCode, notify, settle, kill, or satisfy closure. The original close callback still updates those authority fields. Complete/canSettle/wait/cancel/cleanup authority and original original native exitResolve ordering are preserved by the exact full-source inverse.

The existing failure path and existing xcode post-close callback project the finite timeline. No watcher, worker, receipt, polling loop, query, SDK operation or extra lifecycle wait is introduced. A missing point remains unknown. Cancel context is explicit; a later zero exit cannot be promoted into original-deadline success.

## Query facts and final consumer

The original two read-only queries still share one 5000 ms deadline, one-MiB per-stream limits and existing strict process/error/status/signal/EOF/stderr checks. Original Result705Projection, SDK parser/schema, source/bundle verification, rejection results and nativePassClaim=false remain unchanged. Extra facts are provided as an optional second internal callback argument; existing public one-argument callbacks still receive their original object.

Each actual capture stage contributes at most one nine-column row: stage, captured process/stream error flag, closed exit code or unknown, closed signal enum, two EOF flags, saturated stdout/stderr byte counts, and the original `limited` flag. The last flag is a **limit flag**, not by itself proof of byte overflow: the existing shared deadline can also set it. The byte counts distinguish stream overflow. No raw error, path, stderr text, title, environment, nonce, PID or SDK description is exposed.

The existing D705_XCRESULT_DETAILS_CLOSED callback retrieves owner.toolFacts826 and owner.timeline826 at callback execution, so it sees ROOT_REMOVED if removal has already occurred. It attaches the candidate only when JSON byte length is at most the original 1024. Oversize or fact/timeline/serialization failure leaves the original result available. This changes neither query count nor output slot count. A result projected before removal is not retroactively changed.

ROOT_REMOVED is attempted immediately after the existing successful rmSync returns and before the existing surfaceLease.settled. Cleanup refusal or rm failure produces no point. An observation exception is swallowed without changing original error or settlement order. The point proves that root removal returned before the projection containing it; it does not prove the query's filesystem-read time or causal responsibility for TOOL_FAILURE. The independently approved actual cleanup/query lifetime experiment remains the reason for this limited positive observation, not a claim about the historical CI failure.

## Independent verification

Node **v22.23.4** selected with nvm; current compiled output is from root's completed full `tsc -p tsconfig.test.json` (PASS, `/tmp/cmspark-826-build-mac-types-final.log`), including this frozen unit and the frozen Windows unit. I reused that coordinated compilation rather than rebuilding shared output.

From `companion/`, official isolated runner:

```sh
node scripts/run-tests.mjs \
 .test-dist/tests/desktop-close-observation-826.test.js \
 .test-dist/tests/desktop-workspace-xctest-705.test.js \
 .test-dist/tests/desktop-native-observation-788.test.js \
 .test-dist/tests/desktop-archive-observation-782.test.js \
 .test-dist/tests/desktop-terminal-first-failure-747.test.js
```

**98 PASS / 0 FAIL / 0 SKIP**, 2062 ms. Log: `/tmp/cmspark-826-mac-independent-family.log`.

The six new cases and 92 existing cases actually passed together on current frozen source. Controls exercise:

- Actual AST owner methods with the original complete/canSettle chain: exit-before-close cannot complete; bad observer/xcode close and non-quiescent closure still reject.
- Same-clock first-attempt-only timeline, invalid/throwing clock, saturation, copied values and no authority writes.
- Actual query producer using real owned Node ChildProcesses for nonzero exit, clean exit plus stderr, missing executable, signal, stdout/stderr limit and stream error. Clean exit plus `{}` is intentionally invalid SDK data and reaches original INVALID_RESULT; it is not a fabricated valid SDK response.
- Actual capture fact producer's two stages, deduplication, closed values, saturation and privacy. UID is only a test semantic port; Windows uses the actual owned fixture UID, not a missing host getuid call.
- Actual final native callback, latest memory, unchanged original result, 1024-byte candidate bound, oversized projection fallback and throwing fact sink fallback.
- Actual native cleanup tail with successful removal, observation exception, rm exception and cleanup refusal, preserving original primary/cleanup behavior and removal/settlement order.
- Original exact receipt/identity/quiescence/close guards, actual schema fixture consumers and complete source seals, including LF/CRLF counterexamples.

Scoped `git diff --check`: PASS. No untrusted successful SDK shape, new native UI activation or timing extension was needed. The author's previous sole cross-realm test comparison failure is resolved in the current test by comparing its actual JSON semantics; this independent complete-family run verifies the corrected harness together with every related legacy case.

## Remaining platform gate

The original workspace 45000 ms, shared query 5000 ms, two query APIs, stream/output caps, permissions, UI/observer authority, business assertions, lease retention and cleanup remain in force. Only the finite observation point count intentionally changed from eight to nine. Native Mac success on the next exact head is still required; absence or lateness of an observation must not be treated as negative proof or as a reason to relax that gate.

VERDICT: **APPROVE**.
