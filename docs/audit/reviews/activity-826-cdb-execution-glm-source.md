# Final CDB execution preparation — actual GLM scoped source gate

**APPROVE** the two frozen files for commit. After coordinator gate confirmation, support one purposeful source-changed Windows qualification invocation. Next actual result is followed by temporary-probe retirement; no further120s expansion or diagnostic framework.

- Baseline: `9329bfa2a5118322b19336d791ffb7ecd005bb20`.
- Manifest SHA256: `12fcbc706dc88c26446e6b2ee60d0423bcf7f4c3f3d12800a6b8c7b626064d0a`.
- Full diff SHA256: `0eca9a5754faa2a92734379b50b91697ff3e34b55a858463dc41fb6f47baffc5`.
- Prompt SHA256: `2be195699dcf2961f06c0dd7640f6834ed9c8b28b50f89e99ab60f75253bd6d9`; 109333 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `85628ms; input/output tokens 28537/4877. Safe wrapper disabled tools/hooks/MCP.
- Full current two sources/diff/manifest, full B/author reports, actual17-case author+B logs, actual producer→qualifier two failure controls, approved design and actual9329 receipt were embedded. Seven critical sources matched base bytes; unchanged MJS6 results reused. No executable source edit, CDB/native or dispatch occurred.
- Collector SHA: `4d000b443a63a1aff6e28d57c3be0c14c1599d57867e994c3f51bea5b6d93a2e`; focused-test SHA: `3ba6aa90f9de54118f119079ebc3b5f1a1de92785845e34d618341e616c75606`.
- Only CPU qualification's CDB useful-work6000→120000 is intentional; post3/6/6, MCP20 and actual-close requirements remain. No hard120 total, historical cause or MCP repair claimed. Tool NOT_RUN cannot replace or excuse required canonical product acceptance; original MCP failure still blocks. No merge/release approval.

## Coordinator factual correction

Model item1 has a field-count wording error: runBounded previously returned three fields (ok, stdout, stderr), and now returns five total after adding toolOutcome and exitCode. It does not return seven. Actual source, full diff and test key-set comparisons bind the five-field contract; the subsequent item descriptions and verdict remain supported. No extra API or source edit was needed for this factual note.

## Actual model review (verbatim)

**VERDICT: APPROVE** the two frozen files (`4d000b44…d93a2e`, `3ba6aa90…5606`) at the source gate. No supported blocker found; B's final source conclusion is confirmed.

**Verified against actual embedded source (trigger → path → impact):**

1. **Producer contract exact.** `runBounded826` resolves the original five fields plus two. `toolOutcome` is one of exactly OK/TIMEOUT/OUTPUT_LIMIT/ERROR/NONZERO_EXIT/SIGNALLED: refusal sites set TIMEOUT/OUTPUT_LIMIT/ERROR guarded by `if (invalid || done) return`; close-only fallback picks SIGNALLED/OK/NONZERO_EXIT. Impact: no open string, no raw signal/error text projected (tests assert `/private|PRIVATE_SIGNAL|123/` absent).
2. **First-event preservation.** Timer/cap/process-error share one refusal path; later error or close 0 cannot overwrite (`toolOutcome ||` in `finish`, guarded `refuse`). Test 16 proves timeout → later error → close 0 stays TIMEOUT/0, unresolved until actual close. Matches approved design item 2.
3. **ExitCode close-only.** `actualClose` flag set solely in `child.once('close', …) → finish(code, signal, true)`; `exitCode = actualClose && Number.isSafeInteger(code) ? code : null`. Signal close → null; bad close code → null; no-PID spawn error → ERROR/null via immediate `finish()`; catch path → ERROR/null. No error.code parsing, no kill-status synthesis.
4. **Qualification copy minimal.** Default `toolOutcome:'NOT_RUN', exitCode:null`; post-run copies only the two fields with fixed-set membership (fallback ERROR) and safe-integer/null validation; no spread of captured/streams/error. Thrown run leaves NOT_RUN/null (consistent safe default). Schema 1 additive; both new keys bounded literals/integer — JSON_CAP/`safe()` privacy regex unaffected.
5. **Budget change exactly as scoped.** Only `qualifyCdb826`'s CDB call 6000→120000; `queryOptions` 3000, `debug826` 6000, ready 2000, pong 1000 unchanged; no retry/ladder/cleanup deadline added. Tests assert `[3000]`/cdb 6000 (test 3) and 120000 (tests 8, 17). No hard total-wall promise anywhere; actual-close fence unchanged.
6. **Positive gates intact.** OBSERVED/COMPLETE still requires parserPositive ∧ actualDetached (qd/pong) ∧ dummyClosed ∧ cleanupComplete; first `stoppedAt` preserved through `finally` (test 14 nine-stage set unchanged); held-close fence tests (7, 10, 12, incl. real 3100ms race) retained.
7. **Stale-mock regression vector closed.** `okay()`/`failure()` carry the real producer shape; test 15 deep-equals `produce('ok')` to `okay()` and key-set-equals all failure modes; test 17 runs the actual producer through the actual qualifier (extra `privateExtra` deliberately not propagated) plus early `qualifyCdb826()` NOT_RUN/null key-set check.

**Evidence consistency:** 17/17 PASS in both author and independent B logs; B's 2 producer→qualifier controls (TIMEOUT+close0→TIMEOUT/0; NONZERO_EXIT 17) match source semantics; manifest hashes match B and author reports; seven byte-equal bindings justify reuse of prior gates without reopening the branch. No issue found; no speculative follow-up proposed.

**Disposition (answering the request):**

- **Commit: yes.** The exact two frozen hashes may be rooted as the #826 tool-preparation adjustment. Nothing outside those two files is touched by this review.
- **Windows invocation: conditional support only.** After the coordinator confirms all gates, ONE purposeful source-changed qualification run is supported *as coordinated authorization* — it is not dispatched, approved, or executed by this reviewer, and it is not merge/release/acceptance. Its result classifies CDB execution failure only; it cannot establish the historical 9329/8fa/SDK cause, and the ~7s span remains unclassified.
- **Plan preserved:** after the next actual result, the temporary probe retires; no further 120s expansion, retry framework, or observer. CDB failure yields an honest NOT_RUN/tool-limitation report; an agent-added tool gate must not replace or excuse the original product's necessary canonical CI acceptance. Original MCP20 canonical failure remains a blocker; final normal three-platform shipping dry-run/main/tag gates remain outside and required.
