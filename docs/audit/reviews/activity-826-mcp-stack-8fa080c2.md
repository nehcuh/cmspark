# #826 manual stack experiment — independent actual result

**Disposition: actual Windows qualification UNKNOWN; original native MCP20 NOT_RUN; no native/browser stack sample.** No root cause, native fix or release clearance follows from this run.

[Run41563621481](https://github.com/nehcuh/cmspark/actions/runs/41563621481), event `workflow_dispatch`, exact head `8fa080c2c8e105139eb5adbb7c751c172af1adce`, created2026-11-03 02:02:46Z. Final FAILURE. Explicit probe route was actually executed after successful preflight; normal package/publication jobs skipped. Only45-second metadata observations, terminal job logs, artifact inventory and the safe JSON-only artifact were read. No rerun/cancel/dispatch, source/config edit, model call, extra probe or native call was performed by this reviewer.

## Actual gates

| Gate | Actual result |
|---|---|
| Normal preflight125679769238 | SUCCESS,02:02:49–02:10:34Z |
| Companion npm ci with new envskip | SUCCESS |
| New persistent Release CPU tests on real Linux | 3 PASS, non-skip; details below |
| Probe job125682489161 | FAILURE,02:10:41–02:14:22Z |
| Original native fixtures build + actual test compilation | SUCCESS |
| Verify derived callback, collector and release controls | 18 PASS /0 FAIL /0 CANCEL /0 SKIP |
| Qualify CDB and run one original20 post-timeout experiment | Actual invocation exits1 after qualification UNKNOWN |
| Safe JSON upload | SUCCESS; artifact13198665226 |
| Normal package125682491535 / publish125682491606 | SKIPPED / SKIPPED |

[Terminal probe job](https://github.com/nehcuh/cmspark/actions/runs/41563621481/job/125682489161).

## Actual safe artifact

Artifact `mcp-stack-probe-826`, id13198665226,429 bytes, contains **only** `qualification.json` and `run.json`. No capture.json, native/browser frames, debugger transcript or other file is present. Only these declared safe JSON files were read; no raw/private debugger material was accessed.

`qualification.json`:

```json
{"schema":1,"status":"UNKNOWN","parserPositive":false,"actualDetached":false,"dummyClosed":false}
```

`run.json`:

```json
{"schema":1,"kind":"NON_ACCEPTANCE","originalOutcome":"NOT_RUN","qualification":"UNKNOWN"}
```

The qualification path was actually invoked. This receipt does **not** positively qualify the installed/signed tool, actual parser/vendor record, qd IPC pong, or actual dummy close. The false fields are also not proof that a live dummy was stranded or any particular stage failed: they begin false and are returned from multiple early/refused/error paths. The fixed safe projection does not identify the precise failing predicate. Neither the elapsed stage time nor those defaults justify guessing a query timeout, missing CDB, signature failure or parser cause.

The runner correctly refused to execute the original native MCP case without OBSERVED qualification. Therefore there is **no new MCP20 PASS/timeout/business/cleanup outcome**, no captured host stack and no browser stack. Native-pv/browser-pvr sequential interpretation never comes into play. Previous013d and3e48 invocations remain separate pre-business failures; across these three invocations no native MCP business attempt or target stack sample was obtained. Whether this qualification entered CDB cannot be determined from the safe fields and is not claimed.

## Actual Linux install-input proof

The now-terminal normal preflight log independently shows these new persistent cases at02:07:57Z:

- #2438 `826 actual locked installer: optional GPU default versus skip, CPU assets and speaker consumer`: PASS23.804009ms.
- #2439 `826 bundled CPU native runtime loads on the actual supported release host`: PASS11.109669ms, actual Linux host addon load requiring bundled CPU, no model/inference claim.
- #2440 `826 Release companion installs keep scripts, tests and audit; either missing skip fails`: PASS18.716393ms.

All three are non-skip. Normal preflight as a whole succeeded, including tests/audit. This is useful proof for the new optional-provider install input, but it is **not** normal three-platform package output, Windows native CPU-addon load, CDB qualification or MCP acceptance. A fresh normal three-platform dry-run on the final shipping tree remains required.

## Evidence and result policy

- Exact final metadata: `/tmp/cmspark-826-mcp-stack-8fa080c2-metadata.json`.
- Terminal normal preflight log: `/tmp/cmspark-826-mcp-stack-8fa080c2-preflight.log`; new CPU tests47982–47999.
- Terminal probe log: `/tmp/cmspark-826-mcp-stack-8fa080c2-job.log`; actual control footer18/18 at365–370, qualification command thereafter, exit1 at379.
- Safe artifact ZIP: `/tmp/cmspark-826-mcp-stack-8fa080c2-safe.zip`.
- Watcher `/tmp/cmspark-826-stack-watch-8fa0.mjs` exited after the terminal result.

The configured3s/6s/6s tool-work limits plus required actual process teardown remain the reviewed interpretation; no hard15s wall-time claim is made. The result is UNKNOWN/NOT_RUN, not a reason to change original20s, infer SDK causation, add fields, or automatically repeat this experiment. Existing canonical all-green/main/release blockers remain. Parent disposition is required before any further action or retirement.
