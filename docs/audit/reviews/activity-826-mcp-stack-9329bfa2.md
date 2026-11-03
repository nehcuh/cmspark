# #826 changed CDB preparation — independent actual result

**Disposition: qualification UNKNOWN at CDB; original native MCP20 NOT_RUN; no native/browser stack sample.** The stage narrows diagnostic preparation, not the old MCP/SDK cause. This run is not canonical acceptance.

[Run41567137668](https://github.com/nehcuh/cmspark/actions/runs/41567137668), exact full head `9329bfa2a5118322b19336d791ffb7ecd005bb20`, event `workflow_dispatch`. Independently confirmed identity on initial metadata. Observed at45-second intervals; read only one terminal Windows job log and the declared safe JSON artifact. No rerun/cancel/dispatch, source/config edit, extra OS/probe/native call, model invocation or raw debugger/private-directory access was performed.

## Actual jobs and steps

| Job / step | Actual result |
|---|---|
| Normal preflight125691239336 | SUCCESS,02:36:13–02:43:42Z |
| Windows experiment125693688441 | FAILURE,02:43:45–02:47:54Z |
| Locked companion install + current build | SUCCESS |
| Original native fixtures build + actual test compilation | SUCCESS |
| Verify derived callback, collector and release controls | 20 PASS /0 FAIL /0 CANCEL /0 SKIP |
| Qualify CDB and run one original20 post-timeout experiment | Actual invocation exits1; qualification UNKNOWN/CDB |
| Safe JSON upload | SUCCESS, artifact13199808331 |
| Package125693690263 | SKIPPED |
| Publish125693690815 | SKIPPED |

Actual Windows build/control gates completed; they do not establish actual CDB functionality or native MCP success. The20 controls comprise14 collector/source controls and6 existing probe/consumer controls, including the real inert Node20000ms timeout-classification control. They are not20 native UI cases.

The gated probe job actually ran after successful preflight and package/publication skipped, consistent with the reviewed explicit true dispatch branch. Raw dispatch inputs are not independently returned by run metadata. Normal Release install-input evidence from prior8fa Linux CPU tests is preserved; this run's full normal preflight also succeeds. Neither is a final normal three-platform package dry-run.

## Safe artifact and exact qualification result

Artifact `mcp-stack-probe-826`, id13199808331,444 bytes, lists exactly `qualification.json` and `run.json`. Only these safe JSON files were inspected. No capture.json or debugger transcript was present/read.

```json
{"schema":1,"status":"UNKNOWN","stoppedAt":"CDB","parserPositive":false,"actualDetached":false,"dummyClosed":true}
```

```json
{"schema":1,"kind":"NON_ACCEPTANCE","originalOutcome":"NOT_RUN","qualification":"UNKNOWN"}
```

Under the exact reviewed current helper:

- Stage CDB is assigned **after** fixed tool resolution, owned workspace creation, actual CPU dummy ready and a valid owned ChildProcess PID. Thus this run passed those preparation points; it is not a TOOL/DUMMY_READY outcome.
- The first unsuccessful qualification operation was in the CDB execution/result group (spawn/run/exit/output/work-limit or thrown execution). PARSER is assigned only after an okay tool result, so actual parser qualification and detach pong were not reached positively.
- `parserPositive:false`/`actualDetached:false` are not proof of unparseable vendor output or a failed qd; they are untouched downstream defaults for this stop.
- `dummyClosed:true` is positive actual dummy-close evidence. It is not a native MCP cleanup receipt. A kill request alone cannot set that flag in this source.
- The fixed stage cannot distinguish tool timeout from bad exit, spawn failure, output overflow or another execution refusal. The approximately7-second command span does **not** establish which occurred. No raw output was read to expand that conclusion. Neither stage nor timing proves the historical8fa or originalSDK cause.

## Original business, stacks and cleanup

The runner requires actual qualification OBSERVED before invoking the derived original case. UNKNOWN/CDB correctly yields originalOutcome NOT_RUN. Consequently:

- No original native MCP20 PASS, timeout, assertion failure, configuration persistence or OS-confirmation receipt was produced.
- No owned MCP native process/three-window business/approved-denied/done receipt exists for this run; its native business cleanup was not exercised.
- No native-pv target or browser-pvr stack observation was produced. Those would be later sequential samples, not deadline reconstructions, but that interpretation is not instantiated here.
- Actual CPU qualification dummy closure is true and separately recorded; normal workspace removal is not independently attested by this safe receipt because an earlier first failure remains CDB.

The three historical invocation receipts remain intact:013d control failure,3e48 install-network failure,8fa all-false qualification UNKNOWN. This fourth run adds a concrete preparation CDB-stage stop and dummy close; **across all four, native MCP business attempts/target stack samples remain zero**. This does not imply zero attempted CPU CDB invocations: the current qualification did enter its CDB execution stage.

## Evidence and disposition

- Final metadata `/tmp/cmspark-826-mcp-stack-9329bfa2-metadata.json`.
- One terminal [Windows job](https://github.com/nehcuh/cmspark/actions/runs/41567137668/job/125693688441) log `/tmp/cmspark-826-mcp-stack-9329bfa2-job.log`.
- Safe artifact `/tmp/cmspark-826-mcp-stack-9329bfa2-safe.zip`.
- Watcher `/tmp/cmspark-826-stack-watch-9329.mjs` exited on run terminal.

Configured tool work3s/6s/6s plus required actual teardown remains the contract; no hard15s claim or original20s change is made. No automatic repeat, timeout change, field expansion or SDK fix is authorized by this report. Parent disposition must address the now-concrete preparation result. Canonical/main all-green, a real fix and final fresh three-platform release preview/tag gates remain outstanding.
