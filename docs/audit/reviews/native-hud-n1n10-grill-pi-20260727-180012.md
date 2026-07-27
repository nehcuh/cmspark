I now have all the evidence. Let me write the independent Pi Agent grill.

---

# Dual GRILL — Native HUD N1–N10 (Pi Agent, independent pass)

## Patch freshness verified

`git status` shows HEAD at `353d86e` with the brief committed. The patch file is a header-only stub referencing the same HEAD. No stale diff. The three review output files (claude, pi, diff stubs) are untracked. Confirmed.

## Code evidence gathered

| File | Lines read | Key finding |
|------|-----------|-------------|
| `companion/src/security-confirmation.ts` | 1–445 (full) | `send()` callback is **per-request**, bound to originator WS at construction time (`:193-194`). `respond()` deletes-on-first-call (`:415-428`). `respondFrom()` returns `{outcome:"unknown"}` for late callers (`:343-344`) — no `already_resolved` symbol exists. No broadcast mechanism in the manager. |
| `companion/src/server.ts` | 1320–1380, 4890–4915 | `Promise.race` between `wsPromise` and `trayPromise` (`:1337`); tray winner calls `securityConfirmations.respond(sharedConfirmId, winner.approved)` (`:1361`); WS winner calls `tray!.cancelConfirm(sharedConfirmId)` (`:1354`). The `send` callback inside `request()` **only writes to the originating WS** (`:4893-4895`). There is a `broadcast` function available in scope (`:4898-4907`) but it is **never wired into `SecurityConfirmationManager`** — resolved events never hit broadcast. |
| `companion/src/tray/swift-tray-bridge.ts` | 220–280 | Self-timeout backstop at `req.timeoutMs + 1000` (`:233-237`). `cancelConfirm` resolves the held promise with `approved:false` and sends `cmd: "cancel-confirm"` to Swift (`:254-268`). SHA256 hash gate at `:29, :85, :101`. |
| `companion/src/tray/tray-adapter.ts` | full | `TrayConfirmRequest` shape (`:58-74`); `showConfirmDialog` comment explains the CGEvent foreground-loss motivation (`:96-103`). |
| `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md` | full | D8/D10′/D11′/D12′/D14/D16 at §2.2 lines 42–50. Cockpit IA §5: DualTrack right rail "user + assistant conclusions" — **no N≤8 cap documented** (`:130-131`). D14: "Confirm timeout when unfocused (e.g. 60s auto-deny + toast)" (`:48`) — timer exists server-side in `SecurityConfirmationManager` (`setTimeout` at `:195`); focus/unfocus is an extension-side concern not wired to Companion today. D16: tray-initiated L2 opens Cockpit (`:50`). |
| `docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md` | full | N1–N10 at §5.2. §11 Q4 binary-model OPEN. §7.4 says "Broadcasts `security.confirmation.resolved` to all surfaces." §7.2 says Companion→HUD includes `security.confirmation.request` and `security.confirmation.resolved/expired`. Prior review nits folded in §17. |

---

## N1 — "Native HUD is an optional capability of Companion, not of the Chrome extension"

- **Challenge:** The brief's N1 row says "Binary lives beside tray (macOS); started by menu-bar-agent." §11 Q4 then asks "Single binary vs two: tray + HUD one Swift process with two windows, or separate binaries?" and leaves it OPEN. These are contradictory — you cannot lock a "binary lives beside tray" claim when the binary count is undecided. Worse: the SHA256 gate today is `SWIFT_TRAY_SHA256` — one binary, one hash (`swift-tray-bridge.ts:29`). If N1 locks as two binaries, the gate must be duplicated; if one binary, the gate stays. The security posture forks on this decision. The prior Claude review flagged this as nit 6 (not folded into the brief).

- **Code/doc evidence:** `swift-tray-bridge.ts:29, :85, :101` (single SHA256 gate); `tray-adapter.ts:127-131` (Swift backend detection assumes one binary at one path); brief §11 Q4 OPEN vs §5.2 N1 "beside tray."

- **Lock wording (AMEND):** "P3a ships **one Swift binary** hosting both the menu-bar tray (`NSStatusBar`) and the HUD (`NSWindow`). The existing `SWIFT_TRAY_SHA256` gate is renamed to `SWIFT_COMPANION_UI_SHA256` and gates the single combined binary. `menu-bar-agent.ts` spawns one child process; Companion communicates via the same stdin JSON pipe. This resolves §11 Q4: one binary for P3a; two binaries deferred to P3c if memory profiling forces a split."

- **Operational details:** Detection logic in `detectTrayBackend()` (`tray-adapter.ts:119-131`) is extended to verify the combined binary. Launch order: tray window first (existing), HUD window on first `hud.open` message (lazy). Binary path: same `getSwiftTrayPath()`, renamed constant for clarity.

