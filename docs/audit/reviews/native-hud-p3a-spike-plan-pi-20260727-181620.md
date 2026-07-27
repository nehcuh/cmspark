Good. The real `server.ts` confirms the plan's tray/wiring patterns are coherent with existing code (lines 1175, 1196, 1354, 1361 show the existing race + cancel + respond pattern the plan builds upon).

---

## Independent Review: P3a Native HUD Spike Plan

**Primary:** `docs/superpowers/plans/2026-07-27-companion-native-hud-p3a-spike.md`

### Axis-by-axis findings

**1. Scope fidelity — PASS.** S1–S8 are concrete and measurable. `HudHydrateCmd.dual_track` uses `{ conclusions: never[]; steps: never[] }` — zero screenshots. Full ConfirmElevated (nonce/whitelist/preview), production `hud.shell` UX, L1 expand, and tray L2 retirement are all explicitly listed as non-goals. No scope creep.

**2. N1 one binary — PASS.** Task 4 adds `HudController` as a lazy `NSWindow` in the **same** `Tray.swift` — zero second binaries. Task 4 Step 4 updates `SWIFT_TRAY_SHA256` (optionally renames to `SWIFT_COMPANION_UI_SHA256` with alias). Single SHA256 gate preserved.

**3. N2 standby — PASS.** Task 2 `HudShellRouter.setActiveShell` emits `shell.standby` with the exact N2-law message pattern ("任务进行中 — 在 HUD|确认台 查看"). Task 4 `enterStandby(message:)` hides confirm card, shows status line. Task 6 auto-triggers after 5s. MinimalConfirm stays Panel-only (explicit non-goal).

**4. N3 numbers — PASS.** `HUD_HEARTBEAT_STALE_MS = 3000` and `HUD_PING_TIMEOUT_MS = 400` match the locked values. Cold-start "never blocks" is correctly deferred (non-goal: "full N3 open path can stay behind a debug flag"). The spike implements the health checks without contradicting the lock.

**5. N4 close ≠ stop — PASS.** Task 4 Step 1 uses `isReleasedWhenClosed = false`. Step 3: user-close emits `hud.closed` but does **not** terminate `NSApplication`. Abort button ("急停") emits `hud.abort` without closing the window. Close vs quit are cleanly separated.

**6. N5 single-writer — PASS.** Wire stays `unknown` — the protocol section says: "do **not** invent `already_resolved`" and `HudConfirmResolvedCmd.outcome` includes `"unknown"`. Task 3 broadcast-resolved hook (`finalize` → `onTerminal`) fans out to tray `cancelConfirm`, `cancelHudConfirm`, and `notifyHudConfirmResolved` — safely. `respond()` returns `false` for late callers (existing behavior preserved).

**7. Protocol realism — PASS.** HUD cmds follow the identical `{"cmd":"...",...}` → `jsonLine(...)` pattern as the existing `update`, `show-confirm`, `cancel-confirm` handlers in `Tray.swift`. The race concern is correctly addressed: Task 5 `showHudConfirm` mirrors the existing pending-map + self-timeout pattern, and Task 6 explicitly tests "only one wins; other clears via resolved."

**8. Security — PASS.** Task 4 Step 4 updates SHA256 gate after build. Risk note explicitly states "Do not log pairing secrets or full confirm previews at info." The privileged `respond()` path is **not** widened — `onTerminal` fires from `finalize` which is wrapped in try-catch ("never break resolve path"). The `SwiftTrayAdapter` TOCTOU check (pre + post-spawn inode) is unaffected by any plan change.

**9. Testability — PASS.** All tasks follow TDD: write failing test → implement → pass → commit. Test code references real APIs (`parseSwiftLine`, `SecurityConfirmationManager.respond`, `HudShellRouter`). File references match real files: `Tray.swift` (has `handleCommand`/`jsonLine`), `swift-tray-bridge.ts` (has `SwiftTrayAdapter` with `send`/`pendingConfirms`), `security-confirmation.ts` (has `respond`/`respondFrom`/`PendingConfirmation`), `server.ts` (lines 1175-1361 already implement the tray confirm race the plan extends).

**10. Exit gate — PASS.** Task 0 is the dual-review gate blocking Task 1. Task 7 requires dual-review of implementation before any screenshot flood path. The `N1N10-lock` checklist explicitly gates: "Spike dual-review before dual-track screenshot flood path (plan Task 0 + impl Task 7)."

---

### Non-blocking nits

1. **Task 3 `finalize` hook call-site enumeration** — The plan says "Wire `finalize` into successful `respond`, `respondFrom` resolved path, timeout, disconnect." The existing `SecurityConfirmationManager` has ~5 distinct resolution paths (`respond()`, `respondFrom()` success path, `request()` timeout, `rejectAll()`, `rejectForWorker()`). The plan's pseudocode shows the pattern but doesn't enumerate all call sites. TDD will catch any gaps, but implementers should audit every path that calls `pending.resolve(...)`.

2. **Task 5/6 entry-point ambiguity (`menu-bar-agent.ts` vs `server.ts`)** — The plan says debug entry goes in "`menu-bar-agent.ts` (or server debug handler)." In practice, `SecurityConfirmationManager` + tray bridge wiring lives in `server.ts` (confirmed by `server.ts` lines 1175-1361). The tray process (`menu-bar-agent.ts`) is a separate entry point communicating via WS (`CompanionClient`). The spike debug action should be in `server.ts`, not `menu-bar-agent.ts` — otherwise it can't call `SecurityConfirmationManager.request()` directly. The plan mentions both files, which could mislead.

3. **Task 4 Step 4 `shasum` path** — The plan writes `shasum -a 256 dist/cmspark-tray` but `build-tray.sh` uses `${PROJECT_ROOT}/dist/cmspark-tray`. Implementers running from different CWDs may get path mismatches. The plan should reference the output of the build script (`build-tray.sh` prints the SHA256 directly).

4. **Task 5 Step 3 WS broadcast comment** — The comment `// existing WS broadcast path if any — extend when easy` is hand-wavy. In `server.ts`, the existing resolve path at line 1361 already broadcasts via `respond()` → `pending.send({ type: "security.confirmation.resolved", ... })` which goes to the origin WS. The `onTerminal` hook adds multi-surface fan-out. Implementers may not know whether to extend WS broadcast to non-origin clients in the spike. The plan could clarify: "WS broadcast to all clients is deferred; spike only fans out to HUD + tray."

5. **Task 6 checklist item** — "Second confirm Deny → denied" — doesn't specify whether a second confirmation_id should be created or whether this reuses the same confirm entry (which would be a late-respond unknown test). Clarifying the expected behavior would help the operator during manual verification.

6. **`HudHydrateCmd.dual_track` uses `never[]`** — TypeScript `never[]` means the array must be empty, which is correct for the spike. But implementers should ensure the Swift `handleCommand("hud.hydrate")` path handles `conclusions: []` gracefully (no-op) rather than crashing on unexpected empty arrays.

---

### Can implementers start Task 1 after this review?

Yes. The plan is concrete, references real code correctly, respects all N1–N10 locks, and has no blocking issues. The nits above can be folded into a short amendment section without re-review.

```
VERDICT: APPROVE_WITH_NITS
```
