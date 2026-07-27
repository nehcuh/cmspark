I have enough context. Let me write the review.

---

# P3a Native HUD Spike Plan — Independent Senior Review

I read the plan, both upstream locks (N1–N10 + brief), the four referenced code files (`Tray.swift`, `swift-tray-bridge.ts`, `tray-adapter.ts`, `security-confirmation.ts`, `menu-bar-agent.ts`, `build-tray.sh`), and the actual `server.ts` race site at `companion/src/server.ts:1337`. Patch file is current — `git status` confirms only the two doc updates plus the new plan/review files.

## Axis-by-axis findings

1. **Scope fidelity** — Clean. Non-goals explicitly exclude dual-track screenshots, ConfirmElevated parity, production `hud.shell` UX, L1 expand, and tray L2 retirement. `dual_track?: { conclusions: never[]; steps: never[] }` is a clever TS trick to enforce empty arrays in the hydrate payload (plan line 95). ✓
2. **N1 one binary** — Plan adds `HudController` to `Tray.swift`, reuses `dist/cmspark-tray`, renames `SWIFT_TRAY_SHA256` only optionally (line 562). One binary, one hash gate, lazy `NSWindow`. ✓
3. **N2 standby** — `shell.standby` cmd is concrete (plan lines 119–125, 538–540). MinimalConfirm stays Panel-only per non-goal. ✓
4. **N3 numbers** — Constants locked at 3000ms/400ms in `HUD_HEARTBEAT_STALE_MS`/`HUD_PING_TIMEOUT_MS` (plan lines 346–347). Cold-start selector explicitly deferred (non-goal line 33; self-review table line 758). ✓
5. **N4 close ≠ stop** — `hud.closed reason:"user"` does NOT call `NSApplication.shared.terminate(_:)` (plan line 555). Window `isReleasedWhenClosed = false` reuses `PairingController` pattern (Tray.swift:532). ✓
6. **N5 single-writer** — Wire outcome stays `"unknown"`; plan explicitly says "**do not invent `already_resolved`**" (line 154). Existing `respondFrom()` already returns `outcome: "unknown"` for late callers (security-confirmation.ts:344); privileged `respond()` returns `false`. The `setOnTerminal` hook is NEW and called only from `finalize()` after `pending.delete()` (plan lines 481–490). Late calls early-return before `finalize` → hook fires exactly once. ✓
7. **Protocol realism** — `cmd`/`type` field split matches existing tray protocol (Tray.swift:389 vs 28). Line-delimited JSON on stdin/stdout is the existing pattern (swift-tray-bridge.ts:286–289). Race with `show-confirm` is explicitly called out — HUD-only preferred for elevated path, one explicit dual-surface race test (plan line 778). ✓
8. **Security** — Hash gate `checkIntegrity()` and post-spawn TOCTOU inode check preserved (swift-tray-bridge.ts:70–97, 176–184). Plan risk note #1 explicitly forbids auto-rebuild on hash mismatch (line 776). Risk note #2 forbids logging pairing secrets / full confirm previews. The privileged `respond()` path is not widened — onTerminal hook is read-only fan-out, doesn't grant new respond authority. ✓
9. **Testability** — `companion/src/hud/` does not yet exist (verified); `companion/tests/` exists. TDD progression is clean (red → impl → green → commit). The `setOnTerminal` test signature matches `SecurityConfirmationManager.request`'s 4-arg signature `(send, details, options?, preGeneratedId?)` (security-confirmation.ts:181–191). ✓
10. **Exit gate** — Spike stop conditions S1–S8 are concrete and measurable. Task 0 (this review) gates Task 1. Task 7 dual-review of implementation gates the dual-track screenshot path. ✓

## Non-blocking nits

**N1. Task 2 test assertion contradicts N2 semantics (plan lines 319–322).**
The test sequence sets active shell to `"cockpit"` then `"hud"`. Per N2 ("Companion sends `shell.standby` to the **prior** wide shell"), standby must go to **cockpit** (the prior shell). The implementation at plan lines 383–385 correctly sends to `sendToCockpit` when `prev === "cockpit"`. But the test asserts `assert.equal(standby.to, "hud")` — this will fail at Task 2 Step 3 ("Run tests — PASS"). Either:
- Fix the assertion to `assert.equal(standby.to, "cockpit")` (recommended; matches N2 prose and impl), or
- Re-examine the impl direction if the author actually intended standby to fan out to the new active shell (would contradict N2 — do not).

An implementer following TDD will catch this immediately, but the plan as-written invites them to "fix" the implementation to match the buggy assertion, which would violate N2.

**N2. Loose typing on hydrate parser/encoder (plan lines 262–266).**
`encodeHudHydrate(p: Record<string, unknown>)` and `parseSwiftLine(line: string): any | null` abandon the type safety the rest of the protocol module establishes. For a spike this is acceptable, but a tighter `unknown` + `isHudEvent` typeguard mirror of `isHudConfirmResponse` would cost ~10 lines and prevent the parser from becoming a hole later.

**N3. Task 6 Step 1 doesn't specify the await mechanism for `hud.ready` (plan line 670).**
The plan says "Wait for `hud.ready` (timeout 2s; log failure)" but Task 5's `openHud()` is a fire-and-forget `send()` (plan line 593). Task 5 Step 2 hints at "resolve open waiters if any" (line 627) but doesn't define a `openHudAsync()` returning a Promise. Implementer will need to design this themselves; a one-line hint ("add `openHudAsync(threadId): Promise<void>` that resolves on first `hud.ready` line or rejects after 2s") would close the gap.

**N4. Spike wiring file ambiguity (plan lines 51, 635, 656, 665).**
The plan lists `companion/src/menu-bar-agent.ts or server.ts` as the wire target and Task 5 commit lists both (`git add … menu-bar-agent.ts server.ts`). But `menu-bar-agent.ts` is the tray-spawning entry — it doesn't currently import `securityConfirmations` (server.ts:245 owns the singleton). The implementer needs to either: (a) wire the hook inside `server.ts` where the manager is constructed, then expose `tray` to `server.ts` (currently the singleton is `getTrayInstance()` in menu-bar-agent.ts:102), or (b) add a setter. Plan should call out which file owns the wire.

**N5. Heartbeat timer spec ambiguity (plan line 552).**
"Heartbeat timer every 1s while window visible OR process always" is ambiguous. The 1s cadence is fine vs the 3s stale threshold, but the OR needs resolution: a 1s-always timer keeps the binary busier than necessary; a visibility-gated timer needs `NSNotification` hooks. Recommend "while HUD window is key or visible" with a one-line reference to `NSWindow.didBecomeKeyNotification`.

## Can implementers start Task 1 after this review?

**Yes, with the nits folded in.** Tasks 1 and 3 are independently implementable as-written. Task 2 needs the assertion fix (nit N1) before Step 3 can pass. Task 4–6 should be planned with nits N3–N5 resolved during implementation. The architectural shape — one binary, lazy `NSWindow`, onTerminal hook, env-gated debug entry — is sound and faithful to N1–N10.

---

VERDICT: APPROVE_WITH_NITS