- **Rejected alternative:** "Two binaries, separate SHA256 gates" — doubles codesign surface, forces a second stdin pipe or a UDS between tray and HUD, and loses the "share process" Pro in §4 Option A.

- **Stance:** AMEND
- **Depends on:** §11 Q4 must be downgraded from OPEN; cross-cutting §5.

---

## N2 — "One active L2 shell at a time (native OR extension cockpit)"

- **Challenge:** The brief says "one active L2 shell" and "allow MinimalConfirm everywhere." But MinimalConfirm lives on the **Panel SafetyStrip** per D10′, not on the "loser" wide surface. If the non-active shell must show something, there are two bad options: (a) it shows MinimalConfirm — creating a third confirm affordance that violates the content-split (D10′ explicitly put heavy preview in Cockpit only); (b) it goes blank — user thinks it's broken. The phrase "active" also lacks a tie to the protocol: Companion must track which surface is the active one, but neither `SecurityConfirmationManager` nor the WS message router has an "active surface" concept today. The §5.3 diagram shows "Shell selector" routing to one branch, but the diagram omits what message the **loser** receives. Without a `shell.standby` message (NEW), the loser keeps rendering old state and becomes stale.

- **Code/doc evidence:** Brief §5.2 N2, §5.3 diagram; D10′ (`three-mode-redesign.md:45`); `security-confirmation.ts` has no surface-tracking state; `server.ts` WS router has no "which surface is active" register.

- **Lock wording (AMEND):** "At most one wide shell per thread renders `ConfirmElevated` + full `TaskDock` + `DualTrack`. Companion tracks the **active wide shell** per thread (the surface that last received a `security.confirmation.request` or `computer.task.event`). When Companion switches the active shell, it sends `shell.standby` to the prior active shell — that surface MUST hide `ConfirmElevated` and `TaskDock`, show a concise status line ('任务进行中 — 在 [HUD|确认台] 查看'), and retain the LIVE chip as a reopen affordance. MinimalConfirm remains **Panel-only** per D10′ — standby surfaces do NOT render confirms. Panel SafetyStrip is always-on regardless of shell state."

- **Operational details:** `shell.standby` is a NEW message type. Companion stores `activeShell: "hud" | "cockpit" | null` per thread (null = no wide shell). On `shell.standby`, the surface's internal state machine transitions to standby mode. Reopen from standby → sends `shell.request_activate` → Companion re-routes.

- **Rejected alternative:** "Both surfaces show full IA, first to respond wins" — visually confusing for user (two confirm dialogs on screen), wastes IPC bandwidth sending duplicate screenshots, and creates a false impression that two people can approve.

- **Stance:** AMEND
- **Depends on:** N5, N6, D10′.

---

## N3 — "Shell selection policy: prefer native if process healthy + last user preference; else extension"

- **Challenge:** "Process healthy" was flagged as prior nit 3 and **not folded** into the brief. Without a concrete probe, the word "auto" in `hud.shell` is unimplementable. Additional challenge: the brief lists `hud.shell` as a P3b deliverable (§10 step 1), but N3 already proposes it as product law. Phase inconsistency — either move the setting to P3a or move N3's `auto` mode to P3b. Also: the cold-start interaction is a UX trap. If opening "确认台" from tray must wait 1.5s for HUD cold boot, the user's first impression is latency. If it doesn't wait and immediately opens Cockpit, the first open never reaches HUD, and the user never learns HUD exists. These are product forks, not implementation details.

- **Code/doc evidence:** Brief §5.2 N3, §10 P3b step 1, §12 open latency target; prior Claude nit 3 (`native-hud-brief-claude-20260727-175147.md` nit 3).

- **Lock wording (AMEND):** "Shell selection runs on every `open_confirm_surface` trigger. Algorithm: (1) evaluate `hud.shell` setting; `extension` → Cockpit immediately, no HUD probe; (2) `native` → attempt HUD; if HUD is not alive, cold-start it (background) and open Cockpit for this trigger — HUD becomes available for the **next** escalate; (3) `auto` (default on macOS) → if HUD process is alive AND last user shell choice was HUD or unset, open HUD; else Cockpit. Health = PID exists (`process.kill(pid, 0)`) AND last heartbeat ≤ 3s old (NEW `hud.heartbeat` message, 1s interval). Setting `hud.shell` ships in P3a (moved from P3b) — hidden in settings, exposed only when native binary exists."

- **Operational details:** `hud.shell` defaults: `auto` on macOS, `extension` on Linux/Windows. Heartbeat timeout 3s (generous — covers brief GC pauses). Cold start is async-background: Companion fires `child_process.spawn`, HUD sends `hud.ready` on hydrate complete, Companion records "HUD available." The "background" aspect is critical: the first tray-click → HUD is cold → Cockpit opens immediately (no user-visible delay), but HUD boots in parallel and is ready for the next escalate.

