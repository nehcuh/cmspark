I've completed an independent review of the Wave D implementation by reading the actual repo state, running the test suite, and verifying the rejection gates.

## Verification

- **Tests** `[executed]`: ran `npx tsx --test tests/markdown-export.test.ts` → **30/30 pass** (matches implementer claim).
- **R1 (default omits reasoning)** `[inspected]`: `agentStore.tsx:295` `exportIncludeReasoning: false`; `markdown-export.ts:113-118` strips unless `include_reasoning === true`; default-off test at `tests/markdown-export.test.ts:74` confirms. ✅
- **R2 (no trust elevation)** `[inspected]`: no changes to security-policy / confirm / capability. ✅
- **R3 (rebuild does not inject reasoning)** `[inspected]`: `adapter.ts:170-231` `rebuildMessagesFromHistory` constructs `{role, content, tool_calls}` only — no `reasoning_content`. ✅
- **ADR-020 capability**: plan declares `Surface: L0 UI + export policy / Compose: none / Trust: no elevation`. No new tool, gate, primary chrome, or middle-agent — axes check passes. ✅

## Nits (non-blocking)

1. **MessageRow memo drops `showReasoningMode`** — `ChatView.tsx:708-720`'s `areEqual` compares `msg.id / content / reasoning_content / tool_calls / activeThreadId / sendShortcut` but **not** `showReasoningMode`. Changing the mode in Settings does NOT re-render historical rows; they keep their old fold state until remount. ReasoningBlock's `useEffect([live, mode])` is correct, but it never gets the new prop because the parent short-circuits. Fix: add `prev.showReasoningMode === next.showReasoningMode`. UX inconsistency only.

2. **`include_reasoning` only plumbed through 1 of 3 export entry points** — `ChatView.tsx:328` (per-message 📥) passes it; `StatusRail.tsx:318-322` (whole-thread), `StatusRail.tsx:341-345` (summary), and `ThreadList.tsx:441` (summary) do **not**. The Settings label "导出到 Obsidian 时包含思考过程" implies all exports — user opts in, clicks rail-menu "导出线程", reasoning silently absent. Privacy default holds; only the opt-in is incomplete.

3. **Summary path never receives the flag** — `message-router.ts:1944-1950` calls `serializeSummaryToMarkdown` without `include_reasoning`, even though `serializeSummaryToMarkdown` supports it (`markdown-export.ts:172-178`). Latent today (no upstream caller passes it for `scope: "summary"`), but the dead branch is misleading.

VERDICT: APPROVE_WITH_NITS
