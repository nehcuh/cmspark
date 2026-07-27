I've gathered enough evidence to grill N1–N10 against the brief, three-mode spec, tray adapter, and `SecurityConfirmationManager`. Now writing the grill.

---

# Dual GRILL — Native HUD N1–N10 (Claude Code, independent pass)

## Patch freshness

`git status` confirms the diff stub at `docs/audit/reviews/native-hud-n1n10-grill-diff-20260727-180012.patch` is a header pointing at HEAD `353d86e` with only the untracked review/patch files added. The brief under review is committed (`353d86e docs(p3): Companion native HUD design brief + dual review`). Not stale.

## Code-grounded facts (verified)

- `SecurityConfirmationManager.respond` deletes pending on first call (`companion/src/security-confirmation.ts:415-428`); `respondFrom` does the same and additionally enforces origin binding (`:336-395`). Single-writer is **already** the runtime invariant.
- Late responders land in `respondFrom`'s `{ outcome: "unknown" }` branch (`:343-344`) — there is **no** `already_resolved` symbol in code or protocol today.
- `send(...)` in `request` only reaches the originator's WS callback (`:222-270`); there is **no broadcast** of `security.confirmation.resolved` to non-origin surfaces. Tray today is closed via `cancelConfirm` (`swift-tray-bridge.ts:254-268`) inside a `Promise.race` in `server.ts`, not via a resolved-event fan-out.
- Tray bridge has a self-timeout backstop (`swift-tray-bridge.ts:233-237`) and a SHA256 hash gate (`:29, :85, :101`).
- Tray adapter exposes `TrayConfirmRequest` with `id`, `toolName`, `riskLevel`, `summary`, `criticalApis`, `timeoutMs` (`tray-adapter.ts:58-69`).
- Three-mode D8/D10′/D11′/D12′/D14/D16 citations all match `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md:42-50` and `:128-145`.

---

## N1 — "Native HUD is an optional capability of Companion, not of the Chrome extension"

- **Challenge:** "Binary lives beside tray" and "started by menu-bar-agent" contradict §11 Q4 ("Single binary vs two: tray + HUD one Swift process with two windows, or separate binaries?") which the brief leaves OPEN. You cannot lock N1 while the binary topology it presupposes is OPEN — the spawning model, codesign story, and SHA256 gate all fork on that decision.
- **Code/doc evidence:** brief §5.2 N1, §11 Q4, §13 risk table; `SWIFT_TRAY_SHA256` gate is per-binary today (`swift-tray-bridge.ts:29`).
- **Lock wording (AMEND):** "The native HUD is a Companion-owned process spawned by `menu-bar-agent.ts` alongside the existing tray. P3a ships **one Swift binary** that hosts both the menu-bar tray and the HUD window (single SHA256 gate, single codesign). The binary is launched only when `hud.shell ≠ extension` or when the user opens HUD from the tray."
- **Operational details:** one binary, two `NSWindow`s; same stdin JSON pipe as today; `SWIFT_HUD_SHA256` is **not** a new constant — the existing `SWIFT_TRAY_SHA256` is renamed to `SWIFT_TRAY_BRIDGE_SHA256` and gates the combined binary.
- **Rejected alternative:** "Two separate Swift binaries (tray, HUD)" — doubles codesign/QA surface, forces a second IPC transport, and breaks the "tray + HUD share process" Pro in §4 Option A.
- **Stance:** AMEND
- **Depends on:** §11 Q4 must be downgraded from OPEN to "deferred-to-spike but P3a default = one binary"; cross-cutting §5 below.

## N2 — "One active L2 shell at a time (native OR extension cockpit)"

