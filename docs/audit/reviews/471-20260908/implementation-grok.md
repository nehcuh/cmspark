I'll read the packet and follow its review instructions exactly.The packet is long; I’ll keep reading the rest of it before reviewing.I’ll scan the packet for new files and the non-moved diffs so the review stays on actual changes.The remaining pages, license modal, summoner HTML, and tests are the parts I still need.Checking a few remaining structural details in the packet: composer markup, footer disabled styles, and whether the intent bar change is specified.# Independent implementation review · #471

**VERDICT: APPROVE_WITH_NITS**

Scope is presentation/IA only. I did not execute builds or the browser scripts; machine evidence in the packet is taken as given, not re-run. This is not design approval.

## Outcome and trajectory

This is a real IA change, not a palette restyle.

- Settings: accordion + `order` → named pages, one visible page, hidden siblings still mounted, public status row, public save/test bar, license `Modal` lifted out of the hidden tree.
- Summoner: three `山` marks removed and not replaced; composer is textarea then actions; meeting/browser stay as outline controls under the field.
- Trust: no new permission predicate; `isElevatedTrust` reused; security phrase UI stays on the security page; handlers in the supplied AST inventory match the “8 accordion/nav out, 4 nav in, form/permission handlers retained” claim **[inspected]**.

That matches the written spec’s spine. Leftovers below are why this is not a clean APPROVE.

## P0

None **[inspected]**. No new arm/disarm path, no implicit `config.set` in the supplied UI tests, hidden wrappers do not unmount children, license dialog is no longer a descendant of `hidden`.

## P1

**P1-1 · Summoner composer still has leftover chrome beside/after the specified control set**

Spec: header keeps 历史/新对话; field is textarea, then 附件 → 听写 → 发送 in real DOM order.

Supplied markup still has `#newThreadBar` as a **sibling** of `.field` in `.composer-row`, and `composer-actions` still contains the chevron control and hidden settings **after** `#sendGo`:

```2741:2766:/private/tmp/cmspark-471-implementation/packet.md
    <div class="composer-row">
      <button class="icon-btn" id="newThreadBar" ... aria-label="新对话">
      ...
      <div class="field">
        <textarea id="text" ...>
        <div class="composer-actions">
      <button ... id="attachFile" ...>
        <button ... id="mic" ...>
        <button ... id="sendGo" ...>
          <!-- chevron button remains -->
        <button ... id="settings" ... hidden ...>
        </div>
```

`#mic{margin-left:auto}` then packs mic/send/chevron to the trailing edge, so the visible action row is not the specified three-control set **[inspected]**.

The summoner script only checks `#empty` has no `山`, no `.mark`, and `field.y + height <= send.y`. It cannot see a left-side 新对话 or a control after Send. Header already has 新对话, so the bar is duplicate chrome — the same class of leftover the previous pass was rejected for.

Fix: remove `#newThreadBar` from the composer (header already has it), and keep expand/settings out of the attach/mic/send row (or after the field, not after Send).

## MAJOR

**M-1 · `SettingsIntentBar` always-on → collapsed `<details>`, not in the spec**

```274:274:/private/tmp/cmspark-471-implementation/packet.md
<details className="cm-settings-assistant"><summary>用一句话调整设置</summary><SettingsIntentBar ... /></details>
```

Previously it was a first-class block (`order: 0`). The design text never asked to hide voice/text settings commands behind a disclosure. `summary` is also `min-height:28px`, below the 36px control floor. Discoverability regression **[inspected]**.

**M-2 · 文件与知识: notes-export block has no subheading**

File upload gets `文件上传`; session index keeps `会话索引（标签 / 要点）`; the vault/export fields after the divider start at `笔记库路径（可选）` with no 笔记导出 heading. Spec asked for clear subtitles on grouped controls **[inspected]**.

**M-3 · Control-size spec only applied to the new chrome**

