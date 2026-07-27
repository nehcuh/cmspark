I have enough evidence. Current state: `App.tsx` is 1457 LOC monolith; `ComputerTaskBar.tsx` is already 454 LOC of working L2 chrome (急停/budget/timeline/screenshots/evidence dir) living inside the panel; `BottomBar` always-on 6-pack confirmed; `SecurityConfirmationDialog` does heavy `host_computer` preview/full_preview/nonce in-panel; **no `chrome.windows`/cockpit code exists** — greenfield. Now writing the review.

---

# Review: UI Three-Mode Redesign

## Verdict
APPROVE_WITH_CHANGES

## Summary
The L0/L1/L2 ontology is the right model — it matches real seams already in the codebase (the `host_computer` tool family has its own executor, preview pipeline, 4-tier confirmation, and ~454 LOC of dedicated chrome that has no business being in a 320px conversation column). I therefore endorse D1, D2, D5, D7, and the spirit of D6. I do **not** endorse the strict-split as written (D10), the "full confirm only on cockpit" rule (D6-confirm elevation / Q6), the auto-promote-by-step-count L1 path (D9), or symmetric parallel input on both surfaces (D12) — these four create real safety, focus, and dual-input hazards that the brief hand-waves. The brief is also thin on the riskiest implementation unknown: dual-renderer shared state across an MV3 service-worker-bound extension page. The plan is shippable, but only if the panel retains a *minimal but real* confirm/abort surface during L2, auto-promotion is opt-in, and ModeController + dual-surface state sync are proven before IA work begins. Phase it: P0 = internal-only mode derivation + BottomBar mode-split (no new surface); P1 = cockpit as L2-required only; P2 = polish and L1-promote-on-user-action. The ontology is correct; the surface-split strictness is what needs rework.

## Answers to §5

### Q1 — Is the L0/L1/L2 ontology correct?
**Endorse L0/L1/L2 as proposed; reject a 4th mode.** The split is not aesthetic — it maps to already-existing code seams:
- `companion/src/computer/executor.ts`, `uia.ts`, `model-admission.ts`, `rate-limit.ts` are an entirely separate pipeline from CDP/browser tools.
- `SecurityConfirmationDialog` in `App.tsx:200-202` already branches on `isComputerTask = request.tool_name === "host_computer"` and renders a completely different dialog (annotated screenshot + full_preview + session-trust). L2 is already a separate dialect in the confirm layer.
- The 454-line `ComputerTaskBar.tsx` (急停/budget/step-timeline/locate-attempts/evidence-dir) is L2 chrome with **no analogue** in L1 — collapsing would force one widget to be two things.

So **do not collapse browser+computer**. As for a 4th mode: MCP and multi-agent are context surfaces, not task drivers, today. Promote them only when an MCP server actually drives a long-horizon task — modeling the mode before the behavior exists is design theater. One sub-fissure worth noting: inside L2, `host_app` (no-arg launch) and `host_computer` (coordinate injection) are already treated differently by the dialog (`isAppLaunch` branch). Treat as L2 sub-modes, not L3.

### Q2 — Progressive escalation on one thread sound?
**Sound, but only with hysteresis on de-escalation.** Threads are conversation-scoped, not capability-scoped, and users speak in escalating bursts ("summarize this" → "now fill the form" → "actually open the desktop app and…"). Forcing new threads per capability would be worse than the disease.

The risk the brief under-specs is **mode yo-yo**: an LLM that emits a chatty L0 sentence between two L1 tool calls would visibly thrash the UI. Rules needed:
- **Up-level**: auto, on first qualifying tool call. Fine.
- **Down-level**: **not auto per-message.** Only on (a) explicit user pin release + task-end signal, or (b) a quiescence timer (e.g. 30s of L0-only turns after the last L1/L2 tool).
- **Pin semantics**: pinning a level blocks auto-down only; auto-up still fires when a confirm UI genuinely requires the higher surface (already in D2/D3 — keep it).

