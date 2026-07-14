# Morning Check — NotebookLM Import v1 (Handoff)

**Branch**: `worktree-notebooklm-import` (in worktree `.claude/worktrees/notebooklm-import`)
**Commit**: `2c7481f feat(notebooklm): import current page as Markdown for NotebookLM`
**Status**: ✅ Ready for review. Not pushed (per auto-mode policy; user to push).

## What was built

Side panel 📓 button → extracts current tab → Markdown `.md` download → user drags into NotebookLM. v1 is the **download path only** — no auto-upload, no PDF, no right-click, no LLM tool. Those are deferred to v1.1 with explicit rationale (see ADR-011).

## Decision trail (all 3-way, all logged)

1. **Round 1 — Design** (Claude + Kimi + Claude-as-Pi-substitute): scope, extraction layer, PDF vs MD, security. Consensus on 6/7; Pi-sub dissented on PDF (won on cookie-bleed + per-site-print-CSS grounds). MD-only v1.
2. **Round 2 — Implementation plan adversarial review** (both Kimi and Pi-sub): `approve-with-changes`. Switched X→Z (extension-only), caught DOM-mutation bug, added try/finally, recommended Readability (deferred).
3. **Phase 4 — Independent code review** (Agent subagent + fresh Claude CLI session, both isolated): FIX → all Critical/Major addressed.
4. **Phase 5 — Kimi gate**: `approve-with-changes`. Two nits — fixed one (ms filename), deferred one (setTimeout unmount cleanup, cosmetic).

## What's green

- `chrome-extension`: 93/93 tests, `tsc --noEmit` clean, `plasmo build` succeeds
- `companion`: 912/912 tests (untouched; regression check)
- E2E sanity (no browser automation overnight): real Plasmo docs page → markdown-builder → 11/11 structural assertions

## What's NOT verified (manual check needed)

- Real Chrome load + click button + verify `.md` download + drag into NotebookLM
- Behavior on hostile pages (Substack paywall, SPA shadow DOM, canvas-only)
- Behavior on `chrome://` and `file://` (handler rejects with friendly error)
- Truncation banner UX (need a >200k-char page)

To verify:
```bash
cd /Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import/chrome-extension
npm run build   # produces build/chrome-mv3-prod/
# Load unpacked in chrome://extensions
```

## Worktree-specific notes

- `node_modules` symlinks (chrome-extension, companion) point to the main repo — they're gitignored and not committed
- Decision logs and ADR-011 are committed to the worktree branch under `docs/decisions/` and `docs/adr/`

## If you want to push

Per global memory `git_push_classifier_blocked.md`: auto-mode blocks `git push`. Run from terminal:

```
! cd /Users/huchen/Projects/cmspark/.claude/worktrees/notebooklm-import && git push -u origin worktree-notebooklm-import
```

## v1.1 candidates (in priority order)

1. **`@mozilla/readability`** — extraction quality on site #5 (Pi-sub's strong rec)
2. **Right-click context menu** (page / link / selection)
3. **PDF generation** with auth-element stripping (user opt-in)
4. **CDP auto-upload** to NotebookLM via `DOM.setFileInputFiles` — gated by `SecurityConfirmationManager` + Google ToS review
5. **LLM tool wrapper** ("send this page to NotebookLM" via chat)
6. **Merge N tabs → 1 source** (jetpack's 50-source-dodge)
7. **Doc-site batch** (sitemap-aware)
8. **AI-chat extraction** (Claude/ChatGPT/Gemini conversation pages)

## Known minor follow-ups

- `App.tsx` setTimeout cleanup on Header unmount (cosmetic React warning; sidepanel stays mounted)
- Add jsdom for runtime extractor tests (currently structural-only)
- Make `MAX_TEXT_LENGTH = 200_000` configurable via settings
- `aria-hidden='true'` strip may remove main content when a modal is open (heuristic trade-off documented in ADR-011)
