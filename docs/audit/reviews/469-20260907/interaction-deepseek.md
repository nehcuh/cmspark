…the standard caveat: writing a ref during render is unsupported in concurrent React; since `menuOpen` changes already trigger render, the assignment should move into a `useEffect`. Benign but worth cleaning up.

- The Python harness uses `page.get_by_role('textbox', name='消息内容')` immediately after `page.goto`, before fixtures dispatch `SET_MESSAGES`; fine. But it never asserts that at ≥760px the persistent 220px nav exists (only that the narrow toggle hides). A regression that silently hides the wide nav passes every check. Add a visibility assertion at 800/1440.
- `terminalApp` consumes dark tokens only; the 480px media rule uses blurry descendant selectors (`.cm-terminal>div:first-of-type` / `.cm-terminal details[data-*]`), and header buttons use raw `background`/`border` inline overrides that duplicate the token ladder outside `tokens.ts` — the "tokens are sole value owner" discipline is violated in that file. No behavior defect found (`[inspected]`); testify that this was a token-surface-only change, not a DOM change.

### Verdict: **REJECT** (two blocking defects — no P0 found)

Blockers, concrete from the packet, `[inspected]`:

1. **MAJOR — dead chevron expand/collapse in history groups.** Diff strips `onClick` from all four group headers (today/yesterday/month/day) and puts `toggle*` on a label-only button; the visible `▶/▼` chevron is now a clickable-looking control that does nothing. This is a lost affordance, which the design contract explicitly forbids.
2. **P1 — Escape on a non-input element closes the history popover *and* the open context panel.** The new `document` keydown handler in `ThreadList` closes history and `preventDefault()`s but does not `stopPropagation()`; the pre-existing `ContextPanelHostProvider` window-level Escape handler then also fires (document precedes window in capture/bubble), collapsing the currently open knowledge/skills/MCP panel. Contradicts the "Escape closes the topmost layer only" priority stack. Initial focus on the search input masks the bug; tabbing to any row/group/button exposes it.

Non-blocking (fix before or in the same merge): #3 select-mode "打开" mislabel on the new title button, #4 ensure `warning` is never used for ordinary text (contrast ~3.0:1), #5 missing `WorkspaceFrame`/`workspace-styles` packet files leave all height/width claims and class contracts unverifiable — this must accompany any re-review.

Clean: no new production dep, no implicit approval path, confirmation handlers/DOM/policy byte-unchanged, stop/急停 origin intact, L2/T3 untouched, settings deep-link behavior preserved, full suites claimed.