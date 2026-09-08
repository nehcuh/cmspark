# Independent Read-Only Implementation Review — #471 召唤器与设置重设计

**Base**: 4fd4919b (frozen uncommitted changes) · **Scope**: supplied diff + full-file attachments only · **Evidence**: `[inspected]` = static trace of supplied code; `[machine]` = supplied browser/CI results taken as ground truth per instructions.

---

## VERDICT: **APPROVE_WITH_NITS**

No P0 / P1 / MAJOR findings. The implementation satisfies the second-round design gate: stable ids, mounted-but-hidden pages, single persistent save/test bar, 山 removed at all three HTML sites with no replacement icon, chat-consistent summoner surface, license modal lifted out of the hidden tree. All findings below are cleanup/spec-conformance nits; none blocks merge.

---

## What I verified statically

**[inspected] — Navigation state machine (SettingsSlideout.tsx)**
- `selectSettingsPage` is stable (`useCallback([])`), sets `settingsPageChosen` before any async gap, resets `.cm-settings-body` scroll, and focuses `h3` (tabIndex=-1) only when requested. rAF ordering is safe because React flushes the state update before the frame, which the supplied focus assertion corroborates `[machine]`.
- Race handling matches the gate exactly: the `ws.getPairingStatus` callback applies its default (`paired ? "model" : "connection"`) **only** when `settingsPageChosen.current === false`, so deep links and manual picks are never overwritten by a late pairing response. Deep-link effect sets the chosen flag, so it also wins races. Pairing-driven changes deliberately do *not* set the flag, so reopens re-evaluate when the user never picked — consistent with "用户尚未选页时选 connection".
- Deep-link validation uses `SETTINGS_SECTION_IDS`, which now includes `voice`; invalid ids clear focus without side effects. `useComposerVoice` retargets the voice entry to `voice`. `applySettingsIntent` routes all `set_*` + `enable_hotkey_default` to the voice page and leaves `open_meeting`/`open_packs` as settings-exit actions — matches the move table.
- Handler preservation is corroborated twice: the supplied 134→130 AST multiset (removals are exactly the 7 accordion `onToggle` + 1 old nav `onClick`; additions are exactly the 2 status-row navigations + 1 nav `onClick` + 1 select `onChange`), and my diff trace of the moved blocks (voice engine IIFE, whisper model rows, diarize/speaker row, file-upload trio, session-index block, Obsidian export fields, WP5-I4 block) shows verbatim relocation with no dropped controls. `handleSave`/`handleTest`/all arm–confirm–disarm paths in the supplied hooks prefix are byte-identical in semantics.

**[inspected] — Mounted-but-hidden pages (SettingsPage.tsx + wrappers)**
- All 8 pages render inside `hidden={activeSettingsPage !== id}` wrappers. `hidden` removes subtrees from focus, tab order, and the a11y tree without unmounting — exactly what the draft-preservation requirement needs. The machine test's model-draft retention across page/viewport changes is direct evidence `[machine]`.
- Wrappers are plain divs with no author CSS targeting them, so no `display` override can defeat `hidden`. `[inspected]`
- Category order in `SETTINGS_PAGES` (model/voice/export/connection/security/integrations/secrets/experimental) matches the gate; ids are the stable set. `SETTINGS_SECTION_IDS` order differs but is only used for membership. `[inspected]`

**[inspected] — License modal relocation**
- The `licenseDoorShouldOpen` Modal moved from inside the experimental section (previously invisible whenever that accordion section was closed — a latent bug this PR incidentally fixes) to a sibling of the footer, outside `.cm-settings-body`. Its JSX block, handlers, and button order are unchanged in the diff; focus trap/restore via `useModalDialog` is position-independent. This is a correctness improvement, not a relocation risk. `[inspected]`

**[inspected] — Save-scope compliance**
- Footer calls the original `handleSave` (full `config.set` minus the session-only `native_vision_detected` bit) and original `handleTest`; both unchanged. No "取消全部更改" affordance exists. Independent save/confirm buttons (UserEnv, ws-pair, vision test, whisper download/enable, security phrase gates) all remain as original controls — consistent with the gate's "公共保存不替代独立表单" table. No new implicit-write path exists: page switching only mutates local React state. The synthetic-transport assertion of zero `config.set`/`license_response`/`terminal.start` sends across full navigation supports this `[machine]`.

