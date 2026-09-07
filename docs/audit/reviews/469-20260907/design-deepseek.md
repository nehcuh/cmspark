# Adversarial Review — CMspark #469 UI Workspace Redesign (Design Stage)

**Verdict: APPROVE_WITH_NITS**

**Method:** read-only packet review of `DESIGN.md` + `2026-09-07-ui-workspace-redesign.md` at declared base `8656df94`. No files, components, or runtime consulted; no claims about implemented code. `[inspected]` throughout. This is a design-stage gate; production build and real-component harness remain mandatory before code approval, per the packet's own machine stage.

---

## 1. Safety / T3 (no permission changes, defaults, or runtime)

The design is unusually clean here:
- Explicit non-goals: "runtime redesign, new permission model"; plan step 7: "No live config/app replace."
- Locked invariants are named precisely: FocusBand `confirmation > L2 stop > context`, ThreadList owns search/folders/trash/bulk, ContextPanelHost sole loader/state owner, Settings Modal focus trap, Terminal "no autofill execution", "no duplicated … confirmation center."
- Success criteria encode trust correctly: "dangerous actions never gain an implicit approval"; empty-state suggestions "fill input, never send"; "confirmation remains distinct from normal tool success"; "disconnection does not invent completion"; "never relabel an unverified report as approval … or a permission setting as mere appearance."

No blocker found in the text. However, two design-phase risks require **hard machine-stage gates** (MAJORs), because "improve confirmation presentation" (plan step 4) is the single highest-risk line in this redesign:

**MAJOR-1 — Confirmation invariance (behavioral identity, not just copy).** The generic "shared Modal" (Components section) must not become the rendering path for the Cockpit/confirmation surface, or if it does, the confirmation center's queue semantics (45s timeout, origin binding, whitelist-gating) must remain byte-untouched and the affirmative control must not become the default focus target. Plan step 4 re-presents confirmation UI; any button reorder (e.g., Decline/Approve swapped, Enter defaulting to approve) is a trust-policy change even with identical copy. Machine gate must include a side-by-side DOM/affordance diff of the confirmation component against baseline, plus a check that the FocusBand dominance hierarchy is not flattened by the "one dominant action per area" principle.

**MAJOR-2 — Progressive disclosure vs. informed consent.** "Details expand deliberately without dumping raw JSON first" is good hygiene, but it cuts both ways: if risk-relevant evidence (tool name, target domain, parameters) is collapsed behind an expansion users typically skip, the user approves with *less* information than today. Add an explicit rule (one sentence in DESIGN.md): decision-critical evidence visible at confirmation time must be ≥ baseline; disclosure must never gate content required for confirmation.

**MAJOR-3 — Machine-stage evidence package.** Production build, full suites, real component harness matrix (320/390/800/1440, short-height, long messages, empty state, resources/settings, confirmation, keyboard/escape), actual independent Grok4.6 + DeepSeekV4Pro gates with blocker re-review, and a delivery list enumerating surfaces verified vs. native Swift/Windows shells separately tracked. The plan already commits to all of these; they are conditions of approval, not nice-to-haves. Trust-policy code (trusted_domains, auto_approved_domains, confirmation manager) must show a zero-diff or presentation-only diff.

## 2. Outcome (discoverability, readability, responsiveness)

- **Discoverability:** text-labeled navigation, named settings dialog, 对话/知识/场景/设置 vocabulary, "no unexplained technical acronyms", selected state = text + background (non-color). Solid. Existing-capability discoverability still inherits ContextPanelHost behavior, which is unchanged — honest.
- **Readability:** central max-780px measure, 14–15 body, unboxed assistant prose, quiet surfaces. No overflow at 320, usable at 1440 — both stated as measurable success criteria.
- **Responsive:** drawer at <760, persistent 220px nav ≥760, short-height keeps input/stop reachable, viewport-capped supporting panel, zoom-safe title/URL handling. The "current issues" list (fixed 320px ContextPanelHost stealing short viewport, textarea `outline:none`, keyboard-less ThreadList rows, missing Escape on history portal, unlabeled settings close) reads as genuine audit output and is exactly the right bug list.

## 3. Trajectory (incremental, not a mock)

This is a real trajectory. Evidence: named base/branch, existing component inventory that matches the app's actual surfaces (StatusRail, ComposerDock, Cockpit, terminal, Shared tokens/Modal), plan explicitly reuses existing state owners and forbids "duplicated data loader, thread cache, Agent or confirmation center", no new production dependency, tokens.ts as sole new color owner, and honest scoping that browser harness ≠ native acceptance ≠ live-account claim. The anti-mock properties (real components with synthetic transport, production build, CI merge) are all pre-committed. The one sentence I'd add: WorkspaceNavigation's "recent conversations" is a *projection* over the existing thread store delegating `thread.select` — the invariant implies it; state it.

## 4. Components (focus, menu, confirmation, nav)

- **Focus/names:** visible focus, semantic buttons, Enter/Space, Escape + focus return, no nested interactive elements, ≥32px controls / ≥36px primary — all specified.
- **Menu:** drawer and history portal get keyboard/Escape fixes; settings trigger must be labeled and always visible at narrow width (design implies, state it).
- **Confirmation/nav:** covered by MAJOR-1; nav is sound.

## 5. NITs

1. Pin a numeric contrast floor (4.5:1 text) in the visual-language section; "readable contrast" is unverifiable as written.
2. Conversation header shows task title — specify fallback for untitled threads (first user message / 新对话) so it never mislabels.
3. Empty-state suggestions: if derived from page content, treat as untrusted/sanitized (injection surface); prefer fixed templates. Low severity only because fill-not-send is mandated.
4. Ensure a11y-regression fixes at ship cannot be deferred via the "user refines density later" open question.
5. Record this design-stage review (and Grok's) as a named input gate in the delivery record so the dual-review trail is complete.
6. Add 200% browser-zoom to the harness matrix to substantiate the zoom claim (1.4.10 reflow at 320 CSS px).

Note on scope instruction: no cosmetic preferences raised as findings; density/dark-mode/RTL are acknowledged open or out of scope as written, and that is acceptable.

**Conclusion:** Design is honest, safety-aware, and grounded in real surfaces with a credible incremental plan. No blockers at design stage. APPROVE_WITH_NITS, subject to MAJOR-1/2 as explicit DESIGN.md guardrail additions and MAJOR-3 as machine-stage conditions before code approval.
