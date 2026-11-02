# Main Windows directed result —b585eb6b

VERDICT: FAIL on main's actual MCP bootstrap case. Feature source tree is unchanged from accepted8fce; prior feature acceptance remains evidence, but it does not turn this failed main run green.

Main b585eb6bc29baa2e2a0314dad2793de29a72209b, tree8772671a14fe696dbf08cec47ca8f18722b5857c (same accepted final tree per root). CI41503331363 attempt1; Windows-native job125476159587 completed FAILURE. Unique failed step Native desktop bootstrap and process acceptance (#480). Actual passive activity capture and local OCR (#758) was skipped. No source review restart, mutations or reruns were performed.

First failed case: `#476 actual native MCP form + OS-only confirmation approves update/add and denies update`, test23, desktop-native-mcp-476.test.js:55:25, testTimeoutFailure/ERR_TEST_FAILURE, original20000ms timeout (reported duration20003.05ms).

Finite progress: authenticated=true, windowRequested=true, postAuthRequestMask0; native phases only ready_accepted/env_callback; navigation null; exited=false at pre-cleanup projection; windows0, approved/denied/done false. Exactly6 closed BOOT rows:

| Point | Edge | Native250ms bucket | Code | Presence |
| --- | --- | --- | --- | --- |
|5 CreateEnvironment |entry |0 |0 |n/a |
|6 environmentCallback |entry |7 |0 |n/a |
|6 environmentCallback |callback |7 |0 |present |
|7 CreateController |entry |7 |0 |n/a |
|7 CreateController |return |9 |0 |n/a |
|5 CreateEnvironment |return |9 |0 |n/a |

The observed interval is after CreateCoreWebView2Controller returned S_OK and before any point8 controller callback observation. The environment callback was observed with success and nonnull environment. No point8, get_CoreWebView2, navigation or business request was observed. These bounded missing rows do not prove why the callback was not observed or identify a physical/historical root cause. Native-first-hook clock cannot be subtracted from Node time. ProcessInstanceAttributed remains false.

A later separate #480 host authenticates, navigates and cleans up successfully; its success does not replace the failed MCP case. The main full census is separately monitored. Public log: /tmp/cmspark-825-windows-main-b585-native-job.log.

## Final main census result

Windows census job125476159685 completed SUCCESS with no failed steps. Public artifact13172870080 is named windows-census-b585eb6bc29baa2e2a0314dad2793de29a72209b-1. Per root's identical-tree scope, the final8fce complete case/native evidence is reused rather than reopening source/case-hash review. Main overall Windows is still not green because its directed native job failed as above.

The independent actual-C++ discrimination experiment further establishes that the same6 BOOT+2phase strings permit three states: wrapper returned/no callback entry, wrapper still in last send after peer acceptance, and callback entered but earliest phase send not peer-visible. Thus absent callback observations must not be phrased as absent callback execution or completed wrapper unwinding. See /tmp/cmspark-825-mcp-b585-discrimination-independent-design-review.md and /tmp/cmspark-825-mcp-send-discrimination-independent-exact.log. This does not identify which state happened on main.
