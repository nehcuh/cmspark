# Phase 0 Go/No-Go Decision

> **Date**: 2026-07-16
> **Branch**: `computer-use-phase0` (worktree at `.claude/worktrees/computer-use-phase0`)
> **Authority**: Round 2 synthesis §5.1 kill signals
>
> **Evidence convention** (per behaviors.md R1.2):
> - `[executed]` = command run this session, output captured
> - `[inspected]` = static reading of code / artifact
> - `[assumed]` = inferred from documentation or pattern

## Three-platform status

| Platform | Gate criteria | Status | Evidence |
|---|---|---|---|
| macOS | TCC Automation permission granted to `cmspark-host` (ad-hoc + hardened runtime + entitlement) on Sonoma 14.4+; reads Mail inbox top-1 | ✅ **SOFT-PASS** | `[executed]` codesign flags correct + binary returns valid JSON + TCC dialog appeared after global reset (user confirmed 2026-07-16); `[assumed]` prompt named `cmspark-host` (not explicitly captured) — see `phase0-macos-gate-evidence.md` Step 4 |
| Linux | AT-SPI reads Evolution top-1 inbox on Ubuntu 24.04 Wayland default; no Electron-app D-Bus deadlock | 📋 **RUNBOOK READY** — no test machine access | `[inspected]` `companion/src/host-use/linux/RUNBOOK-phase0.md` executable on Ubuntu test machine when available |
| Windows | UIAccess blocking confirmed for unsigned binary on Win11 24H2+ (negative result is pass) | 📋 **RUNBOOK READY** — no test machine access | `[inspected]` `companion/src/host-use/win/RUNBOOK-phase0.md` collects the 3 blocking behaviors |

## Decision logic (per Round 2 §5.1)

```
macOS FAIL → kill entire project, delete worktree, postmortem.
macOS PASS + Linux PASS + Windows blocked-as-expected → Phase 1 begin (W4 HostAdapter interface definition).
macOS PASS + Linux FAIL → Phase 1 reverts to darwin-only.
macOS SOFT-PASS + Linux/Windows PENDING (RUNBOOK-only) → Phase 1 macOS-first, parallel Linux/Windows spike runs.
```

## Recommended path forward (2026-07-16)

macOS SOFT-PASS achieved; no Linux/Windows test machine access currently. **Proceed with Phase 1 macOS-first**:

1. **macOS gate**: `[executed]` binary works end-to-end; `[executed]` TCC dialog appears after reset; `[assumed]` attribution to `cmspark-host`. Re-verification with screenshot can run in parallel with Phase 1 W4 — no longer blocking.

2. **HostAdapter interface definition at W4** (next session):
   - 3-method interface per Round 2 §2.1: `listReadTargets` / `readOne` / `writeOne`
   - `TargetId` opaque string: macOS=`bundle+path`, Linux=`atspi://path`, Windows=`hwnd`
   - Document at `docs/decisions/host-adapter-interface.md`

3. **Linux/Windows spike execution** (deferred):
   - When test machines become available, follow the RUNBOOKs and fill in evidence docs.
   - Until then, Linux/Windows stubs throw `NotImplementedOnPlatform` — honest signaling per Kimi's process call (Round 2 §5.3).

4. **Phase 1 ship scope** = macOS-only until Linux spike result is in hand. README and docs must explicitly mark Linux as "spike pending, not shipped" — no vague "Phase 1.5" soft-landing language.

## Outstanding risks

- **TCC attribution name not screenshot-captured**: `[assumed]` only. If a future re-verification shows the prompt names Terminal/Node instead of `cmspark-host`, the ad-hoc signing strategy is broken and Developer ID ($99/year) becomes mandatory. Mitigation: re-run protocol in `phase0-macos-gate-evidence.md` Step 4 with screenshot before Phase 1 ship.
- **AppleScript handler invocation gotcha**: `[inspected]` `on run argv` doesn't fire when .scpt loaded via `NSAppleScript(contentsOf:)`. Worked around by removing the handler wrapper; Phase 1 needs `executeAppleEvent(_:withParameters:)` for proper argv.
- **Date locale**: `[executed]` Phase 0 returns locale-formatted date string ("2023年10月8日 星期日 上午11:22:32"). Phase 1 must normalize to ISO 8601.

## Action items before Phase 1 ship (not W4 kickoff)

- [x] User runs TCC verification from Terminal — done 2026-07-16 (SOFT-PASS)
- [ ] Optional: re-verify TCC attribution with screenshot (closes the `[assumed]` → `[executed]` gap)
- [ ] Write `host-adapter-interface.md` at W4 (next session)
- [ ] Run Kimi Round 2 review on fix commits (per `kimi_review_every_fix`)

