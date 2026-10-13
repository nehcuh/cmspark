# Subtask parent navigation (#613)

Issue: https://github.com/nehcuh/cmspark/issues/613. Base: Office PR #617, `c570cb80c5799057e067ae0b55e6a3e4548288c3`.

## Reproduced gap

StatusRail already has a return button for known children with available parents. A just-spawned worker selected from Fleet can be absent from `state.threads`; the existing implementation shows a new conversation and hides return navigation. Missing/trashed parents also hide child identity. Parent names currently appear only in a tooltip.

## Frozen implementation plan

- Add one pure relationship helper beside existing sidepanel thread helpers. Known full Thread metadata wins; only when absent use a Fleet worker with exactly the active ID. No guessing from run, title, another row or root role.
- Add a props-only task relationship presentation component. Show visible child and parent titles and a distinct return control. Missing parent: `主任务暂不可用`; known trash: `主任务在回收站`; self/cycles: invalid relation. Only a known, available direct parent can be navigated. Restored multi-level relationships navigate direct parent without enabling nested spawn.
- Update `StatusRail.tsx` to resolve and render the relationship; clicking dispatches existing `SET_ACTIVE_THREAD` and sends existing `thread.select` only.
- Update existing workspace CSS: keep button visible and independently focusable at 320/390/900px, ellipsize long titles, allow relationship row wrapping.
- Tests cover real reducer Fleet-first selection, Thread/Fleet conflict, foreign same-run Fleet, title refresh, unavailable/trashed/self/cycle/direct-parent relationships, React rendering and keyboard/click navigation. Preserve existing message/busy caches and panel-wide draft/file semantics during child→parent switching.
- Validate actual component+production CSS in an isolated browser fixture using existing tooling; no production test dependencies or live user/browser actions.

## Gate / capability declaration

T2. Surface: existing sidepanel StatusRail. L2 classes: none added. Compose: read existing Thread/Fleet metadata, dispatch existing selection. Autonomy: explicit user navigation only. Trust: exact identity and explicit direct parent; unavailable relations do not guess or restore trash. Channel: existing extension message channel. Host tests/build, ARM64 validation, independent adversary→Pi, Kimi and CI green precede merge. No protocol, backend, worker execution, draft ownership or live configuration changes.
