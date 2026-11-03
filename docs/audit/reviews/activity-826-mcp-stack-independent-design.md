# #826 one post-timeout physical stack experiment — independent design decision

**VERDICT: APPROVE design, with the exact mixed debugger modes below.** This approves implementation and the subsequent independent/actual GLM source gate, not dispatch or acceptance. The parent must obtain the actual GLM design approval before implementation. I did not edit repository source/config, dispatch CI, invoke GLM, run a debugger, launch native UI or execute Windows APIs.

Baseline `c5776f1d54a7d4b920e6c5bfde45691496b947f8`. Read the actual MCP test/compiled callback, Windows launcher cleanup, Surface650 signal proxy, the current Release route, the prior retired experiment source-review evidence, and `/tmp/cmspark-826-mcp-stack-design.md`. Official documentation was read solely to verify debugger/API semantics; no GitHub/product API or experiment was invoked.

## Decision and exact recommended mechanism

1. Keep the original real MCP case registration20s, original snapshot deadline20s, all SDK calls, actual binary/compile flags, business assertions and original cleanup bytes unchanged. A private same-directory compiled sibling has precisely an alias of the **outer original TestContext.signal**, and a best-effort awaited hook before `manager.rejectAll`/native termination. Its helper import is explicit. Full inverse plus fixed actual TS binding must reject unrelated compiled drift.
2. Hook eligibility: outer original signal aborted **and** wallclock at/after the existing snapshot deadline **and** original child exists/not settled **and** the actual prepared snapshot binary exists in scope. The inner signal alone is wrong because Surface650 substitutes a combined test/lease signal. The original test's actual TAP must independently report `testTimeoutFailure`; abort reason itself is not a timeout classification. A clock fence that is not reached yields no capture rather than waiting. Success, early assertion/exit and lease-only abort do not attach.
3. Native target: exact owned snapshot executable, immediate parent PID equal to the current official test Node, creation within the launch interval, exactly one live match. Do not add `child.pid` or broaden the production launcher ABI; it deliberately exposes only `terminate()`. Browser target: at most the uniquely admitted direct `msedgewebview2.exe` child of that native process; missing, ambiguous or no longer live is UNKNOWN. A single bounded OS query is sufficient; no loop, name-only attach or command-line enumeration.
4. **Use `-pv` only for the exact owned native process, and `-pvr` only for the browser.** Fixed command: `~*kc 0n16;qd`. This improves native stack stability without expanding production cleanup authority. CDB `-pv` suspends that target, but the actual original native child cleanup unconditionally invokes `TerminateProcess` through its already-held owned process HANDLE when alive; it does not depend on the UI thread running. Normal `qd` detaches/resumes; if native CDB fails/times out, original `finally` still terminates/reaps native. **Skip the browser capture after native CDB failure/timeout**, because its host may remain paused until original cleanup and a subsequent browser wait could be an observer-induced state. Do not add resume logic, a process-tree killer, an invasive debugger, retry or another debugger.
5. Browser `-pvr` does not suspend the browser. Its inconsistent/unresolved live stack remains UNKNOWN. Host and browser are sequential samples, not an atomic cross-process state. No `/Zi`, private PDB collection or compile change. No extra SDK call or changed browser flag.
6. Declared separate diagnostic budget: one process query≤3s, at most two sequential CDB children≤6s each, at most512KiB raw per child internally, no retries. The20s case is already failed before any attachment. Diagnostic cleanup is a separate non-acceptance tail; it is not represented as the old canonical end-to-end cleanup cost. Any collector throw/overflow/refusal/timeout is swallowed at the inserted boundary and cannot replace the original test result or bypass original cleanup.
7. Raw debugger material stays VM-local/in memory/private temporary files and is removed; never upload or print it. Use `kc`, not parameter/register/memory forms. Safe artifact projection has a fixed byte/count cap, finite statuses, target kind, thread ordinal, admitted module/function names, and original outcome only. No raw exception text, PID/TID/address/path/command/env. Headers/noise or unresolved frames cannot be promoted to symbols. One inert owned CPU dummy-process qualification on actual installed Microsoft-signed CDB, before the MCP case, supplies **real debugger output** for the actual parser and verifies the bounded tool/detach path; no invented output is accepted as its wire contract. Tool/prequalification failure must stop before the MCP business attempt.
8. One explicit default-false manual Release job on a fresh Windows VM; preflight retained, probe mode cannot package/publish. Absent/false/tag behavior is conserved. Official isolated runner, exact current source/locks/native build/compiled test, no previous UI/prewarm. Retain runner nonzero for a timed-out original case even if stacks are captured. Original ten canonical checks/main/release remain required. Temporary route/scripts retired after this single outcome. No automatic second attempt if it passes within20s or produces UNKNOWN.

