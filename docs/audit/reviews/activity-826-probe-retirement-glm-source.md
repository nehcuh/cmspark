# Temporary probe retirement — actual GLM scoped draft-source gate

**APPROVE the exact local uncommitted six-file draft.** Parent may commit/push only after preserving the final fixed-head run's actual result and synchronizing T0 documents, then run necessary canonical final-shipping-tree CI and fresh normal three-platform Release dry-run. No current remote-retirement, canonical PASS, merge or publication claim.

- Reviewed current HEAD: `aad9d65eac4596fdd68e199410f262ebf3cadaa7`; original conservation reference `67c5e209d239995b930fe1dfcc54f444005e44f8`. Remote final-run identity supplied as `41570019778` at the same fixed head; this gate does not query or determine its result.
- Manifest SHA256: `363b86cad9c68c2ec3df950e3a2a72dd8a086573f7d074597c6076d1855b1f89`.
- Full six-path diff SHA256: `bf1c6c6f85c92ae748a94252958c5e1518a2b339cd32fbd797d30f1c832b265c` (64141 bytes).
- Complete functional two-path diff SHA256: `5943cb647b1740e24d2cf663a6ac8adc9464f69514758ec64820bc5127ad1ce5`.
- Prompt SHA256: `cf245a4bbafa5fd5cec023cacb3e7ab0b985d514ff6a463ef9964340619b70da`; 83092 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `68306ms; input/output tokens 22732/3492. Tools/hooks/MCP disabled.
- Honest input coverage: complete remaining Release/759/persistentCPU test bodies, full functional two-path patch, complete original67 Release and full author/B reports/control source/logs; four deleted old bodies reused from prior exact-hash source approvals using compact deletion preimage/postimage proof. Full six-path patch byte-checked locally and hash-bound; deleted body text was not rereviewed.
- Normal Release retains only the two CPUenv additions over original67; full postimage SHA `7d0fdd3f1212d480760ec646ce492d709eb18e9ed6a79a7e00aeca3b51f0f4a4`. Persistent CPU test unchanged. Original MCP20 failure remains blocking, tool NOT_RUN/UNKNOWN cannot waive normal acceptance.
- No source edit, index change, OS/native call, remote API/dispatch except this actual model review occurred in this gate.

## Actual model review (verbatim)

# GLM-Claude scoped source review — #826 six-file local retirement draft

**Coverage (honest):** I reviewed the complete remaining 3 source bodies (release.yml @7d0fdd3f, 759 test @468818a2, retained CPU test @ecee4f06), the complete functional 2-path patch, the full original67 release.yml blob for conservation, and the compact 4-deletion manifest (preimage SHA256s only). I did **not** reread the ~64KB deleted dead-code bodies — per protocol they were previously approved at those exact preimage hashes. This is not a full-branch audit.

## Findings (trigger → path → impact)

**1. Remove dispatch input + probe job + package `if` → `.github/workflows/release.yml` → PASS**
Current body verified directly: `workflow_dispatch:` is bare (YAML-null, valid); jobs are exactly `preflight|package|release`; package has no `if:`; release still gated `startsWith(github.ref, 'refs/tags/v')`; permissions, matrix, NSIS, all content asserts, SHA256SUMS/SBOM and release body byte-identical to the original67 blob in my side-by-side reading. The only deltas from original67 are the two retained `ONNXRUNTIME_NODE_INSTALL: skip` blocks under "Install companion deps" in preflight and package — exactly the reviewed CPU fix, no third insertion. setup-node count = 2 (preflight+package), both `22.23.4`.

**2. setup count 3→2 → `scripts/tests/node-security-runtime-759.test.mjs` → PASS**
Single-line change `['release.yml', 3]`→`2`; it is the exact inverse of the deleted probe job's one setup-node. The rest of the 759 body (guards×4, SEA pin/shim/notifier tests, Docker digest) is intact. Log: 13 PASS / 0 FAIL / 0 SKIP on Node 22.23.4.

**3. Four deletions → probe/capture scripts + their tests → PASS (manifest-bound)**
Every reference the removed Release job made (`mcp-stack-probe-826.mjs`, both test files in the `node --test` step, `CMSPARK_MCP_STACK_PROBE_826` env, `mcp_stack_probe_826` input) is itself removed by the same patch — no dangling caller. Independent `rg` scan across workflows/scripts/product source: 0 matches. Preimage SHA256s match the frozen manifest; deletion postimages absent.

**4. Retained persistent CPU test → `companion/tests/release-cpu-install-826.test.ts` → PASS unchanged**
`requireCpuInstalls` demands exactly one "Install companion deps" step per job with `env.ONNXRUNTIME_NODE_INSTALL === 'skip'` plus plain `npm ci` — satisfied by the current workflow, and its negative controls (either env removed → ERR_ASSERTION) were exercised. It also pins `npm test` and `npm audit --omit=dev --audit-level=high` in preflight, both present. Log: 3 PASS / 0 SKIP on the actual Mac arm64 host (real CPU addon load). Correctly no Linux/Windows inference claimed.

## Non-issues checked
- No replacement gate: the temporary tool gate is gone, nothing substitutes for normal product acceptance.
- Original MCP20/native/required CI untouched by this draft.
- Temporal status honest: LOCAL_UNCOMMITTED; HEAD aad9d65e and remote run 41570019778 unaffected; 9-control log confirms local-draft-only, index unchanged.

## Verdict — **CONFIRM B draft-source APPROVE**

The B APPROVE is supported: exact six-path scope, byte-conservative restoration (original67 + precisely two reviewed CPU env blocks), self-consistent 759 inverse, zero residual probe references, retained persistent test passing with negative controls.

This approves **draft source only**. Sequencing as stated: parent may commit/push this exact six-file draft **only after** the fixed-head run's actual outcome is preserved and T0 docs are synchronized — not now, and this review is not acceptance/merge/publish. After commit, normal canonical shipping CI must run on the final tree, including the fresh normal three-platform Release dry-run (required because the retained CPU install input intentionally differs from old67/d94). Any original MCP20 canonical failure still blocks; diagnostic UNKNOWN/NOT_RUN cannot waive it. No additional probe, budget, or framework iteration is authorized by this verdict.
