# Dual review: P3a Native HUD Spike Plan (Task 0 gate)

Review this plan document as an independent senior product/engineering reviewer:

**Primary:** `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`

**Against (must open and cross-check):**

1. `docs/decisions/v1.3/companion-native-hud-n1n10-lock-2026-07-27.md` (N1–N10 product law)
2. `docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md` (Option A / P3a scope)
3. Real code (use Read/Grep tools — do not rubber-stamp plan prose):
   - `companion/src/tray/Tray.swift`
   - `companion/src/tray/swift-tray-bridge.ts`
   - `companion/src/tray/tray-adapter.ts`
   - `companion/src/security-confirmation.ts`
   - `companion/src/menu-bar-agent.ts` (entry points)
   - `companion/src/tray/build-tray.sh`

## Review axes (cover each)

1. **Scope fidelity** — Does the plan prove S1–S8 without sneaking in dual-track screenshots, full ConfirmElevated, production `hud.shell` UX, or L1 expand?
2. **N1 one binary** — Extends existing tray process/hash gate correctly; no second binary / dual SHA256 for P3a.
3. **N2 standby** — `shell.standby` stub is concrete; MinimalConfirm remains Panel-only (not in HUD spike).
4. **N3 numbers** — Heartbeat 3s / ping 400ms present; cold-start "never blocks" correctly deferred or stubbed without contradicting lock.
5. **N4 close ≠ stop** — Window hide vs process quit; abort separate from close.
6. **N5 single-writer** — Wire outcome stays **`unknown`** (no inventing `already_resolved`); broadcast resolved is NEW and wired to manager hook safely.
7. **Protocol realism** — stdin JSON cmds match existing tray line protocol; race with tray `show-confirm` does not double-exec.
8. **Security** — Hash gate / TOCTOU rules preserved; no logging secrets; privileged `respond()` path not widened unsafely.
9. **Testability** — Tasks are implementable with TDD as written; missing files or wrong APIs called out.
10. **Exit gate** — Clear stop before screenshot flood path.

## Output format

- List **blocking issues** (if any) with concrete plan section / file references.
- List **non-blocking nits** (if any).
- Optional: one paragraph "can implementers start Task 1 after this review?"
- Final line MUST be exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
