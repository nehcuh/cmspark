# #826 final bounded tool experiment — independent actual result

**Disposition: tool qualification OBSERVED/COMPLETE, actual tool outcome OK/exitCode0; original MCP20 business PASS10747.1783ms. No timeout, capture.json or target stack. NON_DISCRIMINATING for the historical failure; not canonical acceptance.**

[Run41570019778](https://github.com/nehcuh/cmspark/actions/runs/41570019778), exact full head `aad9d65eac4596fdd68e199410f262ebf3cadaa7`, event `workflow_dispatch`. Independently matched on initial metadata. Final SUCCESS. Only45-second metadata observation, one terminal Windows job log and the declared safe JSON artifact were read. No source/config edit, rerun/cancel/dispatch, model call, extra OS/native probe or raw debugger/private-directory access occurred.

## Actual gates

| Job / step | Actual result |
|---|---|
| Normal preflight125700488640 | SUCCESS,03:05:02–03:12:24Z |
| Windows experiment125702935371 | SUCCESS,03:12:27–03:16:24Z |
| Locked dependency install/current companion build | SUCCESS |
| Original native fixtures build/actual test compilation | SUCCESS |
| Derived callback/collector/release controls | 23 PASS /0 FAIL /0 CANCEL /0 SKIP |
| Actual CDB qualification + unchanged original20 test | SUCCESS |
| Safe JSON upload | SUCCESS, artifact13201162785 |
| Publish125702937669 / package125702937689 | SKIPPED / SKIPPED |

[Terminal Windows job](https://github.com/nehcuh/cmspark/actions/runs/41570019778/job/125702935371). The23 controls are17 collector/source and6 probe/consumer checks, not23 native UI cases. The original actual native MCP test separately reports1 PASS,0 fail/cancel/skip.

## Actual safe artifact / qualification

Artifact `mcp-stack-probe-826`, id13201162785,625 bytes, contains exactly qualification.json and run.json. Only these safe JSONs were inspected; no capture or raw file was included.

```json
{"schema":1,"status":"OBSERVED","stoppedAt":"COMPLETE","toolOutcome":"OK","exitCode":0,"parserPositive":true,"actualDetached":true,"dummyClosed":true}
```

These are actual Windows qualification results: real installed fixed SDK tool, real kc output accepted by the actual parser controls, real qd/CPU-dummy IPC pong, and actual dummy close. The tool exitCode0 is produced only by the actual tool close callback under the reviewed producer; it is not inferred from elapsed time, a kill request or error.code. COMPLETE also requires the reviewed workspace-cleanup success. This is a CPU helper qualification, not a native MCP or browser stack.

run.json reports NON_ACCEPTANCE, originalMs20000, snapshotMs20000, originalOutcome PASS, exit0. Original TS raw source SHA `54d004ffcc71636dd504841701c81dd9b5d63fb3c8846583a19ec1137ddcdfca` independently matches the **same actual aad Git source represented as CRLF**; the LF source remains `113c2a7302f2a00af52fdc3299f33bccc1409201f95ba60c08333eb8c2c6bbd8`. Compiled SHA `232cd51b43aac2016e72cbcac768ae4c642f2cc9727d452a9c9df87a1e9adf9e` and derived SHA `894cd800baca73091891ed7a66334c67ab12bbe9c249073ae1089a5b3909532f` are recorded. The runner's canonical readonly comparison completed successfully.

## Original MCP20 business / cleanup

Actual native case passed **10747.1783ms**, within the unchanged20000ms registration. Fixed actual receipts show:

- Authenticated, workspace request accepted, post-auth request mask7.
- All eight original phases, including controller callback, navigation, document delivery and actual renderer admission/send.
- Navigation success and canonical source match, webErrorStatus0.
- Three actual OS confirmation windows, two approvals and one denial; real configuration persisted. Native button activation remains synthetic and makes no human-approval claim.
- Original child exit0 assertion and all persisted/private-environment/manager assertions passed; progress reports exited=true, windows3, approved=true, denied=true, done=true.
- PASS is emitted only after the original finally and Surface650 release complete. Original manager rejection, owned-child termination/exit wait, WS/server close, snapshot FD close, config-env restoration/data cleanup and lease settlement remain part of the actual pinned callback. No native cleanup failure is reported.

This is the **first original MCP business attempt in this new stack-experiment sequence**, after four preserved NOT_RUN preparations; it is not the first historical MCP execution in the project.

## No target stack / causal limit

The case completed before its timeout eligibility gate, so no native/browser capture hook ran and no capture.json exists. The original18.5s snapshot is UNKNOWN in the completed process's normal progress; it is not negative evidence. This run provides **zero native/browser physical target stack samples**.

Consequently it does not distinguish the historical MCP timeout cause, prove the120s window was needed in this particular instance, or show that the prior6s CDB failure was a timeout. Qualification completed successfully under the revised preparation contract; no per-operation duration is exposed or inferred. Native-pv/browser-pvr sequential post-timeout sampling did not occur.

## Final bounded disposition

Retain the four earlier NOT_RUN receipts and this one real PASS. Do not repeat the experiment or expand120/fields/framework. Per the approved coordination plan, archive this outcome then retire the temporary probe using the independently/GLM-approved local draft. Until committed/pushed, that local draft is not called remote retirement.

A diagnostic PASS cannot override the original product's canonical gates. Required normal CI must run on the final shipping tree; any original MCP20 failure is still a blocker regardless of this result or another lane. Fresh normal three-platform Release preview remains required because the CPU installation input changed. No main merge/tag/release acceptance is granted here.

Evidence: `/tmp/cmspark-826-mcp-stack-aad9d65e-metadata.json`, one terminal job log `/tmp/cmspark-826-mcp-stack-aad9d65e-job.log`, safe artifact `/tmp/cmspark-826-mcp-stack-aad9d65e-safe.zip`. Watcher `/tmp/cmspark-826-stack-watch-aad9.mjs` exited at terminal. Separate local retirement draft source approval: `/tmp/cmspark-826-probe-retirement-independent-source.md`.