- **Rejected alternative:** "Wait for cold HUD boot before opening any shell" — D16 wants instant feedback from tray click; 1.5s delay is unacceptable. Also: "auto silently switches on every trigger based on health" — causes yo-yo between HUD and Cockpit across task lifecycles.

- **Stance:** AMEND
- **Depends on:** N1 (binary model), N8, §10 phasing.

---

## N4 — "Close HUD ≠ stop task (same as D11′); managed warning when LIVE"

- **Challenge:** The brief is trivially aligned with D11′ in principle, but the close→fallback handoff is missing. Specifically: user closes HUD mid-LIVE, confirm arrives 2 seconds later. Companion has no wide shell to route `ConfirmElevated` to. Options: (a) re-open Cockpit = violates N8 (silent switch); (b) downgrade confirm to Panel MinimalConfirm = user loses preview/nonce/whitelist; (c) toast and wait = blocks task execution. None are free. The brief also doesn't address the difference between "close window" (macOS red dot, `NSWindow.close()`) and "quit app" (`NSApplication.terminate`) — close should keep the binary alive for tray functions; quit should shutdown fully. This distinction matters for the N8 crash exception.

- **Code/doc evidence:** Brief §5.2 N4; D11′ (`three-mode-redesign.md:46`); Cockpit close-warning exists today in extension code; HUD equivalent would need NEW Swift implementation.

- **Lock wording (LOCK with sub-clause):** "Closing the HUD window via UI (close button, Cmd+W, red dot) does NOT stop the task, pause execution, or change `CapabilityLevel`. The HUD process remains alive (tray persists). If a heavy confirm (`ConfirmElevated` class) arrives while no wide shell is open, Companion: (a) downgrades the confirm to `MinimalConfirm` on Panel with a toast 'HUD 已关闭 — 请在侧栏确认'; (b) if the user reopens a wide shell within the confirmation's timeout window, Companion re-promotes the confirm to `ConfirmElevated` on the reopened shell. The close button displays the standard D11′ LIVE warning dialog. Quitting the HUD process (Cmd+Q, '退出') = shell death — handled by N8 crash exception."

- **Operational details:** Close warning = modal `NSAlert` with "任务将继续运行" and "确定关闭" / "取消". Toast on Panel = non-blocking, auto-dismiss 5s. Confirm downgrade/promote uses the **same `confirmation_id`** — the pendency in `SecurityConfirmationManager` is unchanged; only the rendering surface changes.

- **Rejected alternative:** "Auto-reopen HUD or Cockpit on next confirm" — violates user intent (they explicitly closed it) and N8 (silent switch).

- **Stance:** LOCK (with sub-clauses folded)
- **Depends on:** D11′, N8.

---

## N5 — "Confirm response single-writer; others get `already_resolved`"

- **Challenge:** Three concrete problems with the brief's wording, each traceable to code:

  1. **Over-claiming novelty:** The brief presents N5 as a new decision to prevent a new failure mode. In reality, `respond/respondFrom` already delete-on-first-resolve (`security-confirmation.ts:381-395`, `415-428`). Single-writer is the **existing runtime invariant**. Calling it N5 implies it's new product law; it's actually restating what the code already guarantees.

  2. **Invented symbol `already_resolved`:** The brief says late callers "get `already_resolved`." The code returns `{ outcome: "unknown" }` (`:343-344`). There is no `already_resolved` string in any TypeScript source, WS message payload, or protocol doc. Inventing a new outcome name and writing it into the brief as if it exists is a specification error — the implementer reading the brief will code against a symbol that doesn't match the wire.

  3. **Broadcast as genuinely new, unlabeled:** The brief §7.4 says "Broadcasts `security.confirmation.resolved` to **all** surfaces." This IS genuinely new. Today, the `send` callback stored in `PendingConfirmation` writes only to the originating WS (`server.ts:4893-4895`). Tray is notified via `cancelConfirm` (`swift-tray-bridge.ts:254-268`), not broadcast. HUD would be a third consumer on stdin — it also cannot receive WS broadcasts. The brief does not mark broadcast as NEW, so the spike plan might miss this as an implementation requirement.

  Additionally: the HUD is on stdin pipe, not WebSocket. `SecurityConfirmationManager` has no broadcast callback. Companion would need to wire the existing `broadcast` function (`server.ts:4898-4907`) into the manager AND also forward `security.confirmation.resolved` to the stdin pipe. That's a new architectural requirement. The brief does not acknowledge this gap.

