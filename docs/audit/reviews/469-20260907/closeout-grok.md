I'll start by reading the closeout packet and following only its instructions.The packet is a read-only delta review. I’ll inspect the freeze, the listed files, and the Escape/context handlers before judging P1/N1–N3.HEAD is the freeze; I’ll now read the Escape handlers, context panel, and tests against the claimed P1/N1–N3 fixes.I’ll verify the context Escape listener phase, the search input type, remaining blur/aria nits, and the new tests.**VERDICT: APPROVE**

No new P0 / P1 / MAJOR.

**P1 Escape-history-plus-context — CLOSE.**
History’s document `keydown` now `preventDefault` + `stopPropagation` after a hit, and the listener is limited to history / trigger / portaled menu. Context’s handler is window-bubble with no capture, so a history hit never reaches `setActivePanel(null)`. Context still skips `INPUT`/`TEXTAREA`/`SELECT`, which is extra belt-and-suspenders for search, not the row case. Harness: focus the history row, Escape, assert history gone and context still visible (`test-workspace-ui.py`). Search Escape after menu close is the same retention check.

**N1 residual Webkit blur — CLOSE.**
`WebkitBackdropFilter` removed from `ThreadGraphApp` `glass`. No remaining `WebkitBackdropFilter` / `backdropFilter` / `backdrop-filter` in app TS/CSS. Surface was already opaque (`tokens.darkElevated`); the filter was inert.

**N2 global Escape with menu open — CLOSE.**
Early-return no longer uses `menuOpenRef.current` as a global latch. Escape is consumed only if the target is in `historyRef`, the trigger, or `historyMenuRef`. Composer Escape with the overflow menu open leaves the menu up; focusing a menu item then Escape closes only the menu. `menuOpenRef` is still the inner layering bit (menu vs history) and is updated in an effect; that is not the old global consume.

**N3 one-way aria-pressed — CLOSE.**
Resource tabs use `aria-current={active ? "true" : undefined}` (attribute omitted when idle). CSS is `.cm-nav-item[aria-current="true"]`. These are current-item selectors, not toggles. Settings is unchanged and was not this nit.

Confirmation code is outside this delta. Autofocus now queries `input[type="search"]`, matching the real control; the fixture waits for that focus.
