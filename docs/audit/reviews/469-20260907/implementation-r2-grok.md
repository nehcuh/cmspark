I'll read only the specified packet and follow its review instructions.The packet is long; I’ll keep reading the rest of the review instructions and diffs.# Independent re-review — #469

**Verdict: APPROVE_WITH_NITS**  
**Severity: nits only** (no remaining P0/P1; no trust/policy regression in this packet)

Evidence is from this packet only. UI-harness assertions are treated as claimed `[executed]` in the bundled tests; I did not re-run them. Full extension/companion suites are **not** in evidence — per the packet, do not assume a final pass.

---

## Prior blockers

### 1. Navigation modal obscures gate/Stop — **CLOSED**

Narrow nav is an in-flow sibling, not an overlay: `role="dialog"` + `aria-modal="false"`, no scrim, no focus trap. CSS caps it at `max-height: 28dvh` with `overflow: auto`.

```1481:1486:/private/tmp/cmspark-469-finalreview/packet.md
    {!wide && open && <div ref={navRef} className="cm-navigation-disclosure" role="dialog" aria-modal="false" aria-label="工作区导航" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close() }
    }}>
      <WorkspaceNavigation onNavigate={close} onClose={close} />
    </div>}
    <main className="cm-workspace-main" aria-label="对话工作区">{children}</main>
```

```1564:1564:/private/tmp/cmspark-469-finalreview/packet.md
@media(max-width:759px){.cm-workspace{flex-direction:column}.cm-navigation-disclosure{flex-shrink:0;max-height:28dvh;overflow:auto;border-bottom:1px solid ${tokens.border}}...
```

Harness hit-tests 允许 / 拒绝 / 停止 and composer 停止本轮 with navigation **open** at 320×480 via `elementFromPoint`. That closes the original overlay-occlusion defect.

### 2. Conversation/history classes missing — **CLOSED**

Both diffs are in this packet:

- ChatView: `cm-chat-scroll` + `cm-chat-content`
- ThreadList: `cm-history-panel`
- workspace CSS: max-width 780 on `.cm-chat-content`, wide padding on `.cm-chat-scroll`, `.cm-history-panel{max-width:720px}`

### 3. `OPEN_SETTINGS_SECTION` absent / label selectors wrong — **CLOSED**

Jump nav dispatches canonical ids (`security`, …) and focuses `[data-settings-section="${label}"] > button`. That matches `SettingsSection` (`data-settings-section={title}`) and the real reducer (`settingsOpen: true`, `settingsFocusSection: action.section`). Harness clicks 安全与信任 and asserts `aria-expanded=='true'`.

### 4. Capability filtering flash-close — **CLOSED**

`contextBarTabsForLevel` ∪ `contextBarOverflowTabsForLevel` covers every `CONTEXT_PANEL_TABS` id at chat / browser / computer. Host only auto-closes when an id is in **neither** set, so nav `openPanelForce` cannot flash-close. History is omitted from **presentation** only (`t.id !== "history"`); that is grouping, not a permission bypass. Selected resource uses `aria-pressed`.

### 5. History chevron dead — **CLOSED**

Month / day / 今天 / 昨天 chevrons sit inside `<button type="button" className="cm-history-group" aria-expanded=…>`. Wrapper `onClick` on those headers is gone.

### 6. Escape closes history + context — **CLOSED**

History registers a document `keydown` that `preventDefault()` + `stopPropagation()` when the event is inside the panel, on the trigger, or while the overflow menu is open. Document bubble runs before window bubble, so the Host window listener does not also collapse context. Overflow menu is dismissed first via `menuOpenRef`. No confirmation handler is in the diff.

---

## Other claimed fixes (spot-checked)

