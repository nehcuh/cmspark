# MCP stack experiment — actual GLM source gate

**APPROVE** for the frozen six-code implementation. Suitable for **one explicitly coordinated manual NON_ACCEPTANCE experiment** after the coordinator verifies the remaining machine/non-author/source gates. No current dispatch, canonical acceptance, merge or release approval.

- Base: `c5776f1d54a7d4b920e6c5bfde45691496b947f8`.
- Manifest SHA256: `86746c08f64b541d03126ddced14f24628fca559121cfb1ce7a84add68b3ff36`.
- Complete six-path patch SHA256: `0fbc4504ae83e84bbe168372ef09007c08643aaa1da996074b42b64f8faef2c6`.
- Prompt SHA256: `74c2f6b9a5331d6295f921cb1eee6f92f07f65772c66e03aaa566bc347e5c910`; 272989 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `284842ms. Actual input/output tokens: 71641/12806. Tools/hooks/MCP disabled by safe wrapper.
- Full six sources, complete frozen patch, full independent source report, author handoff, original design/actual GLM design, actual task control scripts/logs, unchanged hash bindings and complete two T0 documents were embedded. No live config/private host logs were read or supplied.
- Budget truth: 3/6/6 seconds configure termination-request deadlines; actual tool/dummy close is still required. **No hard15-second wall-clock claim**. Original canonical MCP20000ms is unchanged.
- Evidence: initial combined28 before collector corrections; final collector12 author+B; other19 unchanged results reused. **Not a single31-case run**. No Windows/CDB execution or dispatch occurred during this gate.

## Actual model review (verbatim)

## VERDICT: APPROVE (full independent source gate)

I read all six frozen files and the complete patch end-to-end. **No concrete, supported, reachable source defect found.** After the coordinator verifies the remaining normal machine / non-author / source-gate controls, this code is suitable for **ONE explicit manual NON_ACCEPTANCE dispatch** — not dispatch now by this reviewer, and not canonical acceptance, merge, or release clearance.

### Explicit budget truth — confirmed as implemented
`mcp-stack-capture-826.cjs` `runBounded826`: `timeoutMs` (3000 query / 6000 native / 6000 browser, in `queryOptions`/`debug826`) triggers `refuse()` = one kill **request**; the promise resolves only on actual child `close` (`finish` is wired solely to `close`/no-PID spawn error). `qualifyCdb826` awaits `closePromise` before `work.close()` and sets `dummyClosed` from actual close; a live-PID `error` cannot resolve it. This is exactly "useful-work deadlines + mandatory actual tool close," not a hard 15s wall clock, and there is no new cleanup deadline, retry, fallback, or kill=close claim. The probe's own log line states `toolTimeoutsMs=3000+6000+6000 actualToolCloseRequired=true`. Independent RED→GREEN (`dummy-close-*` logs: `kill.request → dummy.close → workspace.remove → qualifier.return`, 3100ms hold) matches the frozen code.

### Normal/tag Release conservation — confirmed
`release.yml`: `package.if` skips packaging only in explicit probe mode; `release.needs: package` + tag-only `if` means probe mode cannot publish; probe job is `contents: read`, `persist-credentials: false`, `needs: preflight`. `mcp-stack-probe-826.test.mjs` runs the full event×tag×absent/false/true truth table on the parsed `if`s and restores the complete raw original workflow bytes to SHA256 `484078da…`. The only other release.yml consumer change is the 759 inventory count 2→3 (three setup-node, all 22.23.4), with `ci.yml` hash unchanged.

### Precise boolean manual opt-in — confirmed
Default-false `workflow_dispatch` input gates the job; `runMcpStackProbe826` independently requires win32 + `GITHUB_ACTIONS==='true'` + `CMSPARK_MCP_STACK_PROBE_826==='1'` before touching any file or tool, with an executed rejection control.

### Other required invariants — confirmed in source
- `debug826` uses `-pv` only for native, `-pvr` only for browser; `collectMcpStacks826` skips browser on native `UNKNOWN`; original owned-HANDLE `launcher.c`/`DesktopHost.cpp` unchanged by exact hash (terminate-on-suspended evidence reused).
- Identity: one bounded PS query (`QUERY_PS_826`, no CommandLine/WindowTitle, `First 2` caps, Authenticode Microsoft-subject check), unique live native match in a canonicalized 8.3-safe path domain, unique direct `msedgewebview2.exe` child; ambiguity/invalid → `UNKNOWN`, no fallback.
- Privacy: raw streams capped in memory, never printed/artifacted; `admitSymbol826` + finite `MODULES` (with the sole `winhttp` addition and its positive control) emit only module/function; local `_NT_SYMBOL_PATH`, no `srv*`/network, no `/Zi` or compile-flag change; artifact glob is `*.json` projections only.
- Qualification must pass on real Windows CDB (actual capture through the real parser, detach pong IPC, actual dummy close) or the run records `NOT_RUN` and exits 1 **before** MCP; grammar tests are explicitly not vendor evidence.
- `deriveMcpStackProbe826` binds full normalized source/compiled hashes, enforces unique anchors and byte-exact inverse; the derived sibling is `wx`-exclusive and removed after synchronous completion; canonical files are re-verified byte-identical in `finally`; the runner returns the real child exit (`result.status ?? 1`), so a captured stack can never turn the original 20000ms timeout into PASS, and `classifyMcpStackOutcome826` keys on actual TAP `testTimeoutFailure`/`test timed out after 20000ms`.

### Evidence accounting — acceptable as declared
The 28-PASS baseline preceded two collector-only corrections; the final 12-case collector suite (author + B) plus 19 unchanged-input reused results is honestly stated as **not** a combined-31 run. The frozen manifest's final collector/test hashes match the 12-case target files reviewed here; the six changed and six critical unchanged hashes are internally consistent.

**Final: APPROVE for this source and its explicit budget truth. Suitable for one explicit manual NON_ACCEPTANCE dispatch once the coordinator's remaining gates are verified; original failure/TAP exit, canonical-10/main/tag requirements, history, and one-outcome decision/retirement rules remain in force.**
