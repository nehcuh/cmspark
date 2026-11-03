# Independent source gate — omitted native-join consumer migration

**VERDICT: APPROVE** the single test-file fix. This is an actual CI-consumer regression repair, not Windows native business evidence.

Source `scripts/tests/native-join-observation-788.test.cjs` SHA256 `0d5397996ddcee1d5fb70c61308a713f2fdecc75133c1304fc24ca2438909273`; patch `/tmp/cmspark-826-native-join-consumer-fix.diff` SHA256 `09e2cb1f1c0193f9ecc1409189dd78efcc79fe9e261063e7a55bdb97486936c5`. Baseline exact head a4ddaf13817c201b5ddb66565c3003e093cc8939. One source, patch and all six previously approved source hashes independently verified: `/tmp/cmspark-826-native-join-consumer-b-freeze.log`.

## Actual red → green

The original required CI command failed in a4dd build125732207522. Its terminal log, downloaded once, is `/tmp/cmspark-826-shipping-a4ddaf13-job-125732207522.log`: **30tests,23PASS,7FAIL,0CANCEL,0SKIP**. First case11 reached the real new terminal generator but omitted its explicit behavior inverse, then failed the unchanged historical b7e49… seal (actual f3681…). Cases15–19,22 executed the new actual wrapper with missing selectionComplete826 state and raised ReferenceError before their intended assertions. This independently observed CI red is reused, without an unnecessary duplicate old run.

I independently ran the same official command under Node22.23.4:

`node --test scripts/tests/native-join-observation-788.test.cjs`

**32PASS,0FAIL,0CANCEL,0SKIP**,567.789459ms, `/tmp/cmspark-826-native-join-consumer-b-tests.log`. Original30 remain; two actual controls are added. The required included Mac795 and ACP795 cases execute, not skip. No TS source changed; previous strict TSC and108+42 checks remain applicable to their unchanged six-source inputs.

## Reviewed semantic delta

- Case11 explicitly uses the existing approved whole-hash-bound restoreInitialFixture826 before the observation/close/JOIN inverse. It does not replace historical b7e49cbd… or any other expected authority. LF/CRLF negative controls reject appended drift and modified behavior markers.
- The native control still extracts and executes the complete current generated LOCAL/ARCHIVE wrapper bodies. Its actual attempt/complete variables are now declared; only the OS-selection leaf is inert. It explicitly requires the new selection branch and removes the old-builder fallback, so old wrappers cannot masquerade as current coverage.
- Original ownership/visibility/document/epoch/controller/window/key/foreground/once-action guards and diagnostic exception behavior remain. Two names/comments now accurately describe one caption selection before the unchanged foreground/key gates.
- Added controls test partial0/1/2 and failed DPI restoration, reentry while selection is incomplete, permanent no-retry refusal after failure, full3 once-only, and postselection stale epoch/controller/window. Those cases reach the actual wrapper's guards; a ReferenceError/TypeError is not accepted as the expected refusal. Full helper/SDK coordinate controls remain in the unchanged separate focused suite.
- Existing action exceptions still propagate after the started latch; original key focus failures still emit their original results. The machine checks do not add native input, grant authority, bypass foreground or change any20/45s budget.

Product, six approved source files, CLI discovery and CI entry are unchanged. No source/index edit, VM/native/UI run, probe, rerun/cancel/dispatch or model call was performed by this reviewer. The a4dd run continues independently; its original build failure remains recorded, and successful other jobs do not erase it. Proceed to the actual GLM incremental source gate; a changed head needs its own normal all-green CI.
