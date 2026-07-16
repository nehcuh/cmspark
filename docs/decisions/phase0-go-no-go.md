# Phase 0 Go/No-Go Decision

> **Date**: 2026-07-16
> **Branch**: `computer-use-phase0` (worktree at `.claude/worktrees/computer-use-phase0`)
> **Authority**: Round 2 synthesis §5.1 kill signals

## Three-platform status

| Platform | Gate criteria | Status | Evidence |
|---|---|---|---|
| macOS | TCC Automation permission granted to `cmspark-host` (ad-hoc + hardened runtime + entitlement) on Sonoma 14.4+; reads Mail inbox top-1 | ⏳ **PENDING** — see `phase0-macos-gate-evidence.md` Step 4 | AppleScript works, codesign flags correct, JSON returns; TCC attribution awaits user-side Terminal verification |
| Linux | AT-SPI reads Evolution top-1 inbox on Ubuntu 24.04 Wayland default; no Electron-app D-Bus deadlock | 📋 **RUNBOOK READY** — no test machine access | `companion/src/host-use/linux/RUNBOOK-phase0.md` executable on Ubuntu test machine when available |
| Windows | UIAccess blocking confirmed for unsigned binary on Win11 24H2+ (negative result is pass) | 📋 **RUNBOOK READY** — no test machine access | `companion/src/host-use/win/RUNBOOK-phase0.md` collects the 3 blocking behaviors |

## Decision logic (per Round 2 §5.1)

```
macOS FAIL → kill entire project, delete worktree, postmortem.
macOS PASS + Linux PASS + Windows blocked-as-expected → Phase 1 begin (W4 HostAdapter interface definition).
macOS PASS + Linux FAIL → Phase 1 reverts to darwin-only.
macOS PASS + Linux/Windows PENDING (RUNBOOK-only) → Phase 1 macOS-first, parallel Linux/Windows spike runs.
```

## Recommended path forward (2026-07-16)

Given no Linux/Windows test machine access currently, **proceed conditionally**:

1. **macOS gate** (user-side Terminal verification required):
   - If `cmspark-host` TCC dialog names "cmspark-host" → macOS PASS.
   - If TCC fails or attribution leaks to parent → kill project.

2. **HostAdapter interface definition at W4** (deferred until macOS PASS confirmed):
   - 3-method interface per Round 2 §2.1: `listReadTargets` / `readOne` / `writeOne`
   - `TargetId` opaque string: macOS=`bundle+path`, Linux=`atspi://path`, Windows=`hwnd`
   - Document at `docs/decisions/host-adapter-interface.md`

3. **Linux/Windows spike execution** (deferred):
   - When test machines become available, follow the RUNBOOKs and fill in evidence docs.
   - Until then, Linux/Windows stubs throw `NotImplementedOnPlatform` — honest signaling per Kimi's process call (Round 2 §5.3).

4. **Phase 1 ship scope** = macOS-only until Linux spike result is in hand. README and docs must explicitly mark Linux as "spike pending, not shipped" — no vague "Phase 1.5" soft-landing language.

## Outstanding risks

- **TCC attribution unverified**: the most consequential unknown. If `cmspark-host` cannot get its own TCC row when run from a normal user Terminal, the entire ad-hoc signing strategy is broken and Developer ID ($99/year) becomes mandatory before any user-facing ship.
- **AppleScript handler invocation gotcha**: `on run argv` doesn't fire when .scpt loaded via `NSAppleScript(contentsOf:)`. Worked around by removing the handler wrapper, but Phase 1 needs `executeAppleEvent(_:withParameters:)` for proper argv.
- **Date locale**: Phase 0 returns locale-formatted date string. Phase 1 must normalize.

## Action items before Phase 1 kickoff

- [ ] User runs TCC verification from Terminal per Step 4 of `phase0-macos-gate-evidence.md`
- [ ] Update this doc + macOS evidence doc with verification result
- [ ] If PASS: write `host-adapter-interface.md` at W4
- [ ] If FAIL: write `phase0-no-go-postmortem.md` and delete `computer-use-phase0` worktree