- **Code/doc evidence:** `security-confirmation.ts:343-344` (returns `"unknown"`, not `"already_resolved"`), `:193-194` (`send` captured in closure, originator-only), `:415-428` (`respond` deletes on first call); `server.ts:4893-4895` (`send` only writes to originating WS); `swift-tray-bridge.ts:254-268` (tray notified via `cancelConfirm`, not broadcast).

- **Lock wording (AMEND):** "Companion's `SecurityConfirmationManager` already enforces single-writer via delete-on-first-resolve — N5 **restates** this existing invariant, not imposes it. Late callers receive outcome `unknown` (the brief labels this 'already resolved' for readability; the **wire outcome symbol remains `unknown`** — do not change the protocol). NEW requirement for P3a: Companion must fan-out `security.confirmation.resolved` to every connected surface so non-origin UIs close their dialogs. Today this fan-out does not exist — tray relies on `cancelConfirm` as a side channel. P3a spike MUST add: (a) a `broadcastResolved` callback registration on `SecurityConfirmationManager`; (b) a stdin-forward path for HUD; (c) the tray `cancelConfirm` path remains as belt-and-braces close even after broadcast."

- **Operational details:** `broadcastResolved(cb)` is a NEW registration point. Companion's `server.ts` wires it to the existing `broadcast(...)` function for WS surfaces AND to `hud.send({ type: "security.confirmation.resolved", ... })` for HUD. Broadcast is best-effort fire-and-forget — surfaces that have already closed their dialog via timeout are no-ops.

- **Rejected alternative:** "Rename wire outcome to `already_resolved`" — every client parses `unknown` today; renaming breaks deployed extension, tray bridge tests, and protocol documentation. Cosmetic benefit doesn't justify the churn.

- **Stance:** AMEND
- **Depends on:** cross-cutting §1, §7.4.

---

## N6 — "Input ownership: HUD focused → conductor; Panel = follow-up queue"

- **Challenge:** The word "focused" is the trap. macOS has multiple focus concepts: `NSWindow.isKeyWindow` (keyboard focus), `NSApplication.isActive` (app frontmost), `orderedIndex` (z-order). If user clicks Panel to read chat history while HUD is pinned always-on-top, Panel has keyboard focus but HUD is the conductor. D12′ solved this for the single-wide-surface world with "Cockpit = conductor; Panel = follow-up" — it didn't use "focused" at all. N6 adds "focused" and regresses the clarity. Also: the brief says "HUD focused → HUD is conductor" but doesn't say what happens when neither surface is focused (user is in VS Code). The server must enforce this because client focus state over WebSocket is racy (message in flight while focus changes).

- **Code/doc evidence:** Brief §5.2 N6; D12′ (`three-mode-redesign.md:46`) — uses "Cockpit = conductor" without "focused" qualifier.

- **Lock wording (AMEND):** "The conductor is the **active wide shell per N2**, not whatever surface has OS key focus. Companion enforces input ownership server-side: `chat.send` from Panel during LIVE L2 is always routed to the follow-up queue regardless of Panel/Cockpit/HUD focus order. Only the active wide shell's Composer writes to the task conductor. 'Focused' in the brief means 'the active shell is frontmost and ready for input' — informational for UI, not authoritative for routing. The server's routing decision is: `chat.send` origin = active shell Composer → route to agent conductor; `chat.send` origin = Panel or non-active shell → route to follow-up queue."

- **Operational details:** Companion stores `activeShell` per thread (same field from N2). Server-side gate: `if (origin.surface !== activeShell && taskIsLive) → queue, not conductor`. Client focus events are informational only (for D14 timeout purposes).

- **Rejected alternative:** "Whoever has `isKeyWindow` is conductor" — racy across Space switches; HUD pinned always-on-top may never have key focus if user works in another app with Panel side-by-side.

- **Stance:** AMEND
- **Depends on:** N2 (active shell definition).

---

## N7 — "Tray '打开确认台' opens preferred shell (native first if auto)"

- **Challenge:** D16 currently says tray-initiated L2 opens Cockpit unconditionally. N7 silently amends D16. If an implementer reads the three-mode spec but not the brief, they code the D16 path. The brief's open questions include §11 Q1 ("Should tray quick-confirm remain when native HUD is primary, or always elevate to HUD for high/critical?") — but N7 answers the routing question while Q1 is still OPEN. There's a sequencing problem: you can't lock N7 while Q1 may still change the tray's responsibility set entirely.

- **Code/doc evidence:** Brief §5.2 N7, §11 Q1; D16 (`three-mode-redesign.md:50`).

