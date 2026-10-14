# Independent CI r4 incremental test-harness review

2026-10-14 Asia/Shanghai. Non-CI implementer reviewer. Only new scope: `companion/tests/integration/allow-dir-reconnect.test.ts` promise-observation delta. No repository source edits/recompile, no repeat full483/all-repository run, no commit/push/GitHub action. This supplements prior exact CI r3 approval and preserves r2 REJECT/full failure reports.

## Frozen identity

Source worktree `/Users/huchen/.codex/worktrees/issue-convergence/cmspark`.

- Test whole-file SHA256 **25a07a77c45052aca20b04e620abefff2f74c46c5ccd872c0cb76a72e13291d0**.
- Test-only diff SHA256 **c61e6f94131bc538d4557a54efd8a48bc4816b92b5fb2e1830dddcb891038669**.
- Independently rehashed product `mcp/client.ts`, `mcp/manager.ts`, `mcp/stdio-transport.ts`: all byte-identical to prior independently approved r3 whole-file hashes. No new product delta approved here.
- Hash record `/tmp/cmspark-ci-r4-test-delta-independent-hashes.json`. Compiled test mtime1791946049 is newer than source1791946042.

## Correct promise and cleanup contracts

Verified one-based actual source lines47–54: the listener captures **the original** `manager.applyConfig` promise, pushes it before attaching a synchronous rejection handler, and does **not** substitute the `.catch` result into the collection. This removes floating unobserved-rejection risk while retaining the original rejection outcome.

Line85 awaits `Promise.all(configUpdates)` before leaving successful test body. Any captured configuration/teardown rejection therefore fails the test; the catch at53 cannot turn it into a successful value. It isn't an `allSettled`-based success gate or a swallowed error assertion.

Lines69–84 retain all existing product assertions: replacement catalog must remain pending after400ms, success only in ready scenario, actual call count, cancellation/off-on authority revocation/changed-contract errors, approved path commit persistence, no pending confirmations. The asynchronous accounting is added after these assertions rather than replacing them.

Lines87–92 cleanup order is correct for this fixture:

1. Release held catalog, abort controller and reject pending human confirmations so no intentionally held operation prevents drain.
2. Remove config listener and dispatch runtime binding before draining to stop new observed updates from being appended during cleanup.
3. `Promise.allSettled(configUpdates)` drains already observed originals **only in finally**. It cannot suppress the preceding body assertion or `Promise.all` rejection. Cleanup later `manager.applyConfig(disabled)` remains awaited normally; its failure also fails the test rather than masquerading as green.
4. Close synthetic SDK servers, then remove only the owned temporary directory.

The fixture uses actual SDK `InMemoryTransport` linked pairs. It cannot produce native Windows/owned stdio teardown-deadline rejection merely because persisted config says transport:stdio. This is a meaningful future error-propagation/accounting fix; **no claim that its four passing examples exercise an actual native process-teardown fault**. Actual owned rejected-close/manager barrier/SDK pending-handler evidence remains the separate r3 producer regression/probe, preserved intact.

## Focused independent result

Node22.23.2 via nvm; canonical isolated runner:

```text
node scripts/run-tests.mjs .test-dist/tests/integration/allow-dir-reconnect.test.js
```

Fresh result **4/4 pass**, zero failure/cancel/skip, exit0, **2097.252916ms**. Full log `/tmp/cmspark-ci-r4-test-delta-independent.log`. No other groups or full-suite counts are falsely credited to this tiny run. Provided tsc/build receipt is root's machine input; this reviewer used already freshly compiled output and did not rerun compiler.

## LLM evidence dispute does not change source judgment

Independently computed current integrated `chrome-extension/src/sidepanel/store/agentStore.tsx` SHA256 **89aba9e19157ad894ad9dffd9b2c9f8457f037e8805b66607d5c3c3c6c1db807**, matching the frozen Office manifest. The alleged mismatch is not a reproduced source mismatch. A complete Office patch containing new untracked files is a different artifact than a tracked-only diff; unequal hashes for those different artifacts do not demonstrate tampering. Preserve complete Kimi reports and root's explicit manifest/artifact hash proof; do not erase the finding or elevate an unsupported textual claim over real bytes. This limited verification is **not** an independent approval of Office or my Cooperation code.

Linux fresh delta validation and final exact-head CI/Pi/release gates remain pending; this test-only incremental approval doesn't certify them. No remaining confirmed issue in the observed promise delta.

**VERDICT: APPROVE incremental allow-dir-reconnect test delta at whole-file SHA25a07a77c45052aca20b04e620abefff2f74c46c5ccd872c0cb76a72e13291d0 / diff SHAc61e6f94131bc538d4557a54efd8a48bc4816b92b5fb2e1830dddcb891038669. Original rejects remain observable and fail the success path; cleanup drains without masking assertions. Prior r3 product approval remains exact-hash scoped; no whole-wave/release/CI approval.**
