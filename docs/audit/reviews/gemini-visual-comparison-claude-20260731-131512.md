I have full context. The capability declaration is appropriate for a docs-only design SoT, ADR-020 constraints are respected, and the cross-referenced baseline claims (55% ChatStream, 80px FocusBand cap, ui.bottomBarStrip, 装配 P0 minimum) all check out. Issuing the review.

---

## Summary

Pre-implementation **design SoT** proposing "Gemini breath, CMspark bones" — a visual-only pass that demotes L0 chrome (StatusRail thinner, chips collapsed, editorial empty state, hero composer, floating FocusBand) while preserving ADR-020 capability axes, content-split confirm, 急停, and 装配 IA. Capability declaration in the prompt is correct for a docs-only stage (Surface/Compose/Autonomy/Channel n/a, Trust preserved). Direction is implementable, PR slicing is sane, and Gemini synthesis is hedged honestly. **A few internal inconsistencies and one safety-aesthetic watch-item should be reconciled before PR-G2/G3, but none block the design SoT itself.**

## Gemini synthesis quality

Honest and well-calibrated. §2.2 explicitly labels the table "observed / industry synthesis", not "we read their code". §2.3 inferences ("context is implicit until needed", "calm confirm pauses") are reasonable reads of public Chrome Gemini 3 product materials. §14 sources are public. No over-claiming of undocumented internals (no invented CSS hex, no invented component tree, no invented IA names). The doc does not appropriate Gemini assets (KD1, §12 risk row 3). Material Design 3 attribution is hedged ("general, not a hard dependency", §14). One soft note: several "Gemini-like pattern" traits in §2.2 (large radii, hairline borders, tonal surfaces) are generic 2026 modern product design, not uniquely Gemini — but the doc acknowledges this via "industry synthesis" framing. Acceptable.

## ADR-020 / safety fit

Clean. §10 KD6 explicitly bars reopening ADR-020 / D10′. §5.3 non-goals forbid removing 装配/Packs/MCP/Board and forbid changing confirm semantics. §7 migration table preserves every v2 IA decision (StatusRail kept, FocusBand priority table kept, ContextPanelHost unchanged, bottomBarStrip default false unchanged, 装配 composition-only unchanged). A6 acceptance re-asserts "no「中层 Agent」" copy rule and "Board not under 装配" — both ADR-020 §3.III compliant. Trust monotonicity (ADR-020 §3.II.2) preserved: P-G7 keeps 急停 mandatory on L2; A4 keeps 急停 visible on L2+confirm. No new tools, no new gates, no new confirm dialect, no Pack global-relaxation regression. P1 watchlist (god-mode / originWs / evaluate / shell) untouched.

## Discoverability (L0 chips)

This is the main product risk and the doc knows it (Q1 + §12 row 1). The mitigation is **consistent in intent but inconsistent in wireframe**:

- **Baseline §4.4** (sidepanel-uiux-redesign) mandates L0 chips = `装配 · Skills · Know`, and §4.7 M0 establishes **"装配 entry P0 minimum"** as a hard floor.
- **Q1 default** ("one soft 装配 chip + hide Skills/Know until open") preserves that floor — acceptable D5′ minor delta.
- **But §6.1 L0 wireframe** shows zero composer chips; 装配 appears only inside the empty-state suggestion row. Once chat starts and the empty state dismisses, the wireframe does not show where the 装配 entry lives. This contradicts both v2 baseline §4.4 and the doc's own Q1 default.

Net: the *intent* (always one 装配 entry on L0) is sound; the *artifact* (§6.1 wireframe) needs reconciliation. Not a blocker for a Draft-stage design SoT, but PR-G2 implementers must not ship the §6.1 wireframe literally — they must implement Q1 default.

## PR plan

Realistic and well-sequenced. PR-G1 (tokens + StatusRail thinner + L0 mode-bg removal) is low-risk and comparable in scope to `dec31b8` (8 files). PR-G2 (editorial empty + hero composer + chip disclosure) is the largest interaction delta and should be the Pi-gate checkpoint. PR-G3 (floating FocusBand + tool cards) is the watch-PR because it touches safety chrome aesthetics — must verify L2 急停 and MinimalConfirm notice-rates do not regress. PR-G4 (装配 drawer + menus) is cosmetic. Ship order G1→G2→G3→G4 is correct (foundational tokens before hero changes before safety polish).

## Blocking

None.

## Nits

1. **Internal inconsistency — L0 装配 entry placement** (doc §6.1 wireframe vs §11 Q1 default vs baseline §4.4). §6.1 shows no composer chips; Q1 default mandates one soft 装配 chip; baseline mandates 装配 entry P0 minimum. Reconcile before PR-G2 opens. *Where does 装配 live after the empty state dismisses?*
2. **Soft-danger confirm tint risk** (doc §5.5 FocusBand). "Soft danger tint surface, not solid red bar" is a fine aesthetic choice but visual deemphasis of MinimalConfirm on L2 host_computer / shell / netsec tools could reduce user notice-rate. §12 risks table does not list this; add a row with mitigation = "A/B verify notice-rate in PR-G3 Pi gate; preserve high-contrast 急停 even when confirm card softens".
3. **"Non-Material indigo family" framing is loose** (doc §9 A5). `#4f46e5` is Tailwind indigo-600, which is Material-adjacent. The A5 guardrail is fine as intent ("don't reintroduce #4CAF50 / Material status dots"); just word it as "no Material status-dot hex regression" rather than "non-Material indigo".
4. **§5.4 token deltas are directional, not pinned.** StatusRail min-height 40 / composer radius 18–20 / bubbles 18 are reasonable but should cross-reference baseline §5.2 token table at PR-G1 time to avoid drift.
5. **§2.2 trait table is industry-synthesis, not Gemini-unique.** Worth one line in §14 calling out that large radii / hairline borders / tonal surfaces are general MD3 practice — keeps the synthesis honest against future "we copied Gemini" accusations.
6. **§12 missing risk: "soft confirm → user skips L2 notice".** Same root as nit #2; fold into one row.

VERDICT: APPROVE_WITH_NITS