- **Challenge:** "Active" is undefined. Concretely: if Cockpit was auto-opened by D16 and the user then opens HUD from tray, what is the state of Cockpit? The brief's diagram (§5.3) shows a "Shell selector" routing to one branch, but says nothing about the **loser** of the selection — does it close? Go minimal? Become read-only? "Allow MinimalConfirm everywhere" implies the loser keeps a confirm affordance, which means **two surfaces both rendering confirms for the same confirmation_id** until one resolves — that is exactly the race N5 tries to prevent, just at the UI layer instead of the protocol layer.
- **Code/doc evidence:** brief §5.2 N2, §5.3 diagram, §13 risks; D16 (`three-mode-redesign.md:50`) currently routes tray-initiated L2 to Cockpit unconditionally.
- **Lock wording (AMEND):** "At most one **wide** L2 shell renders `ConfirmElevated` + full `DualTrack` for a given thread at a time. When the user activates a second wide shell (HUD opens while Cockpit is up for the same thread), Companion sends `shell.standby` to the prior shell — it must hide ConfirmElevated and TaskDock, retain only the LIVE chip and MinimalConfirm affordance. MinimalConfirm on Panel and tray remain independent and always-on."
- **Operational details:** "active" = the surface that last received `security.confirmation.request` or `computer.task.event` from Companion. Companion is the single arbiter — surfaces do not peer-negotiate.
- **Rejected alternative:** "Both stay full, user closes one manually" — user confusion + dual conductor input races N6.
- **Stance:** AMEND
- **Depends on:** N6, N5.

## N3 — "Shell selection policy: prefer native if process healthy + last user preference; else extension"

- **Challenge:** "Process healthy" is undefined (prior nit 3, not folded into brief). Without a concrete probe, "auto" is unimplementable. Also: the `hud.shell` setting is listed in §10 P3b, but N3 already proposes it as product law — phase inconsistency.
- **Code/doc evidence:** brief §5.2 N3, §10 P3b step 1; cold-start latency target §12 (<1.5s).
- **Lock wording (AMEND):** "Shell selection runs on every `open_confirm_surface` trigger (tray click, escalate, thread select). Algorithm: (1) if `hud.shell === 'extension'` → Cockpit; (2) else if `hud.shell === 'native'` → HUD, opening Cockpit only if HUD fails health probe within 400ms; (3) else (`auto`) → HUD if process is healthy AND user's last shell choice was HUD or unset, else Cockpit. Health probe = companion-local check that the HUD subprocess is alive (PID + last heartbeat ≤ 2s old) AND responded to the most recent `hud.ping` within 250ms. Cold spawn does **not** block the open trigger — Companion opens Cockpit immediately and asynchronously boots HUD for the next escalation."
- **Operational details:** setting key `hud.shell` enum `{auto, native, extension}`, default `auto` on macOS P3a, `extension` elsewhere. Heartbeat: HUD emits `hud.heartbeat` every 1s over stdin. `hud.shell` setting **ships in P3a** (moved from P3b) because N3 cannot be tested without it.
- **Rejected alternative:** "Wait for cold spawn up to 1.5s before falling back" — visible lag on the tray click that D16 explicitly wants to feel instant.
- **Stance:** AMEND
- **Depends on:** N1 (binary model); cross-cutting §2.

## N4 — "Close HUD ≠ stop task (same as D11′); managed warning when LIVE"

- **Challenge:** Trivially aligned with D11′, but the close→fallback handoff is underspecified. If user has `hud.shell=native` and closes HUD mid-LIVE, do we (a) silently re-route to Cockpit = violates N8, (b) drop to Panel Chip only and wait for manual reopen, or (c) toast "HUD closed — task continues, click tray to reopen wide view"?
- **Code/doc evidence:** brief §5.2 N4; D11′ (`three-mode-redesign.md:46`).
- **Lock wording (LOCK with sub-clause):** "Closing the HUD does NOT stop, pause, or downgrade the running L2 task. If a wide shell is required for an in-flight confirm and no other wide shell is open, Companion shows a Panel toast ('HUD closed — confirm moved to Side Panel') and downgrades the next confirm to MinimalConfirm on Panel until the user reopens a wide shell. The close button displays the standard D11′ LIVE warning before close."
- **Operational details:** warning copy matches Cockpit's D11′ dialog; toast is non-blocking.
- **Rejected alternative:** "Auto-reopen HUD on next escalate" — oscillation, violates user intent (they just closed it).
- **Stance:** LOCK (with the toast sub-clause folded)
- **Depends on:** D11′, N8.

