I have enough context. Writing the delta review.

```markdown
# Delta Review: P0+P1 Must-Fixes

## Verdict
**APPROVE_IMPL**

## Summary

All nine must-fix items from the dual-review synthesis are functionally complete in commit `c502eea`, with code that addresses the original concern rather than stubs. The SW-side mirror (`computer-task-mirror.ts`) shadows `computer.task.event` and `security.confirmation.request|resolved|expired` plus the panel's `security.confirmation.response` path, then feeds the Cockpit via a new `cockpit.hydrate` message and `HYDRATE_COMPUTER_TASK` / `HYDRATE_SECURITY_CONFIRMATIONS` reducer actions. Panel `InputArea` is now double-gated against mid-task send (`canSend: !taskActive` + defense-in-depth re-check inside `handleSend`), correctly scoped to `isComputer` so L0/L1 are unaffected. Cockpit nonce anti-paste reaches parity with Panel across all four vectors (`onPaste`, `onContextMenu`, `onKeyDown` Ctrl/⌘+V and Shift+Insert, `onDrop`) plus visual feedback via `pasteBlocked`. The `openOrFocusCockpit` mutex serializes concurrent callers through an `openInFlight` promise with `.finally()` cleanup, and the self-focus effect was removed from CockpitApp — focus is now driven by background `openOrFocusCockpit()` on `computerConfirm || computerTaskStart`. Session/thread trust checkboxes are wired into `ConfirmElevated` with correct `canOfferThreadTrust` / `canOfferComputerSessionTrust` gating and reset on `confirmation_id` change; the Panel full `SecurityConfirmationDialog` gained the D14 60s `Math.min(timeout_ms, 60_000)` auto-deny tied to `denyRef.current()`. `MinimalConfirm` disables Allow when `nonce_challenge` is set (button + `respond` guard + title), and the SW-death `cockpitWindowId` limitation is documented in both the `cockpit-window.ts` header and `docs/DESIGN.md` §Cockpit. 238/239 tests pass (the single failure is the pre-existing `appsPlatformSupported` per prior reviews, unrelated to this delta). The changes are additive; no regressions introduced.

## Checklist

| # | Claimed fix | Status | Notes |
|---|-------------|--------|-------|
| 1 | Cockpit hydrates computerTask + pending confirms from SW mirror | **Met** | Mirror wired in `background/index.ts:345-357` for `computer.task.event`/`security.confirmation.request/resolved/expired`; cleanup also hooked into the panel's `security.confirmation.response` path (`index.ts:503`). `cockpit.hydrate` SW handler at `index.ts:818-821`. Reducer at `agentStore.tsx:458-464` replaces state unconditionally. |
| 2 | Panel hard-gates `chat.send` while L2 task running/paused | **Met** | `App.tsx:757-766` adds `!taskActive` to `canSend`; `App.tsx:861-870` re-checks inside `handleSend` as defense in depth. Both scoped to `isComputer`. Placeholder updated to "任务进行中 — 请在操控台发送指令或先急停". |
| 3 | Cockpit nonce anti-paste parity (keydown/context/drop) | **Met** | `CockpitApp.tsx:381-413` covers `onPaste`, `onContextMenu`, `onKeyDown` (Ctrl/⌘+V, Shift+Insert), `onDrop`. `onChange` uppercases + strips `[^A-Z0-9]`. Allow button disabled when `nonceChallenge && !nonceMatches`. Visual feedback via `pasteBlocked` + red border. |
| 4 | `openOrFocusCockpit` in-flight mutex | **Met** | `cockpit-window.ts:21,91-97`. `openInFlight` promise chains concurrent callers; `.finally(() => { openInFlight = null })` always clears. `_resetCockpitWindowStateForTests` also resets it. |
| 5 | Confirm focus background-driven (no Cockpit self-focus) | **Met** | Removed the `useEffect` on `confirm?.confirmation_id` from CockpitApp. Background still calls `openOrFocusCockpit()` on `computerConfirm \|\| computerTaskStart` (`index.ts:362-374`). Comment at `CockpitApp.tsx:55` documents the handoff. |
| 6 | ConfirmElevated session/thread trust checkboxes | **Met** | `CockpitApp.tsx:249-254,356-375` wires both checkboxes with `canThreadTrust`/`canSessionTrust` gating; `respond` payload includes `add_to_thread_whitelist` and `add_to_session_trust` (`CockpitApp.tsx:294-295`). Reset effect at lines 260-267 restores defaults on `confirmation_id` change. |
| 7 | Panel full SecurityConfirmationDialog 60s auto-deny | **Met** | `App.tsx:214-225` adds a 60s `setTimeout` calling `denyRef.current()` (= `() => decide(false)` assigned during render so latest closure is used), capped via `Math.min(timeout_ms, 60_000)`. Cleanup on `request?.confirmation_id` change. |
| + | MinimalConfirm disables Allow when nonce required | **Met** | `MinimalConfirm.tsx:30,33,72-81` adds `needsNonce`; `respond` early-returns when `approved && needsNonce`; button gets `disabled`, gray styling, and explanatory title. |
| + | SW-death window id documented | **Met** | `cockpit-window.ts:7-10` header describes the limitation and the P2 recovery plan; `docs/DESIGN.md` §Cockpit carries a "Known" bullet. |

## Residual blockers (if any)

None. The must-fix bar from the synthesis is satisfied to a level appropriate for product-owner confirmation. None of the items below are blockers.

## Residual nits / P2

- **Hydrate-then-overwrite race** (also flagged by Pi): `useWebSocket()` registers its `chrome.runtime.onMessage` listener before the `cockpit.hydrate` response arrives. If a fresher `computer.task.event` (or `security.confirmation.request`) is dispatched between listener registration and the hydrate callback, the `HYDRATE_COMPUTER_TASK` / `HYDRATE_SECURITY_CONFIRMATIONS` dispatches replace the newer state with the older snapshot. The window is narrow (the SW handler is synchronous) but not zero. Mitigation: pass a `since` cursor and have the SW include only events newer than the cockpit's boot, or compare `taskId` before replacing in the reducer.
- **`abortAcked` not mirrored**: the SW mirror only ingests `computer.task.event`; `computer.task.abort.ack` (panel-side dispatch when user clicks 急停) is not tracked. Reopening the cockpit after a Panel abort shows `abortAcked: false`, so the 急停 button reappears until the next event. Companion-side abort is idempotent on `task_id`, so this is UX noise, not a safety bug.
- **No unit tests for new logic**: `cockpit-window-logic.test.ts` still only tests path + size constants. The mutex, hydrate plumbing, and HYDRATE_* reducer cases would benefit from focused tests; non-blocking for confirmation.
- **Trust-reset effect dependency** (`CockpitApp.tsx:267`): `request.relevant_apps` is part of the dependency array. It's an array reference, but in practice it only changes when the request object changes (which also changes `confirmation_id`), so no spurious resets occur. Tightenable to `[request.confirmation_id]`.
- **Cockpit steal-focus on every host_* confirm while user is in Panel**: spec-compliant (D14 mandates focus on new confirm), but if a user is typing in the Panel when a `host_read` confirm arrives, the cockpit window will pull focus. UX nit, not a regression introduced by this commit.
- **Trust checkboxes appear in both Panel and Cockpit simultaneously**: when a host_* confirm arrives while capability level is still transitioning L1→L2, both surfaces may render the same `relevant_app` checkbox. Whichever the user clicks wins; companion validates. Acceptable.

## Answers

- **Are prior must-fixes closed enough for product owner confirmation?** Yes. Cockpit will now show task progress + abort + pending confirms when opened mid-task; Panel cannot inject `chat.send` during a running/paused L2 task; nonce cannot be trivially pasted inside Cockpit; the cockpit no longer self-focuses on every confirm; trust checkboxes are reachable from L2; both surfaces auto-deny at 60s; MinimalConfirm is honest about its nonce limitation; the SW-death orphan-duplicate window is documented. None of the residual issues are severe enough to block confirmation — they are P2 hardening items.
- **Any new regressions introduced by the fix commit?** No. The changes are additive: new module (`computer-task-mirror.ts`), new message type (`cockpit.hydrate`), new reducer actions (`HYDRATE_*`), new guards on existing gates, new handlers on existing inputs, new checkbox UI. The only removed behavior — CockpitApp's self-focus `useEffect` — is intentionally replaced by background-driven focus in the same commit, and the new path fires for the same trigger surface (host_* confirms + computer task start/pause).

VERDICT: APPROVE_IMPL
```

Sources:
- [fix(ui): address P0+P1 dual-review must-fixes (commit c502eea)](https://github.com/nehcuh/cmspark/commit/c502eea) — full patch inspected
- Prior reviews: `docs/audit/reviews/ui-mode-p0p1-impl-claude-20260726-153051.md`, `docs/audit/reviews/ui-mode-p0p1-impl-pi-20260726-153051.md`
- Synthesis: `docs/decisions/v1.3/ui-mode-p0p1-impl-review-synthesis-2026-07-26.md`
- Files verified by Read: `background/cockpit-window.ts`, `background/computer-task-mirror.ts`, `background/index.ts`, `cockpit/CockpitApp.tsx`, `sidepanel/App.tsx`, `sidepanel/components/MinimalConfirm.tsx`, `sidepanel/store/agentStore.tsx`, `sidepanel/hooks/useWebSocket.ts`, `sidepanel/utils/computer-utils.ts`, `tests/cockpit-window-logic.test.ts`, `docs/DESIGN.md`
