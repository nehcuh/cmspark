## Review: Precision Instrument Phase 2a token purge (R2)

### Summary
Mechanical hex → `tokens.*` purge across 12 secondary-panel files + 2 docs. Patch verified byte-identical to live `origin/main...HEAD` (branch `feat/sidepanel-precision-p2a-token-purge`, HEAD `afbc505`). The r1 REJECT's blocking issue (invisible code-block text — `color: borderStrong` on `darkElevated`) is fixed in `afbc505` (`darkText` on `darkElevated`), along with the flagged hazard-border nits (`criticalTag`, MCP error border, AppsPanel warning/error boxes).

### Verification performed
- **Patch freshness:** `diff` of extracted patch vs `git diff origin/main...HEAD` → identical.
- **Sole-hex-SoT:** only hex in added lines is `#168` (PR ref in docs); zero new color hex.
- **Logic audit:** filtered diff for non-style additions → chrome changes are 100% style-only (colors/borders/alpha). No JSX structure, handler, confirm-flow, or state edits.
- **ADR-020:** capability declaration present and accurate (Surface L0 secondary chrome, no L2/Compose/Autonomy/Trust/Channel change). Axes fit; Pack-first / confirm-dialect / trust-monotonicity / originWs all N/A (no new scenarios, gates, `request(`, or elevation). P1 watchlist: god-mode UI palette touched, `config.set` logic untouched.
- **Build/tests:** `tsc --noEmit` clean; test suite 622/622 pass.
- **Semantics spot-checks:** `#b45309/#8a5a00/#B26B00 → warning`, `#c62828/#b91c1c → danger`, `#eee/#e5e7eb → border`, `#ddd → borderStrong`, `#888/#999 → textMuted`, `#047857 → success`, `#fff → bgElevated` — all in-family, no danger→accent inversions.
- **ThreadGraphApp canvas:** `rgba(79,70,229,0.45)` → `tokens.accent` + `globalAlpha 0.45` and `rgba(148,163,184,0.55)` → `tokens.textMuted` + `0.55` are pixel-identical; `globalAlpha` restored to 1 post-stroke. Legend opacity shift 0.8→0.85 cosmetic only.

### Blocking
None. B1/B2/B3 gates clear: no confirm/急停/FocusBand behavior change, no new L2 tools, no mass wrong mapping.

### Nits (non-blocking, same class the implementer already fixed elsewhere)
1. `SettingsSlideout.tsx:2718` — protocol-unlock (god-mode) section: `background: dangerSoft` == `border: dangerSoft` → outline invisible (was `#F0C0C0` on `#FFF8F8`). Recommend `borderStrong` or `danger` — this is the most security-critical box on the panel.
2. `SettingsSlideout.tsx:2255-2257` — autopilot tier-pick selected state: border `dangerSoft` on bg `dangerSoft` → invisible (was `#E0A0A0`).
3. `SettingsSlideout.tsx:2370` & `2743` — autopilotConfirm / godmodeConfirm boxes: white bg + `dangerSoft` border → near-invisible (was `#E0B4B4`).
4. Minor: `tokens.userBubbleText` reused as white text on accent/danger buttons — value-identical to replaced `#fff` and consistent with Phase 1 mapping, but a neutral on-colored-text token would be cleaner semantically.
5. Optional: `PacksPanel` bold `copyLabel` success text `#059669` on white ≈3:1 contrast at 12px (previously darker `#047857`).

VERDICT: APPROVE_WITH_NITS