## N5 — "Confirm response single-writer; others get `already_resolved`"

- **Challenge:** Two claims misalign with code:
  1. **"Single-writer" is not new law** — `respond/respondFrom` already delete-on-first-resolve (`security-confirmation.ts:381-395, 415-428`). The brief presents N5 as if it imposes a new constraint; it mostly restates existing runtime behavior. Over-claiming novelty.
  2. **"Already_resolved" outcome does not exist** — late callers today get `{ outcome: "unknown" }` (`:343-344`). The brief invents a symbol that is neither in code nor in the wire protocol.
  3. **"Broadcasts `security.confirmation.resolved` to all surfaces"** is genuinely new — today `send(...)` only reaches the originator WS. Tray gets notified via `cancelConfirm`, not broadcast. HUD will need a real fan-out, and that's a new IPC requirement, not a wording tweak.
- **Code/doc evidence:** brief §5.2 N5, §7.4; `security-confirmation.ts:343-344, 381-395, 415-428, 421`; `swift-tray-bridge.ts:254-268`.
- **Lock wording (AMEND):** "Companion is the single writer of confirmation outcomes: the first call to `SecurityConfirmationManager.respond|respondFrom` for a given `confirmation_id` resolves the entry and deletes it; subsequent calls are no-ops returning the existing outcome `unknown` (the brief calls this 'already resolved' — the **wire symbol stays `unknown`**, the brief relabels it for clarity). NEW requirement imposed by HUD: Companion must **broadcast** `security.confirmation.resolved` to every connected surface (Panel, Cockpit, HUD, tray bridge) so non-origin UIs close their dialog. Today this broadcast does not exist — tray relies on `cancelConfirm` instead. P3a spike MUST add a `broadcastConfirms(cb)` registration point on the manager."
- **Operational details:** broadcast is best-effort, ordered after the originating `send`. Tray's `cancelConfirm` path stays as a belt-and-braces close even after broadcast.
- **Rejected alternative:** "Rename wire outcome to `already_resolved`" — breaks every deployed client's parsing; not worth the cosmetic gain.
- **Stance:** AMEND
- **Depends on:** cross-cutting §1.

## N6 — "Input ownership: HUD focused → conductor; Panel = follow-up queue"

- **Challenge:** "HUD focused" is ambiguous. macOS `NSWindow.isKeyWindow`? `NSApplication.frontmostApplication`? If HUD is visible but Panel has keyboard focus (common sidepanel-on-left workflow), who owns `chat.send`? D12′ solved this for one wide surface; N6 introduces a second wide surface and inherits the same ambiguity.
- **Code/doc evidence:** brief §5.2 N6; D12′ (`three-mode-redesign.md:46`).
- **Lock wording (AMEND):** "The conductor is the **active wide shell per N2**, not whatever surface happens to have key focus. `chat.send` from Panel while an L2 task is running is always queued (follow-up queue), regardless of Panel/HUD/Cockpit focus order. Only the active wide shell's Composer writes to the task conductor. Companion enforces this server-side: `chat.send` messages arriving from a non-active-shell origin during LIVE are routed to the queue, not to the agent."
- **Operational details:** "active" is the shell Companion last routed a `computer.task.event` to (same definition as N2). Server-side enforcement closes the ambiguity — client focus state is informational, not authoritative.
- **Rejected alternative:** "Whoever has key window focus is conductor" — racy across Space switches, mis-detects when HUD is pinned always-on-top but user is typing in Panel.
- **Stance:** AMEND
- **Depends on:** N2.

## N7 — "Tray '打开确认台' opens preferred shell (native first if auto)"