- **Lock wording (AMEND):** "The tray '打开确认台' menu action invokes the N3 shell selector: prefer native HUD when healthy and `hud.shell ∈ {auto, native}`; else open Cockpit. **This explicitly amends D16** for platforms where native HUD ships. On Linux/Windows or when `hud.shell=extension`, D16's original behavior applies unchanged. §11 Q1 (tray quick-confirm vs elevate) remains OPEN — N7 addresses only the '打开确认台' routing, not confirm delivery."

- **Operational details:** Tray menu item label unchanged. The action payload now carries `preferNative: hud.shell !== "extension"` so `menu-bar-agent.ts` can route without a round-trip.

- **Rejected alternative:** "Add a separate '打开 HUD' tray menu item" — violates N2 (one wide shell) and fragments the user's mental model of "one 确认台."

- **Stance:** AMEND
- **Depends on:** N3, N1, §11 Q1 (must remain OPEN while N7 locks routing).

---

## N8 — "No silent shell switch during active LIVE task"

- **Challenge:** Collides directly with the §12 success metric: "Crash of HUD during LIVE < 1% sessions; task continues." If HUD crashes mid-LIVE and N8 prohibits silent switch, the user has no wide shell until manual reopen — the task may have confirms queued that cannot be rendered. Three concrete failure modes: (a) HUD crashes, confirm arrives, Companion has no surface to route `ConfirmElevated` to, confirm times out → task fails; (b) user's task is blocked on a confirm that can't be displayed because the wide shell is gone; (c) user doesn't notice HUD crashed (it's on another Space) and task stalls silently. N8 without a crash exception is actively harmful to the success metric.

- **Code/doc evidence:** Brief §5.2 N8, §12 metrics; `security-confirmation.ts:195` (45s default timeout — task fails if no surface renders confirm in time).

- **Lock wording (AMEND):** "Companion does not silently switch the active wide shell during LIVE, **except**: (a) the active shell process dies or stops responding to health probes (N3 probe) — Companion opens the fallback shell AND emits a user-visible toast ('HUD 不可用 — 已切换至确认台'); (b) the user explicitly changes `hud.shell` in settings. All other shell switches occur only at escalate boundaries (next confirm, task end, or quiescence). HUD process death detection: `child_process.on('exit')` handler iterates all confirmations routed to HUD and calls `rejectForOrigin('hud')` (NEW method on `SecurityConfirmationManager`), then re-presents any still-pending confirms to the fallback shell."

- **Operational details:** Toast = non-blocking, 5s auto-dismiss. `rejectForOrigin(origin: string)` is a NEW method — scoped variant of `rejectAll` that only clears entries tagged with that origin. `PendingConfirmation` gets a new optional `origin: "ws" | "hud" | "tray"` field. HUD crash → opens Cockpit immediately (same as if `hud.shell` was switched).

- **Rejected alternative:** "Strict no-switch — task stalls until user manually reopens" — contradicts §12 success metric and is a terrible UX when the user is away from keyboard and a confirm arrives.

- **Stance:** AMEND
- **Depends on:** N3 (health probe), N4 (close behavior), cross-cutting §6.

---

## N9 — "macOS first; Linux/Windows document degraded path in same brief"

- **Challenge:** The hidden risk is Cockpit bit-rot. If all engineering time goes to Swift HUD, Cockpit regressions slip through and Linux/Windows users get a degraded L2 experience. The brief's mitigation ("Cockpit must keep working") is a passive statement, not an active gate. Also: the brief's scope says "Not in scope: ... full multi-window product" (§1.3) but the entire P3a plan IS a second window for L2. The scope statement is subtly misleading — it means "no multiple HUD windows per monitor" but could be read as "HUD isn't a new window."

- **Code/doc evidence:** Brief §5.2 N9, §8, §1.3, §13 risks; Cockpit acceptance tests exist in the three-mode spec §8 P1.

- **Lock wording (LOCK):** "P3a native HUD ships macOS-only. Linux and Windows have no native HUD — they continue using Extension Cockpit as the wide L2 surface, documented in §8 of this brief. **Active gate**: every HUD acceptance test (hydrate, confirm, close≠stop, dual-track) has a Cockpit counterpart in the P3a CI acceptance suite that **must continue to pass** on every PR. Cockpit parity tests run on all platforms, including macOS (where Cockpit is the fallback). Failure of a Cockpit parity test blocks HUD merge."

- **Operational details:** CI matrix: macOS + HUD acceptance; macOS + Cockpit parity; Linux + Cockpit parity; Windows + Cockpit parity. Cockpit is never removed from any platform's test matrix.

- **Rejected alternative:** "Trust Cockpit implicitly; no regression gate" — the standard failure mode of platform-specific development.

- **Stance:** LOCK
- **Depends on:** None. This is a process gate, not a technical dependency.

---

## N10 — "HUD does not host L0 chat history as primary; right rail N≤8"

