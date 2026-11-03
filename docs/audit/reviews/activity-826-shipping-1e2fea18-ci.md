# #826 normal shipping CI1e2fea18 — independent exact-head result

**VERDICT: BLOCKED —9 required checks SUCCESS,1 FAILURE.** The sole failure is the Windows-native Apps PowerShell producer fixture. All other exact-head checks completed successfully, including the complete Windows census and Mac native/close paths. Another VM or the earlier diagnostic PASS does not compensate for this required red check.

Shipping full head `1e2fea18ceb82966bb09d1d424cfe32f79a51613`; all normal runs are `pull_request` for this exact head. CI [41571547261](https://github.com/nehcuh/cmspark/actions/runs/41571547261), ARM41571547264, Linux integration ARM41571547260 and Session41571547297. Watched45-second metadata until all10 checks were terminal. Each terminal job log was downloaded once; only declared public census JSON was inspected, never sealed ciphertext/raw recovery. No edit/rerun/cancel/dispatch/model/OS probe was performed by this reviewer.

## All10 exact-head checks

| Check | Job | Final |
|---|---:|---|
| build |125705344630|SUCCESS|
| smoke Ubuntu |125705344650|SUCCESS|
| smoke macOS |125705344649|SUCCESS|
| smoke Windows canonical/census |125705344712|SUCCESS|
| smoke Windows-native |125705344626|**FAILURE**|
| Linux X11 native activity |125705344356|SUCCESS|
| acp-history-restart |125707960305|SUCCESS|
| ARM acceptance |125705344511|SUCCESS|
| Linux integration ARM |125705344217|SUCCESS|
| Windows session persistence |125705344450|SUCCESS|

This is normal product CI after probe retirement, not the prior NON_ACCEPTANCE workflow. Local subsequent uncommitted fixture repair is not part of these inputs/results.

## Actual required failure / Windows-native28

[Windows-native job](https://github.com/nehcuh/cmspark/actions/runs/41571547261/job/125705344626) activity batch: **27 PASS /1 FAIL /0 CANCEL /0 SKIP**. The28 are nine original selected cases plus19 source/controlled cases, not28 native UI cases. The original nine contain five CPU/extraction controls and four Windows-required paths.

The sole failure is case6, `#825 Windows PowerShell Apps producer keeps 201/4096 identities, excludes foreign/protected paths and refuses4097`,15444.1077ms, `testCodeFailure`. Actual error is a generic failed powershell.exe producer.ps1 invocation with no stderr or reported exit/killed/signal field; stack reaches Node child_process exithandler. The source call omits opts, so existing runPs15000ms is a concrete reachable deadline inside the unchanged30000ms case. The elapsed time alone does not prove timeout or a unique physical cause.

Other required Windows paths in the **same failed job** are non-skip PASS:

- Apps GUI process identity across visible/minimized/hidden/no-window plus foreground unchanged:21940.2194ms; real GUI all six initial points true, headless MAIN_ENTER true.
- #758 passive capture/local OCR/identity and minimized/occluded refusal:9153.0323ms; source unchanged, original close phase reached.
- scope825 real two-column main/independent windows:23761.4833ms; title gate/local OCR/crop, side-column decoy refusal, model input excludes sidebar, visible embedded image preserved, layout resize refusal and pending cleanup all true. Initial ready/input/qualification points positively observed.
- All19 source controls and five CPU/extraction cases pass.

Because this first native activity step failed, that job's later original MCP/bootstrap and interaction steps did **not execute**. No native-lane MCP PASS is claimed. The independently completed other VM remains separate below.

## Canonical Windows: complete actual census

[Windows canonical job](https://github.com/nehcuh/cmspark/actions/runs/41571547261/job/125705344712) SUCCESS. Its normal directed bootstrap original MCP20 is non-skip PASS8621.6148ms; interaction workspace PASS2818.1273ms. Public accounting then shows the **complete canonical census**:

- 9565 leaf PASS +67 SKIP =9632 leaves; **0 FAIL /0 CANCEL**;157 suites.
- `complete:true`, `execution_complete:true`, `tests_exit:0`, outcome PASS; all three canonical batches including settings complete.
- Full-census original MCP20 non-skip PASS1747.0792ms.
- Apps producer201/4096/4097 non-skip PASS8857.4711ms on this independent VM. Its success does not override the native VM failure.
- Scope readiness13 and failure-observation6 source cases all PASS. Actual GUI/scope native cases are platform/env-selected SKIP inside the full census; their real execution is evidenced by the dedicated native lane, not fabricated from those skips.
- Private CPU artifact/runtime consumer non-skip PASS1444.9685ms.
- Permanent Release CPU installer/backend/install-contract tests all non-skip PASS; actual Windows CPU addon load15.058ms.

Declared artifact13203355110, `windows-census-d754026b2cbf29f5ba4151074d75b230473c2eff-1`. Public identity run41571547261/attempt1, PR merge head d754026b2cbf29f5ba4151074d75b230473c2eff; its tree `24ed079b95ff38d4f3b28217d0e6fffe7ea7d174` independently equals exact shipping1e2 tree. Only accounting/result/identity/discovery public JSON was read; sealed/*.enc/envelope/recovery content was not opened.

Safe derived accounting: `/tmp/cmspark-826-shipping-1e2fea18-census-sanitized.json`; public archive `/tmp/cmspark-826-shipping-1e2fea18-census.zip`.

## Mac native business and full close

Mac job SUCCESS and no not-ok result in its actual log. Normal original MCP20 PASS10420.512708ms, actual three OS windows/two approvals/one denial/config persistence. Workspace actual OS picker PASS36045.472916ms, with actual/controller-confirmed/persisted/reopened/listed/read/cancelled/other-thread-preserved flags true.

Workspace full closure is positive: native receiptMask1023, UI receiptMask31, selected outcome/identity true; observerClosed/code0, xcodeClosed/code0, native childExited/code0; no first failed assertion/failureSite. Surface lease RELEASED36042ms with over_budget false. These actual receipts, not just job exit, support complete business/close. LOCAL/ARCHIVE/TERMINAL lease release also completes.

## Permanent CPU install proof / other lanes

Linux build's new persistent tests are all non-skip PASS, including actual Linux CPU-addon load11.471628ms. Windows full census independently loads the actual Windows CPU binding as noted above. Mac smoke does not substitute for another platform's permanent test; current-host macOS CPU load was separately proven in the scoped official local suite, and fresh normal three-platform packaging remains a separate requirement.

All other terminal job logs were acquired once; no unrelated failure was found or investigated beyond the current gates. ACP/ARM/Session/X11/Ubuntu normal PASS is not borrowed from old273 or the diagnostic experiment.

## Result and next boundary

The current exact head cannot merge/tag/release: Windows-native remains required red. The separately reviewed two-test-file fixture construction/per-error metadata repair must receive actual GLM source approval and a **new changed-head complete normal CI**; its local11PASS/2Windows SKIP is not a Windows pass or a replacement for this failure. Original15s/30s/MCP20 and all assertions stay mandatory. No old/other-lane result permits an acceptance exception.

Final metadata `/tmp/cmspark-826-shipping-1e2fea18-metadata.json`; ten single-download terminal logs `/tmp/cmspark-826-shipping-1e2fea18-job-<jobid>.log`. Watcher `/tmp/cmspark-826-shipping-watch-1e2.mjs` exited after all10 terminal. No current source or remote action was changed by this observation.