- **Challenge:** D16 currently says tray-initiated L2 opens Cockpit. N7 silently amends D16 — if implementers read the three-mode spec and not the brief, they route to Cockpit. Supersession must be explicit.
- **Code/doc evidence:** brief §5.2 N7; D16 (`three-mode-redesign.md:50`).
- **Lock wording (AMEND):** "The tray '打开确认台' action invokes the N3 shell selector (prefer native HUD when healthy and `hud.shell ∈ {auto, native}`; else Cockpit). **This amends D16** for platforms where the native HUD is shipped; on Linux/Windows or when `hud.shell=extension`, D16's original behavior (open Cockpit) applies unchanged."
- **Operational details:** tray menu item label stays "打开确认台" — no UX divergence.
- **Rejected alternative:** "Add a separate '打开 HUD' tray item" — violates N2 (one wide shell) and adds a third mental model.
- **Stance:** AMEND
- **Depends on:** N3, N1.

## N8 — "No silent shell switch during active LIVE task"

- **Challenge:** Collides with the §12 metric "Crash of HUD during LIVE < 1% sessions; task continues". If HUD dies mid-LIVE, the user is left without a wide shell. Either companion silently falls back to Cockpit (violates N8) or the task stalls until HUD restarts (violates the metric). Need an explicit crash exception.
- **Code/doc evidence:** brief §5.2 N8, §12 metrics, §13 risks.
- **Lock wording (AMEND):** "Companion does not silently switch the **active** wide shell while L2 is LIVE, except in two cases: (a) the active shell process dies or stops responding to health probes — companion opens the fallback shell and emits a user-visible toast ('HUD unavailable — switched to Cockpit'); (b) the user explicitly changes `hud.shell` setting. Shell switches otherwise occur only at escalate boundaries (next confirm) or when the task is quiescent."
- **Operational details:** toast is non-blocking, copy is i18n-keyed. The crash exception is the only path that overrides N8.
- **Rejected alternative:** "Strict no-switch — task stalls if HUD dies" — UX disaster, contradicts §12 success metric.
- **Stance:** AMEND
- **Depends on:** N3, N4, cross-cutting §6.

## N9 — "macOS first; Linux/Windows document degraded path in same brief"

- **Challenge:** Defensible direction, but the hidden failure mode is Cockpit rot: engineering time goes to macOS native, Cockpit (the Linux/Windows surface) bit-rots and breaks parity tests.
- **Code/doc evidence:** brief §5.2 N9, §8 platform table; `CockpitApp.tsx` exists today.
- **Lock wording (LOCK):** "P3a native HUD ships macOS-first. Linux and Windows have no native HUD in P3a — they continue to use Extension Cockpit as the wide L2 surface, documented in §8 of this brief. Cockpit remains the parity baseline: every HUD acceptance test (hydrate, confirm race, close≠stop, dual-track) has a Cockpit counterpart that must continue to pass."
- **Operational details:** parity gate enforced via §12 metrics on Cockpit too (open latency, double-response=0).
- **Rejected alternative:** "Build GTK/Qt HUD in parallel" — dilutes P3a spike focus.
- **Stance:** LOCK
- **Depends on:** none.

## N10 — "HUD does not host L0 chat history as primary; right rail N≤8"

- **Challenge:** Two issues:
  1. "Fixed-height, non-scrolling" is over-constrained — long conclusions get truncated with no escape affordance.
  2. "Match Cockpit slice" is asymmetric: Cockpit's DualTrack right rail (`three-mode-redesign.md:130-131`, `:136-145`) has **no N≤8 cap** documented. If the cap is right for HUD, it should be right for Cockpit; if it's wrong for Cockpit, justify the asymmetry.
- **Code/doc evidence:** brief §5.2 N10; D7 / D12′ (`three-mode-redesign.md:42, 46`); Cockpit IA `§5 DualTrack`.
- **Lock wording (AMEND):** "HUD DualTrack right rail shows the **last N≤8 assistant conclusions** (no user-side truncation: user turns are always summarized as ≤1 line). FIFO eviction. The rail is **fixed-height with internal scroll** for long conclusions, but does not grow into a full chat viewport. The same cap applies to Cockpit's DualTrack right rail — amends Cockpit IA §5 to add the N≤8 cap. L0 full chat history remains Panel-only."
- **Operational details:** N=8 is a knob (`hud.dualtrack.conclusion_cap`, default 8). Fixed height = 30% of HUD vertical, internal scroll enabled.
- **Rejected alternative:** "Infinite scroll on HUD right rail" — scope-creep into chat app, explicitly rejected by §1.3 and §13.
- **Stance:** AMEND
- **Depends on:** D7, D12′.

