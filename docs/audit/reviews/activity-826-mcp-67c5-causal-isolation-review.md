# #826 MCP current causal boundary and finite counterfactual design review

VERDICT: **APPROVE one explicitly non-acceptance measurement experiment**, subject to the unchanged canonical 20000 ms gate and normal independent/GLM implementation gates. No product/native-source fix or acceptance budget change is justified yet. This report does not authorize an unchanged CI rerun.

The completed Windows acceptance facts are in `/tmp/cmspark-826-windows-67c5e209.md`. I only read source and actual logs and performed a nonexecuting AST control of the current compiled registration. No native UI, SDK call, source edit or new CI run was performed.

## What this sample establishes

The census VM's coherent independent snapshot has flags751 and send kind2/site5/edge1/stage6/result0. Against the actual C++ implementation, environment and controller API return markers, environment callback exit, outer environment wrapper leave and original outer DispatchMessage return have occurred by the sample. The last wrapped bootstrap observation's send has completed. The controller callback entry flag is not set in this sample.

Therefore the exact old ambiguity “the last BOOT row reached the peer while the same environment wrapper/send was still blocked” is excluded **at this sample**. There is no basis to identify SDK-internal startup, browser process creation, OS scheduling, a different subsequent UI operation, or the original deadline state from that one instant. The original case timed out with no later accepted phases, but a missing later wire row is not proof of a particular callback stack.

The actual host initializes a single-threaded WinRT apartment, creates its window, and runs the original GetMessage/TranslateMessage/DispatchMessage loop. Environment/controller creation is asynchronous. The official WebView2 threading documentation requires STA plus a UI message pump and notes that callbacks depend on that pump. Current source provides those constructs; this review found no demonstrated violation warranting a speculative product edit. The Microsoft documentation supports the mechanism, not a diagnosis of this CI run: [WebView2 threading model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model).

Two tempting hypotheses lack current supporting paths:

- The host already creates a random, exclusively owned new UDF on every process launch, before calling CreateCoreWebView2EnvironmentWithOptions. Changing to a “cold profile” is not an identified fix; warm runtime/global state differs from reusing a UDF.
- The actual Windows official runner passes `--test-concurrency=1`. The new CPU case and MCP case do not execute concurrently through this supported entry, so concurrent CPU test contention is not supported by this command path.

## Minimal experiment

Keep the canonical test, its compiled file, original native binary, snapshot deadline and canonical result unchanged. In a separate owned diagnostic invocation, derive the **current actual compiled MCP test** by changing only the single test-registration timeout numeric literal 20000 → 60000. The snapshotDeadline825 expression stays Date.now()+20000, hence its one sample remains at the original 18.5-second target. Do not add a second sample, observer framework, SDK calls, retries, prewarming, GPU flags, profile sharing or a modified native business path.

The diagnostic still must execute every original manager/config/authentication/form/confirmation/store/receipt assertion and original finally/close/cleanup. Use the official isolated test runner so this real config-writing case never touches live config. A temporary compiled sibling retains all relative imports and __dirname semantics; use an owned unique filename and exclusive creation and remove only that owned file after the diagnostic child closes. It must not remain for later canonical discovery. Never rewrite the canonical JS, change its gate result, or allow diagnostic success to substitute for it. If implementation chooses a different loader, its actual import/dirname/isolation semantics must be machine-tested rather than assumed.

Measure actual elapsed test time, the original phase/BOOT rows, full original native business receipts, exit and cleanup result. Label every derived result NON_ACCEPTANCE. A diagnostic failure remains visible as a diagnostic failure; it does not erase or change the canonical job's existing failure.

## Decision value and limits

- Full actual business completion in (20s,60s] demonstrates a real execution of the current fixture can complete late within that measured range. A controller BOOT bucket at or beyond the original boundary gives direct positive callback timing in that probe. This would justify reviewing the measurement contract transparently with the coordinator; it does **not** prove the earlier canonical execution would have completed, that cold startup caused its failure, or that 60s is an acceptable production/test SLA.
- Completion within 20s after a canonical failure does not discriminate the previous timeout cause; intervening process/runtime state or ordinary variation remain uncontrolled. It does not justify a budget change.
- Timeout at 60s does not support the narrow claim that this probe merely needed a completion between 20s and 60s. Preserve its failure, without inferring permanent SDK deadlock or adding unbounded observations.
- A different assertion/exit/cleanup failure is a distinct observed path to inspect. Partial phases or a final process code alone cannot become full MCP business success.

Because the experiment is separate from acceptance and has a different declared measurement boundary, it is a finite counterfactual, not permission to relax the original gate. After this one purpose-directed result, decide from the reached path; another unchanged run or more diagnostic scaffolding is not automatically warranted. The three-round history is not reset.

## Independent actual-source control

`/tmp/cmspark-826-mcp-timeout-counterfactual-design-control.log` records an AST-bound inspection of the actual current compiled JS: exactly one matching MCP registration and one numeric timeout property are found; its original value is 20000. A derived in-memory string replacing only that literal with 60000 is byte-identical everywhere else, the original snapshotDeadline825 remains 20000, and the canonical compiled file is unchanged. This control did not execute the case or write a derived repository file. It establishes that the proposed minimal alteration is reachable; real Windows completion and implementation cleanup/isolation are still future gates.

VERDICT: **APPROVE the finite non-acceptance design; no canonical budget or product change approved.**

## Fresh-VM scheduling refinement

After reading the current `.github/workflows/release.yml`, I prefer the existing manual Release workflow with one default-false, typed boolean diagnostic input and one independently scheduled Windows probe job. This has a narrower operational blast than adding an automatically running experimental job to normal PR CI and later removing it. It introduces no user-facing feature or product permission.

Keep preflight unchanged. The new probe job should require both workflow_dispatch and the explicit boolean true, depend on the normal preflight, and override permissions to contents:read. Its Windows runner is fresh and executes no earlier native UI. Install/build current checkout using existing commands and existing `--test-fixtures` builder; do not add a one-off SDK/toolchain/profile/compilation bypass merely to produce this probe. Current compilation has no UI execution, so this avoids prior canonical native UI as a deliberate experimental confound.

Only the explicit probe mode skips the package matrix. Normal dispatch (input absent/false) and tag-push packaging behavior must remain unchanged, and release publication remains dependent on package and the original tag-only gate. The implementation/source tests must execute the real parsed workflow conditions for push-tag, ordinary branch dispatch, explicit probe dispatch and tag-ref dispatch with probe=true. Assert preflight preserved, probe true never packages/publishes, false/absent never runs the probe, and ordinary release commands/dependencies remain conserved. This is a small workflow control, not a new CI acceptance lane; normal PR ten checks stay intact.

The temporary derived JS must be a real discoverable sibling only for the official targeted runner invocation, with owned exclusive creation and cleanup after the child closes; the original TS and JS are read-only inputs. Strict current raw-TS hash, one exact compiled registration and one expected numeric option prevent applying this experiment to drifted code or another test. The canonical compilation and source must be checked unchanged, and a leftover temporary test must not silently enter later census discovery. Report the experiment as NON_ACCEPTANCE with the original snapshot target and all actual receipts. Implementation must demonstrate the real loader/import/isolation/cleanup path before this probe is dispatched.

This refinement makes the measurement cleaner; it still does not turn one late success into evidence that the prior census instance would have succeeded, or establish a cold-start root cause. The original failing canonical result remains authoritative.
