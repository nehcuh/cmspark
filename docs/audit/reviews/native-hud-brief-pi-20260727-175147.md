I now have a complete picture. Here is my review.

---

## Dual External Review — P3 Companion Native HUD Design Brief

**Document**: `docs/decisions/v1.3/companion-native-hud-brief-2026-07-27.md`

---

### 1. Option choice: A vs B vs C

**Option A is correct.** Rejecting B (two-wide-surface confusion; doesn't solve Chrome dependency for confirms) and C (popover density limits — proven by tray's own 800-char summary truncation in `server.ts:1192`) is well-reasoned. The existing `Promise.race` tray-confirm pattern in `server.ts:1348–1380` already proves Companion can multiplex confirm surfaces; extending this to a full L2 shell is the natural progression. The phased approach (P3a native shell, P3b preference, P3c optional Cockpit deprecation) is prudent.

**One structural concern**: The brief says "Reject B as end-state (acceptable only as intermediate spike)" (§4) but never defines what B-as-spike delivers. If B is genuinely considered as a spike, it needs a concrete deliverable definition (e.g., "Swift window with LIVE chip + abort + last screenshot + open-cockpit deep link, used to validate IPC transport choice").

---

### 2. N1–N10 consistency with locked three-mode decisions

All ten proposals are consistent. Specific cross-reference validation:

| Proposal | Upstream | Verdict |
|----------|----------|---------|
| N1 (HUD = Companion capability) | D8 ("Companion native = roadmap") | ✓ |
| N2 (one active L2 shell) | D4, D12′ (single conductor) | ✓ |
| N3 (shell preference) | New, no conflict | ✓ |
| N4 (close ≠ stop) | D11′ verbatim | ✓ |
| N5 (single-writer confirm) | Extends D10′/D14 to 4-surface topology | ✓ |
| N6 (input ownership) | D12′ verbatim | ✓ |
| N7 (tray opens preferred shell) | Extends D16 | ✓ |
| N8 (no silent shell switch) | Consistent with D13 (no silent escalation) | ✓ |
| N9 (macOS first) | Matches `detectTrayBackend()` extant pattern | ✓ |
| N10 (no L0 chat in HUD) | Preserves Panel-as-chat-primary | ✓ |

---

### 3. Single-writer (N5) and one-full-shell (N2) — race analysis

**N5 is architecturally sound.** The existing code already has the two-tier pattern this needs:

- `respondFrom()` (`security-confirmation.ts:335`) — origin-bound, rejects wrong-WS responses with `origin_mismatch`
- `respond()` (`security-confirmation.ts:410`) — privileged bypass for the tray's single-instance local subprocess
- `Promise.race` + `cancelConfirm` in `server.ts:1348–1380` — first responder wins, loser is silenced

The Native HUD would add a third privileged path (alongside tray and WS), reusing the same `respond()` bypass + `cancelConfirm()` silencing pattern. This is proven in production.

**N2 enforcement gap (nit, not blocker):** The brief describes a "shell selector" but doesn't specify what happens when both Extension Cockpit and Native HUD are simultaneously open. If both surfaces render the same `ConfirmElevated` and the user clicks "Allow" on both before Companion processes either, N5's server-side atomicity (`pending.delete` → `pending.resolve`) is the safety net — but the brief should state this explicitly. The existing tray pattern uses `cancelConfirm(id)` to dismiss the tray dialog when WS wins; the same mechanism is needed bidirectionally between Native HUD and Extension Cockpit. Suggested text for §7.4:

> When shell selector activates native HUD, Companion sends `cockpit.close` to the extension and `security.confirmation.resolved` for any confirms already answered on the other surface. The shell selector is authoritative; N5 is the server-side backstop.

---

### 4. Platform degrade honesty

**Honest.** §8 explicitly states "P3a ship criteria do not require Linux/Windows native parity." The degrade path (Extension Cockpit + tray on non-macOS) matches the existing `detectTrayBackend()` in `tray-adapter.ts:62-73` where `swift` is `darwin + arm64` only and everything else falls to `systray2`. The tray adapter's `showConfirmDialog` on non-Swift backends already returns a never-resolving promise. The brief is architecturally consistent with the code.

---

### 5. Scope creep risk

**Guarded but not airtight.** N10 is clear: "HUD does not host L0 chat history as primary." Empty state copy explicitly says "Side Panel 仍负责日常对话." 

**Nit**: §5.2 N10 says "May show compact dialogue tail (same as Cockpit dual-track right rail)." The existing `CockpitApp.tsx:81-83` shows the last **8** user/assistant messages — which is more than a "tail." Once native HUD has a scrolling chat rail, the creep risk is real. Suggested guardrail: cap the native HUD dual-track right rail to a fixed-height non-scrolling recent-messages pane (not a full chat viewport), or display only the last N assistant conclusions without full message text.

---

### 6. Missing threats and open questions

The brief's §11 lists 6 open questions. I flag these additional items:

**a) Biometric integration gap (nit):** The existing `w8-biometric-final.md` and `w8-biometric-scope-brief.md` are in the repo. Native HUD has a natural advantage over extension for Touch ID / Apple Watch confirm — the brief's security section (§9) doesn't mention this opportunity. Not blocking for P3a; worth an open question.

**b) Transport resolution before ship (nit):** §7.1 recommends "B for macOS v1" (stdin/stdout like tray bridge) but the brief itself notes "if message volume (screenshots) blows stdin." Screenshots ARE the primary data type for the CU dual-track. Recommending B for v1 without first benchmarking screenshot throughput on stdin is putting the riskiest choice first. The spike should validate this before committing.

**c) Cross-process deep-link unspecified (nit):** §5.3 says native HUD may show link "在浏览器侧栏打开 Tabs" — this requires the native process to tell the extension to open a specific tab. The mechanism (via Companion WS relay? direct extension message?) is unspecified.

**d) Tray confirm coexistence (already in §11 Q1, but needs sharper framing):** The tray adapter already has `showConfirmDialog` with its own Promise.race. When native HUD is primary, does tray confirm become a third parallel channel (now 4 surfaces: Panel, Tray, Native HUD, Extension Cockpit), or does tray confirm downgrade to "open HUD" only? The brief should decide: tray quick-confirm either remains (with N5 as backstop) or is deprecated when native HUD is active. Leaving this as an open question without a P3a disposition risks implementation drift.

---

### Summary

The design is coherent, well-scoped, and consistent with both the locked three-mode decisions and the existing codebase architecture. The option choice is correct, N1–N10 are sound, and the single-writer pattern has a proven implementation path. The gaps identified above are addressable in the spike phase without rejecting the brief.

VERDICT: APPROVE_WITH_NITS
