**Scope**: Closure addendum #471 — test-only delta (E2E computed-style assertions for selected nav); no production diff in packet.

**NIT-1 (selected CSS unevidenced) → CLOSED.** Three independent proofs in the frozen files:
1. `workspace-styles.ts` carries both selected rules: `.cm-nav-item[aria-current="true"],.cm-nav-thread[aria-current="page"]{background:…navSelected;font-weight:500}` and `.cm-settings-nav button[aria-current="page"]{background:…navSelected;font-weight:600}`.
2. `tokens.ts` defines `navSelected: "#e9e9e6"` → `rgb(233, 233, 230)`; the test literal matches byte-exactly (0xe9=233, 0xe6=230).
3. Executed: script exit 0, PASS log, per-desktop-category assertion of both background and `fontWeight === "600"`. The earlier "no CSS evidenced" was a diff-scope artifact (r1→current omitted an unchanged rule); the rule exists and is now machine-verified.

**Test delta — no new blockers.** The corrected recipe is sound:
- `assert current.count()==1` pins the poll target before measurement.
- `page.mouse.move(0,0)` is necessary, not cosmetic: `.cm-settings-nav button:hover` has equal specificity ((0,2,1)) and later source order than the `[aria-current="page"]` rule, so hover legitimately overlays selected; leaving the pointer isolates the selected state. This confirms "fixture timing," not a production defect.
- `wait_for_function` on the settled color is transition-safe and bounded by the 6s default timeout; no flake vector. Immediate-assert-after-click sampling the pre-settle style is exactly the class of race the filter removes.

**Minor (P2, non-gating)**: the literal `rgb(...)` could be derived from the token to survive palette repins, but a pinned palette test with an exact literal is an acceptable, legible choice. Consistent with the accepted nits list; tracked residuals (status copy, shared h3, redundant aria-label, 36px controls, first-open-license fallback, mixed export checkbox copy) remain open by consent and do not gate.

**Findings**: 0×P0, 0×P1. **Verdict: APPROVE_WITH_NITS — selected-nav finding explicitly CLOSED, not retained.**