---

## Cross-cutting answers

### 1. Fan-in single-writer (align N5 with real `SecurityConfirmationManager`)

Today: `respond/respondFrom` enforce delete-on-first-resolve (`security-confirmation.ts:381-395, 415-428`). Tray bridge uses `Promise.race` in `server.ts` between the WS-originated promise and the tray-stdin promise; whichever calls `respond(id, approved)` first wins, the other calls `cancelConfirm` to clean up the Swift side (`swift-tray-bridge.ts:254-268`).

**For HUD (third racer):** companion keeps the same pattern — HUD's stdin pipe yields a `security.confirmation.response` message; companion calls the existing `respond(confirmationId, approved)` (privileged path, `:415`). The first caller wins; HUD and tray both get `cancelConfirm` notifications. **The genuinely new requirement is broadcast** of `security.confirmation.resolved` to non-origin surfaces so they close their dialogs — today's `send(...)` only reaches the originator. N5 must label this NEW (see N5 amendment above).

### 2. Shell health probe (define "process healthy" for N3 auto)

- **Liveness:** companion has the HUD child PID (it spawned it). `process.kill(pid, 0)` returns success → alive.
- **Heartbeat:** HUD emits `hud.heartbeat` over stdin every 1000ms; companion marks unhealthy if last heartbeat > 2000ms old.
- **Ping:** on `open_confirm_surface`, companion sends `hud.ping` with a 250ms deadline. Healthy = pong received within deadline.
- **Cold start:** spawn-on-demand does NOT block the open trigger — see N3 amendment.

### 3. D14 focus ownership (60s auto-deny when multiple UIs open)

Companion routes each `security.confirmation.request` to **exactly one** wide shell per N2 (the active shell). The other shells are in standby (N2 amendment) and never receive the request. Therefore focus/timeout is well-defined: the surface that received the request is the one whose focus state drives the 60s auto-deny. If that surface is unfocused for 60s, auto-deny fires; the timer lives in `SecurityConfirmationManager` (existing `setTimeout` at `:195`), not in any UI.

If both HUD and Cockpit are in standby (Panel is showing MinimalConfirm), the Panel's focus drives the timer.

### 4. Tray confirm vs HUD (when tray may show quick-confirm)

Today tray has `showConfirmDialog` for the no-Chrome-focus click-target scenario (CGEvent tap loses foreground if Chrome panel steals it — see `tray-adapter.ts:96-103` comment). With HUD primary:

- **`hud.shell=native` on macOS P3a**: tray delegates — clicking tray "确认台" opens HUD with ConfirmElevated focused. Tray's own `showConfirmDialog` is **retired for L2** but kept for L1/browser confirms (where Chrome focus loss is still a real issue).
- **`hud.shell=extension` or Linux/Windows**: tray keeps `showConfirmDialog` for the CGEvent-focus scenario, exactly as today.

P3a spike should NOT remove the tray confirm path — it remains the L1 fallback and the Linux/Windows native path.

### 5. Binary model — pick for P3a

**Pick: one Swift binary, two windows** (`NSStatusBar` + `NSWindow`). Rationale:
- Reuses `SWIFT_TRAY_SHA256` gate as a single hash check at launcher start.
- Shares stdin JSON pipe (one transport, one set of message classes).
- Codesign/notarization story does not change.
- Tray's existing pairing window infrastructure (`showPairingWindow`) and HUD's hydrate share a Swift process state — cheaper snapshot passing.

§11 Q4 should be downgraded from OPEN to "P3a picks one binary; revisit if HUD memory footprint forces a split in P3c".

### 6. Crash mid-confirm (who cancels / who re-presents)

