I've completed my review of the design brief. Let me record the verdict.

## Review Summary — `docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md`

### Verified against real code

- **Patch freshness**: confirmed via `git status` — three untracked files (the brief, the patch stub, my review file). Patch file (`native-hud-brief-diff-20260727-175147.patch`) is a stub pointing at the untracked set; not stale.
- **Upstream links resolve** (`docs/menu-bar-service/design-final.md`, `companion/src/tray/tray-adapter.ts`, `chrome-extension/src/cockpit/CockpitApp.tsx`, `docs/confirm-center-user-guide.md`, `docs/superpowers/specs/2026-07-26-ui-three-mode-redesign.md`).
- **Three-mode D8/D10′/D11′/D12′/D14/D16** citations match the spec (spec §2.2 lines 42-50).
- **Cockpit IA vertical order** in brief §6.1 (TitleBar → ConfirmElevated → TaskDock → DualTrack → Composer) matches `CockpitApp.tsx:103-269`.
- **Tray adapter `TrayConfirmRequest`** (brief §1.1, §7) matches `companion/src/tray/tray-adapter.ts:58-74` and `swift-tray-bridge.ts:227-252`.
- **N5 single-writer** is *not* new — `SecurityConfirmationManager.respond/respondFrom` already deletes the pending entry on first resolution (`security-confirmation.ts:381-389, 419-423`); race between WS and tray is already arbitrated via `Promise.race` + `cancelConfirm`.
- **D8 supersession** is transparently declared in the brief's frontmatter — acknowledged as a deliberate flip of "Companion native = roadmap".
- **Platform degrade honesty** (§8) is clear: Linux/Windows document-only; Extension Cockpit remains default off-macOS.

### Non-blocking nits (no factual errors found)

1. **N5 wording drift (brief §5.2 line 150, §7.4)** — brief says late responders "get `already_resolved`" and that Companion "Broadcasts `security.confirmation.resolved` to all surfaces". Actual code returns outcome `"unknown"` to the late caller (`security-confirmation.ts:343-344`) and the `send` callback only reaches the originating WS (`server.ts:1272-1277`, `1657-1662`, `4893-4901`). Tray today learns via `cancelConfirm`, not broadcast. Either rename the outcome to `already_resolved` or note that broadcast-to-all-surfaces is a new requirement the HUD imposes.

2. **§6.3 "Dark HUD by default (D6 L2 direction)"** — D6 actually says "full dual-skin dark HUD in **P2**" (spec §2.2 line 40). The brief inherits the L2-dark direction but should call out that native HUD v1 = three-mode P3a, not P2; the milestone boundary is what makes "default" honest.

3. **N3 "process healthy" is undefined** (brief §5.2 line 148) — heartbeat? spawn-on-demand? cold-start latency budget? Should be either a sub-bullet defining the probe or an §11 open question.

4. **D14 dual-focus ambiguity** (brief §3.2 cites D14 timeout, but §6 doesn't address it) — when both HUD and Cockpit could be the "focused" surface for the same task, whose focus state drives the 60s auto-deny? Add to §11 open questions.

5. **Threat model transport gap (§9 line 277)** — "socket credentials + binary hash" assumes a peer-credentialed transport (AF_UNIX `SO_PEERCRED`/`getpeereid`). §7.1 transport option **C** (localhost HTTP/WS on loopback) cannot do peer-cred checking at OS level; only option A (UDS) or B (stdin pipe to a child the parent spawned) preserves it. The spike recommendation (B for macOS v1) is correct, but §9 should make explicit that transport C is only safe behind a capability token + 127.0.0.1 bind, not peer creds.

6. **Single-binary assumption** (§11 Q4 open) is fine as a question, but §9's "binary hash" mitigation presupposes the answer. Either commit to one Swift binary (reusing `SWIFT_TRAY_SHA256` gate from `swift-tray-bridge.ts:28-32`) or describe how two binaries each get hashed/verified at launcher start.

7. **Screenshot sink rule (§9 line 272)** — "Same redaction rules as today" doesn't say whether Companion-side or extension-side redaction applies. HUD is a new screenshot consumer over IPC; the brief should specify that Companion remains the redaction gate (extension rules don't help when pixels never traverse the extension).

8. **`docs/menu-bar-service/design-final.md` upstream** is dated 2026-06-07 (pre-three-mode redesign). Still accurate context, but worth flagging that some assumptions may have shifted; consider noting "may need refresh" in the upstream row.

9. **HUD crash + follow-up queue (§12 metric only)** — "Crash of HUD during LIVE < 1% sessions; task continues" is the right target, but no cleanup story: when HUD dies mid-confirm, who calls `cancelConfirm` for the HUD-side promise? The tray bridge handles this with a self-timeout (`swift-tray-bridge.ts:233-237`); HUD needs an equivalent backstop.

### Blocking issues

None. This is a design brief at the correct altitude for dual review — accurate to current code, transparent about superseding D8, honest about platform degrade and the new IPC attack surface. The nits above should be folded in before N1-N10 lock and a spike is greenlit.

VERDICT: APPROVE_WITH_NITS
