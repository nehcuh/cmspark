All materials read and cross-referenced against the codebase. Here is the final review:

---

## Summary

Two new staged files: a dual-review prompt and a 359-line visual-comparison design doc proposing a "Gemini breath, CMspark bones" visual direction on top of the already-shipped UIUX v2 Quiet Agent Shell + Quiet Premium indigo pass. No code changes. The spec correctly self-identifies as "Visual / IA presentation only — no capability model change" and provides a valid ADR-020 capability declaration. It preserves all safety chrome (FocusBand state machine, 急停, content-split confirm) while proposing visual-only deltas: token tuning, chip collapse, floating FocusBand presentation, editorial empty states, and menuing polish.

---

## Gemini synthesis quality

The spec's sources are publicly verifiable: the Chrome Gemini 3 blog, "Use Gemini in Chrome" support pages, MacRumors/TechRadar coverage, and Material Design 3 surface language. The traits table (§2.2) uses the framing "observed / industry synthesis" and describes publicly observable visual grammar (chrome density, tonal surfaces, corner radii, accent-as-spark pattern). The spec does **not** claim access to undocumented internals, internal telemetry, or proprietary design specs. The synthesis is honest about what is observed vs. what is inferred. The interaction grammar (§2.3) stays at the level of what's observable in the shipped product.

---

## ADR-020 / safety fit

**Capability declaration**: Present and accurate. Surface `n/a` (visual only), Compose `none new`, Autonomy `n/a`, Trust `existing content-split / 急停 preserved`. The diff is pure docs — no missing-declaration issue.

**Axes checks**:
- No new Surface level, Composition primitive, or Autonomy tier.
- No "中层 Agent" anywhere in spec text (verified via `rg`; only A6's "don't do this" criterion mentions it).
- Board stays out of 装配 (inherited from baseline IA v2 §4.5).
- No new primary Side Panel entry — existing 装配 path is preserved (Q1 keeps one soft 装配 chip on L0).
- No new confirm dialect — FocusBand presentation changes from full-bleed bar to floating card, but the state machine and priority table are explicitly kept (§7: "Keep priority table, change presentation").
- Trust monotonicity: L2 急停 stays visible when L2 task active (hard rule 1 from baseline §4.3, re-asserted in P-G7, A4); confirm semantics (Allow/Deny/timeout) explicitly unchanged (§5.3 non-goals).
- `originWs`: Not applicable (no code changes, no new confirmations).
- No new runtime.

**KD1–KD6 review**: All six key decisions are safe against ADR-020. KD6 ("No ADR-020 / D10′ reopening") is the gate. KD1–KD5 are visual/product choices that don't touch the axes.

---

## Discoverability (L0 chips)

KD4 collapses L0 chips behind `＋` disclosure, with the default compromise (Q1) keeping **one soft 装配 chip** always visible plus 装配 and `/packs` in empty-state suggestions. The risk table (§12) acknowledges the over-minimal risk. The mitigation is sound: users get two non-slash paths to 装配 (the persistent soft chip + the empty-state suggestion). Acceptance criterion A1 (`≤2 permanent chrome rows; no chip row until ＋ or L1+`) is consistent with a single soft chip (one chip ≠ a row). This is a reasonable discoverability trade-off for the "Gemini breath" visual target.

---

## PR plan

PR-G1 through G4 are well-scoped and correctly ordered by dependency:

- **G1** (surfaces & type): Token deltas only — low risk, no logic changes. Foundation for everything else.
- **G2** (empty + composer): Editorial empty state, chip collapse, composer hero. Depends on G1 tokens.
- **G3** (FocusBand floating + tool cards): Changes FocusBand *presentation* to floating card but keeps the state machine. Depends on G1 tokens.
- **G4** (装配/menus polish): Final visual polish pass. Depends on G1–G3 context.

Each PR is a visual pass, not a logic rewrite. Ship order (G1→G2→G3→G4) is correct. The spec notes Pi-gating if continuing AgentTeam, which is appropriate. No sizing red flags.

---

## Blocking

None.

---

## Nits

1. **§2.2 corner radii claim** (`line ~49`): States "~16–24px product language" as definitive when the framing elsewhere is "observed / industry synthesis." Recommend: `"observed ~16–24px product language"` for consistency with the §2.2 header.

2. **§5.4 canvas target** (`line ~161`): Describes `#f5f6fa` tonal target as "Google white space" — edges into brand-association language the spec otherwise carefully avoids. Recommend: `"airier tonal white space"` or similar.

3. **§5.5 FocusBand confirm tint** (`line ~195`): "Soft danger tint surface, not solid red bar" — the exact tint token is unspecified. Fine for the design SoT stage, but implementers will need a concrete value (e.g., `rgba(220,38,38,0.08)` or a `surface.dangerSoft` token). Consider noting this as an implementation-level open item.

4. **§11 Q1 / §9 A1 tension** (`lines ~293, ~286`): Q1 default is "one soft 装配 chip" while A1 says "no chip row until `＋` or L1+." A single chip is not a "row," so this is consistent in practice, but making the distinction explicit (e.g., "≤1 soft chip on L0 ≠ a chip row") would reduce implementer confusion.

---

VERDICT: APPROVE_WITH_NITS