- **HUD-side pending promise has its own timeout backstop** mirroring `swift-tray-bridge.ts:233-237` — companion's `Promise.race` between HUD-stdin and WS already protects against hang.
- **HUD process death detection:** companion's child-process `exit` handler fires; companion iterates all HUD-originated pending confirmations and calls `respond(id, false, reason="disconnect")` — same pattern as `rejectAll("disconnect")` in `security-confirmation.ts:437-455` but scoped to HUD-originated entries (NEW: needs a `rejectForOrigin("hud")` or a tag on `PendingConfirmation`).
- **Re-present:** companion re-routes the next escalation through N3's selector. If a confirm was already mid-flight when HUD died and is still within its 45s timeout, companion re-presents it to Cockpit (or Panel MinimalConfirm) with the original `confirmation_id` preserved.

---

### Grill summary table

| ID | Stance | One-line lock |
|----|--------|---------------|
| N1 | AMEND | One Swift binary, two windows; `menu-bar-agent` spawns it; SHA256 gate renamed, not duplicated |
| N2 | AMEND | At most one wide shell renders ConfirmElevated per thread; loser goes standby via `shell.standby` |
| N3 | AMEND | Probe = PID + heartbeat ≤2s + ping 250ms; `hud.shell` setting moves to P3a |
| N4 | LOCK (with toast sub-clause) | Close ≠ stop; if no other wide shell, downgrade next confirm to Panel MinimalConfirm + toast |
| N5 | AMEND | Existing single-writer restated; broadcast of `resolved` is NEW and must be labeled as such; outcome name stays `unknown` |
| N6 | AMEND | Conductor = active wide shell per N2, server-enforced; Panel chat.send always queued during LIVE |
| N7 | AMEND | Tray opens preferred shell via N3 selector; explicitly amends D16 for HUD-shipped platforms |
| N8 | AMEND | No silent switch except shell-process death (with toast) or explicit setting change |
| N9 | LOCK | macOS first; Cockpit parity gate must keep passing on Linux/Windows |
| N10 | AMEND | N≤8 FIFO on both HUD and Cockpit right rail; fixed height with internal scroll; amends Cockpit IA §5 |

---

### Blocking-issue scan

None of the AMENDs blocks the P3a spike (Swift window + mock events + one confirm round-trip). All concern wording, operational defaults, and protocol-symbol accuracy — fixable in the brief without owner data. The most material misalignments are:

- **N5 over-claim:** brief presents single-writer as new law; it's restated existing behavior. The genuinely new requirement (broadcast) must be labeled NEW so the spike knows to add it.
- **N1 vs §11 Q4 contradiction:** N1 presupposes one binary, §11 Q4 leaves it OPEN. Pick.
- **N3 "process healthy" undefined:** was raised as prior nit 3 and not folded in.
- **N8 vs §12 crash metric:** crash exception needed.

These are non-blocking for spike greenlight; they ARE blocking for product LOCK of N1–N10. Per the grill prompt's standard ("APPROVE = N1–N10 are clear enough to lock for spike planning"), this lands APPROVE_WITH_NITS.

### Non-blocking nits (folding list for the author)

1. **N5 wording:** replace "get `already_resolved`" with "are no-ops returning outcome `unknown` (brief calls this 'already resolved')". Mark broadcast as NEW.
2. **N1 + §11 Q4:** pick one binary, downgrade Q4.
3. **N3:** inline the health probe definition; move `hud.shell` from P3b to P3a.
4. **N2:** define "active" = last recipient of `computer.task.event`; add `shell.standby` message.
5. **N6:** server-side enforcement clause; drop "focused" wording.
6. **N7:** add "(amends D16)" suffix to N7 row.
7. **N8:** add crash-death exception with toast.
8. **N10:** apply N≤8 cap to Cockpit too, or justify asymmetry; add internal scroll.
9. **Cross-cutting §6:** add `rejectForOrigin("hud")` or equivalent tag to `PendingConfirmation` (NEW API — label as such).
10. **Cross-cutting §4:** explicit retirement scope for tray `showConfirmDialog` (L2 only on macOS native; L1 + non-mac stays).

VERDICT: APPROVE_WITH_NITS
