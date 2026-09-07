I'll read the packet and follow its review instructions exactly.# Independent design review — CMspark #469

**Reviewer:** Grok 4.6 (adversarial PRODUCT-UX / SAFETY)
**Base:** `8656df94` · **Stage:** design text only
**Scope:** `DESIGN.md` + `docs/superpowers/plans/2026-09-07-ui-workspace-redesign.md`
**Constraint honored:** this packet only; no other files, screenshots, or code.

---

## Verdict: **APPROVE_WITH_NITS**

This is a real product design, not a decorative mock. It names live surfaces, freezes trust policy, keeps confirmation in FocusBand, and requires a real-component harness before any code approval. It may proceed to implementation **only if the MAJOR locks below are treated as design constraints, not backlog taste**.

This verdict is **not** code approval. Production build, full suites, and the browser matrix remain mandatory before an implementation gate.

---

## What holds

**Trajectory.** Shared `tokens.ts` as the only new color owner, no new production dependency, no second thread cache / Agent / confirmation center, nav delegating `thread.select` and existing history — that is incremental and maintainable.

**Safety / T3.** Non-goals correctly exclude runtime and permission-model work. Layout is forbidden from changing trust policy. Dangerous actions must not gain implicit approval. Destructive confirmation copy is preserved. Empty-state suggestions fill input and never send. Terminal stays bound to original peer/task with no autofill execution. Native Swift/Windows and HTML capture are explicitly **not** certified by the browser harness.

**Responsive intent.** 320px as a first-class surface (full-width chat + drawer) matches the actual Side Panel home. Persistent 220px nav only from 760px+ is the right call. Short-height rule (scroll transcript, keep composer/stop) is the right job.

**A11y direction.** Visible focus (including killing `outline: none` on the textarea), 32/36px targets, Escape + focus return, labeled settings close, keyboard ThreadList rows — these are defects, not décor.

---

## MAJOR (lock in design before code, not “later”)

### M1. Primary-surface nav trigger is unnamed

Home is ~320px Side Panel. At that width the Codex-like rail **does not exist**; discoverability lives or dies on the drawer control.

The spec says “explicit drawer” and “text labels explain navigation,” but never names the control, its label, or its place in the header/FocusBand stack.

**Lock:** at &lt;760px a visible **text** control (e.g. 对话) opens the drawer; icon-only hamburger is out. Keyboard and Escape/focus-return already required.

### M2. StatusRail vs WorkspaceNavigation relationship is unspecified

Two chrome systems are both in evidence. If both remain, 320px gets stacked chrome and 1440px gets two “new conversation” paths.

**Lock:** one navigation owner. StatusRail is either absorbed, reduced to non-nav status, or deleted from the conversation chrome. No duplicate new-thread / history / resource entry points.

### M3. ContextPanelHost below 760px is implied, not specified

Today it is a fixed 320px column. At 320–759 the design forbids fixed wide columns, but does not say the host becomes a drawer, named dialog, or stacked sheet.

**Lock:** &lt;760px ContextPanelHost is an overlay (drawer or named dialog), viewport-height capped, not a 320px column beside chat. Sole loader/state owner stays. 760px+ may be a bounded pane, not an unbounded third layout system.

### M4. “Improve confirmation presentation” must be bounded (T3)

DESIGN.md keeps pending confirmation in existing FocusBand and preserves copy/gates. The plan’s “improve … confirmation presentation” is wider than that.

**Lock — visual only:** spacing, type, contrast, focus ring, non-color risk label.
**Forbidden:** move off FocusBand; change button order/role; change whitelist / skip / timeout / auto-approve copy or defaults; style Confirm like charcoal Send; treat disconnect or process exit as success.

Cockpit / Confirm Center is in the evidence list and absent from IA and the harness matrix.

**Lock:** in visual scope (same freeze) or explicitly out of #469. Do not silently restyle it.

### M5. Short-height chrome budget is unquantified

Success requires input and stop reachable, and pending confirmation + stop always visible. Unbounded stack = task title header + FocusBand + drawer trigger + composer.

**Lock:** when confirmation is pending, FocusBand + Stop + input remain on-screen without scrolling chrome. Title may truncate; supporting context may collapse. Do not add a second sticky header that competes with FocusBand.

---

## NIT (do not block implementation)

- **N1.** At 1440px, 220 + max 780 leaves ~440px. Quiet margin is on-brand; say so. Do not stretch prose to the remaining width.
- **N2.** Harness lists 320/390/800/1440; add **759** (drawer) and **760** (persistent rail).
- **N3.** Chrome prefers 对话/知识/场景/设置 but still exposes MCP/apps. Expand or Chinese-label those in chrome; keep technical names inside settings/evidence.
- **N4.** Charcoal Send vs indigo focus is fine; Confirm/Deny must not reuse the Send token.
- **N5.** Delivery record must list verified surfaces (Side Panel, host web shell, Cockpit if in scope) and must not imply native Windows/Swift pixel acceptance.
- **N6.** Capture HTML 360×420 is called out as separate code — keep it in the “not claimed” list, not as accidental conversation-wrapper fallout.
- **N7.** Reconcile `docs/DESIGN.md` before paint: this file owns layout; `docs/DESIGN.md` owns capability/safety. No second layout story.

None of the above is a color/spacing preference.

---

## Outcome assessment

| Bar | Assessment |
|---|---|
| Discoverability | Passes at ≥760px if one labeled rail. **Conditional** at 320px until M1/M2. |
| Readable workspace | 780px measure + unboxed assistant is sound. 320px overflow rule is the right success metric. |
| Confirmation / L2 | Policy is correct; plan language is the leak — M4 closes it. |
| Incremental vs mock | Incremental. Real components, synthetic transport, no store fork. |
| T3 | No permission/default/runtime change in this text. Presentation delta must stay visual. |

---

## Blockers

**None** that reverse trust policy or invent a fake UI.

Do **not** treat this as implementation APPROVE. Next gate needs: production build, full test suites, real-component matrix (including confirmation, keyboard, short height, 320 and 760), and a delivery list of surfaces that were actually verified.

If M1–M4 are ignored in code (hamburger-only home nav, leftover StatusRail, 320px context column, restyled L2/Cockpit), the implementation review should **REJECT**.
