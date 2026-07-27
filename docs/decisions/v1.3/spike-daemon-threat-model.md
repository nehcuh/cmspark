# Daemon Threat Model Addendum — S-P0-2 / Approach C

**Date**: 2026-07-24
**Trigger**: Adversary review Blocker B3 (`adversary-approach-c-round1.txt`).
**Scope**: Decide whether Approach C ships with a long-lived `cmspark-host` daemon or stays with the current per-action `execFile` spawn model.

## The threat model under per-action spawn (current, v1.3 Batch 1 shipped)

**Asymmetric coverage — important distinction**:

| Binary | TOCTOU hardening | Where |
|---|---|---|
| `cmspark-tray` (menu bar) | **S-P0-2 enforced** — `checkIntegrity()` opens fd, hashes, captures inode+dev+realpath, spawns via realpath, post-spawn re-stat | `companion/src/tray/swift-tray-bridge.ts:42-185` |
| `cmspark-host` (computer-use) | **S-P0-2 ABSENT** — `host-bin.ts` only does path resolution (S-P0-1 `CMSPARK_HOST_BIN` override lockdown); spawn at `companion/src/host-use/darwin/adapter.ts:138-144` is a bare `execFileAsync` with no hash check, no inode/dev re-stat | `host-bin.ts` + `adapter.ts` |

Both paths share three properties:

1. **Fresh spawn per call** — every inject invocation is a new process. Lifetime: tens of milliseconds. Blast radius if compromised: one misrouted click/type.
2. **Argv-only input surface** — no stdin, no IPC, no network. The only attack surface per spawn is the command-line arguments, which are constructed in TypeScript with strict types and no shell interpolation.
3. **Hardened runtime + library validation** (tray only currently; host pending SkyLight decision).

**For `cmspark-tray`:** full S-P0-2 TOCTOU posture is enforced. Capability-bounded model: each invocation does one thing and dies. No persistent privileged state to suborn.

**For `cmspark-host`:** the spawn path has no integrity check today (pre-SkyLight). The addition of `disable-library-validation` for SkyLight dlopen removes a defense layer (DYLD injection defense) that was the *only* compensating control on that path. Plan-phase must either (a) mirror `checkIntegrity()` into `adapter.ts:138-144` (preferred — closes both TOCTOU and library-load regression), or (b) explicitly accept that `cmspark-host` runs without S-P0-2 and re-derive the residual attack surface.

## What changes under Approach C item #5 ("long-lived host daemon")

| Property | Per-action spawn | Long-lived daemon |
|---|---|---|
| Process lifetime | ~10-50 ms | hours to days |
| State | None | All state (resolved SPI handles, cached window lists, IPC socket) lives in memory for the daemon's lifetime |
| Integrity check frequency | Every call | Once at start; subsequent calls trust the running process |
| IPC surface | Argv only | Unix domain socket (or stdin JSON lines) — any local process can connect |
| Privilege escalation value if compromised | One misplaced click | Persistent proxy with SkyLight event-posting capability — can drive ANY window on the host, including password dialogs, keychain prompts, and other agents' windows |
| TOCTOU window | Per-call (microseconds between hash and exec) | Start-of-process only; afterwards zero re-validation |

The daemon model converts `cmspark-host` from a **stateless tool** into a **persistent privileged service**. That is a categorical change in blast radius, not an incremental one.

## Threat rows

### T1 — Local priv-esc via socket hijack

**Scenario**: daemon listens on a Unix domain socket at `~/.cmspark-agent/host.sock` (or similar). Any user-level process on the host connects and sends `{"cmd":"inject","window_id":<victim_window>,"x":...,"y":...,"action":"click"}`.

**Damage**: attacker drives arbitrary windows — password prompts, Keychain Access, banking sites, other agents. With SkyLight per-PID posting, the click lands even if the target is not frontmost and the user's cursor doesn't move, making the attack effectively invisible.

**Mitigation candidates**:
- (a) `SCM_CREDENTIALS` + verify peer pid against companion's pid every call.
- (b) Socket mode 0600 + parent-dir mode 0700; relies on filesystem perms (TOCTOU-able via symlink swap if dir is writable by other uid).
- (c) Linux-style `SO_PEERCRED` is not available on macOS; `LOCAL_PEERCRED` is, but is v1 (pid only, no uid signing).
- (d) Replace socket with fork-per-request (reduces to current model, kills perf win).

