# Dual review: estop CGEventTap soft-fail (socket stays live)

**Batch:** estop-tap-degraded  
**Repo:** `/Users/huchen/Projects/cmspark`  
**Branch:** `fix/macos-tcc-product-identity`  
**Reviewers:** Pi + Claude (real CLIs; Kimi optional / skipped)

## Problem (device evidence, 2026-08-01)

| Launch path | Result |
|-------------|--------|
| CLI `MacOS/CMspark estop` | SOCKET_LIVE, tap OK |
| Python/Process from Terminal | SOCKET_LIVE |
| `open -a CMspark.app` / tray-owned child | Previously: tapCreate nil → **exit code 4** → dead socket → `host_computer` refuse |
| After soft-fail reinstall | **SOCKET_LIVE**, estop child alive, log: `hotkey DEGRADED`, `axTrustedBefore=false` under LS |

CLI `security-check` still reports `axTrusted:true` while LS-launched estop reports `axTrusted=false` — TCC attribution differs for ad-hoc LaunchServices vs direct exec.

## Required reading

1. `companion/src/host-use/darwin/host.swift` — `runEstop` (CGEventTap section) + `launchAgentTrayAndExit`
2. `companion/src/computer/darwin-estop.ts` — connect-first / fail-closed on socket
3. `docs/superpowers/plans/2026-08-01-macos-tcc-estop-BLOCKED-HANDOFF.md`
4. Device log: `~/.cmspark-agent/logs/estop-tray.log` (expect DEGRADED or armed, not process exit)

## Change under review

- Prefer `CGEvent.tapCreate` **listenOnly**, then **defaultTap**
- If both nil: **do not** throw HostError code 4 / exit; keep socket server + `CFRunLoopRun`
- Log hotkey DEGRADED + axTrusted flags
- Fail-closed for Computer Use remains **UNIX socket proof-of-life**, not global hotkey

## Must verify

1. Hard code-4 exit on tap nil is **gone**
2. Companion still refuses when **socket** unavailable
3. Hotkey remaining best-effort is explicit in logs/comments
4. No user-facing “enable node”
5. No claim that full Computer Use DoD (screenshot/click/hotkey) is complete without evidence
6. Security: degraded hotkey does not weaken fail-closed (agent still dies if helper dies)

## Rejection gates

| # | Gate |
|---|------|
| R1 | Helper still exits when tapCreate fails (code 4 or equivalent) |
| R2 | Companion preflight treats “hotkey missing” as hard fail while socket is live |
| R3 | Claims on-device host_computer fully fixed without SOCKET_LIVE / click / screenshot evidence |
| R4 | Soft-fail introduces a path where a dead helper still looks live |

## Device evidence snapshot (implementer)

```
estop-tray.log:
estop: CGEventTap unavailable — hotkey DEGRADED; socket proof-of-life still active.
axTrustedBefore=false axTrustedNow=false. ...

ps: CMspark → CMspark estop --socket-path /tmp/cmspark-estop.sock (living)
python connect /tmp/cmspark-estop.sock → SOCKET_LIVE
```

## Output format

Summary, Blocking, Nits, then exactly one final line:

```
VERDICT: APPROVE
```
or
```
VERDICT: APPROVE_WITH_NITS
```
or
```
VERDICT: REJECT
```
