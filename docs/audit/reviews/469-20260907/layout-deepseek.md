# Independent Review — #469 Layout Redesign

**Fixed point:** `8656df94` · **Scope:** listed frozen files only · **Verdict: REJECT**

Two P1 functional defects block merge. Several P2 issues follow.

---

## P1 — Settings category navigation dispatches an action that does not exist

`SettingsSlideout.tsx` category chips dispatch:

```tsx
dispatch({ type: "OPEN_SETTINGS_SECTION", section: id })
```

The existing settings deep-link mechanism (provided in the packet) uses `state.settingsFocusSection` and `CLEAR_SETTINGS_FOCUS` — no `OPEN_SETTINGS_SECTION` appears anywhere in the frozen files, and the agentStore reducer is not part of this diff. If the reducer does not handle this action type (almost certainly, given the existing pattern), every category chip is a no-op: the section accordion never expands, and the subsequent `querySelector(\`[data-settings-section="${label}"] > button\`)` finds nothing because the heading is still collapsed. The category bar — a newly added, core navigation surface — becomes decorative.

The correct action is likely `SET_SETTINGS_FOCUS` (or equivalent), and the label-based query selector should be replaced with a robust section id (`SETTINGS_SECTION_IDS`) rather than a Chinese label string that may not match the DOM attribute value.

---

## P1 — Navigation resource buttons ignore capability-level gating

`WorkspaceNavigation` renders:

```tsx
CONTEXT_PANEL_TABS.filter(t => t.id !== "history").map(...)
```

This filters only `history`, not by capability level. `ContextPanelHostProvider` explicitly enforces `allowedIds` / `overflowIds` per level and auto-closes any panel not in those sets via an effect. So at L1/browser mode, buttons such as 会议 / 任务包 / MCP / Board (level-restricted) are rendered and clickable; clicking opens the panel, then the provider's `useEffect` immediately closes it — a visible flash and a broken affordance. The nav must use `contextBarTabsForLevel(capabilityLevel)` / `contextBarOverflowTabsForLevel` to gate the resource list, or the auto-close effect is exposed as a regression.

---

## P2 — "最近对话" is not sorted by recency

```tsx
const recent = state.threads.filter(...).slice(0, 30)
```

There is no sort by `last_message_at` / `updated_at`. If `state.threads` is not already ordered newest-first, the list labeled "最近对话" shows arbitrary old threads. The existing full-history TimelineModel treats recency explicitly; the projection must do the same.

---

## P2 — `overflow: hidden` on `.cm-workspace` risks clipping popovers

`.cm-workspace` sets `overflow:hidden`. `SlashCommandPopover`, `AtThreadPopover`, and the ThreadList popup are absolutely positioned overlays that may extend beyond the workspace bounds (the old root had no `overflow:hidden`). If any of these render near the bottom/right edge, they could be clipped. Needs visual verification at 320px with composer popovers open.

---

## P2 — Settings modal stays vertically centered at narrow widths

The backdrop style was changed to `alignItems:"center" / justifyContent:"center"` for all widths. `workspace-styles.ts` styles `.cm-settings-panel` at `@media(max-width:759px)` as a bottom sheet (`border-radius:16px 16px 0 0`, `width:100%`, `max-height:90dvh`), but the backdrop is not reverted to `flex-end`. The result is a full-width centered dialog with bottom-sheet-only corners — a layout mismatch with the declared "narrow dialogs" intent.

---

## P2 — Focus/scroll deep-link may fail even after the P1 action is fixed

The `requestAnimationFrame` chain then queries `[data-settings-section="${label}"] > button`. `SettingsSection` likely sets that attribute to a stable id, not the Chinese display label. If mismatched, the section opens but focus/scroll silently does nothing. Use the section id from `SETTINGS_SECTION_IDS`, consistent with the existing `settingsFocusSection` mechanism.

---

## Non-blocking observations

- `cm-nav-running` is a `<span aria-label="运行中">` without `role="status"` / `aria-live` — the busy indicator will not be announced.
- Navigation drawer initial focus lands on the close button (first focusable), not on 新对话; minor, but could be improved with `initialFocusRef`.
- The composer capsule focus-within `box-shadow` is not `!important` and may lose to the inline `boxShadow` style; `border-color` still carries the focus cue, so not severe.
- Confirmation handler/DOM and toast placement changes are scoped and byte-unchanged as claimed; no confirmation regression found in the packet.

---

## Summary

The redesign is structurally sound (tokens scoped to `tokens.ts`, Modal/unified keyboard behavior retained, no new deps), but the settings category navigation is non-functional as written (P1) and the workspace resources violate existing capability gating (P1). Both must be corrected before merge.