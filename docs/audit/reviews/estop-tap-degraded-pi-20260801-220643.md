All verification complete. Here is my independent review.

---

# Dual review: estop CGEventTap soft-fail (socket stays live)

**Batch:** estop-tap-degraded · **Repo:** `/Users/huchen/Projects/cmspark` · **Branch:** `fix/macos-tcc-product-identity`

**Scope examined:** uncommitted working-tree diff on `host.swift` (+ `host-integrity.ts` SHA bump), `darwin-estop.ts` (unchanged in this diff), `server.ts` preflight/abortCheck wiring, `darwin-adapters.ts` inject flag guard, blocked handoff doc, device logs (`~/.cmspark-agent/logs/estop-tray.log`, `companion-2026-08-01.log`).

## Summary

The change converts the CGEventTap from a hard gate to a best-effort feature: `runEstop` now tries `listenOnly` first, falls back to `defaultTap`, and on double-nil logs `hotkey DEGRADED` and continues to `CFRunLoopRun()` instead of throwing code 4 / exiting. The socket proof-of-life is explicitly re-declared as the fail-closed channel for Computer Use. The code matches the device evidence: `estop-tray.log` (22:06) shows exactly the new `DEGRADED … axTrustedBefore=false axTrustedNow=false … (legacy code-4 path removed)` line, and the companion log confirms a live socket (`computer.estop.connected owner=preexisting`). The change is honest about what is and isn't fixed.

## Gate-by-gate

| # | Gate | Verdict | Evidence |
|---|------|---------|----------|
| R1 | Helper still exits when tapCreate fails | **Not tripped** | Old `guard let tap … else { close(serverFD); throw HostError(code: 4) }` removed. New path: `listenOnly` → `defaultTap` → nil → `fputs(DEGRADED)` → falls through to `CFRunLoopRun()`. Remaining `code: 4` instances (lines 159/288/425/477) are AppleScript-error paths, unrelated. |
| R2 | Preflight treats "hotkey missing" as hard fail | **Not tripped** | `ensureEstopHelper()` is socket-connect only — zero AX/tap inspection. With soft-fail the tap-nil helper stays alive and binds the socket, so preflight returns `ok:true` (SOCKET_LIVE). `server.ts` refuses (`EMERGENCY_STOP_UNAVAILABLE`) only on `!darwinEstopOk.ok`, i.e. socket unreachable. |
| R3 | Claims full on-device fix without evidence | **Not tripped** | Commit `fd29c29` message: "device evidence (CGEventTap still fails)"; handoff: 「勿宣称「用户侧 Computer Use 已完全修好」」; snapshot claims only SOCKET_LIVE + hotkey DEGRADED, no click/screenshot DoD claim. |
| R4 | Dead helper still looks live | **Not tripped** | Liveness is the held socket connection to a genuinely running process: socket binds (step 1) *before* tap (step 2); accept loop runs on a global queue. Helper death → EOF → `estopHeartbeatLost()` → `abortCheck` `"estop-lost"` → `EMERGENCY_STOP_LOST`. Hotkey state is orthogonal to socket liveness — a degraded hotkey does not fake process liveness, and the inject-time `--estop-flag` guard remains as defense-in-depth. |

## Must-verify checklist

1. Hard code-4 exit on tap nil gone — ✅ (diff above, gate R1)
2. Companion still refuses when socket unavailable — ✅ `ensureEstopHelper` fail → refuse; daemon-fallback early-exit path returns `{ok:false}` with stderr; old log lines (`host_computer refused: emergency-stop unavailable … exited at startup (code 4)`) demonstrate the refusal path.
3. Hotkey best-effort explicit in logs/comments — ✅ Header comment ("The global hotkey is best-effort"), inline comment ("Do NOT exit"), and both stderr lines (`hotkey armed … mode=…` / `hotkey DEGRADED … socket proof-of-life still active`).
4. No user-facing "enable node" — ✅ `rg` over `companion/src` + `chrome-extension/src` finds nothing; user guide (per prior review) actively forbids enabling node.
5. No un-evidenced DoD claim — ✅ (gate R3)
6. Degraded hotkey doesn't weaken fail-closed — ✅ The hotkey was never the fail-closed mechanism; socket EOF on helper death still aborts mid-task. The only *reduced* surface is the user-initiated muscle-memory kill (see Nit 3) — stop remains available via tray quit / Side Panel Stop / killing the helper.

## Blocking

None.

## Nits

1. **Daemon-fallback spawn loses the DEGRADED signal.** In `spawnEstopOnce`, `stderrBuf` is only surfaced when `earlyExit !== null`. With the soft-fail, a tap-nil helper spawns and connects successfully, so the "hotkey DEGRADED" line is silently discarded on the daemon path (only the tray path writes `estop-tray.log`). Suggest logging stderrBuf on the success path too, or returning the hotkey mode in the `EstopResult` for logging.
2. **Stale `code4` retry branch.** `ensureEstopHelper`'s `last.reason?.includes("code 4")` + 1.5s retry can no longer trigger for tap failures (that exit code no longer exists for the tap path). Harmless, but dead — consider removing or generalizing to "early exit".
3. **Degraded hotkey is invisible to the user in-app.** A user who habitually relies on Ctrl+Shift+Alt+Cmd+E gets no tray/Side Panel indication when it's silently degraded (only stderr/log). Since the whole point of soft-fail is to *proceed anyway*, consider surfacing a "hotkey unavailable" hint in the panel/tray when DEGRADED is detected, so nobody presses a dead kill switch and assumes the task stopped.
4. **Batch artifact hygiene (meta, not code).** The two peer-review outputs for this batch are broken: `estop-tap-degraded-kimi-…220643.md` is 44 bytes containing `error: Cannot combine --prompt with --yolo.`, and `estop-tap-degraded-pi-…220643.md` is 0 bytes. The dual-review claim in this batch is currently unsubstantiated by files.

## Security note (accepted, should be stated)

With the hotkey degraded, the user-initiated hotkey kill silently no-ops; the remaining stop surfaces are tray quit, Side Panel Stop, or killing the helper (which the companion detects via EOF). The fail-closed guarantee — *agent still dies if helper dies* — is fully preserved, and this tradeoff is explicitly documented in the header comment and log line. Consistent with the reviewed design.

```
VERDICT: APPROVE_WITH_NITS
```
