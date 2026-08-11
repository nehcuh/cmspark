# Side Panel density budget @ 640px (W4)

| Field | Value |
|-------|--------|
| Date | 2026-08-11 |
| Method | Static budget from code constants (no live Side Panel) |
| SoT | `docs/superpowers/specs/2026-08-11-sidepanel-design-debt-remaining-w4-hex.md` |
| Dual-review N1 | Gutter allowance for borders / seams (not gamed) |
| Panel height | **640px** |

## Targets (UIUX v2)

| Scenario | ChatStream share of 640px | Threshold |
|----------|---------------------------|-----------|
| L0 idle | ≥ 55% | pass/fail |
| Worst-case (L2 + confirm + scene + runBusy + worker) | ≥ 40% | pass/fail |
| FocusBand | ≤ 80px always | hard cap (constant) |

## Code constants (sources)

| Band / surface | Constant | Value (px) | Source |
|----------------|----------|------------|--------|
| StatusRail | `minHeight` | **44** | `StatusRail.tsx` styles.rail |
| FocusBand | `FOCUS_BAND_MAX_PX` | **80** | `focus-band-priority.ts` |
| FocusBand primary cap | `FOCUS_BAND_PRIMARY_MAX_PX` | 56 | same |
| FocusBand secondary cap | `FOCUS_BAND_SECONDARY_MAX_PX` | 24 | same (56+24=80) |
| SceneStatusBar | `maxHeight` (when pack/workspace) | **28** | `SceneStatusBar.tsx` |
| RunBusyChip | `maxHeight` (when runBusy) | **28** | `RunBusyChip.tsx` |
| WorkerScopeBar | `maxHeight` (when worker thread) | **28** | `WorkerScopeBar.tsx` |
| InputArea textarea | `minHeight` / `maxHeight` | **44 / 120** | `App.tsx` styles.textarea |
| ComposerChips row | estimate (SoT ≤40) | **36** (30–40 band) | chip pad+font + row `padding-bottom: 10` |
| `ui.bottomBarStrip` | default | **false** (0 height) | `ui/flags.ts` — not in stack |

### Composer / InputArea assumptions (documented)

InputArea stack (vertical, idle composer — **realistic**, not max-expanded textarea):

| Piece | px | Notes |
|-------|-----|--------|
| `inputArea` padding top+bottom | 12+16 = **28** | `App.tsx` styles.inputArea |
| ComposerChips row | **36** | single-line chips; within SoT 30–40 |
| `composerCapsule` padding top+bottom | 10+10 = **20** | styles.composerCapsule |
| textarea (realistic / min) | **44** | minHeight; idle 1–2 lines |
| **InputArea subtotal (realistic)** | **128** | 28+36+20+44 |
| InputArea max-expanded (reference only) | 28+36+20+120 = **204** | not used for pass/fail |

`borderTop: 1` on InputArea counted under **gutters**, not double-counted in the 128.

### Co-render note

Scene + RunBusy + Worker **can** co-render (independent conditions: pack/workspace, scoped runBusy, worker-thread scope). Worst-case **includes all three** (conservative).

FocusBand `primary === "empty"` → component returns `null` (0 height). L0 idle uses that.

## Gutter / seam allowance (dual-review N1)

Borders and outer pads that sit outside the named max heights (or add to footprint):

| Seam | px | When | Notes |
|------|-----|------|--------|
| StatusRail `borderBottom` | 1 | always | content-box; outside `minHeight` 44 |
| FocusBand `outer` padding-top | 2 | FocusBand present | `FocusBand.tsx` styles.outer `"2px 10px 0"` |
| FocusBand card top+bottom border | 2 | FocusBand present | 1px × 2; card `maxHeight` 80 is content shell |
| SceneStatusBar `borderBottom` | 1 | Scene present | content-box; outside max 28 |
| RunBusyChip `borderBottom` | 0 extra | RunBusy present | `boxSizing: border-box` — inside max 28 |
| WorkerScopeBar `borderBottom` | 0 extra | Worker present | border-box — inside max 28 |
| InputArea `borderTop` | 1 | always | |
| Flex / subpixel slack | 4 | always | N1 cushion so 40% is not gamed |

| Scenario | Gutter total |
|----------|--------------|
| L0 idle (no FocusBand / Scene / RunBusy / Worker) | 1+1+4 = **6** |
| Worst-case (all bands) | 1+2+2+1+1+4 = **11** |

## Scenario A — L0 idle

**Assumptions:** chat mode; FocusBand empty → null; no pack/workspace; no runBusy; no worker scope; bottomBarStrip off; composer **realistic** (128).

| Item | px |
|------|-----|
| StatusRail | 44 |
| FocusBand | 0 |
| Scene / RunBusy / Worker | 0 |
| InputArea (realistic) | 128 |
| Gutters | 6 |
| **Chrome total** | **178** |
| **ChatStream** | 640 − 178 = **462** |
| **Share** | 462 / 640 = **72.2%** |

| Check | Result |
|-------|--------|
| ChatStream ≥ 55% | **PASS** (72.2% ≥ 55%) |
| FocusBand ≤ 80 | N/A (0) |

Sensitivity (still pass): max-expanded textarea → chrome 44+204+6 = 254 → Chat 386 → **60.3%** ≥ 55%.

## Scenario B — Worst-case chrome

**Assumptions:** FocusBand at hard max 80 (e.g. confirm primary + secondary abort/tools under cap); Scene + RunBusy + Worker all present at max 28 each; composer **realistic** 128 (not max textarea); bottomBarStrip off.

| Item | px |
|------|-----|
| StatusRail | 44 |
| FocusBand (cap) | 80 |
| SceneStatusBar | 28 |
| RunBusyChip | 28 |
| WorkerScopeBar | 28 |
| InputArea (realistic) | 128 |
| Gutters | 11 |
| **Chrome total** | **347** |
| **ChatStream** | 640 − 347 = **293** |
| **Share** | 293 / 640 = **45.8%** |

| Check | Result |
|-------|--------|
| ChatStream ≥ 40% | **PASS** (45.8% ≥ 40%) |
| FocusBand ≤ 80 | **PASS** (constant cap) |

Sensitivity (not gating): chips at top of band (40) → InputArea 132 → chrome 351 → Chat 289 → **45.2%** still pass.  
Max-expanded textarea (204) would drop to ~34% — **out of acceptance method** (SoT: composer realistic).

## Verdict

| Scenario | Share | Threshold | Pass? |
|----------|-------|-----------|-------|
| L0 idle | 72.2% | ≥ 55% | **PASS** |
| Worst-case | 45.8% | ≥ 40% | **PASS** |

**Both thresholds pass with stated assumptions and gutters.**

### Structure change

- `structure_changed` = **false**
- No FocusBand architecture edit
- No RunBusy hide/dedupe (surgical path only if fail)
- No new meta-band; `bottomBarStrip` remains false

## W5 cross-note (hue, not density)

UIA badge `#dbeafe` → `tokens.accentSoft` (`#eef2ff`, Quiet Premium indigo-soft) is an **intentional blue→indigo hue shift**, same family as userBubble / accent migration. Not a density regression; QA should not treat as accidental color regression. OCR chip `#e5e7eb` intentionally left raw (out of W5).