### Q3 — L1 promote-to-cockpit (D9): right default?
**Wrong as auto-promote; right as user-initiated.** The brief leaves the threshold "N steps OR dense screenshots OR confirm queued" unspecified — and any concrete N will be wrong because step density depends on task shape, not capability. Auto-promotion by step count creates "where did my agent go?" confusion: the side panel is the user's anchored mental surface, and yanking content into a floating window mid-task is a regression even if the panel is "too small."

Concrete reasons to reject auto-promote:
- Chrome extension windows via `chrome.windows.create` are easily lost behind the very page being automated (the memory note on `NSRunningApplication.activate` and Chrome popups blocking target apps applies here).
- macOS/Windows window management for pop-outs has no "always-on-top" without flags the user must set.
- The user already opted into the side panel precisely because it doesn't steal focus.

**Force-change**: L1-promote fires only on explicit "expand workspace" action. Keep L1 panel-only as the default. Reserve cockpit auto-open for L2 (required).

### Q4 — Strict split (D10): does TaskChip-only panel during L2 create dangerous blind spots?
**Yes — three real ones.** This is the most adversarial part of the brief and I'm not signing off as written.

1. **Missed abort (regression)**. Today `ComputerTaskBar.tsx:189-201` shows a primary ⏹ 急停 button inline with status; the existing flow even has an `abortUnconfirmed` 3s fallback to a hotkey (`Ctrl+Alt+End`). D10 reduces the panel to "TaskChip + optional secondary abort." **"Optional" is wrong** — primary abort must always be reachable from the panel in one click, because the whole point of abort is that the user saw something go wrong *on the screen being operated on* and the cockpit window may not be focused. Keep ComputerTaskBar's abort behavior; just visually demote the rest.

2. **Missed confirm (silent stall)**. D11 says closing cockpit hides surface but doesn't stop task. Combined with D10's "full confirm only on large-enough surface," this lets a confirm queue stall invisibly if the user dismissed the cockpit. The panel must always render a *minimal* confirm (tool name + risk color + allow/deny + "open details") for any confirmation that fires during L2 — never zero UI. This is non-negotiable from a safety standpoint.

3. **Dual-input races (D12)**. "Both surfaces may send follow-up instructions" on the same thread is a race waiting to happen. If panel and cockpit both have live input and the user is mid-edit in both, `chat.send` ordering becomes nondeterministic. Rule: during L2, **panel input becomes "queue follow-up"** (visually distinct, sends only on cockpit-close or explicit "send now"), not parallel send. Cockpit is the primary conductor during L2.

### Q5 — Dual skin (D6): helpful or jarring?
**Helpful as signal; ship with three guards.** Dark HUD for L2 reinforces "watch the screen, your typing matters less" — that's a real cognitive aid and worth the cost. But:
- Build a single token system with semantic roles (e.g. `surface.background`, `text.primary`) that resolves per-skin — **not** two parallel token tables. Otherwise `docs/DESIGN.md` (already thin) bifurcates further.
- Transition between skins must be instant or ≤200ms, no shimmer — photosensitive users will otherwise get flicker on every escalation.
- Allow user to pin L0/L1 to dark. Some users live in dark-only; respect that without forcing them to L2 chrome.

### Q6 — Confirm elevation: is "full confirm only on cockpit" acceptable?
**No, not as stated.** Chrome window focus is the unreliable substrate underneath this rule:
- macOS: `chrome.windows.create` focuses the new window once; if the user cmd-tabs away, the panel cannot programmatically re-focus without a user gesture. A queued confirm can sit there silently.
- The current `SecurityConfirmationDialog` for `host_computer` is genuinely heavy (annotated preview + caption + full_preview of 30 actions + nonce input + session-trust). Putting all of that on a 320px panel is also wrong. So the rule should be **content-split**, not surface-split:
  - **Panel (always)**: tool name, risk color, target app, [allow] [deny] [stop], "open details ↓". Render-cap: ≤4 lines.
  - **Cockpit (when present)**: full preview image, full_preview enumeration, nonce input, whitelist/session-trust controls.
