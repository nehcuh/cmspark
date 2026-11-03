# Apps producer fixture — actual GLM scoped source gate

**APPROVE** exactly the two frozen files, conditional on collecting all current-head CI failures and updating T0 before commit. Then run necessary normal Windows/shipping CI; the changed201/4096/4097 producer must actually pass under original15s/30s limits. No actual-Windows/performance, MCP-fixed, canonical-green, merge or release claim.

- Baseline: `1e2fea18ceb82966bb09d1d424cfe32f79a51613`.
- Manifest SHA256: `8dcc875125a2230c83a09203c64d2f7dcb6b852debfab011ed3866c5fefe9917`.
- Full two-path diff SHA256: `d04044ff1c01602763bf3c18e5f809b2fb3d1163cfa7104bb2f45b29ae14f4db`.
- Five-pair source inverse SHA256: `8747fae94c789538b66e06eae3a30faf5d30b981076d84de7ee5573756417e8f`.
- Prompt SHA256: `b211cdca11b9d63309fd6852404d578de65e85d404e3bb1e0af0977b004ef122`; 91580 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `87829ms; input/output tokens 25512/3797. Tools/hooks/MCP disabled.
- Complete current two tests/diff/manifest/inverse pairs, full B/author reports/control source/logs, complete actual productionPS/runPs source, bounded public-CI failure excerpt and five unchanged byte bindings were embedded. No whole raw host log or live config used.
- Local11PASS/2expectedWindowsSKIP and data/catch/inverse controls are not Windows or timing proof. Strict compilation passed. Microsoft primary pre7.5 array guidance was verified and supplied as a short paraphrase plus [official source](https://learn.microsoft.com/en-us/powershell/scripting/dev-cross-plat/performance/script-authoring-considerations#array-addition); it does not establish this failure's unique cause.
- Original15/30/20 budgets unchanged; production code unchanged. Same original error rethrown after bounded diagnostic. No source/index edit, PowerShell/native/OS launch or dispatch performed by this gate.

## Actual model review (verbatim)

# Source Review Verdict: APPROVE (conditional disposition confirmed)

## Scope check
Diff touches exactly the two manifest files. Production `activity-windows.ps1`, `powershell.ts`, MCP-476 test, `ci.yml`, `release.yml` are byte-bound unchanged. No timeout, budget, permission, format-API, or framework change exists in the patch.

## Findings (verified against frozen sources, diff, pairs JSON, B controls)

**1. Fixture builder change — correct, no semantic drift.** `activity-apps-825.test.ts`: per-count `List[object].Add` + one `ToArray` replaces `+=`. Add appends in order (order preserved); all five literal forms byte-match the baseline rows modulo container alias (`Id=5003` duplicate now reads `$fixtureList825[0]`, valid since index 0 exists for 201/4096/4097); counts and the foreign/protected/unresolved/duplicate gates unchanged; production `functions`/`body` extraction untouched. `List[object].Add` is void in PowerShell 5.1 — no stray stdout — and the idiom already exists in the unchanged production script (`$rows = New-Object ...List[object]` / `.Add` / `.ToArray()`), so this is not a new pattern imported into the test. B's data control confirms identical field/order arrays and JSON for all three counts. Impact: removes the test's own O(n²) copies from the single PS invocation; production enumeration cost is unchanged.

**2. Rejection-path projection — minimal and error-preserving.** Fires only on `runPs` rejection; projects exactly `code` (safe integer/null), `killed` (boolean/null), `signal` (SIGTERM/SIGKILL/null); inner catch keeps the original failure; the **same** error object is rethrown. Success path: `stdout` is exactly the resolved value; `JSON.parse` and all 201/4096/4097 assertions unchanged. No stderr/message/args/path added (the command line in the CI error is the pre-existing rethrown error, unchanged). One `runPs` call, two args, no opts → 15s helper default inside the unchanged 30s case, verified by B's AST control. `async t =>` is a valid `node:test` signature change only.

**3. Seal extension — mechanically traceable, original seal intact.** `activity-failure-observation-826.test.ts` adds exactly 5 `replace` pairs before the original d94 inverse. Each `replace` asserts unique occurrence (`split(...).length === 2`); B applies the 5 pairs and requires **whole-file equality** with `git show 1e2...:activity-apps-825.test.ts`, then the original inverse still yields the unchanged `95835e66…` seal across LF and CRLF. No new expected hash, no normalization waiver. AST control confirms the in-file pairs equal the JSON pairs.

**4. Failure causality — correctly bounded.** 15444ms duration against the no-opts 15s `execFile` timeout is a supported deadline hypothesis, not proof; killed/signal/code are absent from the old log. The added diagnostic will supply them on any next failure. PS 5.1 is confirmed by the CI error's `System32\WindowsPowerShell\v1.0` path, so the Microsoft pre-7.5 array-copy caveat applies; the citation is guidance, not proof. Correctly not claimed as unique cause.

## Non-blocking notes
- If the next Windows run passes, no timing evidence is captured to confirm the deadline hypothesis; acceptable — adding instrumentation would exceed stated scope.
- B's Mac runs (11 PASS / 2 expected Win SKIP) establish source/data/inverse correctness only; they are not Windows or performance evidence, and the reports do not claim otherwise.

## Disposition — confirmed as requested
APPROVE the exact two-file patch for commit, gated as you stated: (a) only after current-head CI has fully collected **all** actual failures and T0 is updated — no partial picture; (b) then rerun the necessary normal Windows/shipping lanes under the **original** 15s/30s/20s; (c) the changed-head producer case at 201/4096/4097 must actually pass in those lanes — no substitution by the local run or another lane. No unique-historical-cause assertion, no boundary relaxation, no full-green or MCP-fixed claim, no merge/release approval, no reviewer dispatch at commit time. No separate design round is warranted; the change is mechanical fixture-only.
