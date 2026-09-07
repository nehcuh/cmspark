I'll read the packet first and follow its review instructions independently.The packet is long; I’ll keep reading so the review follows the full instruction set.**VERDICT: REJECT**

Implementation gate, not visual taste. Machine green / prior design locks do not clear the P1s below.

---

### P1 — Nav drawer overlays pending confirmation and Stop

`WorkspaceFrame` mounts navigation as a full-viewport `Modal` (`position: fixed; inset: 0; z-index: 10060; aria-modal`).

Consequences while the drawer is open (the normal Side Panel width is `< 760px`):

- FocusBand confirmation is covered and not in the tab cycle (`useModalDialog` traps Tab/Escape on the overlay and `stopPropagation`s Escape).
- Composer Stop is covered and unreachable.
- AT: `aria-modal="true"` hides the live confirmation from the rest of the page.

This is new chrome, not a token-only restyle. Contract: pending confirmation and Stop stay visible; layout must not change trust UX; do not overlay pending confirmation. Settings already sat above the band (z-index 200); this makes a **frequent** control (thread switch / 新对话, including 运行中 rows) do the same.

Fix: non-modal drawer, or scrim/panel that starts **below** FocusBand with confirmation/Stop at a higher z-index and **not** `aria-modal`’d away. Handlers/DOM of confirmation must stay untouched.

---

### P1 — Readable conversation column is dead CSS in this freeze

`workspace-styles.ts` implements the 760px+ contract only if these classNames exist:

- `.cm-chat-content` / `.cm-composer-dock` → `max-width: 780px`
- `.cm-chat-scroll` → wide padding
- `.cm-history-panel` / `.cm-history-group` → history keyboard/focus

In the frozen files, only `ComposerDock`, StatusRail, App capsule, settings, and the context **host** wrapper get `cm-*` classes. **ChatView, ThreadList, HistoryPanel are not in scope and receive no className.** The `cm-` prefix is new; if those files were not changed after base `8656df94`, the primary layout goal (usable 1440px, max 780px conversation) is unimplemented. History focus rules never attach.

That is a merge-blocking completeness defect against the listed evidence surfaces, not a polish nit.

---

### P2 — Resource nav ignores capability gating

```ts
CONTEXT_PANEL_TABS.filter(t => t.id !== "history")
```

Provider still uses `contextBarTabsForLevel` / overflow and **closes** disallowed panels in an effect. Nav uses `openPanelForce` with no level filter.

Ineligible items are first-class 36px buttons that flash-open then collapse, and overflow-only tools are promoted to the same grid as 知识/场景. Not a backend policy change; it is a broken/misleading affordance and extra `loadPanelData` calls.

---

### P2 — Short layout: composer grew, confirmation still not a higher priority than chrome

Capsule is now a column (`flexDirection: "column"`, actions row `min-height: 36px`, extra padding). Minimum composer chrome is roughly ~2× the old 52px row. Short-height CSS only trims dock padding. Contract: only the message list shrinks; if confirmation competes, **supporting context** yields. A taller dock plus 36dvh/360px context cap can still squeeze the transcript before anything yields to FocusBand.

---

### P2 — Other concrete gaps

| Issue | Evidence |
|---|---|
| 导航 has no `aria-expanded` / `aria-haspopup="dialog"` | StatusRail toggle is a fire-and-forget `Event` |
| Active context tab not shown in nav | Design: selected nav = text + background; only threads get `aria-current` |
| Task tooltip ≠ title | `title={…alias \|\| "新对话"}` vs `displayThreadTitle(...)` |
| Settings-from-⋯ does not `closePanel()` | Only the nav 设置 button does; contract: close supporting panels before configuration |
| Settings category jump is copy-coupled | `querySelector('[data-settings-section="${label}"] > button')` with a hardcoded Chinese list parallel to `SETTINGS_SECTION_IDS` |
| 「最近对话」 is `filter` + `slice(0, 30)` with **no recency sort** | Lies if store order ≠ last_message_at |
| `.cm-workspace { overflow: hidden }` wraps the whole app | Absolute header/composer menus can clip; settings/nav are `fixed` so they survive |

---

### NIT

- Duplicate `.cm-settings-categories` block inside `@media (max-width: 759px)` (second wins).
- Triple `threads.find` for the same title.
- `onNavigate={() => {}}` on the wide nav.
- Possible unused `IconNewChat` / `createBlankThread` in StatusRail (tsc passed, so either still used in ⋯ or `noUnusedLocals` is off).
- Resource grid 2×N at 220px will ellipsize the required text labels.

---

### Checked and not blocking

- No new production deps in scope; T3/L2 auto-open Cockpit, `handleStop`, attach `l2_task` disable, confirmation files absent (handlers/DOM not in this freeze).
- Toast host moved **after** FocusBand (correct direction vs rail covering confirm).
- 759/760 JS and CSS match; wide nav 220px; drawer vs persistent split is right.
- 新对话 removed from StatusRail and owned by `WorkspaceNavigation` + existing `createBlankThread` / `thread.select` / store.
- History still `ThreadList` in the rail; nav filters `history`.
- Settings still one `Modal`; close control is `type="button"` with a name.
- Focus ring / 32–36px targets on new nav controls; reduced-motion kill switch present.
- Send uses `tokens.actionPrimary` (charcoal action vs indigo focus) — allowed token consumer.

---

**Merge bar:** fix P1 drawer vs confirmation/Stop, and actually attach the conversation/history classNames the CSS was written for (or drop the dead rules and put the 780px wrappers on ChatView in this freeze). Then re-run the synthetic 320/759/760/short/confirmation+drawer keyboard matrix; do not treat the current 1281 + 1440 pass as covering those two holes.