- This way: focus problems don't strand confirms; heavy preview content still gets the room it needs.
- Also: a persistent (not toast) confirm indicator must live on **both** surfaces when L2 is active, so a minimized cockpit doesn't hide a pending confirm.

### Q7 — What to reject or force-change before implementation?
Ordered by severity:

1. **REJECT full-confirm-only-on-cockpit (Q6).** Replace with content-split confirm described above.
2. **REJECT TaskChip "optional secondary abort" (D10).** Primary abort stays one-click on panel during L2.
3. **REJECT symmetric parallel input on both surfaces (D12).** Panel input during L2 = follow-up queue; cockpit is conductor.
4. **REJECT auto-promote L1 panel → cockpit by step count (D9).** User-initiated only.
5. **FORCE-CHANGE**: define L2 "task end" explicitly (tool-call-complete vs user-ack vs quiescence timer) before writing ModeController rules.
6. **FORCE-CHANGE**: prove dual-renderer shared state on MV3 before committing to IA. The brief says "shared agent store, two renderers, one state" — but `App.tsx` is currently a 1.4k-LOC monolith bundling Header/Chat/ComputerTaskBar/BottomBar/Input/SecurityDialog/modals inline. Splitting *that* into two shells is the real implementation risk, not the `chrome.windows.create` call. Run a 1-week spike.
7. **FORCE-CHANGE**: tray-initiated L2 entry must specify surface initialization. `companion/src/server.ts` already builds a `traySummary` for `host_computer`; if user fires L2 from tray and the panel isn't open, what opens? Cockpit? Both? The brief is silent.

### Q8 — Phasing: smallest shippable slice?

**P0 — Internal-only mode derivation (validates ontology, no new surface, ~1–2 wk)**
- Introduce `ModeController` that derives `(CapabilityLevel, SurfaceLayout)` from existing state (tool activity, confirm queue, host_computer task state).
- Replace any binary "chat vs work" internal with the L0/L1/L2 enum.
- BottomBar mode-split per D5 (L0/L1: Skills/Know/Hist; execution: Tabs/Apps/MCP).
- Mode badge in header.
- **No cockpit yet, no skin change, no confirm move.** Validates: ontology fits existing flows without regression; gives product real data on mode distribution.

**P1 — Cockpit MVP (L2-required only, ~2–3 wk)**
- Build cockpit as extension page via `chrome.windows.create`.
- When `host_computer` task starts, auto-open cockpit with dark HUD.
- **Move** existing `ComputerTaskBar` (timeline/screenshots/preview/details) into cockpit — this is mostly a relocation, not new UI.
- Panel during L2: TaskChip + **primary abort** + **minimal confirm** (per Q6 content-split).
- Validates: dual-renderer state sync works at MV3 scale; cockpit focus behavior on real tasks; user tolerance for the pop-out.

**P2 — Polish + L1 promote + dual-skin tokens (~2 wk)**
- Semantic token unification; dual-skin resolve; transition polish.
- L1-promote on explicit "expand workspace" only.
- Hysteresis on de-escalation; user pin semantics finalized.
- Tray-initiated L2 surface initialization.

**P3+ — Deferred**
- Companion native HUD window.
- SVG icon system / full token refresh of `docs/DESIGN.md`.
- L1-promoted and L2 sharing one shell with theme swap (decide post-P1 data).
- MCP-as-mode or multi-agent (only when usage data justifies).

## Must-fix before implementation
1. Panel during L2 must retain one-click **primary abort** and a **minimal confirm** (tool/risk/allow/deny/details) — never TaskChip-only. (D10, Q4, Q6)
2. "Full confirm only on cockpit" replaced with **content-split confirm**: panel always renders a 4-line version, cockpit renders the heavy preview/nonce/whitelist chrome. (Q6)
3. During L2, panel input becomes a **follow-up queue**, not parallel send. (D12, Q4)
4. L1 → cockpit promotion is **user-initiated only**, never auto by step count. (D9, Q3)
5. **Hysteresis on de-escalation**: down-level only on quiescence timer or explicit pin release, never per-message. (D2, Q2)
6. Run a **dual-renderer shared-state spike** on MV3 (service-worker lifecycle, cross-window React state, race conditions) **before** IA work — budget ~1 week. (Q7)
7. **Define "task end"** for L2 → L1 transition: tool-call-complete vs user-ack vs quiescence. Pick one and document it. (Q7)
8. **Tray-initiated L2 surface initialization** specified: what opens when user fires `host_computer` from tray and panel is closed? (Q7)