- **Challenge:** Two asymmetries with the Cockpit spec:

  1. Cockpit IA §5 (`three-mode-redesign.md:130-131`) says DualTrack right rail = "user + assistant conclusions" with **no N≤8 cap**. N10 puts a cap on HUD but not Cockpit. If 8 conclusions is correct for HUD space constraints, it's correct for Cockpit's ~720×560 window too. If it's wrong for Cockpit, justify why the same vertical strip with the same information density has different rules.

  2. "Fixed-height, non-scrolling" is the wrong constraint. If a conclusion is long (multi-paragraph `chat.send` from conductor), fixed-height + non-scrolling = truncation with no user affordance. The right constraint is "fixed-height with internal scroll" — prevents chat viewport scope-creep while keeping all content accessible.

- **Code/doc evidence:** Brief §5.2 N10; Cockpit IA §5 (`three-mode-redesign.md:128-131`).

- **Lock wording (AMEND):** "HUD DualTrack right rail shows the **last N≤8 assistant conclusions** (user turns summarized as ≤1 line each). FIFO eviction. The rail is **fixed-height with internal scroll** for overflow — the rail does NOT grow into a full chat viewport. **Same cap applies to Cockpit's DualTrack right rail** — Cockpit IA §5 is amended to add the N≤8 cap for consistency. L0 full chat history with infinite scroll remains Panel-only per §1.3 non-goals."

- **Operational details:** N=8 is configurable as `hud.dualtrack.conclusion_cap` (default 8). Fixed height = 30% of HUD vertical, with `overflow-y: auto` (internal scroll). Cockpit adopts the same cap and layout behavior.

- **Rejected alternative:** "No cap on Cockpit, N≤8 on HUD" — creates a feature skew where Cockpit is the "better" viewing experience for conclusions, undermining HUD as the preferred shell. Also: "infinite scroll on HUD right rail" — turns HUD into a chat app, violating §1.3.

- **Stance:** AMEND
- **Depends on:** D7, Cockpit IA §5 (two-way amendment).

---

## Cross-cutting

### 1. Fan-in single-writer (align N5 with real `SecurityConfirmationManager` behavior)

**Code reality:** `SecurityConfirmationManager` already enforces single-writer at the data-structure level: `respond()` (`:415-428`) and `respondFrom()` (`:336-395`) both call `this.pending.delete(confirmationId)` before resolving. Second call → `this.pending.get(confirmationId)` returns `undefined` → returns `false` / `{outcome:"unknown"}`. This is NOT new law. What IS new:

**(a) Broadcast gap:** The `send(...)` callback captured in `request()` (`:193-194`) only writes to the originating WS. There is no broadcast integration in the manager. For HUD, Companion must fan-out `security.confirmation.resolved` to: (i) all WS clients via the existing `broadcast` function (`server.ts:4898-4907`), (ii) the HUD stdin pipe, (iii) keep calling `tray.cancelConfirm()` as belt-and-braces.

**(b) HUD race arbitration:** Today's race is two-way: `Promise.race([wsPromise, trayPromise])` in `server.ts:1337`. With HUD, it becomes three-way: `Promise.race([wsPromise, trayPromise, hudPromise])`. The same `respond(sharedConfirmId, winner.approved)` pattern applies — first to call wins; others get `cancelConfirm` notifications.

**(c) HUD confirm routing gap:** The brief §7.2 says Companion→HUD includes `security.confirmation.request`. But today `securityConfirmations.request()` sends `security.confirmation.request` via the `send` callback — which is bound to the originating WS. To route to HUD's stdin instead, Companion needs a **new routing decision** at confirm-creation time: "is HUD the active shell? → send via stdin, not WS." This is not a minor wiring change — it requires the `send` callback to be dynamic (or Companion creates two parallel `request()` calls with different `send` callbacks, pre-resolving the race at the HUD/Cockpit level before the WS/tray level).

**Fan-in diagram (reality):**

```
SecurityConfirmationManager.request()
  └─ send(cb) → WS originator ONLY (today)
  └─ Promise.race([wsPromise, trayPromise]) → first responder wins
  └─ no broadcast of resolved → tray gets cancelConfirm, non-origin WS get nothing

NEEDS (P3a):
  └─ routing decision: activeShell=hud? → send via stdin, not WS
  └─ Promise.race([...hudPromise, ...wsPromise, ...trayPromise])
  └─ broadcast of resolved → WS clients + stdin + cancelConfirm(tray)
```

**Recommendation:** Add a `fanOutConfirmResolved` callback registration to `SecurityConfirmationManager` in P3a, distinct from the per-request `send` callback. Label this clearly as NEW in the brief.

### 2. Shell health probe (N3) — define "process healthy"

