# #826 cross-platform activity test-path fix — independent source review

VERDICT: **APPROVE** the actual frozen single-test-file patch. No blocker remains. This corrects the reproduced Windows-only harness mismatch; it does not change native behavior or convert the failed8aa job into a pass.

Path: `companion/tests/activity-failure-observation-826.test.ts`; reviewed final SHA256 `e54d4ac877287d50f5e237195a14ec070ab4b9509e71c7fba9d0d7fab8657f2a`. Root authored the uncommitted patch. I read the complete actual diff and independently ran actual source controls and the official isolated tests. No shared source edit, commit, dispatch, native input/UI or live config access was performed.

## Actual change

receiptHarness now accepts a pathApi (host path remains the default), builds one synthetic owned root and ready/failure filenames through that same API, and uses it consistently in its actual receipt context, request path, fake spawn/map and response map. Tests populate returned readyFile/failureFile keys instead of POSIX literals. Actual launch/control and all original failure/parse/close/abort/listener assertions now execute with both path.posix and path.win32.

The actual-finally test derives its fixed GUI/headless expected strings using the same selected path API and passes that API/root into its actual-source VM. It still requires exactly kill→closed→projectGUI→projectHeadless→diagnostic→remove→settled, or the original throwing-reader short branch followed by remove/settled. The original primary error identity remains required. It does not normalize away actual Windows data or modify the receipt/finally source to satisfy an expectation.

All changes are in the harness and its existing assertions' path values/iteration dimensions. No assertion was removed or relaxed. The real Apps controller/receipt/finally, C# fixtures, scope native/helper and CI workflow independently compare byte-identical to HEAD. Existing source inverse pins and original10s/90s/180s gates remain.

## Independent verification

Node22.23.4 selected with nvm, Companion cwd:

```
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js .test-dist/tests/activity-failure-observation-826.test.js
```

**19 PASS / 0 FAIL / 0 SKIP**,262ms. Log `/tmp/cmspark-826-path-harness-independent-source-tests.log`. Root's targeted strict noEmit check is reused; the final source-only indentation adjustment has no semantic change.

The prior immutable8aa exact reproduction remains the red baseline (`/tmp/cmspark-826-path-harness-independent-repro.md`). I reran its actual AST-bound two consumers against the new actual shared-source text, not just a proposed string mutation:

- Actual8aa callbacks with path.win32: two expected RED/ERR_ASSERTION outcomes.
- Actual8aa callbacks with path.posix: both GREEN.
- **Current actual frozen callbacks** under win32 and posix outer path ports: all GREEN; the current callbacks additionally execute their internal explicit posix/win32 loops.

Eight expected outcomes pass. The actual receipt/finally consumer code is unchanged throughout. Script/log `/tmp/cmspark-826-path-harness-independent-source-control.mjs` and `.log`.

Source SHA and real implementation preservation: `/tmp/cmspark-826-path-harness-independent-preservation.log`. Scoped diff-check passes. No pure model result is represented as native Windows execution.

## Decision

The patch repairs the exact path-representation causes seen in8aa while preserving original failure priority, parse/close/abort semantics and exact cleanup order. Proceed through the actual GLM incremental source gate. Original9 native business cases already passed in8aa, but this patch still requires changed-head canonical tests and all original job gates to pass before acceptance; no rerun or timeout waiver is approved here. The8aa census watch continues independently.

VERDICT: **APPROVE**.
