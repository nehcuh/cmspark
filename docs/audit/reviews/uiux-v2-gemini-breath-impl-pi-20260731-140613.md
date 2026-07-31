## Summary

Independent senior review of the G1–G4 stack (`feat/uiux-v2-shell`, 0cfa7a4 → f74e6e5) applying the SoT spec §5/§8/§9 and the ADR-020 capability checklist. The diff spans 15 source files + 3 test files, all purely visual/presentation. No new tools, gates, Host panels, capability axes, or security logic changes. All 6 rejection gates pass. 5 non-blocking nits noted.

---

## Spec coverage G1–G4

| PR | Deliverable | Status |
|----|------------|--------|
| **G1** | Canvas `#f5f6fa`, radiusComposer/Bubble 18, thin StatusRail (40px, no L0 mode fill), indigo accent family | ✅ |
| **G2** | Editorial empty L0/L1/L2 (kicker→title→hint→≤3 chips); L0 one soft 装配 chip only; hero composer (radius 18, padding/gap uplift); short human placeholders | ✅ |
| **G3** | FocusBand floating card (borderRadius 16, shadowMd, 10px insets); confirm via `dangerSurface` (8% red tint, not solid bar); tool card 2px left hairline accent; ≤80px hard cap preserved | ✅ |
| **G4** | 装配 drawer soft scrim (`rgba(15,23,42,0.28)`), radiusSheet 20, settings-list groups (one card per group, hairline dividers, borderless items); 5 menus unified to shared `radiusMenu`(14)/`shadowLg`/`borderStrong` | ✅ |

Cross-check: `focus-band-priority.ts` has **zero diff** — priority machine untouched. Non-compact `MinimalConfirm` path (Cockpit/chat-embedded) untouched. `COMPOSE_SECTIONS` still excludes `board` with guard at `ComposeDrawer.tsx:66` + footer note at `:117`.

## Safety / FocusBand / 急停

**PASS.** The `secondaryAbort` rendering path is preserved and renders *before* the primary slot inside the floating card:

```tsx
// FocusBand.tsx:87-89
{slot.secondaryAbort && (
  <AbortSecondaryLine taskId={task!.taskId} taskLabel={task?.task} />
)}
```

`AbortSecondaryLine` retains its dark-danger chrome: `background: tokens.darkBg`, abort button with `tokens.darkDangerBg` / `tokens.darkDanger` / `border: 1px solid #7f1d1d`. When L2 is active and confirm fires, `resolveFocusBandSlot` (unchanged) returns `secondaryAbort: true` — 急停 appears as a dark abort row inside the soft-tinted confirm card, providing strong visual contrast. 急停 is **not** buried.

One subtlety: `secondaryContext` background changed `darkElevated`→`darkBg` — this path is mutually exclusive with `secondaryAbort` per the priority machine, so it never competes with 急停. Cosmetic only.

## ADR-020 / 装配 IA

| Check | Result |
|-------|--------|
| Board / Fleet / multi-worker under 装配 | ❌ — excluded by `COMPOSE_SECTIONS`, guard `:66`, footer `:117` |
| "中层 Agent" / middle-agent runtime copy | ❌ — zero matches in codebase |
| Pack-first (new Side Panel chrome) | N/A — no new primary UI entry points |
| New confirmation family | ❌ — existing confirm gates reused |
| Trust monotonicity | ✅ — no surface-level change alters confirm semantics; nonce/whitelist/stop paths intact |
| originWs regression | ❌ — no `security.confirmation.response` wiring touched |
| Security confirmation logic regressions | ❌ — `needsNonce`, `allow/deny/stop/whitelist/nonce_challenge` all preserved |

**R1**: PASS — no Board or Autonomy chrome under 装配; no "中层 Agent."

## Discoverability (L0)

`composerChipsForLevel("chat")` returns **only** `[{ id: "compose", primary: true }]`. Skills, Knowledge, Packs, and MCP are reachable via:
- 装配 drawer sections (`COMPOSE_SECTIONS`: skills, knowledge, packs, mcp, apps, history)
- `/` slash commands (`META_PANEL_SLASH` includes skills, knowledge, packs, mcp, 装配, board)

Tests at `bottom-bar-strip-flag.test.ts` and `composer-slash-parity.test.ts` assert `deepEqual(["compose"])` for L0. **R3**: PASS — no L0 multi-chip row restored.

## Blocking

**None.** All 6 rejection gates verified:

| Gate | Verdict | Evidence |
|------|---------|----------|
| R1 — ADR-020 Board/中层Agent | PASS | Guard `:66`, footer `:117`, composeSectionsExcludeBoard(), no "中层Agent" |
| R2 — FocusBand priority / 急停 buried | PASS | `focus-band-priority.ts` empty diff; `secondaryAbort` renders `AbortSecondaryLine` with dark-danger chrome |
| R3 — L0 multi-chip row | PASS | `composerChipsForLevel("chat")` → `["compose"]` only; tests assert |
| R4 — Full-bleed solid danger bar | PASS | `cardConfirm` uses `dangerSurface` (8% red tint), borderRadius 16, shadowMd |
| R5 — Material status hexes | PASS | No `#4CAF50`/`#F44336`/`#FF9800` in any touched file; `connectionColor` uses Tailwind-functional tokens |
| R6 — Security confirmation logic | PASS | `needsNonce`/allow/deny/stop/whitelist paths unchanged; only compact-path button colors touched |

## Nits

1. **StatusRail menu loses frosted transparency** (`StatusRail.tsx:392`): `rgba(255,255,255,0.96)` → opaque `tokens.bgElevated` (`#ffffff`). Defensible as MD3 elevated surface; minor aesthetic shift from frosted rail language. *(Also noted in G4 Pi review)*

2. **停止 button border at 35% opacity** (`MinimalConfirm.tsx:187`): Old `border: 1px solid #7f1d1d` → new `border: 1px solid rgba(220,38,38,0.35)`. On near-white `dangerSurface` (8% tint), the softer border may visually recede next to high-contrast 允许 (white-on-green). Still clearly tappable with red text + outline. *(Also noted in G3 Pi review)*

3. **Label contrast marginal** (`MinimalConfirm.tsx:127`): `color: tokens.danger (#dc2626)` on near-white `dangerSurface` at 11px/700 weight ≈ 4.3:1 — slightly below WCAG AA 4.5:1 for normal text. Acceptable in compact chrome context. *(Also noted in G3 Pi review)*

4. **Section list items lack hover state** (`ComposeDrawer.tsx:293-296`): `transition: background 150ms` defined but no explicit `:hover` background rule. UX polish for interactive rows. *(Also noted in G4 Pi review)*

5. **L2 emptyHint ASCII semicolon** (`ChatView.tsx:756`): `此处可排队跟进；` uses ASCII `;` — should be full-width `；` (U+FF1B) per Chinese typography conventions. Ultra-minor editorial polish. *(Also noted in G2 Pi review)*

---

VERDICT: APPROVE_WITH_NITS
