# Dual external re-review: Gemini breath implementation (PR-G1…G4)

**Batch:** `uiux-v2-gemini-breath-impl`  
**Stage:** **Post-implementation re-review** (SoT already dual-reviewed; per-PR Pi gates G1–G4 landed)  
**Date:** 2026-07-31  
**Branch:** `feat/uiux-v2-shell`  
**Diff base:** `0cfa7a4` (docs SoT) → `HEAD` (through PR-G4 `f74e6e5`)

## Capability declaration

```text
Surface:      n/a (visual / chrome density only; L0/L1/L2 presentation)
L2-classes:   (none new)
Compose:      none new — 装配 remains Composition-only (no Board)
Autonomy:     n/a
Trust:        soft confirm must not bury 急停; content-split / 急停 preserved
Channel:      n/a
```

## Context

- Design SoT: `docs/superpowers/specs/2026-07-31-gemini-inspired-visual-comparison.md` (“Gemini breath, CMspark bones”).
- Pre-impl dual-review on SoT already ran; this is **code re-review of the shipped G1–G4 stack**.
- Per-PR Pi artifacts (for cross-check, not rubber-stamp):
  - `docs/audit/reviews/uiux-v2-PR-G1-pi-*.md`
  - `docs/audit/reviews/uiux-v2-PR-G2-pi-*.md`
  - `docs/audit/reviews/uiux-v2-PR-G3-pi-*.md`
  - `docs/audit/reviews/uiux-v2-PR-G4-pi-*.md`

### Delivered commits (newest first)

| Commit | PR | Intent |
|--------|-----|--------|
| `f74e6e5` | G4 | 装配 sheet MD3 + unified menus |
| `0cb78b0` | G3 | floating FocusBand + soft confirm + tool hairline |
| `4b2804a` | G2 nit | emptyHint punctuation |
| `5ed3e35` | G2 | editorial empty, L0 装配 chip, hero composer |
| `4702c85` | G1 | airier canvas, thin rail, hero radii |

## Your job

Independent senior **design + safety + IA** review of the **working tree / diff vs base**.  
Use Read/Grep/Bash on the repo. Do **not** rubber-stamp prior Pi gates.

### Must verify against SoT §5 / §8 / §9

1. **G1 surfaces** — canvas `#f5f6fa`, radiusComposer/Bubble 18, thin StatusRail, no L0 full mode fill, indigo accent family (not Material status hexes).  
2. **G2 empty + composer** — editorial empty; L0 **one soft 装配 chip only** (Skills/Know via drawer or slash); hero composer.  
3. **G3 FocusBand + tools** — floating inset card (not full-bleed solid red bar); soft `dangerSurface`; tool card **left hairline**; `resolveFocusBandSlot` priority unchanged; 急停 still visible when L2 + confirm.  
4. **G4 装配 + menus** — soft scrim token; settings-list groups; menus use shared radius/shadow; **Board not under 装配**.

### Rejection gates (any fail → REJECT)

| # | Gate |
|---|------|
| R1 | ADR-020: Board / multi-worker /「中层 Agent」 under 装配 or new Autonomy chrome |
| R2 | FocusBand priority table rewritten or 急停 buried under soft-confirm presentation |
| R3 | L0 permanent multi-chip row restored (Skills+Know+… without 装配 disclosure) |
| R4 | Full-bleed solid danger bar as outer FocusBand confirm chrome |
| R5 | Material status-dot hex regression (`#4CAF50` / `#F44336` / `#FF9800` as connection/status SoT) |
| R6 | Security confirmation **logic** regresses (allow/deny/stop/nonce/whitelist paths broken — not just colors) |

### Also check

- Diff stays **visual** (no new tools, gates, Host panels, capability axes).  
- Tests still meaningful for flags / chips / tokens (spot-check `chrome-extension/tests/*`).  
- Cross-file consistency: menus not half-migrated; tokens SoT used vs hardcoded leftovers in **touched** files.

## Output format

```markdown
## Summary
## Spec coverage G1–G4
## Safety / FocusBand / 急停
## ADR-020 / 装配 IA
## Discoverability (L0)
## Blocking
## Nits
VERDICT: APPROVE|APPROVE_WITH_NITS|REJECT
```

End with **exactly one** final line:

```text
VERDICT: APPROVE
```
or
```text
VERDICT: APPROVE_WITH_NITS
```
or
```text
VERDICT: REJECT
```