| Criterion | Mechanism | Threshold | Owner |
|-----------|-----------|-----------|-------|
| PID liveness | `process.kill(pid, 0)` | Fail = unhealthy immediately | Companion |
| Heartbeat | HUD emits `hud.heartbeat` over stdin every 1s | Last heartbeat > 3s = unhealthy | HUD→Companion |
| Responsiveness | On `open_confirm_surface`, Companion sends `hud.ping` | No `hud.pong` within 500ms = unhealthy for THIS trigger | Companion |
| Cold start | `child_process.spawn` | Does NOT block trigger — Cockpit opens immediately; HUD boot is background | Companion |

**Critical design point:** Cold start is **background** — the first tray click after Companion launch opens Cockpit immediately. HUD boots in parallel (target <1.5s per §12 metric) and is ready for the NEXT escalate. This prevents the "first impression latency" UX trap and means users on `auto` will naturally see HUD on their second L2 task, not first.

### 3. D14 focus — which surface owns the 60s auto-deny clock?

D14 (`three-mode-redesign.md:48`) says "Confirm timeout when unfocused (e.g. 60s auto-deny + toast)." The timeout lives **server-side** in `SecurityConfirmationManager` (`setTimeout` at `security-confirmation.ts:195`). It fires after `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` (45s) regardless of UI focus state. "Unfocused" in D14 was an **extension-side concept** — the Cockpit window tracks its own focus and can call `respond(confirmationId, false)` early at 60s if unfocused the whole time.

With N2's active-shell model: only the active wide shell receives `security.confirmation.request`. That shell reports its focus state via a new message (`shell.focus.changed`). If the shell is unfocused for 60s, it MAY auto-deny early. The server-side 45s timeout is the hard backstop. Which surface "owns" the auto-deny: **the active shell** — it's the only surface that received the request. If no shell is active (N4 close scenario), MinimalConfirm on Panel owns it, and Panel's focus rules apply (extension-side logic, already exists today).

### 4. Tray confirm vs HUD — when tray quick-confirm stays

Tray `showConfirmDialog` exists today for the **CGEvent foreground-loss** scenario: when Chrome panel steals focus to show a confirm, CGEvent taps land on the wrong app (`tray-adapter.ts:96-103`). With HUD:

| Scenario | Where confirm shows | Tray quick-confirm? |
|----------|---------------------|---------------------|
| HUD active, macOS | HUD `ConfirmElevated` | **Retired for L2** — HUD is native, no foreground loss |
| Cockpit active (fallback), macOS | Cockpit `ConfirmElevated` | **Retained for L2** — Cockpit is Chrome, foreground loss still possible |
| L1/browser confirms, any platform | Panel `MinimalConfirm` + tray optional | **Retained** — tray parallel channel remains for L1 |
| Linux/Windows | Cockpit `ConfirmElevated` | **Retained** — no native HUD, CGEvent issue remains |

**P3a spike should NOT remove tray `showConfirmDialog`.** It stays as the L1 fallback and non-mac native path. The retirement for L2-on-macOS-native is a P3b polish decision.

### 5. Binary model — one Swift process vs two binaries

**Decision: ONE binary for P3a.** Rationale:

- Reuses `SWIFT_TRAY_SHA256` gate (single hash, single codesign, single notarization).
- Shares stdin JSON pipe — no second transport to secure.
- Tray's existing pairing window infrastructure (`showPairingWindow`) and HUD's window management share process state — cheaper than IPC between tray and HUD.
- `NSStatusBar` + `NSWindow` in one `NSApplication` is the standard macOS pattern.
- Two binaries would mean: two SHA256 gates, two codesigns, two `child_process` instances, two stdin pipes, and a new UDS between tray and HUD for state sharing.

**Risk:** one binary means HUD crash = tray crash. Mitigation: Companion spawns the combined binary; if it dies, Companion auto-restarts it (existing tray restart logic). During the restart window (~1–2s), N8 crash exception routes confirms to Cockpit.

**§11 Q4:** Downgraded from OPEN to "P3a picks one binary; revisit if memory profiling forces split in P3c."

### 6. Crash mid-confirm — who cancels / who re-presents

| Event | Actor | Action |
|-------|-------|--------|
| HUD process dies | Companion `child_process.on('exit')` | Iterates all `PendingConfirmation`s tagged `origin: "hud"` → calls `respond(id, false, reason="disconnect")` → deletes from pending map → emits `security.confirmation.resolved` to WS clients |
| Confirm already resolved, HUD dies | Companion exit handler | No-op — entry already deleted from `pending` map |
| Confirm still pending, HUD restarts | Companion (after restart) | HUD sends `hud.hydrate` → Companion returns snapshot including pending confirm → HUD checks if any confirm was originally its own → re-renders or ignores |
| HUD backstop timeout | HUD-side `setTimeout` (mirroring `swift-tray-bridge.ts:233-237`) | Fires at `timeoutMs + 1000` → auto-resolves UI-side promise → prevents promise leak |

