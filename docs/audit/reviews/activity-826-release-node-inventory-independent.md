# #826 Release Node inventory correction — independent incremental review

VERDICT: **APPROVE**. This corrects a real consumer inventory mismatch introduced by the explicit third Release setup-node job. It does not relax runtime/version validation or alter a native SDK/business gate.

Reviewed only `scripts/tests/node-security-runtime-759.test.mjs` against current HEAD6d42d79e. The complete delta is the Release count2→3 plus two explanatory comment lines. CI inventory remains4; exact patched version22.23.4, array equality and all other package/lock/SDK/runtime/SEA assertions are unchanged. The MCP probe's three source paths and its previous source approval remain valid; no dispatch, commit, rerun or source edit was performed here.

## Independent actual checks

After nvm use22.23.4, ran the exact complete early CI command from repository root:

```
node --test scripts/tests/nsis-ci-setup.test.mjs scripts/tests/windows-ci-feedback-750.test.mjs scripts/tests/node-security-runtime-759.test.mjs scripts/tests/native-ci-stages-760.test.mjs
```

**151 PASS / 0 FAIL / 0 SKIP**. Log: `/tmp/cmspark-826-release-node-inventory-independent-machine.log`.

A private source-derived control extracts the actual inventory test callback through the TypeScript AST and replays it with only the workflow read port varied. It uses current parsed workflow objects, not invented workflow snippets. **13 controls PASS**:

- Current complete inventory accepts the actual workflows.
- Previous actual HEAD callback with Release count2 rejects the current third-job workflow, reproducing the original consumer failure.
- Every one of the seven actual setup-node version fields (CI4 plus Release3) independently changed to22.23.2 is rejected.
- Removing or duplicating the new Release probe setup-node is rejected.
- Removing or duplicating an original CI setup-node is rejected, proving the original CI4 bound remains strict.

Probe and output: `/tmp/cmspark-826-release-node-inventory-independent-controls.mjs` and `.log`. The callback is actual source; assertion failures must be ERR_ASSERTION rather than a missing-port exception. No repository workflow is modified. Scoped git diff-check passes.

## Decision

The single literal update matches the already reviewed actual Release job inventory. Exact per-job versions and original CI count remain enforced. Proceed through the actual incremental GLM source gate before push. The one already-dispatched MCP measurement is unaffected; it is not redispatched or credited as canonical acceptance by this review.

VERDICT: **APPROVE**.
