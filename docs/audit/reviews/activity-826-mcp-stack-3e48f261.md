# #826 manual stack invocation — independent actual result

**Disposition: preflight dependency installation FAILED; Windows experiment, CDB qualification and original MCP20 business all NOT_RUN. No physical stack evidence.**

[Run41562258351](https://github.com/nehcuh/cmspark/actions/runs/41562258351), exact head `3e48f26190cc9e0f37edc9f70b54b2b36532606b`, event `workflow_dispatch`, created2026-11-03 01:49:48Z. Final overall FAILURE. Observed this exact run with45-second metadata intervals and downloaded only its terminal failed job log. No rerun/cancel/dispatch, additional probe, source/config edit, model invocation or native call was performed.

| Actual gate | Final result |
|---|---|
| Preflight125675370407 | FAILURE |
| Release guard | SUCCESS |
| Install companion deps (`cd companion && npm ci`) | FAILURE |
| Remaining preflight build/tests/audit | SKIPPED |
| Windows experiment125675518383 | SKIPPED by failed dependency |
| Package125675517580 | SKIPPED |
| Publish125675518001 | SKIPPED |
| Artifact inventory | total_count0 |

First actual error: dependency `onnxruntime-node` runs `sh -c node ./script/install`, which fails with `AggregateError [ETIMEDOUT]` at `internalConnectMultiple`; nested network connect errors include ETIMEDOUT and ENETUNREACH on443. npm exits1. This is the preflight install path, before companion build, the corrected workflow consumer, installed-CDB qualification or any native MCP launch. No public/private debugger output exists to inspect.

The corrected LF/CRLF consumer has **no new Windows execution result** in this run. No tool-signature/actual-parser/qd-pong/dummy-close receipt, original20s MCP outcome, native/browser stack projection or original MCP cleanup receipt was produced. The earlier013d invocation remains a separate experiment-control failure; neither invocation reached CDB or native MCP business. This report does not infer a provider outage's unique cause or authorize an unchanged retry/installer bypass.

Normal package/publication paths did not execute. Raw dispatch inputs are not exposed by run metadata; unlike the previous run, the probe job's condition could not execute because preflight failed, so its actual skipped status alone is not independent proof of true input. Parent dispatch record binds the requested input. Exact head/event and the actual preflight dependency failure are independently verified.

Evidence: `/tmp/cmspark-826-mcp-stack-3e48f261-metadata.json`; terminal [preflight job](https://github.com/nehcuh/cmspark/actions/runs/41562258351/job/125675370407) log `/tmp/cmspark-826-mcp-stack-3e48f261-preflight.log`; watcher `/tmp/cmspark-826-stack-watch-3e48.mjs` exited at run terminal. Only artifact inventory was queried; no artifact existed or was downloaded.

**Final: NOT_RUN for CDB and MCP20. Existing canonical acceptance/release blockers remain; await parent disposition without automatic retry or source change.**
