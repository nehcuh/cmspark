All verification complete. Summary of the review:

## Fix verification — S2.6 (the round-2 blocker)

- **`styles.inviteRow` (ChatView.tsx:1701-1715)** — no `color` key at all; only layout/typography properties remain `[inspected]`. JSX applies it plain (`style={styles.inviteRow}`, no spread override).
- **`.invite-row` CSS (ChatView.tsx:1490-1499)** — owns rest (`tokens.text`), hover + focus-visible (`tokens.accentText`), and the focus ring. With the inline declaration gone, the `:hover` rule (same specificity, later in sheet) now wins the cascade — S2.6 is alive at runtime, not just on paper.
- **Test `S2.6 inviteRow color lives only in CSS so hover can win`** (companion-canon-s12.test.ts:32-39) — slices the real source block and asserts `!/color:/` — meaningful guard, passes `[executed]`.

## Machine gates

- `npx tsc --noEmit` in `chrome-extension/` → **exit 0** `[executed]`
- `npm --prefix chrome-extension test` → **715 pass / 0 fail** `[executed]` (matches claim; up from 714 via the new S2.6 test)

## Carry-over claims still hold

- **C″** `[inspected]` — rail renders gear + 新对话 + 历史 + ModeBadge whisper + conn dot in both empty and work; `hasMessages` only gates ⋯ menu export items (StatusRail.tsx:318-365), no costume dump.
- **D″** `[inspected]` — `empty-state-copy.ts`: L0 has no operate-the-tab claim and no 「随便聊」； L1 is page-task; 装配 rows carry human gloss.
- **急停 / S1.1** `[inspected + tests executed]` — `focus-band-priority.ts:78-88`: `showL1Context` gates the strip; confirm branch keeps `secondaryAbort` untouched; S1.1 tests assert confirm wins and abort shows under L2.
- **`createBlankThread` / Trust** `[inspected + test executed]` — `config_override: {}`, no DeepSeek stamp; S2.1 passes.

## ADR-020 checklist

Pure UI resurface of already-declared capabilities: no new tools, gates, runtimes, or confirm families; Board stays `/board` (ComposeDrawer dead link removed); `trustStatusChipShort` is display-only with full detail retained on title/aria and disarm path intact; no `securityConfirmations.request`/originWs surfaces touched. Declaration ruled present and honest in the prior round; the only delta since is the one-line S2.6 fix + test. Items 1-7 pass or N/A.

## Non-blocking nits (carry-over, unchanged)

- Legal line `tokens.textMuted` (#a3a3a3) @11px on white ≈2.5:1 contrast — below WCAG 4.5:1 (App.tsx styles.legal).
- Attach hide-gate omits `!voice.listening` (App.tsx InputArea) — attach button can stay hidden while dictation is active on an empty composer.
- Send-at-rest `#e4e4e7` with white glyph ≈1.6:1 — intentional disabled look, but a darker glyph would help.
- `inviteRowCSS` injects a document-global `<style>` — matches the existing `markdownCSS` pattern, so consistent, but unscoped.

The claimed fix is exactly what shipped: blocker removed at the root (inline key deleted, not just deduped), all five claims verified by execution, no regressions in the carry-over set.

VERDICT: APPROVE_WITH_NITS
