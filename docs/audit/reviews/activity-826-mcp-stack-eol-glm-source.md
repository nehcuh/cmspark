# MCP stack workflow EOL consumer — actual GLM incremental source gate

**APPROVE** the one-file correction for commit and, after coordinator gate confirmation, one purposeful changed-source manual invocation toward the **first actual CDB/MCP experiment**. Prior run remains NOT_RUN; no acceptance, merge or release approval.

- Base: `013d3484f862c14ddb5df2bb5a250ba8b987b2f2`.
- Source: `companion/scripts/tests/mcp-stack-probe-826.test.mjs`; SHA256 `eb33b8b2694b0dc637ba6324911dafb85bcc0a430f2cc57e147667d810985d66`.
- Full single-path diff SHA256: `86a07e1431bda22f03667b3ea807dc1ebc166f7d004b1534c7b849d59683f078`.
- Prompt SHA256: `ae9e80a2397ea894577d93b7bd0a0ff8d93102dae8da0f7efda081123a8e9cd6`; 88394 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual modelUsage key `glm-5.3`; process exit `0`, `success`, duration `179932ms; actual input/output tokens 23189/8889. Tools/hooks/MCP disabled.
- Complete current and old test source, full actual diff, current/full original67 workflow blob, five unchanged-source byte proofs, full B report and actual18-control script/log, both targeted1PASS logs, first-run NOT_RUN receipt and prior source approval were embedded. No other source was re-reviewed or changed.
- The actual18controls/targeted1PASS are the machine evidence. Model prose about string equivalence is its source analysis, not an additional executed test.
- Original MCP20 and actual-close budgets, normal/tag paths, and one-outcome/retirement rules remain unchanged. No edits or dispatch performed by this gate.

## Actual model review (verbatim)

## VERDICT: APPROVE

Single-file review of `companion/scripts/tests/mcp-stack-probe-826.test.mjs` (SHA256 `eb33b8b2…`); the only semantic delta is the workflow-consumer test, confirmed byte-identical elsewhere by the supplied hunk.

### Evidence against required checks

1. **Source correctness / fixes the actual failure.** Old callback used literal-LF markers (`indexOf('  mcp-stack-probe-826:\n')`) and LF-only restore patterns. New code derives `eol` from each input (`text.includes('\r\n') ? '\r\n' : '\n'`) and suffixes both job markers, the `workflow_dispatch:` collapse (pattern now `\r?\n`, replacement `'  workflow_dispatch:' + eol`) and the package-`if:` deletion with that EOL. The independent control (AST-extracted actual callbacks, actual js-yaml, real assertions) reproduced old-LF GREEN / old-CRLF RED at exactly `assert.ok(begin > 0 && end > begin)` — matching run 41560307958's test-17 `ERR_ASSERTION` — and current callback GREEN in both forms. Marker collisions are impossible: the dispatch input uses `mcp_stack_probe_826` (underscore), and the artifact path occurrence lacks the two-space prefix; `begin > 0` still rejects `-1`.

2. **Assertion strength preserved or strengthened, not weakened.** Every parsed assertion (input deepEqual incl. `default: false`, `needs: 'preflight'`, probe `contents: read`, `persist-credentials: false`, `release.needs: 'package'`, full push/dispatch × tag/branch × undefined/false/true truth table, upload `if: 'always()'` + `*.json` path) moved verbatim **inside** the loop and now executes for the untouched actual bytes plus both derived EOL forms — both forms must restore to pinned original67 bytes, so any content mutation fails in both branches (14/14 negative controls rejected with real `ERR_ASSERTION`).

3. **Both EOL seals from the actual original67 blob, not normalized evidence.** Constants `484078da…` (LF) and `ffff7730…` (CRLF form) equal the control-recomputed `git show 67c5e209…` blob hashes, logged as `originalGitBlobSha`/`originalLfSha`/`originalCrlfSha`; the LF value is identical to the old test's pin. No normalization-before-acceptance: the actual working-tree bytes are the first Set element; current producer unchanged at `283b6c54…`, and restoration equals original67 + exactly (dispatch-inputs block, probe job span, package `if:` line), verified slice-wise against both embedded documents.

4. **No new CI history dependency.** Seals are hardcoded constants; no `git` call exists in the unit (`spawnSync` remains only in the unchanged TAP-classifier test). No `.gitattributes`/compat framework added.

5. **Boundedness.** Diff is a single test; the five experiment files are byte-unchanged per the manifest/base-equality proof, so the prior six-code GLM APPROVE legitimately covers them. Set-dedup semantics verified: exactly the two EOL forms always execute regardless of checkout form; mixed-EOL input would fail loudly at the marker/seal, not pass silently. The CRLF derivation `replace(/\r?\n/g,'\r\n')` is output-equivalent to test 1's two-step form (checked on lone-CR, CRLF, LF cases) — cosmetic asymmetry only, non-blocking.

### Disposition

Approve **committing this one test correction** and, **after the coordinator independently confirms the remaining gates**, one purposeful changed-source manual invocation toward the first actual CDB/MCP experiment. This correction only repairs the harness bootstrap gate; CDB qualification and native MCP20 remain **NOT_RUN** with zero physical samples, the inert TAP timeout classifier is not native/CDB proof, and original MCP20 timing, deadline/actual-close budget, one-outcome/retirement policy, and canonical acceptance/main/tag gates are untouched. No acceptance, merge, or release approval is granted or implied; no unknown historical physical root cause is asserted — the EOL consumer defect is source-supported and reproduced, nothing more.
