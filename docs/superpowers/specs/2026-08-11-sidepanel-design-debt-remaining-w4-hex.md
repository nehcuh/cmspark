# Side Panel design debt — remaining batch (W4 density + residual hex)

| Field | Value |
|-------|--------|
| Status | **APPROVE_WITH_NITS** — dual-review 20260811-170904; implementing W4+W5 |
| Date | 2026-08-11 |
| Parent | `docs/superpowers/specs/2026-08-11-sidepanel-design-debt-conditional-go.md` (W1–W3 in working tree) |
| Dual-review | `docs/audit/reviews/sidepanel-design-debt-remaining-verdict-20260811-170904.json` |
| Dual-review parent | `docs/audit/reviews/sidepanel-design-debt-conditional-go-verdict-20260811-164753.json` |

## Capability declaration

```text
Surface:      L0 Panel chrome only
L2-classes:   (none)
Compose:      none
Autonomy:     none (Board hex only — no Board IA change)
Trust:        no elevation
Channel:      community | enterprise unchanged
```

## Why this batch

Parent CONDITIONAL GO left **optional W4** and **lag-note residual `#2563eb`** for a follow-up. User asked to finish remaining items the same way (dual-review → workflow).  
**Still NO-GO (do not expand into):** FocusBand priority rewrite, Settings restructure, ontology rename, type/emoji polish campaign, mass hex sweep of every panel.

## In-scope

### W4 — Density budget: measure + surgical collapse only if fail

**Targets** (UIUX v2): at **640px** panel height

| Scenario | ChatStream height share |
|----------|-------------------------|
| L0 idle | ≥ **55%** |
| Worst-case L2 + confirm + scene + runBusy (+ worker scope if applicable) | ≥ **40%** |
| FocusBand | ≤ **80px** always |

**Method (required, timeboxed):**

1. **Static budget calculator** (preferred for CI/agent harness without live Side Panel): sum documented chrome heights from code constants:
   - StatusRail minHeight 44
   - FocusBand max 80 (primary+secondary caps in `focus-band-priority.ts`)
   - SceneStatusBar max 28 (when pack/workspace)
   - RunBusyChip max 28 (when runBusy)
   - WorkerScopeBar max 28 (when worker thread)
   - Composer/InputArea: measure from styles (minHeight 44 / maxHeight 120) + chips row estimate ≤ 40 — document assumptions
   - **Dual-review N1:** add **gutter allowance** (+borders/seams between bands, e.g. +1–2px per border + documented N px) so 40% is not gamed
   - Note whether Scene+RunBusy+Worker ever co-render (conservative worst-case still report all three)
2. Write results to `docs/audit/reviews/sidepanel-density-budget-20260811.md` with pass/fail vs 55%/40%.
3. **Only if worst-case ChatStream &lt; 40%** (or L0 idle &lt; 55% with realistic composer): surgical code change — **prefer**:
   - Hide/dedupe `RunBusyChip` when FocusBand already surfaces equivalent fleet/tools busy for the same scoped run
   - Or collapse Scene to single line already max 28 (no new band)
4. **Forbidden under W4:** new unified meta-band; FocusBand priority machine rewrite; moving Board into L0 Host; re-enabling `bottomBarStrip`.

If static budget **passes** both thresholds with stated assumptions → **document pass; no UI structure change**.

### W5 — Residual indigo/blue hex on lag-noted surfaces (monotonic)

Replace **product accent blue leftovers** with `tokens.*` on named files only:

| File | Known residue | Map to (pin at impl) |
|------|---------------|----------------------|
| `BoardPanel.tsx` | trust `tool_verified` bg `#2563eb` | **`tokens.accent`** (bg on light) |
| `AppsPanel.tsx` | text `color: "#2563eb"` | **`tokens.accentText`** (text-on-light AA) |
| `SettingsIntentBar.tsx` | already cleaned in W1–W3 | skip |
| `utils/computer-utils.ts` | UIA badge `bg: "#dbeafe"` | **`tokens.accentSoft`** (not modeBrowserBg semantics) |

**Hue shift (dual-review nit):** mapping is **legacy blue → Quiet Premium indigo family**, not pixel-identity. Same as userBubbleBg migration. QA should not treat as accidental regression.

**Not in W5:** OCR chip `#e5e7eb` gray; full AppsPanel/ThreadList gray ladder; Packs `#b45309` orange campaign.

## Acceptance

| # | Check |
|---|--------|
| B1 | Density note exists under `docs/audit/reviews/` with L0 idle + worst-case numbers at 640px and pass/fail |
| B2 | If fail → only surgical dedupe/collapse; if pass → no FocusBand architecture edit |
| B3 | `rg '#2563eb' chrome-extension/src/sidepanel` → **0** hits (or only comments/docs) |
| B4 | `computer-utils` no raw `#dbeafe` / `#2563eb` (UIA badge uses tokens) |
| B5 | No FocusBand rewrite / Settings restructure / bottomBarStrip true / ontology rename |
| B6 | `npm --prefix chrome-extension test` green |

## Suggested commits

1. `docs(ui): sidepanel density budget measure @640px`  
2. `fix(ui): map residual accent hex to tokens (Board/Apps/computer-utils)`  
3. (optional only if B1 fail) `fix(ui): dedupe RunBusy when FocusBand shows fleet busy`

## References

- Parent SoT W4 section + lag note  
- `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` P4 / density  
- `chrome-extension/src/sidepanel/App.tsx` strip stack  
