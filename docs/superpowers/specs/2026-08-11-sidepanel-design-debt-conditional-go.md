# Side Panel design debt — CONDITIONAL GO (bounded sprint)

| Field | Value |
|-------|--------|
| Status | **APPROVE_WITH_NITS** — dual-review 20260811-164753; implementing W1–W3 |
| Date | 2026-08-11 |
| Surface | Chrome Side Panel (`chrome-extension/src/sidepanel`) |
| Mode | Operate (task UI) |
| Prior | Impeccable dual-agent critique + independent ROI critic + force-challenge of NO-GO |
| Dual-review | Claude+Pi `docs/audit/reviews/sidepanel-design-debt-conditional-go-verdict-20260811-164753.json` |

## Capability declaration (if landed)

```text
Surface:      L0 (Panel chrome only) — no L1/L2 tool or host changes
L2-classes:   (none)
Compose:      none (copy may mention 装配 / /board; no new pack surface)
Autonomy:     none
Trust:        no elevation
Channel:      community | enterprise unchanged
```

## Verdict under review

**CONDITIONAL GO — 1–2 day bounded debt sprint** (not a redesign campaign).

| Track | Decision | Confidence |
|-------|----------|------------|
| Full design-optimization campaign | **NO-GO** | high |
| FocusBand architecture rewrite | **NO-GO** | high |
| SettingsSlideout restructure | **NO-GO** | high |
| Product jargon rename (装配 / Surface / cruise) | **NO-GO** | high |
| Type/emoji polish pass | **NO-GO** | high |
| **Truth path + contrast + DESIGN SoT (+ optional density)** | **GO** | ~74% |

## Evidence (spot-checkable)

### E1 — False discoverability path (product truth bug)

- `chrome-extension/src/sidepanel/ui/flags.ts`: `bottomBarStrip: false`
- `chrome-extension/src/sidepanel/App.tsx`: BottomBar only if `ui.bottomBarStrip`
- `StatusRail.tsx` menu item toasts:  
  `场景 / 任务板已移至底栏「更多」— 主栏仅保留当前模式高频入口`  
  while BottomBar is **not rendered** by default.
- Correct paths already exist: `/board`, ComposeDrawer note, chips / 装配 (`meta-slash.ts`).

### E2 — DESIGN.md ↔ tokens.ts drift (agent-coding regression risk)

- Live: `tokens.accent` = `#4f46e5`, `tokens.bg` = `#f5f6fa` (`sidepanel/ui/tokens.ts`)
- Doc table: accent `#2563eb`, canvas `#fafbfc` (`docs/DESIGN.md`)
- Residual `#2563eb` still appears in secondary panels (e.g. BoardPanel, AppsPanel)

### E3 — `textMuted` contrast on guidance copy

- `tokens.textMuted` `#94a3b8` on `#f5f6fa` ≈ **2.37:1** (fails WCAG AA for normal text)
- Used for empty states / “暂无*” guidance (ThreadList, AtThreadPopover, packs empty, ChatView empty kicker) — not only decorative timestamps

### E4 — Status strip accretion vs UIUX v2 P4

- Spec P4: single status rail, not 4 strips (`docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md`)
- Implementation: StatusRail + FocusBand + SceneStatusBar + RunBusyChip + WorkerScopeBar (latter three outside FocusBand)
- Density targets: ChatStream ≥55% L0 idle / ≥40% worst-case @ 640px — **not re-measured in this batch**; Day-2 only if budget fails

### E5 — Impeccable scores (context, not gate)

- Nielsen ~27.5/40 Good; detector AI-slop clean after product FP filter
- Independent critic: NO-GO campaign; force-challenge elevated truth-path + contrast + DESIGN SoT

## In-scope work (Day 0.5–1 — required if APPROVE*)

### W1 — Fix false IA copy (`StatusRail`)

- Remove or rewrite menu item / toast so it never points at bottom-bar「更多」when strip is off.
- Point to real entry points via **copy/slash only**: `/board`, 装配 chips, `/场景`.  
  **Dual-review nit (Pi):** do **not** add a new L0 Host/Board primary entry; Board stays Autonomy chrome only (UIUX v2).
