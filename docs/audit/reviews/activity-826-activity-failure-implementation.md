# Activity826 finite failure diagnostics: implementation test handoff

Base `d94d5db5ce30aee7d047baea53c0bc503f766461`. Design approved in `/tmp/cmspark-826-activity-failure-glm-design.md`. Root authored the three fixture/controller changes. This agent changed only assigned test consumers and added the Apps closed reader. No staging/commit/push, CI dispatch, live configuration, input, or production changes.

## Result and frozen paths

**Official isolated runner19 PASS,0 FAIL,0 CANCELLED,0 SKIP. Strict targeted TypeScript PASS. Diff whitespace PASS.**

Six-path manifest: `/tmp/cmspark-826-activity-failure-source-manifest.json`.

Root-owned source, read/tested without editing:

- `companion/tests/fixtures/activity-scope825-windows.cs`
- `companion/tests/fixtures/activity-apps-windows-825.cs`
- `companion/tests/activity-apps-825.test.ts`

This agent's changes:

- `companion/tests/activity-scope825-readiness.test.ts`: actual SetupInputReason and Exception catch language ports; preserve all prior12 cases; one new exact12-reason/UNKNOWN/catch test. Existing short0/1/2 late-event fence tests now assert the actual reason in the failure payload.
- New `companion/tests/activity-failure-observation-826.test.ts`: six source-derived controller/producer/reader/cleanup/inverse tests; no old suite registration or product imports.
- New `companion/tests/helpers/activity-apps825-observation.cjs`: fixed six names, `apps-initial-` prefix, exact phase plus boolean sameSta/two-key payload. Missing/malformed/unknown/pending-only values remain UNKNOWN. It never imports a product module or creates observations/readiness.

## Actual coverage

Scope group13 cases retain original false-ready counterexample, complete real input setup body/ABI/geometry/ownership controls, single-batch/partial results, queued/reentrant qualified late events, stale popup/resize behavior,128 guard results and query counts, old reader failure behavior and close-before-projection cleanup. The new mapper is uniquely extracted from the actual C# switch. Each of the12 current throw strings reaches the actual catch and produces its compact closed suffix. Unknown/private/suffixed/case-altered/empty/null/undefined inputs produce only UNKNOWN; no exception text is reflected. Unknown failures retain Shutdown(2) and the same success fence.

Focused group6 cases:

1. AST-extract actual Apps receipt and exact six-stage Set. Run the original10000ms timer callback for every allowed stage and unknown private string; check final existing-ready behavior and timer/watch/listener cleanup.
2. AST-extract actual nested launch/control initializer and execute it with the **actual receipt function**, not a fake receipt implementation. GUI/headless startup and each fixed command flow through the real fourth-argument callsites. Controlled owned filesystem/process leaves supply inert receipts; no native execution is claimed.
3. Actual receipt retains failure-file priority, JSON parse failure, child close, abort reason identity and listener cleanup.
4. Actual C# Observe body produces its real file-name/payload expressions into the source reader. All six names, false sameSta, missing/malformed/foreign/extra-private-key/unknown/pending-only files, and throwing once-only publication are covered.
5. Actual Node finally reads both fixed GUI/headless folders only after child close. A throwing reader still preserves primary failure and remove/lease settlement; successful projection likewise preserves order.
6. Exact observation-only inverse returns all three genuine d94 baseline source SHA256 values, including every original statement. These hashes were recorded during implementation; runtime tests never require an old Git object or spawn Git, so shallow CI checkouts are supported. Derived LF/CRLF fixtures prove byte-exact inverse and actual mapper/observer/TS-source extraction. Native/compiler source is not rewritten or normalized by these controls. Original90s Apps and180s scope registrations are pinned, and the actual receipt timer remains10000ms.

One initial test run found the expected JSON SyntaxError came from the VM realm, so constructor identity differed from the outer realm. The assertion now checks the actual error name; final19/19 and strict types pass. This was a test-consumer issue, not a product/native failure or an excuse to weaken the original receipt behavior.

## Exact commands

Working directory `/Users/huchen/.codex/worktrees/vision-activity-models/cmspark/companion`, Node22.23.4 selected through nvm:

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null
node - <<'NODE'
const fs=require('fs'),ts=require('typescript');for(const name of ['activity-scope825-readiness','activity-failure-observation-826']){const file='tests/'+name+'.test.ts';const value=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file});fs.writeFileSync('.test-dist/tests/'+name+'.test.js',value.outputText)}
NODE
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js .test-dist/tests/activity-failure-observation-826.test.js > /tmp/cmspark-826-activity-failure-tests.log 2>&1
node node_modules/typescript/bin/tsc --noEmit --strict --esModuleInterop --module commonjs --target ES2022 --types node --skipLibCheck tests/activity-scope825-readiness.test.ts tests/activity-failure-observation-826.test.ts > /tmp/cmspark-826-activity-failure-types.log 2>&1
```

Final official runner and final strict type invocation each independently exited0. Runner log reports19/19; type log is empty on success. Only these two transpiled test files were written into the existing isolated test output; the shared output directory was not removed.

Repository-root `git diff --check -- companion/tests/activity-scope825-readiness.test.ts companion/tests/activity-failure-observation-826.test.ts companion/tests/helpers/activity-apps825-observation.cjs` exited0.

## Limits and next gate

These are CPU source/consumer controls on macOS. They establish that diagnostics preserve the original code statements and runtime control paths represented by actual source, not the historical Windows cause or native readiness. Windows remains failed at the prior observed Apps stage-unknown timeout and scope aggregate refusal until the next approved changed source run supplies actual evidence. No new screenshot, clock, thread, wait, retry, native API or input was added by this diagnostic unit.

Source/test unit is frozen for B's independent source review, then GLM source approval. No CI result or merge/release readiness is claimed here.

STATUS: MACHINE PASS; READY FOR B / GLM SOURCE GATES.
