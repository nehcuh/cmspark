# MCP826 one-off NON-ACCEPTANCE measurement receipt

Observed read-only: [Release run41533046015](https://github.com/nehcuh/cmspark/actions/runs/41533046015), attempt1, workflow_dispatch, exact head `6d42d79ee956251b02a6471d4ba76682046ae930`. API head and actual checkout log agree. No source edits, dispatches, retries, cancellations or timeout changes were performed by this watcher.

## Actual workflow outcome

- Preflight job125577887651: SUCCESS,21:57:47Z–22:05:08Z.
- Fresh Windows job125581590240, `MCP latency measurement (NON-ACCEPTANCE)`: SUCCESS,22:05:11Z–22:07:58Z. Its configured sequence built fixtures/compiled tests, ran five controls, then ran only this MCP measurement; no preceding native UI family was run in this job.
- Package job125581593536: SKIPPED. Publish job125581594281: SKIPPED. This was a dedicated measurement, not packaging, a release dry run, or release acceptance.
- Whole workflow: COMPLETED/SUCCESS. Runtime Node22.23.4 was configured.

Metadata was queried at approximately45-second intervals. The single probe job log was downloaded only after API terminal SUCCESS:

`gh api repos/nehcuh/cmspark/actions/jobs/125581590240/logs > /tmp/cmspark-826-mcp-probe-6d42d79e.log`

## Source/workflow controls actually executed

Log240–278: **5 PASS,0 FAIL,0 CANCELLED,0 SKIP**,345.4592ms total. All named cases really ran:

1. Actual compiled MCP differs only in registration timeout; canonical source and snapshot unchanged.
2. Exclusive temporary sibling is removed after success/assertion failure/cancellation; pre-existing file survives.
3. Real official runner discovers sibling and preserves CJS dirname/imports and config isolation.
4. Normal local invocation refuses before reading/launching case.
5. Actual release YAML preserves ordinary release paths and does not package/publish an explicit probe.

The measurement banner at285 states `NON_ACCEPTANCE registrationMs=60000 canonicalMs=20000 snapshotDeadlineMs=20000`; explicit measurement environment was1. Canonical20-second registration and original snapshot deadline were not altered by the one-off derivation.

## Actual complete MCP measurement

Log288–304: **1 PASS,0 FAIL,0 CANCELLED,0 SKIP**. The actual native case elapsed **7963.9014ms**; runner total8502.2488ms. The case therefore completed below20 seconds, even though this measurement allowed60 seconds.

Native business receipt:

```json
{"native":true,"syntheticNativeButtonActivation":true,"humanApprovalClaimed":false,"windows":3,"approved":2,"denied":1,"persisted":true,"rendererPrivatePayload":false}
```

The unchanged actual test additionally asserts accepted update command and private environment preservation, accepted add command/Chinese spaced argument/disabled state, pending manager count0, exact persisted config equivalence, every required window/save/done receipt, and native exit code0. Its successful completion includes original finally cleanup and surface lease settlement/release; no weakened receipt substitutes for those assertions.

Actual progress projection:

- authenticated=true; windowRequested=true; postAuthRequestMask=7.
- All eight phases observed: ready_accepted, env_callback, controller_callback, navigation_callback, document_post_attempted, renderer_callback, renderer_admitted, renderer_send_attempted.
- Navigation: all HRESULT-success flags true, isSuccess=true, sourceMatches=true, readySample=true, webErrorStatus0.
- exited=true, windows3, approved=true, denied=true, done=true.
- Native bootstrap rows include controller callback and every subsequent configured API/resource/send site. They retain their native-first-hook250ms clock and processInstanceAttributed=false; no cross-clock elapsed/cause is inferred.
- snapshot825 status=UNKNOWN. The original target remains deadline−1500ms (18.5 seconds after original case deadline origin). This case completed in7.964 seconds, so there is no18.5-second observed snapshot to interpret. UNKNOWN does not identify a failure or provide a synthetic state.

Cleanup fact precision: the native business explicitly awaited real exit0; the case and official runner both passed their full cleanup path. GitHub's later post-job cleanup reports one orphan `vctip` terminated at22:07:56Z (log321–322). Thus the receipt does not assert every toolchain descendant had already exited naturally; it does not infer a historical compiler, SDK or UI cause from that orphan.

## Decision

This run is the predeclared **≤20-second, non-discriminating outcome**. It proves this dedicated measurement completed the entire original MCP business under20 seconds on this particular fresh job. It does not establish that a previous timeout would have completed during20..60 seconds, does not establish cold-start/SDK/root physical cause, and does not repair or replace failed canonical20-second acceptance runs. No follow-up unchanged measurement or budget expansion is justified by this result alone.

STATUS: MEASUREMENT SUCCESS; HISTORICAL CAUSE NOT DISCRIMINATED; CANONICAL ACCEPTANCE UNCHANGED.