Nav 40px, footer/input/select 36px. Status chips are 32px; assistant summary 28px; in-page actions keep old `toggleBtn`/`secondaryBtn` padding. Spec: 控件>=36px **[inspected]**. Not a trust issue; it is an incomplete application of the same visual contract.

## NIT

1. **Export-include-reasoning stays on 模型与推理** next to 思考过程展示, not with 文件与知识. Spec put 笔记导出 on the files page. Borderline grouping **[inspected]**.
2. **Context-window overflow help** remains *after* the vision block, detached from the token field that moved up **[inspected]**.
3. **`role="status"` wraps native buttons.** Spec asked for this, so it is spec-correct; ARIA `status` is a poor parent for interactive controls (live announcements + buttons). Prefer text in the live region and buttons beside it **[inspected]**.
4. **Mobile category naming duplicated:** visible `<label>设置分类` plus `aria-label="设置分类"` on the select. Some SRs will say it twice **[inspected]**. Desktop/mobile mutually `display:none` is otherwise correct.
5. **Page heading + badge are not grouped.** `h3` is block; badge is a following sibling with no flex on `.cm-settings-page-heading` **[inspected]**.
6. **settings-web:** h1 is 中文, subtitle/section titles remain English; comment still says the surface “mirrors the dark family” after the tokens went light **[inspected]**.
7. **Dead CSS:** `.cm-settings-categories` remains in the old `max-width:759px` rule **[inspected]**. Accordion helpers in `settings-sections.ts` kept on purpose — fine.
8. **Footer `button:last-child { background: actionPrimary !important }`** can override disabled save chrome. DOM order (test then save) is otherwise correct; `order` is gone **[inspected]**.
9. **Unpaired first paint:** default page is `model` until `ws.getPairingStatus` returns, then it may jump to `connection` if `settingsPageChosen` is still false. Spec allows that; expect a one-frame flash **[inspected]**.

## What holds (do not re-litigate)

| Requirement | Evidence |
|---|---|
| Stable ids + `voice` added; old deep links keep the same id; composer voice opens `voice` | `SETTINGS_SECTION_IDS`, `SETTINGS_PAGES`, `useComposerVoice` **[inspected]** |
| Deep link / manual choice not clobbered by late pairing | `selectSettingsPage` sets `settingsPageChosen`; pairing uses `setActiveSettingsPage` only when the ref is false **[inspected]** |
| Hidden pages stay mounted; tab exclusion via `hidden` | wrappers `hidden={activeSettingsPage !== id}` **[inspected]** |
| Desktop nav `aria-current="page"`, focus `h3[tabIndex=-1]`; mobile select does not steal focus | nav `focus=true`, select `focus` default false **[inspected]** |
| Status copy, `isElevatedTrust`, empty status collapses (`:empty`) | matches 门禁 text **[inspected]** |
| License `Modal` outside hidden page, same `licenseDoorShouldOpen` gate | JSX after layout close, before footer **[inspected]** |
| Public save/test call original `handleSave` / `handleTest`; per-form buttons kept | footer label change only **[inspected]** |
| `山` only in the three HTML sites, all removed | header, initial empty, `renderMsgs` empty **[inspected]** |
| settings-web does not grow an eight-category fake | theme + h1 only **[inspected]** |

Machine packet: extension production + 1281/0, companion production + tests, React 320/390/800/1440 × 8 pages, draft retention, deep-link focus, safety badge, no implicit writes, summoner HTML/SSE checks **[assumed — not re-executed]**.

AST 134→130 does **not** certify layout; the summoner leftover is exactly that gap.

## Non-claims

- Not a design sign-off (packet says re-review is separate).
- Native Swift/app UX not certified.
- No live config, installed app, or account was used in the supplied checks.

**Merge stance:** presentation/trust boundary is sound enough to merge *after* P1-1 (composer leftovers). M-1 and M-2 should be fixed in the same pass if the bar is “not another superficial chrome diff.” I would not block on the NIT list.