- Delete dead “关于「更多」面板” if it only exists to toast a lie.

### W2 — `textMuted` policy (surgical)

**Dual-review nit (Claude+Pi): pick (B) first** (minimal blast).

- **(B) default:** Keep `tokens.textMuted`; change empty/guidance “暂无*” / “无匹配*” / primary empty kickers to `textSecondary`; reserve `textMuted` for non-essential meta only.  
  Include ChatView `emptyKicker` (not decorative).
- **(A) only if** (B) misses AA-critical spots: darken `tokens.textMuted` toward ≥4.5:1 (wider blast — timestamps etc.).

Do **not** restyle entire SettingsSlideout.

### W3 — DESIGN.md SoT alignment

- Declare `chrome-extension/src/sidepanel/ui/tokens.ts` as sole hex SoT.
- **Default (dual-review):** drop hex columns; keep role → `tokens.*` name only + lag note.  
  **A3 nit:** cover **entire** color role table **and** Message Bubbles section (not only accent/canvas).
- Lag note must name residual `#2563eb` panels for a future batch: BoardPanel, AppsPanel, SettingsIntentBar (dead `|| "#2563eb"` fallback — optional drive-by delete).
- No visual code change required beyond optional one-line comment in tokens.

## Optional Day 1–2 (only if density measurement fails)

### W4 — Density regression + surgical collapse

1. Measure ChatStream height fraction at ~640px panel height:
   - L0 idle
   - L2 + pending confirm + scene + runBusy (+ worker scope if applicable)
2. If ChatStream &lt; 40% worst-case **or** duplicate busy chrome is obvious:
   - Prefer **hide/dedupe** RunBusy when FocusBand already shows equivalent fleet/tools busy
   - Or make Scene row collapsible / merge into FocusBand **secondary** only if trivial
3. **Forbidden:** new unified meta-band component; FocusBand priority machine rewrite; Settings restructure

## Explicit out-of-scope (REJECT if dual-review tries to expand into these without new evidence)

- FocusBand priority redesign / “one scannable band” rewrite
- SettingsSlideout IA rewrite (~3.8k LOC)
- Rename 装配 / Surface / cruise product terms
- Batch hex migration campaign across all secondary panels
- Type scale / emoji chrome polish pass
- Companion / WS / Trust / L2 tool changes

## Acceptance

| # | Check |
|---|--------|
| A1 | No toast/menu claims “底栏更多” for board/scene when `bottomBarStrip === false` |
| A2 | Empty-state guidance uses `textSecondary` (policy B) or document alternative if A chosen |
| A3 | DESIGN.md color role table **and** Message Bubbles section do not contradict `tokens.ts` (prefer role→token, no stale hex) |
| A4 | No FocusBand rewrite; no Settings restructure; no BottomBar re-enable; no ontology rename; no hex-migration campaign; no polish pass |
| A5 | Extension tests still pass for touched modules (`npm --prefix chrome-extension test` scoped if available) |
| A6 | If W4 run: written measurement note (pass/fail vs 40%/55%); any code change limited to collapse/dedupe. Prefer a short timeboxed measure even if no code change. |

## Suggested commit shape

1. `fix(ui): correct StatusRail discoverability copy (no bottom-bar 更多)`  
2. `fix(ui): textMuted empty-state contrast policy`  
3. `docs(design): align DESIGN.md color SoT with tokens.ts`  
4. (optional) `fix(ui): dedupe status chrome under density budget`

## References

- Critique snapshot: `.impeccable/critique/` (sidepanel slug, 2026-08-11)
- UIUX v2: `docs/superpowers/specs/2026-07-31-sidepanel-uiux-redesign.md` (P4, density)
- Tokens: `chrome-extension/src/sidepanel/ui/tokens.ts`
- Flags: `chrome-extension/src/sidepanel/ui/flags.ts`