**NEW requirement:** `PendingConfirmation` needs an `origin` tag (`"ws" | "hud" | "tray"`) so the exit handler can scope its rejection to HUD-originated entries only. `rejectForOrigin(origin: string)` is a NEW method on `SecurityConfirmationManager`.

### Grill summary table

| ID | Stance | One-line lock |
|----|--------|---------------|
| N1 | AMEND | One Swift binary (tray + HUD in one process); single SHA256 gate renamed; §11 Q4 resolved |
| N2 | AMEND | At most one wide shell renders ConfirmElevated per thread; loser gets `shell.standby` (NEW); MinimalConfirm stays Panel-only per D10′ |
| N3 | AMEND | Health = PID + 3s heartbeat + 500ms ping; `hud.shell` setting moves to P3a; cold-start is background (no trigger blocking) |
| N4 | LOCK (with sub-clauses) | Close ≠ stop; if no wide shell, confirm downgrades to Panel MinimalConfirm + toast; close warning mandatory |
| N5 | AMEND | Single-writer is existing invariant (restated, not imposed); `already_resolved` stays `unknown` on wire; broadcast is NEW requirement — must be labeled as such |
| N6 | AMEND | Conductor = active shell per N2, server-enforced; Panel `chat.send` always queued during LIVE; "focused" is informational only |
| N7 | AMEND | Tray opens preferred shell via N3 selector; explicitly amends D16; §11 Q1 remains OPEN |
| N8 | AMEND | No silent switch EXCEPT shell death (with toast) or explicit setting change; crash → auto-fallback to Cockpit + confirm re-present |
| N9 | LOCK | macOS first; Cockpit parity CI gate on ALL platforms blocks HUD merge on failure |
| N10 | AMEND | N≤8 FIFO on BOTH HUD and Cockpit right rail (amends Cockpit IA §5); fixed-height with internal scroll, not non-scrolling |

---

### Non-blocking nits (for author to fold before locking N1–N10)

1. **N5 wire symbol:** Replace "get `already_resolved`" with "are no-ops returning the existing outcome `unknown` (brief labels this 'already resolved' for readability — wire symbol does not change)."
2. **N5 broadcast:** Add "NEW REQUIREMENT" banner: "Companion must fan-out `security.confirmation.resolved` to all surfaces. Today this fan-out does not exist."
3. **N1 + §11 Q4:** Pick one binary; downgrade Q4 from OPEN to "P3a = one binary; P3c may split if memory profile forces."
4. **N2 standby:** Define `shell.standby` message type (NEW). Clarify that MinimalConfirm on Panel does NOT appear on the standby wide surface.
5. **N3 cold start:** Add "background" qualifier — first trigger opens Cockpit immediately; HUD boots in parallel for next escalate.
6. **N3 `hud.shell` timing:** Move from P3b to P3a (hidden setting, exposed only when binary exists).
7. **N6 server-enforcement:** Replace "HUD focused" with "active wide shell per N2." Add server-side `chat.send` routing gate.
8. **N7 + §11 Q1:** Add note that N7 routes the "打开确认台" action but §11 Q1 (whether tray shows its own quick-confirm for L2 on HUD-primary) is separate and OPEN.
9. **N8 crash exception:** Add shell-death exception with toast + `rejectForOrigin("hud")` NEW API.
10. **N10 symmetry:** Apply N≤8 cap to Cockpit IA §5 as well, or explain the asymmetry explicitly.
11. **Cross-cutting §6:** Add `PendingConfirmation.origin` tag and `rejectForOrigin(origin)` method (NEW). Document the HUD crash → confirm re-present flow.
12. **Cross-cutting §4:** Tray `showConfirmDialog` retirement: L2-only on macOS-native; stays for L1 and non-mac platforms.
13. **§1.3 scope:** Clarify "no full multi-window product" means "no multiple HUD instances per monitor" — not that HUD isn't a window.
14. **§7.2 confirm routing gap:** The `send` callback must be routable to HUD's stdin when HUD is the active shell. This is a non-trivial implementation requirement — add to §7.2 as a spike task.

### Blocking issues

None. All issues are wording, operational defaults, or protocol-symbol precision — fixable in the brief without product-owner data. The fundamental architecture (one binary, single-writer, N3 shell selector, N8 crash exception, macOS-first with Cockpit parity gate) is sound. The spike (Swift window + mock events + one confirm round-trip) can proceed.

The critical items to address before the spike writes code are: N3 cold-start UX (background-only), N5 broadcast labeling as NEW, and N8 crash exception — these directly affect implementation order and test design.

VERDICT: APPROVE_WITH_NITS
