All verification complete. Summary of what I independently confirmed:

**S2.6 fix (the two prior REJECTs):**
- `styles.inviteRow` (ChatView.tsx:1701–1716) has **no `color` key** — only layout/font fields. ✓
- `.invite-row` CSS (ChatView.tsx:1490–1499) owns base `tokens.text`, hover/focus-visible `tokens.accentText`, and focus ring. With no inline `color`, `.invite-row:hover` now genuinely wins (specificity no longer overridden). ✓
- S2.6 test asserts both `.invite-row:hover` exists and `!/color:/` in the `inviteRow:` style block — it directly catches the exact regression that caused both prior REJECTs. ✓
- Main `npx tsc --noEmit` in `chrome-extension/` → **exit 0**. ✓
- `npm test` → **715 pass / 0 fail**. ✓
- Patch matches live working tree at HEAD `b3f1098` (git diff --stat agrees file-for-file). ✓

**C″ D″ 急停 `createBlankThread`:** `config_override: {}` (no DeepSeek stamp, no trust stamp), `tool_whitelist: null`, `active_skill_ids: []` — matches the established `config_override: {}` inherit-live-config pattern in `useWebSocket.ts:1013/1052`, and consumers fall back to `state.config.*` on empty override (App.tsx:889–894). Trust monotonicity holds (actually a tightening vs. the old DeepSeek/empty-key stamp). ✓

**ADR-020 checklist:** Capability declaration present in the s12 prompt (Surface L0 Panel chrome, L2-classes none new, Compose 装配 entry chrome only, Autonomy Board /board only, Trust settings discoverable + 急停 not buried, Channel unchanged). No new confirmations, no originWs-touching `request()` changes, no new runtime, no experimental layers. FocusBand `hasThreadMessages` change is display-only — confirm/急停 still win on empty L1 (tested in focus-band-priority.test.ts S1.1). ✓

Nits (non-blocking):
1. S2.6 test is still a source-text grep rather than a computed-style DOM test — now that the inline `color` is gone it correctly guards the regression, but a real hover computed-style pin would be stronger.
2. "Circular up-arrow send" — the send button is circular, but the IconSend glyph is a plain up-arrow with no circle element (cosmetic, previously flagged).

VERDICT: APPROVE_WITH_NITS
