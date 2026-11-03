# MCP826 resumed investigation — setup/build/environment lane

Frozen source `c5776f1d54a7d4b920e6c5bfde45691496b947f8`. Independent read-only analysis; no agent findings were requested or exchanged. Only current/frozen repository sources and existing logs were used. No external API, CI/native/UI probe, compiler, retry, budget change or shared edit.

## Conclusion

The inspected setup path does **not** currently support an environment/profile/fixture repair. Actual-source checks reproduce identical MCP generated source and compiler arguments across the two lanes, and the observed failure has already passed profile creation, bootstrap authentication, environment creation callback and synchronous controller API return. A cheap reproduction of the missing controller callback has **not** been achieved by this lane; do not claim these source controls reproduce the Windows failure.

An important exclusion: the failing273 "census lane" receipt occurs in the **early bootstrap step**, before the complete census launcher. Its filtered child environment/reporter/owned short-path setup cannot explain this particular receipt. Root's separate shared native-host/controller investigation is therefore the relevant next source-level boundary, rather than changing census environment, config isolation, cached profiles or compilation flags without a reproduction.

## Actual logs

| Existing run/path | MCP elapsed | Actual outcome / phase boundary |
| --- | ---: | --- |
|273 native |8662.858ms|PASS, mask7, all8 phases,3 windows/approved/denied/done/exit. Controller callback at native bucket27 after API-return bucket3. |
|273 census lane early bootstrap |20008.0087ms|FAIL original20000ms; authenticated/windowRequested=true, mask0, phases ready_accepted/env_callback. BOOT5/6/7 finish with API7 and wrapper5 return bucket15; no callback8. Snapshot OBSERVED offset1,version108,flags751. |
|8aa census lane early bootstrap |7630.6912ms|PASS, mask7/all8 phases; API7 return bucket2, callback8 bucket24. |
|f3 native |20004.0878ms|FAIL20s; same phase pair/mask0; API7/wrapper5 return bucket11; snapshot751 offset2. |
|f3 census lane early bootstrap |20004.6301ms|FAIL20s; same phase pair/mask0; API7/wrapper5 return bucket18; snapshot751 offset2. |

Raw logs: `/tmp/cmspark-826-windows-native-273c1aff.log`, `...windows-census-273c1aff.log`, `...windows-census-8aa98dbb.log`, `...windows-native-f3edcae6.log`, `...windows-census-f3edcae6.log`.

273 census log3711–3727 preserves the actual MCP timeout. The same invocation's next ordinary native Windows-host metadata case also fails20s (3731–3742), authenticated and waiting-metadata with only ready/env phases; later visual acceptance fails too. That ordinary host case does not use MCP's clone/snapshot or form. This is a concrete shared-path symptom, not proof of its OS cause and not an independent controlled removal experiment.

Native bucket deltas can be compared **within that native clock** (e.g. API-return3→callback27 on the successful273 native run). The snapshot target is Node-case start+18500ms. These clocks do not share an observed origin, so do not subtract a BOOT bucket from18500 or infer an exact native wait duration from that subtraction.

## Build and fixture identity

Current `build-desktop-windows.mjs:235–244` builds the MCP family once per same `--test-fixtures` build. Both matrix lanes use the same build step and compiler invocation. The real MCP call has `/DCMSPARK_DESKTOP_TEST_PHASES` exactly once and no D480_VISUAL mode. Native/census do not select different MCP macros or forms.

The genuine `desktopMcpFixture`→`desktopMcpBootstrapObservationFixture773`→snapshot transformation is deterministic, inverse-checked and identical for both lanes. Generated frozen MCP source SHA256: `109440989f672f90ad09be0c841d6024b6cfa4f2c16a17a8b69b710a71aa72d9`. The original profile creation statement remains exact in it. This proves source/plan identity, **not identical compiled EXE bytes across separate VMs**; no such binary digest was recorded in these logs.

Ten relevant inputs (host, launcher, native builder, Windows builder, MCP/BOOT/snapshot transforms, snapshot header, original MCP test, snapshot preparation helper) are byte-identical at f3/8aa/273/c577. Mixed PASS/FAIL therefore does not track a changed setup/fixture/compiler-source delta in those inputs.

## True consumer / environment boundary

Frozen CI parsed positions: early native bootstrap15, complete census21 (zero-based). The failing step runs the common official `run-tests.mjs` four-file command with no step env override. The later `windows-census.mjs` childEnvironment/censusStageEnvironment and NODE_OPTIONS reporter are not in this invocation. Node's official runner does use its existing data-dir preload, private run root and Windows test-concurrency1; these are common to both early lanes.

Native-specific preceding steps differ: extension dependency installation/staged Windows scripts and, since8aa, the reviewed Activity UI/input history. Census keeps its different preceding collector work. Those contextual differences are real, but8aa census PASS and f3 native FAIL already refute a deterministic "must run Activity first" prerequisite. No context is promoted to a physical cause.