**[inspected] — Summoner 山 removal**
- All three occurrences in the diff removed: header brand span, initial `#empty`, and the `renderMsgs` `innerHTML` rebuild (the last is the historically-missed one; it's covered here). `.mark`/`.mark.sm` CSS deleted wholesale. Empty state now starts with a plain `<strong>${CHAT_SHELL_TITLE_NONE}</strong>` line — no replacement icon. `[inspected]`

**[inspected] — Composer DOM/visual order**
- Attach moved from a `<label for="files">` to a native `type="button" id="attachFile"` wired via `$("attachFile").addEventListener("click", () => $("files").click())`. Programmatic click on the hidden input opens the chooser (machine chooser test passes `[machine]`). The button is a strictly better a11y target than the old label (real focus semantics, Enter/Space). DOM order in `.composer-actions` is attach → mic → send; no `order` properties introduced anywhere, so DOM order = visual order. `#mic{margin-left:auto}` shifts the mic/send cluster right without reordering — legible and within spec ("附件、听写、发送在输入框下"; nothing hidden in menus).

**[inspected] — Settings CSS architecture**
- Single scroll container (`.cm-settings-layout .cm-settings-body{overflow:auto}` inside `.cm-settings-layout{overflow:hidden;min-height:0}`); footer outside the scroll region → persistent single save/test bar. The removed inline `display:flex;flexDirection:column` from the body is correctly superseded by the layout classes; the fact that the supplied 800×700/320×480 assertions (save button inside viewport) pass proves the panel root is a flex column constraining layout `[machine]`.
- No `order` properties remain; keyboard DOM order matches visual order in nav, status row, footer.
- `88dvh`/`94dvh` split at 760px matches the gate; `min(980px, 100vw - 32px)` is valid modern CSS; reduced-motion rules pre-exist and cover the new styles.

**[inspected] — Status row**
- Single DOM node for both breakpoints (`role="status"` + buttons; `:empty{display:none}` gives "无状态不占位"). Uses `isElevatedTrust` only — no new permission predicates. Texts match the gate verbatim. State updates are polite-live, don't steal focus, and navigation focuses the page h3.

---

## Findings (NITs)

| # | Class | Location | Finding |
|---|-------|----------|---------|
| 1 | NIT | `companion/src/settings-web.ts` | Stale comment above `:root` still says "this surface mirrors the dark family" after the light-token switch. Actively misleads future maintainers about the dark-palette ban rationale. |
| 2 | NIT | `workspace-styles.ts` | `.cm-settings-status button{min-height:32px}` and `.cm-settings-assistant summary{min-height:28px}` fall below the gate's "控件>=36px" floor. Both pass WCAG 2.5.8 (24px), so no accessibility defect — but either raise to 36px or record the exemption in the design doc. |
| 3 | NIT | `workspace-styles.ts` / `summoner-web.ts` | Dead CSS: pre-existing `@media(max-width:759px){.cm-settings-categories{...}}` targets a removed class. Also, the new base `.brand{padding:12px 16px}` appears *after* the `@media(min-width:760px){.brand{padding:16px 24px 12px}}` rule; equal specificity + later position = the wide rule is now dead at all widths. If that override is intentional (compact header), delete the dead rule; if not, reorder. |
| 4 | NIT | `settings-sections.ts` | File header doc still describes the accordion ("Settings accordion expand state … compact-ux") while the slideout no longer consumes the open/close helpers. Utilities are intentionally retained per the gate; the comment should state that (legacy/LS-compat) so nobody "cleans them up" and breaks the stated retention decision. |
| 5 | NIT | `settings-web.ts` | h1 and page name are Chinese, but subtitle ("Companion global LLM config — fallback…") and section title ("LLM Config") remain English. The gate mandates 中文页名 + unchanged 表单层级 only, so this conforms — flag for the design pass whether full label localization is wanted. |
| 6 | NIT | `SettingsSlideout.tsx` | `role="status"` already implies `aria-live="polite"`; the explicit attribute is harmless duplication. |
| 7 | NIT | `SettingsSlideout.tsx` | Status-row button for "尚未配对" is rendered even when the user is already on the connection page (and likewise elevated-trust on security); clicking navigates to the current page and yanks focus to the h3. Benign, slightly noisy; could hide when the target page is active. |
| 8 | NIT | `workspace-styles.ts` | Newly referenced tokens `tokens.navSelected`, `tokens.actionPrimary`, `tokens.bgHover` are outside the supplied scope, so I couldn't confirm their existence `[assumed]`. Template-literal interpolation won't fail the build if one is missing — the declaration would silently drop (e.g., no selected-nav highlight; `aria-current` still carries semantics). One grep to confirm. |
| 9 | NIT | `SettingsPage.tsx` / panel header | Heading hierarchy is flat: the panel title ("设置") and every page title are `h3`. Pre-existing pattern, worth a dedicated pass later if heading structure matters to the SR strategy. |

**Verification note (not a finding)**: with all 8 pages now always mounted while settings is open, any pre-hidden block that installs *mount-time* listeners is exposed more often than under the accordion (e.g., `HotkeyCaptureField`). The moved content in the diff is event-driven JSX with no mount effects, and `HotkeyCaptureField` is pre-existing, but a one-line confirmation that it (and the WP5-I4 IIFE) only react to focus/events, not window-level capture on mount, would close the last gap `[assumed]`.

---

## Scope discipline check (re-confirmed)

- No permission defaults, confirmation phrases, protocol gates, or Agent-execution semantics changed — arm/disarm paths and phrase literals are intact in the supplied hook prefix.
- settings-web remains a global-model-only surface; no endpoint or permission scope expanded (variables/labels only).
- No native (Swift) surface touched; no claim made about native UX.
- 山 removal is restricted to the three HTML sites + their CSS; the user's stated full-source search is consistent with the supplied diff `[assumed]`.

## Closing

Implementation is mergeable on its own merits. The machine evidence (1281/0 extension, companion suite green, real-page layout matrix, no-implicit-write, summoner transport tests) covers the load-bearing claims, and the static trace found no semantic drift. The 9 NITs are cosmetic/documentation — none affect trust boundaries or correctness. The ongoing design re-review stands as the separate gating track, as scoped.

**VERDICT: APPROVE_WITH_NITS.**
