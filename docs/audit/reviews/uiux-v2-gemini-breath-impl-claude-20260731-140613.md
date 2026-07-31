Diff matches working tree (HEAD `f74e6e5`, base `0cfa7a4`). Priority file `focus-band-priority.ts` has zero diff. Tests: 371/371 pass. No `#4CAF50/#F44336/#FF9800/#4A90D9` regressions in touched files. Board guard `ComposeDrawer.tsx:66` intact; `COMPOSE_SECTIONS` excludes board; no "中层 Agent" string anywhere.

## Summary

Independent re-review of G1–G4 Gemini-breath stack. The diff is purely visual/chrome (tokens, radii, shadows, soft confirm surface, floating FocusBand, MD3 drawer, menu tokenization) plus the mandated Q1 IA change (L0 = one 装配 chip). No new tools, gates, Host panels, capability axes, or runtime. All six rejection gates pass; 371/371 tests green. Ship with nits.

## Spec coverage G1–G4

| PR | Requirement | Evidence | Status |
|----|-------------|----------|--------|
| G1 | `bg #f5f6fa` | `tokens.ts:11` | ✅ |
| G1 | `radiusComposer/Bubble 18` | `tokens.ts:76-77` | ✅ |
| G1 | Thin StatusRail (h40, gap6) | `StatusRail.tsx:366-373` | ✅ |
| G1 | No L0 full-rail fill; 3px accent line | `StatusRail.tsx:165-181` (`modeLine=null` for chat) | ✅ |
| G1 | Indigo accent, no Material hexes | grep clean | ✅ |
| G2 | Editorial empty (kicker/title/hint/≤3 chips) | `ChatView.tsx:723-789` | ✅ |
| G2 | L0 = one 装配 chip only | `meta-slash.ts:281-284` | ✅ |
| G2 | Hero composer (fs14, h44, radius18) | `App.tsx:836-872` | ✅ |
| G3 | Floating FocusBand inset card | `FocusBand.tsx:74-111` (`outer` 6/10/0 pad + `cardShell` r16) | ✅ |
| G3 | Soft `dangerSurface` not solid bar | `tokens.ts:35` + `FocusBand.tsx:178` | ✅ |
| G3 | Tool card left hairline | `ChatView.tsx:401` (`borderLeftColor: statusTone`) + `toolCard.borderLeft 2px` | ✅ |
| G3 | Priority table unchanged | `focus-band-priority.ts` diff = 0 | ✅ |
| G4 | Soft scrim token | `tokens.ts:93` + `ComposeDrawer.tsx:192` | ✅ |
| G4 | MD3 settings-list groups | `ComposeDrawer.tsx:145-154, 254-263` | ✅ |
| G4 | Unified menus (radiusMenu14 + shadowLg) | 5 menus verified | ✅ |
| G4 | Board not under 装配 | guard + footer + `composeSectionsExcludeBoard()` | ✅ |

## Safety / FocusBand / 急停

`resolveFocusBandSlot` is byte-identical to base. When L2 + confirm coincides, `cardTone === "confirm"` (primary wins), and `secondaryAbort` renders `AbortSecondaryLine` as a `tokens.darkBg (#0b0d12)` strip inside the soft `dangerSurface` card — maximum contrast, 急停 button uses `darkDangerBg`/`darkDanger`/`#7f1d1d` border (`FocusBand.tsx:220-235`). Compact `MinimalConfirm` keeps four explicit action buttons (允许/拒绝/停止/确认台) with high-contrast pairs. R2/R4/R6 all pass.

## ADR-020 / 装配 IA

- Board excluded from `COMPOSE_SECTIONS` (`meta-slash.ts:171-220`).
- Defensive guard `ComposeDrawer.tsx:66`: `if (section.panelId === "board") return`.
- Footer note line 117 unchanged.
- No new Surface/L2-class/Compose/Autonomy/Channel declared or introduced — matches capability declaration in the prompt.
- No "中层 Agent" string in `chrome-extension/src` or `companion/src`.

## Discoverability (L0)

L0 chips reduced to `[{id:"compose", primary:true}]`. Skills/Know reachable via 装配 drawer sections + `/skills` `/knowledge` slash (verified in `META_PANEL_SLASH`). Packs/MCP slash entries preserved. Test `bottom-bar-strip-flag.test.ts:37-58` asserts the new contract.

## Blocking

None. R1–R6 all pass; capability declaration provided; diff stays visual + mandated chip IA change.

## Nits

1. **Outer padding vs 80px cap** (`FocusBand.tsx:172-175`): `outer.padding="6px 10px 0"` floats the card but the FocusBand region now claims ~86px in the layout when both abort (24) + compact confirm (56) render inside the 80px card. Card chrome itself still ≤80, so the *visible chrome* invariant holds; just flagging the layout footprint shift.
2. **停止 button border softened** (`MinimalConfirm.tsx:186`): reduced from `#7f1d1d` solid to `rgba(220,38,38,0.35)`. Still clearly tappable (red text + outline + title), but worth a visual confirmation next to high-contrast 允许 (white-on-green) in a real L2+confirm scenario. (Pi G3 nit, still open.)
3. **StatusRail iconBtn active hexes** (`StatusRail.tsx:211`): pre-existing `#fcd34d`/`#bfdbfe` not migrated in this PR — now adjacent to the new `modeBrowserLine` token. Not a regression (untouched block), but a token-cleanup candidate.
4. **StatusRail menu lost translucency** (`StatusRail.tsx:392`): `rgba(255,255,255,0.96)` → opaque `bgElevated`. Intentional consistency with other menus; rail itself stays frosted. (Pi G4 nit.)
5. **L2 emptyHint `;`**: already resolved by commit `4b2804a` (rewritten without semicolon). No action.

VERDICT: APPROVE_WITH_NITS
