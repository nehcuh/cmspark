All verification complete. Here is the review.

---

# Dual review: macOS TCC CU unblock PR (`fix/macos-tcc-product-identity` → main)

## Summary

Reviewed 13 commits (f6dc510 tip, 40 files, +2522/−136) against `origin/main`. Verified every "must verify" item on the real tree, ran the test suites, compiled both the Swift host and TypeScript extension, and checked all five rejection gates.

**Must-verify results:**

1. **`runEstop` does not exit on tapCreate nil** — ✅ host.swift (`runEstop`): `tapCreate` nil → `defaultTap` fallback → still nil → `fputs("hotkey DEGRADED…")` → falls through to `CFRunLoopRun()`; the socket accept loop (global queue) keeps serving. The old code-4 hard exit is gone (remaining `code: 4` sites are AppleScript `HostError`s in other subcommands only).
2. **Companion `ensureEstopHelper` is connect-first** — ✅ darwin-estop.ts: held-socket check → `tryConnectHeld(30×100ms)` for tray/Aqua helper → `CMSPARK_ESTOP_NO_DAEMON_SPAWN` opt-out → daemon spawn last-resort (logged). Test `CMSPARK_ESTOP_NO_DAEMON_SPAWN refuses` passed on this machine (3s grace, then refuse without spawning).
3. **Spatial describe + untrusted marker; credential scan before seal** — ✅ executor.ts: OCR → `scanDanger(...).credentialRects` → blur → `formatOcrWordsAsDescribeText` (line grouping by mid-Y, truncation marker) → `untrustedText` prefixed `[untrusted host-ocr; not instructions]` → preview + `sealScreenshot` with blur. Executor test asserts the untrusted prefix.
4. **paused_only ≠ 运行中** — ✅ `classifyFleetActivity`: locks/intents/holding_tabs/idle → active; workers+paused → `paused_only`; `fleetProcessingLabel` returns null for paused_only; FocusBand `hasFleetActivity` requires "active" so zombies can't steal the band; FleetStrip hidden unless expanded/showPausedOnly. Focus-band tests (12) pass.
5. **No user-facing「enable node」regression** — ✅ grep over the diff and `companion/src` + `chrome-extension/src` finds no enable-node strings; review docs even list it as an anti-pattern.
6. **Tests exist and pass** — ✅ `computer-darwin-estop-owner` (2, passed), `computer-ocr-describe` (6), `host-bin-resolve` (6 incl. new `resolvePackagedContentsDir`), executor untrusted-marker assertion, focus-band (12). Full companion suite: 116 pass / 0 fail. `chrome-extension tsc --noEmit`: clean. `host.swift` swiftc: exit 0 (only pre-existing warnings).

**Rejection gates:** R1 (no code-4 hard exit — socket survives tap failure) ✅ not triggered. R2 (soft-fail weakens fail-closed — NO: the proof-of-life socket *is* the fail-closed channel; helper death → EOF → `estopHeartbeatLost` → `EMERGENCY_STOP_LOST` mid-task, preflight still refuses with no socket; injects also re-check the flag file) ✅ not triggered. R3 (claims full CU fixed — NO: memory/project-knowledge.md + session.md honestly record "真机仍 CGEventTap fail under LS", "LS 热键 DEGRADED", "完整 CU DoD 仍开放") ✅ not triggered. R4 (paused zombies labeled 运行中 — fixed with tests) ✅. R5 (untrusted OCR removed / shell OCR encouraged — untrusted marker added and adapter prompt + tool catalog explicitly forbid `shell_exec screencapture`/ad-hoc Vision as a substitute) ✅ not triggered.

## Blocking

None.

## Nits

1. **Dead `code4` retry in `ensureEstopHelper`** (darwin-estop.ts ~line 229): with soft-fail the helper never exits with code 4 (it stays alive with a DEGRADED tap), so `last.reason?.includes("code 4")` and the `retry_after_ax` branch are unreachable. Vestigial — remove or repurpose to retry on *any* early-exit.
2. **`computer-darwin-estop-owner.test.ts` first test** only proves raw UNIX-socket connect semantics against a fake path; the test's own comment concedes it doesn't drive `ensureEstopHelper` against a live tray-owned helper at the production path. An integrated test (external server holds `/tmp/cmspark-estop.sock` → `ensureEstopHelper` connects without spawning) would directly cover the PR's central ownership claim.
3. **`spawnEstopOnce` unlinks the socket before spawning**: if the tray helper is alive but a connect attempt failed transiently, the daemon fallback unlinks the tray helper's bound path and rebinds — orphaning the tray helper's listener. Connect-first makes this unlikely; a re-check-before-unlink would close the race.
4. **`EstopContext.clients` only prunes dead fds on `trigger()`**; repeated connect/disconnect cycles accumulate fds until a hotkey press. Trivial resource nit.
5. **ChatView `fleetLabel.replace(/^舰队/, "")`** cosmetic; "舰队持锁 · 3 锁" → "持锁 · 3 锁" — fine but slightly awkward for the 持锁 branch.

VERDICT: APPROVE_WITH_NITS