## Nice-to-have / later
- Per-skin semantic tokens unify `docs/DESIGN.md` so it doesn't bifurcate into light.md + dark.md.
- User-pinnable skin preference (some users want dark L0 too).
- L2 sub-mode distinction between `host_app` (no-arg launch) and `host_computer` (coordinate injection) — the confirm dialog already does this internally.
- Cockpit "always-on-top" affordance if Chrome ever exposes it (currently flag-dependent on macOS).
- Persist user's last-surface choice per thread so re-opening remembers panel vs cockpit preference.
- A11y: mode badge announced via `aria-live` so screen-reader users get escalation events.

## Risks & failure modes
- **Multi-window focus**: Chrome extension windows are easily lost behind the page being automated; macOS requires `NSRunningApplication.activate` semantics, Chrome popups block target apps (per the TCC/activate memory). Mitigation: never rely on cockpit being focused; always have a panel-side affordance for safety-critical actions.
- **Mode thrash**: LLMs that interleave chit-chat with tool calls will yo-yo modes. Mitigation: hysteresis on de-escalation; visual transition budget capped.
- **Confirm missed**: the combination of D10 + D11 + "full confirm only on cockpit" can produce silent stalls. Mitigation: minimal panel confirm; persistent indicator on both surfaces.
- **Dual-input races**: two live `chat.send` paths into the same thread. Mitigation: follow-up queue semantics on the non-conductor surface.
- **Service-worker eviction mid-task**: MV3 SW can die during long L2 tasks; cockpit and panel must both be SW-resilient (already an issue in `App.tsx` NotebookLM path which uses a 30s race). Mitigation: state in companion, not in SW; surfaces rehydrate from companion on reconnect.
- **`App.tsx` monolith split risk**: 1457 LOC bundled into one shell is the real implementation cost; pretending it's just a `chrome.windows.create` call will blow estimates.
- **Skin-flip photosensitivity**: instant or ≤200ms transitions, no animation that could trigger photosensitive users.
- **Tray L2 entry**: surface initialization is unspecified; users opening L2 from tray with no panel could land in a confusing state.
- **Cockpit window closed mid-task (D11)**: hides surface but doesn't stop task — fine, but the panel must surface a re-open affordance immediately, not wait for the next event.
- **Confirmation queue stacking**: existing code already shows `还有 N 个确认请求在等待` (`App.tsx:450-453`); on a small cockpit this could stack badly. Need queue management UI in cockpit from day one.

## Suggested phasing
(Same as Q8, condensed.)

- **P0 (validates ontology, ~1–2 wk)**: `ModeController` + L0/L1/L2 enum internally; BottomBar mode-split per D5; mode badge in header. No new surface. No skin change. No confirm move.
- **P1 (cockpit MVP, L2-required, ~2–3 wk)**: cockpit extension page; auto-open on `host_computer` task; relocate existing `ComputerTaskBar` chrome to cockpit with dark HUD; panel keeps TaskChip + primary abort + minimal confirm.
- **P2 (polish, ~2 wk)**: semantic token unification + dual-skin resolve; L1-promote on user action only; de-escalation hysteresis; tray-initiated L2 surface init; queue management UI.
- **P3+ (deferred)**: Companion native HUD; SVG icon system; full token refresh; MCP-as-mode; multi-window orchestration; L1/L2 shared shell with theme swap.

The smallest shippable slice that validates the model without a full rewrite is **P0** — and crucially it requires no cockpit, no skin work, and no architectural commitment. Ship that, instrument mode distribution, and *then* decide whether cockpit earns its cost.

VERDICT: APPROVE_WITH_CHANGES
