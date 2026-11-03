# CDB execution preparation — actual GLM scoped design gate

**APPROVE** starting exactly two-file implementation: collector and focused CJS test. Follow with machine → B independent source → actual GLM source → parent authorization before any single changed-input Windows invocation.

- Baseline: `9329bfa2a5118322b19336d791ffb7ecd005bb20`; no implementation diff.
- Prompt SHA256: `098644ca60b5c1f74e5898511b198680308e06b5f6baa290ec6e53ca616335d7`; 80172 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `86227ms; actual input/output tokens 20925/3221. Tools/hooks/MCP disabled.
- Complete current collector/test, independent design and actual9-control source/log, actual9329 report+safe JSON, runner ordering and project checked() preparation context were embedded; earlier unchanged-source gates reused. No executable edit, actual CDB/native or dispatch.
- Explicit budget change: **only CPU qualification CDB useful work6000→120000ms**. This is a new preparation window, not old-budget conservation or empirical CDB proof. Post-timeout3/6/6, originalMCP20, ready2/pong1 and mandatory actual close remain. No hard120s total/teardown promise.
- Outcome/exitCode preserve first invalidating event and actual-close-only code; final consistent safe field name may be toolOutcome. Prototype evidence is feasibility only; actual-source tests must cover every failure path and current producer result shape.
- Four historical NOT_RUN receipts/round limits remain; no timeout/signature cause or MCP repair inferred. No source/dispatch/acceptance/merge/release approval.

## Actual model review (verbatim)

**VERDICT: APPROVE the minimal two-file revision. Implementation may start on exactly `mcp-stack-capture-826.cjs` + `mcp-stack-capture-826.test.cjs`, then machine gate → B source gate → actual GLM source gate → parent authorization of ONE purposeful changed-input Windows invocation.**

## Supported findings (trigger → supported path → actual impact)

**1. Classification need is real.** Trigger: actual 9329 `qualification.json` = UNKNOWN/`CDB`, `dummyClosed:true`, downstream false, original NOT_RUN; current `runBounded826` collapses timeout/overflow/error/nonzero/signal into `ok:false`, and the ~7s span proves none of them. Supported path: add one closed fixed enum + actual-close exitCode; `stoppedAt:'CDB'` then also carries which failure class occurred, with NOT_RUN/null defaults for earlier refusals. Impact: the next single invocation distinguishes CDB failure mode without reading raw output or re-running; nothing is asserted about 8fa or the original SDK.

**2. Prototype semantics match the contract.** The VM patch is first-event-wins (`refuse(cause)` guarded by `invalid||done`; timer→TIMEOUT, cap→OUTPUT_LIMIT, spawn/no-PID→ERROR, catch→ERROR), computed SIGNALLED/OK/NONZERO_EXIT only at close, `exitCode` copied solely from the real close callback when `Number.isSafeInteger`, else null. Controls prove: 6 classes correct; timeout-then-close0 stays TIMEOUT/0; held close + later error preserves TIMEOUT, resolves only on actual close; qualifier real-shape run invokes only 120000 and reaches OBSERVED/COMPLETE; post budgets remain [3000,6000,6000]; repo source byte-unchanged after execution. Impact: feasibility and boundary preservation are controlled-source evidence, correctly not claimed as CDB/Windows evidence.

**3. Budget revision is correctly bounded.** Only the pre-business qualification CDB call 6000→120000; `debug826` 6000/6000, CIM 3000, ready 2000, pong 1000, original MCP 20000 unchanged; runner MJS untouched (its `sourceHash`/`compiledHash` cover the original test, not the collector, so no drift trip). `checked()` 120000 is cited as preparation-scale context only, not CDB evidence. Combining classification + window in one changed-input attempt avoids a metadata-only run followed by a second VM if the result is TIMEOUT. Impact: no SLA relaxation, no retry/ladder, no hard total-teardown promise; worst case is 120s work plus mandatory actual close before workspace removal — the same open-ended close fence that already exists at 6s, not a new risk.

**4. Privacy/observation contracts hold.** New fields are a fixed enum literal and integer/null; no raw error/signal/args/paths/streams projected. `query826`/`debug826` read only `ok`/stdout/stderr, so extra fields are inert to existing consumers. OBSERVED/COMPLETE still requires real parser qualification, pong, actual dummy close, cleanup; first-failure `stoppedAt` preserved through `finally`.

## Implementation-gate items (not blockers; lock in the two files)

- **Field naming must be finalized once** (`toolOutcome` vs `executionOutcome`) and used consistently in collector + tests; semantic contract is fixed either way.
- **Qualifier fixtures must consume the real producer shape**: update `okay()` and inline `{ok:false,…}` fakes to include the new fields, and update the exact deepEqual qualification objects with the two defaults — the stale-mock schema is the main regression vector; the design gate already demands this.
- Confirm only these two new keys enter `qualification.json` (schema 1 retained, additive), the qualifier call is exactly 120000, both post-timeout CDB calls stay 6000 and CIM 3000, and runner/workflow/original-test bytes are byte-compared unchanged.
- Keep the no-new-cleanup-deadline rule: an unkillable child at 120s still holds until actual close; that is the pre-existing deliberate fence.

## Scope confirmations

Historical four NOT_RUN receipts and round limits are not reset; the 7s span is not labeled a timeout and no signature/cause claim is made; dispatch-now, acceptance, merge/release, MCP-fix claims, and the fresh three-plateform final shipping dry-run/canonical main/tag remain outside this review and unapproved here.