The exact frozen parent proposal initially said all-`-pvr`. This review deliberately recommends the limited native-`-pv` revision only because the actual owned-HANDLE cleanup chain and its failure ordering are now checked. Do not silently extend `-pv` to the browser.

## Actual independent machine evidence

Node22.23.4 was selected through nvm. All tests are inert and operate in private `/tmp` trees. The real official runner and preload were copied unchanged into a private tree so its actual discovery/isolation contract was exercised without introducing a compiled sibling in the shared checkout.

`/tmp/cmspark-826-mcp-stack-design-controls.cjs` and `.log`: **7 controls PASS**.

- AST extracts the **actual compiled** MCP try/finally and the original `await Promise.race` statement. The proposed two insertion locations restore the whole compiled file byte-for-byte when removed; original unique registration20000 and snapshot20000 remain.
- Real Node:test timeout (scaled40ms solely in this inert test) exercises that actual race/finally with inert capture/native/filesystem ports. The original TAP remains `testTimeoutFailure`; capture occurs after the original signal abort and clock fence, before terminate.
- Real early lease abort leaves the outer original signal un-aborted and calls no capture. Ordinary child-exit failure and success also call none.
- A throwing observer and a bounded8ms observer preserve the original timeout outcome and exact original order: `rejectAll → terminate → channel.close → legacy.close → server.close → snapshot.close → remove → settled`.
- No MCP form/config/native executable was imported or launched. Inert keepalive models the original real server/process handle so the timeout test does not merely cancel for an empty event loop. Initial test-harness discovery/empty-loop failures were corrected in the private control, not repository code.

`/tmp/cmspark-826-mcp-stack-native-terminate-control.cjs` and `.log`: **4 controls PASS**.

- Extracts the actual `terminate_child` body from `companion/src/desktop/native/launcher.c:52`, selects the original `_WIN32` preprocessor branch, and adapts only C member syntax to an inert VM port.
- For alive false/true crossed with conceptual target suspended false/true, an alive target always receives the original `TerminateProcess(c->process,1)` through the exact opaque sentinel HANDLE, with original lock→call→unlock order. No caller-supplied PID, target resume or cooperative UI processing is introduced.
- This proves the application cleanup branch; Windows process semantics come from the official API contract, not this CPU port. It is not a claim that CDB/Win32 was executed locally.

## Why the experiment can change a decision

The current751 snapshot and wire phases cannot tell where the host's main execution is parked after controller creation. A stable native backtrace can supply a concrete blocking API/call chain, or a recognizable message-wait boundary, which can be mapped back to the existing startup code and independently reproduced before a fix. A native thread with GetMessage is a positive fact about that captured stack; unless UI-thread attribution is actually established, do not label an arbitrary message-pump thread as the main UI. Private host symbols and useful browser symbols may be unavailable. Neither absent frames nor a lone browser wait proves a deadlock or SDK cause. Even a valid post-timeout stack is a later state, not a reconstruction of the18.5s sample or the20s deadline.

This is materially different physical evidence following the user's explicit resumption. It does **not** reset the prior three-round history, authorize more phase fields, change the SLA, or make repeated unchanged CI acceptable. PASS within20s/no capture is non-discriminating; UNKNOWN remains UNKNOWN. No additional experiment is implied by this approval.

## Required implementation/source-gate controls

These are not claimed implemented or passed at this design stage:

- Exact source/compiled AST binding, two insertion inverse, readonly canonical before/after bytes, exclusive sibling cleanup on every path, actual CJS `__dirname` and official config isolation.
- Execute the actual PID selector against inert owned facts for wrong path/parent/creation time, zero/multiple matches, exited/ambiguous browser; never fall back to process name.
- Actual real-CDB dummy output→actual capped parser; reject path/args/register/header noise, truncation, missing symbols and overflow. Distinguish native-pv versus browser-pvr argv. Native tool failure skips browser and still reaches actual original cleanup; tool children bounded.
- Parsed workflow absent/false/true/tag matrix and full preflight/package/release conservation; exact Node inventory/other affected source readers, no canonical acceptance substitution.

## Official sources supporting the limited choice

- [CDB command-line options](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options): `-pv` noninvasive, `-pvr` does not suspend; fixed symbol paths and network-symbol restrictions are available.
- [Noninvasive debugging](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/noninvasive-debugging--user-mode-): ordinary noninvasive inspection suspends target threads.
- [Display stack backtrace](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/k--kb--kc--kd--kp--kp--kv--display-stack-backtrace-): `kc` limits each frame to module/function; explicit frame count is required to avoid default hexadecimal interpretation.
- [Quit and detach](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/qd--quit-and-detach-): `qd` exits CDB and leaves the target running.
- [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess): unconditional termination stops all target threads; external invocation is asynchronous, and actual exit must still be observed. The original launcher/test already retain that exit path.

**APPROVE design with native-only `-pv`, browser-only `-pvr`, skip-browser-on-native-tool-failure, and all original acceptance gates unchanged.**
