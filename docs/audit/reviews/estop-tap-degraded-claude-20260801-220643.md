I have all evidence needed. Applying R1–R4 strictly against the diff (host.swift runEstop + the socket-only companion preflight + HANDOFF claims).

## Summary

The change converts `runEstop` from a hard-fail design to a soft-fail design:
- **Before**: `CGEvent.tapCreate` nil → `throw HostError(code: 4)` → `exit(4)` → dead socket → `host_computer refused: emergency-stop unavailable`.
- **After**: try `listenOnly`, then fall back to `defaultTap`; if both nil, **log `hotkey DEGRADED` and keep the UNIX socket server + `CFRunLoopRun` alive**. Fail-closed for Computer Use is redefined as **socket proof-of-life** (held connection), not hotkey presence.

This matches the implementer's device evidence (LS-launched ad-hoc child gets `tapCreate=nil` even when CLI `security-check` reports `axTrusted:true`) and the design intent stated in the BLOCKED-HANDOFF "Update 2026-08-01 late night" section.

`darwin-estop.ts` is unchanged in this diff and remains socket-only by construction: `EstopResult` has no `hotkey` field, `ensureEstopHelper()` returns `ok:true` purely on socket connect, and `estopHeartbeatLost()` keys off `liveSock.destroyed`. The companion literally cannot tell armed from degraded — by design.

## Rejection gates

- **R1 — Helper still exits when `tapCreate` fails (code 4 or equivalent): PASS.** Both branches of the new `if let tap = tap { … } else { fputs(…DEGRADED…) }` fall through to `CFRunLoopRun()`. There is no `throw HostError(code: 4, …)`, no `close(serverFD)` on tap nil, no `exit(4)`. The accept loop launched at host.swift:2010 keeps running independently of tap state, so the held socket stays live under DEGRADED. The host-integrity SHA bump in the same uncommitted set is a routine resign marker, not a re-introduction of the code-4 path.

- **R2 — Companion preflight treats "hotkey missing" as hard fail while socket is live: PASS (no such defect).** `holdSocket` (darwin-estop.ts:69) only sets `liveSock`; `ensureEstopHelper` (line 165) returns `ok:true` whenever `tryConnectHeld` succeeds. There is no field, env var, or status byte the helper emits that conveys hotkey state, so the preflight cannot gate on it. This is exactly the documented intent ("Fail-closed for Computer Use = socket proof-of-life, not global hotkey").

- **R3 — Claims on-device `host_computer` fully fixed without SOCKET_LIVE / click / screenshot evidence: PASS.** The HANDOFF doc is explicit (lines 91–94): "勿宣称「用户侧 Computer Use 已完全修好」— 真机 host_computer 仍失败. CLI 成功 ≠ Side Panel 成功." The "late night" update (lines 159–163) lists still-open items including "Re-verify Side Panel `host_computer` screenshot + click end-to-end on device" and "Hotkey still degraded under LS until Accessibility/Input Monitoring covers ad-hoc LS identity." Device evidence cited is exactly `SOCKET_LIVE` (python connect) + estop-tray.log DEGRADED line — not click/screenshot end-to-end. No overclaim.

- **R4 — Soft-fail introduces a path where a dead helper still looks live: PASS.** The socket server is established (bind+listen+accept loop, host.swift:1976–2015) before the tap is created, and remains the only companion-visible channel. Helper death (SIGTERM/SIGKILL/crash/`terminate()` from tray) closes all FDs → companion's held socket sees EOF → Node fires `'end'`/`'error'` → `sock.destroyed` becomes true → `estopHeartbeatLost()` returns true → fail-closed. The held socket registers an `'error'` listener that does nothing (line 72) but Node still flips `destroyed` on transport errors, which is what the comment `/* liveness via sock.destroyed */` and `estopHeartbeatLost()` rely on. DEGRADED keeps the **process** alive; it does not keep the **socket** artificially alive after process death.

## Blocking

None. All four gates pass.

## Nits

1. **Dead code-4 retry path (darwin-estop.ts:191–194).** `spawnEstopOnce`'s `code4 = last.reason?.includes("code 4")` retry is now unreachable — the helper no longer exits with code 4 in any branch. Already flagged in the HANDOFF (line 162: "Pi nits: … clean dead code4 retry"). Safe to delete the retry block and the `for (let attempt = 1; attempt <= 2; …)` loop wrapper.

2. **DEGRADED state is invisible to companion/UI.** The held socket is paused with no `'data'` listener and the helper emits no status byte on connect, so the companion cannot tell whether the hotkey is armed. Surfaceable only via `~/.cmspark-agent/logs/estop-tray.log`. Acknowledged in HANDOFF as still-open Pi nits (line 162: "log DEGRADED on daemon-fallback success path; surface degraded hotkey in UI"). Not a safety regression — fail-closed is intact — but a UX gap for users whose hotkey silently doesn't work. A one-shot `write(fd, "degraded\n", …)` (or `"armed mode=listenOnly\n"`) on the accepted client connection before `addClient` would let `holdSocket` attach a `'data'` listener for status without breaking the proof-of-life contract.

3. **Swift shadowing / minor style (host.swift:2029/2049).** Outer `var tap` is rebound then shadowed by `if let tap = tap`. Functionally correct; could be tightened with a single `let tap: CFMachPort? = firstAttempt ?? secondAttempt` but not worth churn.

4. **Accept loop has no backoff on `accept` returning -1 (host.swift:2010–2014).** Tight busy-spin if `accept` ever fails repeatedly. Low practical risk for a single-client companion socket; mention only for completeness.

Nits 1 and 2 are explicitly tracked as known follow-ups in the HANDOFF and do not affect the safety property under review.

VERDICT: APPROVE_WITH_NITS
