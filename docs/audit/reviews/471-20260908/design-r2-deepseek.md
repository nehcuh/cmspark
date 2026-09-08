**DESIGN RE-REVIEW #471 — VERDICT**

_Read-only packet review of the supplied frozen design doc; no repo inspection or execution (no code invented). Axes: Spec = close/retain of the five first-round concerns; Standards = repo conventions (Issue-first, scope discipline, token reuse, execution-verified gates). All claims `[inspected]` from the packet._

## Disposition

| # | First-round concern | Verdict |
|---|---|---|
| 1 | Trust strip: placement/content/live/focus/modal reachability | **CLOSE** — 2 micro-notes |
| 2 | Save-scope composition | **CLOSE** |
| 3 | Complete IA / stable IDs / migration / voice setters | **CLOSE w/ 1 condition** + 3 notes |
| 4 | Nav a11y | **CLOSE** — 1 micro-note |
| 5 | Concrete visual contract | **CLOSE** — 1 note |

**No retains.** Details:

**1. Trust strip — closed.** Three-state copy (detecting / unpaired / elevated), no-status = no placeholder, same DOM 320↔1440 with narrow wrap, polite live region that never steals focus, buttons that switch category + focus the page title, modal confirmations lifted outside the content area with original order/handlers/focus trap intact, and `isElevatedTrust` reused (no new permission logic). Micro-notes:
- `role=status`/`aria-live=polite` on a container holding interactive buttons is a pattern smell (status implies static content; button labels get folded into polite announcements). Fix: put the live region on a span wrapping only the copy; buttons as siblings.
- State the old header "安全标识" badge's disposition — retained alongside the strip, or removed as subsumed (the verification list still references it).

**2. Save scope — closed.** The four-way partition is complete and preserves original semantics: global `handleSave` (single call, full `state.config`), page-independent `handleTest` on current draft model/vision, immediate handlers for voice/shortcut prefs with explanatory page notes, independent per-form saves retained, permission flow untouched, explicit refusal of a false "save all independent forms" and of "cancel all changes". Keep-mounted hidden pages genuinely preserve drafts; no unmount boundary leaks. Note only: boundaries are block-level — implementation should run a field-level checklist against original `state.config` keys to confirm no voice/shortcut field persists via `handleSave`.

**3. IA/IDs/migration — closed with one condition.** Table is sound: 7 stable ids + `voice` (new), `export` carrying the 文件与知识 display name, block-level ownership unambiguous where original ordering defines boundaries ("发送快捷键起，到 Context Window 前"), the pairing-callback race resolved by explicit-selection-wins, `useComposerVoice` deep link rerouted to `voice`, meeting/scene intents still exit settings.
- **Condition:** the "自主度" control's destination is ambiguous. Integrations row says the section below it now "clearly points to security"; security row's enumeration (arm/disarm/phrases/warnings/whitelist) doesn't include autonomy. State explicitly: (a) stays in integrations with clarified pointer, or (b) moved to security and add it to security's row. One sentence; don't implement from inference.
- Notes: (i) old sub-anchor deep links (model-page scroll targets) degrade to category-level selection — say so; (ii) configure-vs-operate intent split for voice ("听写设置" → voice; "开始听写" → operate/exit) should be pinned for the intent classifier; (iii) clarify whether "组件会话内" category persistence = React mount or app session (affects reopen behavior next to the pairing auto-select rule).

**4. Nav a11y — closed.** Buttons + `aria-current=page` (deliberate non-tablist choice, valid), focus-to-h3 on activation with scroll reset, native labeled select at <760 with focus retention, hidden pages out of Tab order, CSS `order` abolished (DOM = visual), persistent bottom bar, 88/94dvh. Micro-note: at narrow widths focus stays on the select and the page change is unannounced — add a polite live region (or announce the h3) on category change to match wide-width behavior.

**5. Visual contract — closed.** Concrete tokens: full summoner palette (contrast spot-check: #666/#4f46e5 on #fff/#f7f7f5 ≈ 5.7–5.9:1, passes AA), typography, radii, ≥36px controls, nav width, dialog heights, viewport matrix, empty-state copy pinned to `CHAT_SHELL_TITLE_NONE`, and the testable commitment that the mountain exists at exactly three source positions — all removed, no other loading/error icon path. Note: values must be **derived from the chat's actual token source** (mirror, not duplicated literals, to prevent drift), and dark-mode disposition should be stated (mirror-and-defer vs explicit light-only — silent drop would be a regression if dark existed).

**Standards axis — PASS.** Issue-first (`GitHub: #471`, gate supplement), no scope creep (settings-web self-limits; `isElevatedTrust` reused; no new permission logic), tokens reused, all security/confirmation boundaries held, verification matrix is execution-based (4 widths + short screens, draft retention, deep links, real summon HTML over isolated transport, production build, full suites, Grok4.6 + DeepSeekV4Pro re-review) — consistent with repo discipline.

## Final

**APPROVE to proceed to implementation — zero retains.** All five first-round concerns are closed; carry the single condition (autonomy destination) and the micro-notes into implementation without reopening the design. The verification matrix — especially drafts-across-switch, voice/old deep links, and mountain non-regression — is the correct final gate.
