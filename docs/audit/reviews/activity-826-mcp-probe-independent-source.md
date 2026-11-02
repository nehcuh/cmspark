# #826 finite MCP latency probe — independent source review

VERDICT: **APPROVE** the current three-file implementation for the actual GLM source gate. No blocker remains. This is approval of one explicit NON_ACCEPTANCE experiment; no dispatch, canonical budget change, merge or release acceptance was performed or approved by this review.

Base: `67c5e209d239995b930fe1dfcc54f444005e44f8`. Reviewed `.github/workflows/release.yml`, `companion/scripts/mcp-latency-probe-826.mjs`, and `companion/scripts/tests/mcp-latency-probe-826.test.mjs`, including the subsequent shallow-checkout test correction. I made no source edits, commits, dispatches, native UI calls or live configuration accesses.

## Source findings

The script refuses non-explicit GHA Windows execution before reading/launching the case. It binds the actual MCP TS source with a fixed source hash (LF/CRLF source representation admitted), requires exactly one actual compiled registration and the unchanged snapshotDeadline825 expression, derives only registration timeout20000→60000, and verifies the inverse. All original business/config/authentication/receipt/store/close/finally code remains part of the derived test. There is no native-source rewrite or runtime compilation fallback.

Canonical TS/JS are read only and their byte buffers compared in the outer finally after execution. The derived test is a same-directory CJS sibling, exclusively created with wx/0600, so relative imports and __dirname retain the actual compiled layout. A pre-existing file is never adopted or removed. Normal return and thrown execution paths remove the owned sibling in finally. The script invokes the actual official runner, inherits its real result, rejects runner.error/signal and retains nonzero status. It labels execution NON_ACCEPTANCE with canonical20000 and snapshot20000 unchanged. The original ~18.5-second sample is not extended or repeated.

The default-false typed Release dispatch input selects one independent Windows VM with needs:preflight and contents:read; checkout persistence is disabled. Preflight is unchanged. The probe builds current checkout through existing build/test-fixture/tsc commands and then runs the explicit measurement. It executes no previous native UI. Only probe=true dispatch skips packaging; normal dispatch and tag-push package paths remain conserved. Original release needs/package and tag-only condition are unchanged. Probe=true on a tag-ref dispatch also cannot publish because package is skipped; false tag-ref dispatch retains the original behavior. The canonical CI workflow is byte-unchanged from67c5, so its normal ten checks are not substituted or expanded.

## Independent machine evidence

Node22.23.4 selected with nvm. All test configuration writes below used the real official runner and private data root.

1. Independently ran current unit before the shallow-source correction: **5 PASS / 0 FAIL / 0 SKIP**, log `/tmp/cmspark-826-mcp-probe-independent-machine.log`.
   - Unique actual compiled mutation/inverse/snapshot20 and drift rejection.
   - Exclusive sibling cleanup on return/throw/cancellation and pre-existing-file preservation.
   - Real official-runner CJS import and __dirname, actual config.replaceMcpServers write and disk readback in an isolated data root; disk sentinel proves the child test executed. Removing inherited NODE_TEST_CONTEXT here is specifically the standalone-child test harness boundary, not a change to the probe business path.
   - Explicit local refusal and actual parsed workflow conditions, original jobs and permissions.
2. Added only a private `/tmp` source-derived probe (no repository modification): **8 controls PASS**. `/tmp/cmspark-826-mcp-probe-independent-controls.mjs` and `.log`.
   - The actual runMcpLatencyProbe826 function body was AST-extracted and executed with inert filesystem/child-process ports rooted in private copies. Success, nonzero result, result.error, signalled runner, thrown spawn and deliberate canonical drift all follow their exact expected guard/result; all remove the temporary sibling.
   - Two actual official-runner children execute an assertion failure and a real50ms test timeout. Both return nonzero as expected, and the real temporary sibling is removed afterwards. No native MCP/UI case executes.
3. Root then removed the test's historical git-show dependency, which would be unavailable in a future Actions depth-one checkout. I independently recomputed its replacement pins from the actual67c5 Git object, parsed with the actual js-yaml library. Raw workflow SHA is `484078da169a63dfbe5d4fe174568d597dfc48f38d57d05a1e86a67265244480`; complete JSON job hashes are:
   - preflight: `40a951cde0fd388eb9ad6a682b8adfe35b44f9459480d4d0d668bc2a5f69c441`
   - package: `69e2fd8ad3f2fa4580803602abeba619c092ed17569fe2ac1b407807699f65ae`
   - release: `9f8bd997430e9d68fcd4f016a1250cfd72e175398b0e2257d231f52cf78120c6`
   All current pins match. The actual package object is hashed after removing only its newly tested if; preflight/release complete hashes remain exact. Deliberate job mutation controls reject. Evidence: `/tmp/cmspark-826-mcp-probe-baseline-independent.log`.
4. To verify the actual shallow path rather than merely deny a git subprocess, I created a **real depth-one local clone of main with67c5 object absent**, copied the current unchanged unit, actual source/compiled input, runner/preload and built test outputs, and supplied existing dependencies. No commit was created. `rev-parse --is-shallow-repository` returned true and `git cat-file -e67c5^{commit}` failed before running the complete current unit: **5 PASS / 0 FAIL / 0 SKIP**. This also executes the added tag-ref false case. The private clone was removed after the run. Script/log: `/tmp/cmspark-826-mcp-probe-shallow-independent.py` and `.log`.

The production probe script and workflow were unchanged by the test-only shallow correction, so the independent eight fault controls remain valid and are not needlessly repeated. Scoped diff-check passed.

## Decision and interpretation

No remaining supported source blocker was found. After actual GLM source approval, one explicit fresh-VM diagnostic can measure whether this particular fixture completes with all original business receipts after20s but within60s. Such a result cannot replace the failing original20s gate, prove the original instance would finish, identify cold startup as its cause, or authorize another unchanged run or an automatic timeout change. A probe that completes within20s is not discriminating; one that fails at60s remains a failure. The original canonical Windows acceptance failures remain authoritative.

VERDICT: **APPROVE**.
