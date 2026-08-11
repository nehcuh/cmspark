All checks complete. Baseline test suite: 615 pass / 0 fail (B6 infrastructure green). Parent SoT confirms W4 was "optional / Day-2 only if budget fails" and the lag note named BoardPanel/AppsPanel/SettingsIntentBar — the remaining batch's promotion of W4 to a *required measurement* with code-only-if-fail directly resolves parent nit 3 ("W4 can silently die").

---

## 1. Summary

Plan gate for the remaining batch (W4 density measure + W5 residual hex → tokens). Patch (`6d95973` base) is fresh and matches `git status` exactly; the working-tree diff is the **parent W1–W3 implementation** (empty-state `textMuted→textSecondary` contrast migration, StatusRail honest note, DESIGN.md hex-SoT rewrite, SettingsIntentBar dead-fallback removal) — not this batch's work. The remaining SoT's every machine-checkable claim verified true: 3 residual hex hits exactly as named, all stack constants real, density targets match UIUX v2. No rejection gate (R1–R4) triggers. W5 is monotonic (3 named residues only). B1–B6 all implementable.

## 2. Factual spot-check

- **Residual hex as claimed:** `rg '#2563eb|#dbeafe'` → exactly 3 hits: `BoardPanel.tsx:23` (trust `tool_verified` bg), `AppsPanel.tsx:1146` (`pickedClearBtn` color), `utils/computer-utils.ts:186` (UIA badge bg). `SettingsIntentBar` is now clean (diff removed the `tokens.accent || "#2563eb"` fallback at old :176) — matches "already cleaned in W1–W3".
- **W4 constants:** StatusRail `minHeight:44` (:449); `FOCUS_BAND_MAX_PX=80` + container `maxHeight: FOCUS_BAND_MAX_PX` (`focus-band-priority.ts:5`, `FocusBand.tsx:227`; primary 56 + secondary 24); SceneStatusBar/RunBusyChip/WorkerScopeBar all `maxHeight:28`; InputArea `minHeight:44 / maxHeight:120` (App.tsx:1726-27); ComposerChips ≈30px (fits "≤40" assumption).
- **Density targets:** UIUX v2 `:53/:384-385/:510-511` — ≥55% L0 idle / ≥40% worst-case @640px, FocusBand ≤80px — exact match.
- **W5 feasibility:** BoardPanel/AppsPanel already import `tokens`; computer-utils needs one import add. `tokens.accent=#4f46e5`, `modeBrowserBg=accentSoft=#eef2ff` (tokens.ts:23-24,40).
- **Tests:** `npm --prefix chrome-extension test` → 615 pass, 0 fail (baseline green).
- **ADR-020:** declaration present in both SoT and batch prompt (Surface L0 Panel chrome only; L2 none; Compose none; Autonomy none; Trust no elevation; Channel unchanged). No tools/gates/confirm changes → originWs N/A; no "中层 Agent" language; Pack-first not implicated. No violation.

## 3. Blocking

None. R1 pass (no false code claims), R2 pass (W4 explicitly forbids FocusBand rewrite / Settings restructure / bottomBarStrip / Board-into-Host), R3 pass (3 named residues only, "Not in W5" list excludes gray ladder + Packs orange), R4 pass (no Trust/L2 changes).

## 4. Nits (non-blocking)

1. **W5 mapping is a visible hue shift, not identity** — `tokens.accent` (#4f46e5) ≠ #2563eb and `modeBrowserBg`/`accentSoft` (#eef2ff) ≠ #dbeafe. The table reads as if "map to token" preserves color; in fact Board/Apps/UIA badge shift legacy blue → current indigo family (same precedent as userBubbleBg per DESIGN.md). Add one line to the SoT stating the resulting hue change so QA doesn't flag it as a regression.
2. **Semantic fit for UIA badge** — computer-utils `#dbeafe` is an L2 capability badge; mapping to `modeBrowserBg` (browser-mode tint) is semantically odd. Prefer `accentSoft` or note it's visual-only. Also B4's "for mode chrome" wording doesn't match the actual site (UIA badge ≠ mode chrome) — reword to "no raw #dbeafe/#2563eb in computer-utils".
3. **"W1–W3 already landed" overstates** — the W1–W3 changes are uncommitted working-tree edits on 6d95973, not merged to main. Suggest committing them separately (parent suggested-commit list) so W4/W5 land on a clean base and the batch history stays reviewable.
4. **Worst-case sum is conservative** — Scene+RunBusy+WorkerScope all at 28px simultaneously is the SoT's stated worst case; the density note should record whether all three ever co-render in practice (if not, budget is looser). Static math at 640px ≈ 44+80+28+28+28+84 = 292px chrome → ~54% ChatStream worst case, so both thresholds likely pass; document, don't change structure.
5. **No regression test for StatusRail copy** — parent Claude nit 5 suggested asserting the menu never references 底栏「更多」while `bottomBarStrip===false`; cheap to add alongside W4/W5. Deferrable.

## 5. Scope W4/W5 keep-cut

- **W4 (keep, promoted to required measurement)** — correctly "measure first, surgical-only-if-fail"; forbidden list correct (no new meta-band, no FocusBand priority rewrite, no Board-into-Host, no bottomBarStrip re-enable). Resolves parent nit 3.
- **W5 (keep)** — monotonic, 3 named residues, correct target files/lines, SettingsIntentBar correctly marked skip.
- **Kill list correct:** Settings rewrite, ontology rename, polish pass, mass gray hex sweep, Packs #b45309 campaign all NO-GO and not smuggled.

VERDICT: APPROVE_WITH_NITS
