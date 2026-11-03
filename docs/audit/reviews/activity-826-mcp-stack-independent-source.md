# #826 post-timeout stack experiment — independent source review

**VERDICT: APPROVE the final frozen six-code-path implementation for the actual GLM source gate.** No supported blocker remains. The initial dummy-close defect was reproduced and fixed before this approval; WinHTTP symbol coverage was also corrected. This is a NON_ACCEPTANCE experiment source approval, not Windows/CDB qualification, dispatch, canonical acceptance, merge or release clearance.

Baseline `c5776f1d54a7d4b920e6c5bfde45691496b947f8`. Reviewed all six source files end-to-end: Release workflow,759 Node inventory, probe runner and its unit, collector and its unit. Manifest `/tmp/cmspark-826-mcp-stack-source-manifest.json` binds those six; all six current code hashes and all six critical unchanged hashes were independently checked and match. Root's frozen full patch is `/tmp/cmspark-826-mcp-stack-source.patch`. Docs/T0 text is outside this code approval.

I made no shared source/config edits, dispatches, external review/product API calls, CDB launches, native UI calls or Windows API executions. Independent controls and reports are private `/tmp` artifacts. Current review used the code-review skill; findings required a supported source path and a concrete negative control.

## Findings resolved during this gate

1. **Actual dummy cleanup gap, now resolved.** Initial `qualifyCdb826` killed the dummy then raced actual close against3000ms; if the dummy had not closed, it removed the workspace and returned UNKNOWN with `dummyClosed:false`. Independent execution of the **actual exported qualifier** with only OS leaves controlled produced `kill.request → workspace.remove → qualifier.return → dummy.close`. The contract negative assertion rejected that sequence. Evidence: `/tmp/cmspark-826-mcp-stack-dummy-close-independent.cjs` and `.log`.

   Final collector removes the timer race and awaits actual dummy close when there is an actual PID; an error with a live PID cannot masquerade as close. A no-PID spawn failure may finish UNKNOWN without waiting for a nonexistent process. Independent green re-execution deliberately holds close for3100ms, crossing the old3000ms boundary, and emits a live-PID error: no return/workspace removal occurs until actual close. Final sequence `kill.request → dummy.close → workspace.remove → qualifier.return`. Evidence: `/tmp/cmspark-826-mcp-stack-dummy-close-fixed-independent.cjs` and `.log`. The final12-case collector suite also covers these paths.

2. **Source-supported symbol coverage, now resolved.** The original allowlist omitted `winhttp` even though the original host synchronously calls `WinHttpWebSocketSend` on the UI path, an explicit target of this experiment. Only `winhttp` was added, with its named positive grammar control. Unknown module rejection remains. My actual hook-to-collector control now positively projects `winhttp!WinHttpWebSocketSend`.

No unrelated or hypothetical defect is promoted into another review round.

## Source and actual integration

- Probe derives only the fixed original TS/emitted JS pair. Normalized LF/CRLF hashes bind the **complete** original source/emitted file, not selected tokens. The original unique20s registration and snapshot20 remain. Exactly one outer-signal alias and one best-effort hook before original `manager.rejectAll` are inserted; removal recovers every compiled byte. Canonical TS/JS are not written. The derived sibling uses exclusive `wx` creation in the original directory and is removed after the synchronous official-runner child completes, including thrown execution. A pre-existing file is refused and preserved.
- The hook binds the **outer original** test signal, deadline clock fence, existing live child and actual snapshot binary. It uses the real CJS helper path under the companion working directory. It cannot attach on mere early Surface650 lease loss. Helper loading, collection or writing a safe capture result may fail without replacing the original error or skipping original cleanup.
- Collector accepts only the expected owned clone location, current Node parent PID, admitted creation interval and a unique live actual executable match. Native realpath normalization handles the previously supported8.3/long-path domain without treating case folding as identity. The PS producer emits exactly pid/parentPid/executablePath/createdMs/live and Microsoft-signature status; it never collects command lines, window titles, environment or user content. At most two native candidates/two direct browser candidates are inspected. Invalid facts or ambiguity return UNKNOWN; there is no name-only fallback.
- Fixed SDK x64 CDB is PE/architecture checked and Microsoft-signature qualified before use. Fresh private debugger cwd/symbol directory and reconstructed local environment avoid ambient `ntsd.ini`, inherited symbol servers and inherited secrets. Native CDB uses only `-pv -p <admittedPID> -c '~*kc 0n16;qd'`; browser uses only `-pvr`. Failed native debugging/UNKNOWN skips browser. Original owned-HANDLE native termination remains responsible for the host. No native launcher ABI/rights/PID field or browser-tree killer was introduced.
- Combined raw streams are capped internally at512KiB and never printed/artifacted. Clean-frame parser emits only finite module/function tokens, target kind and thread ordinal, with32-thread/16-frame limits and64KiB JSON cap. It rejects argument/path/address/header noise, unknown modules, missing frame evidence and overflow; truncated/limited data is INCOMPLETE/UNKNOWN. Names do not assert main UI-thread identity. No register/memory/dump command or private PDB/compile flag change is present.
- Actual Windows qualification remains a required **future runtime gate**: one owned CPU/IPC dummy, actual CDB output through the actual parser plus negative projections, detach ping/pong, and actual dummy close. Local grammar ports are explicitly not vendor or Windows recordings. Tool or qualification failure stops before the MCP case.
- Runner retains real official child exit status; captured stacks cannot convert timeout to PASS. Classification is based on actual TAP (`testTimeoutFailure`, original20000), not AbortSignal.reason. PASS within20s is non-discriminating. No60s alternate registration, prewarm, retry or canonical gate bypass remains.

