# #826 workflow CRLF consumer — independent incremental source review

**VERDICT: APPROVE.** The single-test-file patch fixes the actual early experiment regression without changing the workflow producer, runner/collector, schema, original20s business contract or safety gates. This approves the actual GLM incremental source review, not a dispatch or native/CDB acceptance.

Base `013d3484f862c14ddb5df2bb5a250ba8b987b2f2`. Only reviewed source delta: `companion/scripts/tests/mcp-stack-probe-826.test.mjs`, final SHA256 `eb33b8b2694b0dc637ba6324911dafb85bcc0a430f2cc57e147667d810985d66`. Other five experiment code files are byte-unchanged from013d, independently confirmed with scoped baseline diff. Prior full-source approvals/results for those files remain valid. No repository source/config edits, API/model calls, CDB/native launches or dispatches were performed by this review.

## Actual cause and final patch

Original callback searched raw workflow text with literal-LF job markers and restoration patterns. The actual Windows job failed its begin/end assertion before CDB qualification or MCP execution. Independent replay of the **actual013d callback** with the actual current workflow shows LF GREEN and CRLF RED at exactly the same `assert.ok(begin > 0 && end > begin)`. Parsed truth-table checks execute before that boundary and pass in both cases. This source-derived reproduction supports the consumer EOL cause; no SDK/OS cause is inferred.

Final callback retains actual working-tree bytes as the first input, then additionally executes actual-derived LF and CRLF forms. For each form it locates markers with that input's EOL, restores dispatch/package lines with the same EOL, and compares the entire inverse against the matching original raw seal. It does not normalize the actual workflow into one accepted representation before checking it.

Both expected seals were independently recomputed from the **actual original67 Git blob**, rather than from normalized current workflow:

- Original Git/LF: `484078da169a63dfbe5d4fe174568d597dfc48f38d57d05a1e86a67265244480`.
- That exact blob represented as CRLF: `ffff77300b98431c0541a7ce6f4f92722dfb9b444169fea62f917c79fef17c44`.

The current real producer remains SHA `283b6c543bf8229ff9f7d125a9836b383a00eb305f65040379bbc9ced1a3a989`. There is no Git invocation/history dependency in the CI unit; its pins remain constants. No .gitattributes or extra compatibility framework was added.

All previous parsed schema/permissions/credential-persistence assertions, the complete push/manual×tag/branch×absent/false/true truth matrix, package/release dependency checks, upload safety path and complete original raw inverse remain. They now execute for both line-ending forms. The rest of the file is unchanged, including actual20s TAP classification and unique derived source inverse.

## Independent machine evidence

Node22.23.4 via nvm.

1. `/tmp/cmspark-826-mcp-workflow-eol-independent.mjs` and `.log`: **18 controls PASS** using AST-extracted actual old/current test callbacks, actual js-yaml parsing and real assertions.
   - Old LF passes; old CRLF fails at the real boundary assertion.
   - Current actual LF and CRLF inputs both pass. Each current execution restores **both original byte forms exactly**, independently checked against the actual67 Git blob, not merely a mocked SHA.
   - Fourteen negative assertions, seven actual workflow mutations in each EOL form: input default, probe permissions, normal preflight command, package condition, publish condition, unsafe artifact path, and original raw comment. Every mutation is rejected by an actual `ERR_ASSERTION`, not a missing VM port or TypeError.
   - VM YAML values cross the realm boundary via JSON semantics solely to avoid prototype-identity artifacts; assertions and parsed content are unchanged.
2. Actual targeted unit command:
   `node --test --test-name-pattern='manual probe workflow' companion/scripts/tests/mcp-stack-probe-826.test.mjs`
   **1 PASS /0 FAIL /0 CANCEL /0 SKIP**,215.8ms. `/tmp/cmspark-826-mcp-stack-eol-independent-machine.log`.
3. Single-file diff-check PASS; other five frozen source files byte-identical to013d. Unchanged17 Windows controls and previous independent source evidence are reused; no unnecessary original20s/native test rerun was made.

## Disposition

No blocker remains in this bounded consumer fix. Proceed to the required one-file actual GLM source gate. The first manual run41560307958 remains truthfully NOT_RUN for CDB qualification and native MCP business; this local repair does not manufacture a physical sample or native success. Any next experiment invocation requires the parent's separate disposition after the actual review gate, with no change to the original budget or one-run result policy.

**APPROVE.**