**Verdict**: row resolves to **"trust the caller"** under (a)/(b)/(c) — all mitigations have known bypass classes on macOS. Only (d) is unconditional.

### T2 — Post-spawn binary substitution (S-P0-2 regression)

**Scenario**: daemon started at boot against binary with hash H1. Attacker with write access to `dist/cmspark-host` substitutes binary with hash H2. Daemon keeps running with H1 in memory — substitution undetected until restart.

**Damage**: undetected for hours/days. Worse than current model where every spawn re-hashes.

**Mitigation candidates**:
- (a) Re-hash the on-disk binary every N seconds; compare to startup hash. Cost: disk I/O every N seconds; trivial bypass — pause attack during hash window.
- (b) `mmap` the binary file at startup with `MAP_FILE | MAP_PRIVATE`, hash the mapping; future spawns (if daemon restarts) read from the mmap, not the disk. Defeats substitution but assumes startup wasn't itself substituted.
- (c) Sign the daemon's in-memory image with a kernel-attested hash (requires `Endpoint Security` framework — privileged, App Store incompatible).

**Verdict**: row resolves to **"trust startup"** under (a)/(b). (c) is research-grade.

### T3 — SPI handle subornation

**Scenario**: daemon holds SkyLight `dlsym` function pointers in process memory. Attacker with arbitrary read/write (e.g. via a different vuln in Node or the daemon's own parser) overwrites the function pointer to call an arbitrary address.

**Damage**: arbitrary code execution with the daemon's privileges (which now include Accessibility + SkyLight event posting).

**Mitigation candidates**:
- (a) Re-resolve `dlsym` every N calls (defeats the cached-pointer attack but not an attacker with write access).
- (b) `mprotect` the function pointer table as read-only after initial resolution. Defeated by attacks that can flip `mprotect` first.
- (c) Resolve on every call (defeats caching but loses ~0.1ms per call — acceptable perf cost).

**Verdict**: row resolves to **"trust the heap"** under (a)/(b). (c) is workable but doesn't address T1/T2.

### T4 — Companion ↔ daemon IPC message injection

**Scenario**: companion (Node process) constructs IPC messages to daemon. A compromised renderer in the Chrome extension exfiltrates the WebSocket secret and sends a malicious tool-call that the companion then forwards to the daemon as a privileged operation.

**Damage**: same as T1 — arbitrary click on any window.

**Mitigation candidates**:
- (a) Per-operation confirmation gate at the daemon (re-implement the L2 dialog inside the daemon — duplicates `security-confirmation.ts` and adds latency).
- (b) Strict allowlist of action types in the daemon (click, type, scroll) but no policy on coordinates — useless, since arbitrary coordinates are the threat.
- (c) Trust the companion's existing L2 gate; daemon does no policy.

**Verdict**: row resolves to **"trust the upstream gate"** under all three. Same as today's per-spawn model.

## Synthesis

Three of four threat rows (T1, T2, T3) **resolve to "trust X"** under every mitigation considered. T4 is identical to today's model.

**Decision**: Approach C ships **WITHOUT** the daemon optimization. We keep `execFile`-per-action spawn and only adopt the SkyLight primitive swap. This is the "C-minus" variant discussed in `spike-skylight-tahoe-results.md`.

**What we lose**: ~10-50ms × N action fork overhead. For a 10-action sequence, ~100-500ms cumulative. Noticeable but not catastrophic.

**What we keep**: no new IPC attack surface; no persistent privileged state. (Note: S-P0-2 TOCTOU posture is preserved for `cmspark-tray`, but was **never** applied to `cmspark-host`'s spawn path — see table above. Adding it for `cmspark-host` is a Plan-phase prerequisite if the library validation flip lands.)

## Deferred work

If daemon becomes necessary for UX reasons (e.g. latency is unacceptable in user testing), reopen T1-T3 with these pre-conditions:
1. Adopt `LOCAL_PEERCRED` + pid-allowlist (mitigation T1c).
2. `mmap`-based binary integrity (mitigation T2b) — accept "trust startup".
3. Re-resolve `dlsym` per call (mitigation T3c).

This is the "C-plus" variant. Not on the v1.3 critical path.

## Production gate

This document is a prerequisite for any Plan-phase work that touches:
- `companion/src/host-use/darwin/host-bin.ts` (per-spawn model — preserve)
- `companion/src/host-use/darwin/host.swift` (SkyLight swap target)
- Any new IPC channel between companion and a long-lived host process

Grok + Claude Code final review must explicitly approve this document before Approach C Plan-phase.