## Timing interpretation: approved concrete implementation

**3s query +6s native CDB +6s browser CDB are configured useful-work timeouts, not a hard15s end-to-end wall-clock limit.** Expiry/overflow invalidates the result and requests one tool kill; returning, removing the cwd or proceeding still requires actual tool close. Qualification has its own stated ready/query/CDB/pong timeouts and now its actual dummy-close fence. Teardown can follow useful-work expiry; no artificial “kill means closed” claim or second cleanup deadline is made.

I approve this explicit source concretization of the design. Waiting for actual closure preserves the owned workspace boundary, while the original MCP20 result has already failed before collection. It changes only the declared NON_ACCEPTANCE diagnostic tail, not canonical20s, native business calls, permissions or assertions. The CLI already reports `toolTimeoutsMs=3000+6000+6000 actualToolCloseRequired=true`. The actual GLM source reviewer should use this interpretation, not an assumed hard15s guarantee. No speculative OS hang model or timeout relaxation was introduced.

## Workflow preservation

Actual parsed conditions cover push/manual, tag/branch, and absent/false/true input. Only explicit boolean true manual dispatch selects the independent fresh Windows experiment; it skips normal packaging, hence cannot reach publication. Normal preflight and release dependency/tag conditions remain. Removing exactly the probe input/job/package condition restores complete original Release raw SHA256 `484078da169a63dfbe5d4fe174568d597dfc48f38d57d05a1e86a67265244480`, including comments/formatting. The current canonical CI bytes are unchanged.

759 changes only exact Release setup-node inventory2→3, preserving CI4 and every pinned22.23.4 field. I read the actual workflow/759 diff; source unit tests preserve full versions/counts. Probe checkout disables credential persistence and grants contents:read. Only top-level safe `*.json` projections are uploaded; raw debugger material stays within private workspace/in-memory and is not included by the glob.

## Independent machine evidence

Node22.23.4 selected through nvm.

1. Before the two collector-only corrections, independently ran the complete affected command:
   `node --test companion/scripts/tests/mcp-stack-probe-826.test.mjs companion/scripts/tests/mcp-stack-capture-826.test.cjs scripts/tests/node-security-runtime-759.test.mjs`
   **28 PASS /0 FAIL /0 CANCEL /0 SKIP**,20.397s. `/tmp/cmspark-826-mcp-stack-independent-machine.log`.
   This includes the **real original20000ms Node timeout** classifier case, LF/CRLF full inverse, business/cleanup/registration drift refusal, exclusive sibling cleanup/collision, actual parsed workflow truth table/full raw restoration, collector leaf controls and strict Node inventory.
2. After the final collector-only increment, independently reran its complete unit: **12 PASS /0 FAIL /0 CANCEL /0 SKIP**,3.188s. `/tmp/cmspark-826-mcp-stack-independent-collector-fixed.log`. The other19 cases' exact code/inputs are unchanged, so their existing independent results are reused; this is **not** a claim of a new single31-case combined execution.
3. Independent actual initial RED→final GREEN dummy-close control described above. No CDB/Windows call was involved.
4. `/tmp/cmspark-826-mcp-stack-hook-independent.mjs` and `.log`: **5 integration controls PASS**. AST extracts the **current actually derived** entire `finally`, executes it with original error identity, and on an eligible path physically loads the current CJS collector through the same resolved path. Only OS/query/debugger leaves and filesystem/process boundaries are inert ports. The **actual collector, selector, projection and environment/argv code** run. Positive capture includes actual `-pv` native then `-pvr` browser paths and WinHTTP frame projection. Lease-only abort and before-deadline do not load the helper; helper-load throw and capture-file-write throw preserve the same original error and exact cleanup sequence. No live config module is imported.
5. Independent six-code/six-unchanged manifest match and scoped diff-check PASS. Direct baseline diff confirms unchanged actual MCP TS, snapshot preparation, host, launcher ABI/native launcher and canonical CI. Prior signal/cleanup source evidence is reused rather than re-audited.

Final collector SHA256 `f2c4508aadb57d08ba8cffab31cafac6e90d382e2f37a9b22587fca241fbaa9d`; final collector unit `a0a214091b1eeb118c47f0ed4942282a77044c003a79bbed347f6c01bd7df481`. Other four frozen code hashes are in the manifest verified above.

## Conclusion

**APPROVE.** The concrete cleanup defect and purpose-specific WinHTTP omission are resolved with actual negative/positive evidence. Proceed to the already required actual GLM source gate. Actual installed-CDB qualification and the single explicitly authorized Windows experiment remain unexecuted. A valid post-timeout stack supplies one later physical observation; it cannot retroactively describe the18.5s sample, prove SDK causation, replace the required MCP20 gate, or authorize another unchanged experiment. Prior round history and release blockers remain intact.
