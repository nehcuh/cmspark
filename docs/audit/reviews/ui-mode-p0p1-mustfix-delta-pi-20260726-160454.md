---

# Delta Review: P0+P1 Must-Fixes

## Verdict
**APPROVE_IMPL**

## Summary

All nine must-fix items are implemented with working code, not stubs. The SW-side `computer-task-mirror.ts` correctly shadows computer task events and pending security confirmations, feeding them into Cockpit via the new `cockpit.hydrate` SW message and `HYDRATE_COMPUTER_TASK`/`HYDRATE_SECURITY_CONFIRMATIONS` reducer actions. Panel send is double-gated (`canSend` + defense-in-depth in `handleSend`) while L2 tasks are running or paused. Cockpit nonce anti-paste covers all four vectors (paste event, context menu, keyboard shortcuts Ctrl/⌘V + Shift+Insert, drag-drop) with visual feedback. The `openOrFocusCockpit` mutex correctly serializes concurrent callers through a chained promise, and self-focus on every new confirm has been removed — focus is now driven by the background SW's `openOrFocusCockpit` call on computer-class events. Session/thread trust checkboxes are wired into both Cockpit `ConfirmElevated` and Panel `SecurityConfirmationDialog`, with correct gating (`canOfferThreadTrust`/`canOfferComputerSessionTrust`). Panel's full dialog now has a 60-second auto-deny timeout capped to `Math.min(request.timeout_ms, 60_000)`. `MinimalConfirm` correctly disables its Allow button when a nonce challenge is present. The SW-death window-id limitation is documented in both `cockpit-window.ts` header and `docs/DESIGN.md`.

## Checklist

| # | Claim | Status | Notes |
|---|-------|--------|-------|
| 1 | Cockpit hydrates computerTask + pending confirms from SW mirror | **Met** | `computer-task-mirror.ts` shadows events into `noteComputerTaskEvent`/`noteSecurityConfirmationRequest`/`noteSecurityConfirmationGone`. `cockpit.hydrate` returns snapshot. CockpitBoot dispatches HYDRATE_*. Mirror cleaned on `security.confirmation.response`/`resolved`/`expired`. Minor P2 race: hydrate snapshot can overwrite newer broadcast events (see residual). |
| 2 | Panel hard-gates chat.send while L2 task running/paused | **Met** | `canSend` adds `!taskActive` (checks `status === "running" \|\| "paused"`). `handleSend` has defense-in-depth duplicate check. Placeholder updates. Both guards scoped to `isComputer` capability level only — correct; L0/L1 don't run computer tasks. |
| 3 | Cockpit nonce anti-paste parity (keydown/context/drop) | **Met** | `onPaste` preventDefault, `onContextMenu` preventDefault, `onKeyDown` blocks Ctrl/⌘V and Shift+Insert, `onDrop` preventDefault. `pasteBlocked` state visual feedback. `onChange` sanitizes to `[A-Z0-9]` uppercase. Allow button disabled when nonce mismatches. |
| 4 | openOrFocusCockpit in-flight mutex | **Met** | `openInFlight` promise chains concurrent callers onto one `openOrFocusCockpitImpl()`. `.finally()` always clears. `_resetCockpitWindowStateForTests` updated. |
| 5 | Confirm focus background-driven (no Cockpit self-focus) | **Met** | Removed `useEffect` that called `cockpit.focus` on every `confirm?.confirmation_id`. Comment documents background-driven design. Background calls `openOrFocusCockpit()` on `computerConfirm \|\| computerTaskStart`. |
| 6 | ConfirmElevated session/thread trust checkboxes | **Met** | Thread-trust checkbox gated by `canOfferThreadTrust`. Session-trust checkbox gated by `canOfferComputerSessionTrust`, defaults ON (Grill Q2). Both values sent in response payload (`add_to_thread_whitelist`, `add_to_session_trust`). Reset on confirmation change. |
| 7 | Panel full SecurityConfirmationDialog 60s auto-deny | **Met** | Timeout `useEffect` on `request?.confirmation_id`, capped at `Math.min(timeout_ms, 60_000)`. Calls `denyRef.current()` → `decide(false)`. DenyRef assigned in render body (`denyRef.current = () => decide(false)`) so latest closure always used. |
| + | MinimalConfirm disables Allow when nonce required | **Met** | `needsNonce` disables button, gates `respond(true)`, grays out styling, sets explanatory title. |
| + | SW-death window id documented | **Met** | `cockpit-window.ts` header block documents the limitation. `docs/DESIGN.md` §Cockpit "Known" bullet. |

## Residual blockers (if any)

*None.* All must-fix items are functionally complete. The two items below are P2 quality improvements that should not block approval:

## Residual nits / P2

- **Hydrate-then-overwrite race**: `CockpitBoot` starts `useWebSocket()` (live broadcast listener) before the async `cockpit.hydrate` response callback fires. If a `computer.task.event` broadcast arrives between mount and hydrate dispatch, `HYDRATE_COMPUTER_TASK` overwrites the newer state with the snapshot. Window is narrow (SW processes hydrate synchronously before any new companion message), but not zero. Mitigation: compare `taskId` before overwriting, or track whether any live event has arrived since mount.
- **Nonce paste bypass via programmatic `value` assignment**: `onChange` sanitizes `[^A-Z0-9]` and uppercases but does not detect multi-character bulk injection (browser password manager, devtools). Threat model is low-severity — the user must still visually match the displayed nonce before clicking Allow.
- **Panel 60s timeout fires `decide(false)` via `chrome.runtime.sendMessage` without return handling**: if the panel is closed/inactive at timeout fire, the SW won't see the `security.confirmation.response`. However, the companion maintains its own timeout — this is a UX convenience layer, not the sole timeout.

## Answers

- **Are prior must-fixes closed enough for product owner confirmation?** Yes. All nine items are implementable and functional. The Cockpit will show task progress and pending confirms when opened mid-task, the Panel cannot inject sends during L2 execution, nonce cannot be trivially pasted, the Cockpit won't self-focus-steal, trust checkboxes are present and correctly wired, and auto-deny fires on both surfaces.
- **Any new regressions introduced by the fix commit?** No. The changes are additive: new message types (`cockpit.hydrate`, `HYDRATE_*`), new guard conditions on existing gates, new event handlers on existing inputs. The one removed behavior (Cockpit self-focus) is intentionally replaced by background-driven focus in the same commit.

VERDICT: APPROVE_IMPL