`launcher.c:107–131` produces only PATH/SystemRoot/TEMP/TMP, deriving Windows/temp paths through the existing Windows APIs; arbitrary Node provider/WebView/proxy/PATH overrides are intentionally excluded. `CreateProcessW` uses that block, no inherited handles and inherited current directory. LOCALAPPDATA/USERPROFILE are not forwarded, by the current shared security contract, in either lane. There is no evidence justifying broadening that environment; absent variables alone are not a reproduced cause.

The installed runner metadata in the inspected pass/fail logs is the same: runner2.338.2, Windows Server2025/10.0.26100, image windows-2025-vs2026 version20261030.294.1. This does not prove identical runtime process/system state. The compile SDK is pinned WebView2 1.0.4258.31; the actual installed Evergreen runtime version is not emitted in these logs, so SDK and runtime must not be conflated.

## Profile, assets, channel and sample preparation

- `DesktopHost.cpp:408–410` obtains a Windows temp path, creates an exclusive random `cmspark-desktop-<random_id>` directory, then passes it explicitly as the WebView UDF. It does not use CMSPARK_DATA_DIR as the UDF, adopt an existing browser profile or depend on the MCP config directory. Actual observed environment callback with successful return/present environment means this path passed its preceding GetTempPath/CreateDirectory guards in this failure. A profile collision/missing parent/path-limit fix is unsupported here.
- Original MCP test sets its private config directory inside the lease callback, creates registry/channel/listener, and only then dynamically prepares the snapshot and launches. Preparation validates/copies the owned binary and all9 original assets; it does not rebuild or choose another protocol/endpoint. Source isolation hasn't changed across these outcomes.
- The actual HMAC host authenticated and the channel accepted the window request. A missing channel port, failure to open the bootstrap identity carrier or complete failure to launch cannot explain those same receipts. No renderer request, navigation or form/config business begins before the absent controller callback. Do not "fix" mcp.list/config/form payload preparation for an earlier unobserved controller boundary.
- Snapshot seed deadline is captured at original test entry, before lease/config/copy work. Target remains deadline−1500ms. Native worker starts on actual ready and validates a future target before one sample. A751 OBSERVED receipt proves those seed/file/timing checks succeeded and a stable read was committed inside the old budget. A theoretical late seed/lease starvation path would yield UNKNOWN rather than this observed751 and does not reproduce the current trace. Do not move the budget start to hide setup time.
-751 decomposes to EnvApi/EnvLeave/ControllerApi/WrapperLeave/OuterDispatch/Armed/EnvEntry/SendReturned. ControllerEntry/ControllerLeave are absent. The last recorded diagnostic send returned successfully and its observation scope ended (stage6/result0/known); the environment callback and wrapper have left, and at least one armed outer dispatch returned. This excludes a current wait inside that last send or controller API invocation, not every possible later message-loop/native wait. It does not prove the UI pump continued making progress until timeout.

## Cheap actual-source controls and falsification

One local Node22 CPU-only source evaluation was recorded at `/tmp/cmspark-826-mcp-resume-setup-controls.log`. It reads frozen blobs via `git show`, imports only frozen pure JS transformation modules through in-memory data URLs, and executes the **actual checked(cl,args,options) argument statement** in a VM with checked replaced by a recorder. No compiler/native process is started. Results:

-40 blob hashes (10 inputs×4 heads) match by input.
- Real two-layer derivation/inverse succeeds; original profile statement is preserved exactly.
- Real compiler argument statement yields identical native/census argv, phases macro once.
- Actual parsed workflow proves early bootstrap precedes complete census and does not invoke filtered census env.
- Real launcher source's finite output-key inventory is PATH/SystemRoot/TEMP/TMP, independent of CMSPARK_DATA_DIR.
- Existing raw progress/timing receipts are parsed without synthetic SDK outputs.

Falsifiable candidate decisions:

| Candidate | Cheap check / actual counterevidence | Decision |
| --- | --- | --- |
|Missing macro / divergent MCP test build |Actual argv recording and four-head source equality |No supported lane-specific fix. Would reopen only for an actual built-input/digest discrepancy. |
|Complete census filtered env loses a required key |Failure occurs before that producer is invoked |Rejected for these receipts. A later full-census failure must be classified separately. |
|Profile creation/config isolation fails before startup |Actual env callback + successful API/present environment; explicit random UDF and true channel auth |No source reproduction; changing roots/cache/authorization is unjustified. |
|Snapshot/prep consumed whole budget or sample is corrupt |Valid751 fixed sample and authenticated native path |Not a reproduction of this trace. Do not shift/extend deadline. |
|MCP form/asset/message-port request blocks startup |No controller/nav/renderer yet; channel already authenticated; ordinary host also fails later |Focus next on shared native controller/message-loop path, not form data setup. |

No new setup-lane fix is recommended before a candidate's failure is reproduced using its real consumer. These controls narrow the search; they do not explain why the controller callback is absent on these Windows instances. No extra diagnostic layer or unchanged CI run is proposed by this lane.

STATUS: SETUP/BUILD CONTRACTS CONSERVED; OBSERVED FAILURE NOT REPRODUCED IN SETUP LANE; SHARED NATIVE CONTROLLER BOUNDARY REMAINS THE SUPPORTED INVESTIGATION TARGET.