| Claim | Evidence |
|---|---|
| Recency sort | `threadRecency(b).localeCompare(threadRecency(a))` |
| Single title resolver + tooltip | `displayThreadTitle` in rail and nav; `title={…}` |
| Noninteractive row/card wrappers | Thread row `onClick` removed; tool card `cursor:default`, named disclosure button |
| Stale empty copy | `可从导航创建新对话` |
| Terminal header class / 36px | `.cm-terminal-header`; `button{min-height:36px}` |
| Narrow settings bottom-aligned | `@media(max-width:759px){.cm-settings-panel{align-self:flex-end;…border-radius:16px 16px 0 0}}` |
| Settings closes context centrally | Host `useEffect` on `state.settingsOpen`; nav 设置 also `closePanel()` |
| `aria-expanded` on 导航 | `trigger.setAttribute("aria-expanded", String(!wide && open))` |
| Stronger focus ring | `outline:2px solid ${tokens.accent}; outline-offset:3px` |
| Toast below confirmation | ToastHost moved under FocusBand |
| Coding overlay vs rail | `--cm-status-height` + ResizeObserver; fallback `0px` |
| Companion capture/settings | style-block-only; harness strips `<style>` vs `8656df94` |
| Confirmation policy | No confirmation component/handler/policy files in the packet. Cockpit `confirmElevated` is a background token only. |

Layout vs trust: 760px persistent 220px nav; 759px disclosure; new-thread owned by WorkspaceNavigation; header title uses existing resolver; context cap `min(36dvh,360px)` / `28dvh` below 560px; tokens remain the color owner; no new production dependency.

---

## Remaining nits (not blockers)

1. **导航 name vs state.** `aria-label` stays `打开工作区导航` while open. `aria-expanded` is set; the accessible name is still wrong for the close half of the control.
2. **Opening nav moves focus** into the disclosure even if a confirmation alertdialog is up. Hit-testing still passes; a keyboard user who opened 导航 must Escape the disclosure first. Visibility/priority of FocusBand is preserved.
3. **In-flow disclosure sits above `<main>`**, so it appears above StatusRail rather than under the 导航 control. Unusual, not occluding; already covered by the 320×480 matrix.
4. **ThreadGraph** still sets `WebkitBackdropFilter: "blur(12px)"` after removing `backdropFilter`. Background is opaque `tokens.darkElevated`, so this is dead styling.
5. **Settings category chips** have no `aria-current` / `aria-pressed`.
6. **Resource `aria-pressed`** on `openPanelForce` (non-toggle). Pressed means “this panel is showing,” not “click to unpress.”
7. **Noninteractive thread wrapper** still has `aria-label={accessibleName}` while the inner control already names 打开/选择/已删除. Extra generic region for SR.
8. **Cockpit confirm surface** still uses hardcoded `border: 1px solid #7f1d1d` next to `tokens.darkDangerBg`.
9. **settings-web `--faint`** now equals `--muted` (`#94a3b8`). Contrast is better than `#64748b`; hierarchy is flatter.

None of these change confirmation roles, order, timeout, whitelist, or auto-approve copy.

---

## Verification caveat (not a code defect)

Packet: App harness PASS (including latest functional fixes, before a later title/context cleanup); capture/settings presentation PASS; terminal UI PASS before header-selector cleanup; **final extension/companion builds and full suites underway**.

This verdict is on the implementation in the packet, not a CI-green certificate. Native Swift/Windows chrome remains uncertified, as designed.

---

## Closed / retained summary

| Prior blocker | Disposition |
|---|---|
| Nav modal vs gate/Stop | **CLOSED** |
| Missing chat/history classes | **CLOSED** |
| `OPEN_SETTINGS_SECTION` / selectors | **CLOSED** |
| Capability flash-close / invented bypass | **CLOSED** |
| Dead history chevron | **CLOSED** |
| Escape closes history+context | **CLOSED** |

**APPROVE_WITH_NITS.** Safe to merge from this packet’s product/a11y/trust surface; land the nits opportunistically; do not treat this as a substitute for the in-flight full test run.
