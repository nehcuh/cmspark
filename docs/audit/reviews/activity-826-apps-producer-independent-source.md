# #826 Apps producer fixture — independent scoped source gate

**VERDICT: APPROVE the frozen two-test-file patch for actual GLM source review.** No supported blocker found. This removes demonstrated source-reachable fixture construction overhead and preserves the original test/production budgets; it does not prove the old failure's unique cause or claim Windows timing success.

Baseline `1e2fea18ceb82966bb09d1d424cfe32f79a51613`. Read the complete two-file diff, implementation note, manifest and five source-pair record. Independent hashes match:

- `companion/tests/activity-apps-825.test.ts`: `5c154697b6c028613d4ff11cc0b5a0933583e886566a30d922d1a5de51a56c31`.
- `companion/tests/activity-failure-observation-826.test.ts`: `8765abc61c163dc8ee3e358a59ac54cf07b40c7f6ee726c88ecddbef918e32b4`.

I did not edit shared source/config, launch PowerShell/native UI, dispatch/retry CI or invoke an external reviewer. Existing exact-head CI watcher continues independently and its results are not replaced by this local gate.

## Actual failure and patch boundary

The current shipping Windows-native run's activity batch has27PASS/1FAIL. Its sole failure is the existing201/4096/4097 producer invocation, with generic command failure after15444ms. The actual `runPs` call supplies no options and therefore uses the existing15000ms helper timeout, inside the unchanged30000ms case. This is a supported deadline path, not proof of a timeout without actual killed/signal/code evidence. The real GUI/Apps/capture/scope cases passed in that batch.

Only synthetic fixture row construction changes: repeated array `+=` becomes `System.Collections.Generic.List[object].Add` and one ToArray per count. All five row literal forms remain the same; the duplicate refers to the same first row. Construction still runs once for201/4096/4097 in one PS invocation, with foreign/protected/unresolved/duplicate cases and actual producer functions/body unchanged. Generic List.Add returns void, so these calls do not emit ArrayList-style index values into stdout; the production PS already uses the exact same List[object]/Add idiom. Assigned ToArray does not add a new output command.

The process rejection boundary adds best-effort projection of exactly code(safe integer/null), killed(boolean/null), and signal(SIGTERM/SIGKILL/null), then rethrows **the same original error**. It does not print stderr/message/args/path or add a native observer/framework. JSON.parse and all original actual producer assertions remain after successful execution. Killed/signal are metadata, not unique-cause or actual-close proof.

The existing lineage consumer initially rejected legitimate source drift. Its only extension is five exact unique inverse pairs, mechanically traceable to this current test versus actual1e2 baseline. They restore the whole current file to that baseline before the original d94 inverse. The original full raw seal `95835e6694f4bdbe479a2cc473a4becd520d65f2f35a315a25947e59c7c24aad` and existing LF/CRLF source checks are retained; no new expected hash/normalization waiver weakens them.

## Independent machine evidence

Node22.23.4 via nvm.

1. Existing official isolated targeted entry on current compiled outputs:
   `node scripts/run-tests.mjs .test-dist/tests/activity-apps-825.test.js .test-dist/tests/activity-failure-observation-826.test.js`
   **11 PASS /0 FAIL /2 expected Windows-only SKIP**. `/tmp/cmspark-826-apps-producer-b-tests.log`.
   Full strict compilation had already passed with unchanged frozen inputs and was reused. The original full-seal/LF/CRLF consumers execute here. This local run is not Windows producer/runtime evidence.
2. `/tmp/cmspark-826-apps-producer-b-controls.mjs` and `.log` execute bounded actual-source controls:
   - Extract actual old/current five PSCustomObject literal forms; after only first-row container alias substitution, literals match exactly. For each201/4096/4097 count, controlled expression/data ports produce identical complete field/order arrays and JSON bytes, including the four extra entries. These are data-construction controls, not a PowerShell interpreter or performance measurement.
   - AST-extract the **actual current try/catch**, transpile and execute it with process leaves: integer exit, killed/SIGTERM, invalid/private field types and throwing diagnostic. Exactly one runPs call receives original two arguments/no opts; every path rethrows the same error object and excludes private values from the three-field projection.
   - AST-extract the first five actual Apps inverse replacements, compare with the recorded pairs, apply them and require entire current Apps source to equal the actual1e2 Git baseline. Original958 seal remains.
3. Frozen hashes/diff-check match. Explicit baseline diff of production activity-windows.ps1, powershell.ts, original MCP case and CI/Release is empty. No helper timeout/case timeout/MCP timeout change exists.

## Disposition

**APPROVE** for the one actual GLM source gate; no separate architecture/budget design round is warranted. The next changed-head actual Windows producer assertion must still execute and pass under the original15s/30s limits. Local source/data checks do not establish its elapsed time. If it fails, the finite actual process projection can inform the supported failure classification without discarding the original error.

Current1e2 CI must finish independently and all actual failures must be preserved before coherent next-head CI. No old/diagnostic PASS or another lane can compensate for this required job failure. There is no reason to alter production enumeration, loosen201/4096/4097 assertions or increase time/permissions based on this review.
