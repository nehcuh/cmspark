I have all the data I need. Writing the review.

---

# Review: UI Mode P0+P1 Implementation

## Verdict
**APPROVE_WITH_FIXES**

## Summary

P0 ModeController is **correct and well-tested** — highest-wins derivation, pin semantics (blocks down only), 30s quiescence hysteresis (D15), browser/computer tool sets, and escalate-only toast (D13) all match the approved design and pass 13 focused unit tests. P1 Cockpit ships the dual-track shell, ConfirmElevated with nonce/whitelist, content-split MinimalConfirm, mandatory Panel abort, and background auto-open on `host_computer`/`host_app` confirms and `computer.task.event:started|paused` (covering D16 tray path). 238/239 tests pass (the one fail is the pre-existing `appsPlatformSupported` per brief §3.4) and `tsc --noEmit` is green.

However, **three meaningful gaps** block a clean APPROVE_IMPL: (a) Panel `InputArea` changes placeholder to "排队跟进…" in L2 but never gates `chat.send`, so D12′ "Panel is not a parallel task conductor" is only honest about the visual — Panel still sends; (b) CockpitApp's `useWebSocket` boots from `initialState` — `computerTask` and `pendingSecurityConfirmations` history are **not rehydrated**, so opening the cockpit mid-task shows no TaskDock and no abort until the next event arrives; (c) CockpitApp's confirm-arrival effect fires `cockpit.focus` from **inside the cockpit window itself**, which is the wrong architecture and can disrupt focus on every new confirm. Smaller issues: cockpit send button isn't disabled offline; `cockpitWindowId` is in-memory only (orphaned on SW death); ModePin has a reducer action but no UI affordance.

None of these require rethinking the ontology or the surface split. All are bounded fixes (1–3 days) before human product confirmation.

## Spec compliance matrix

| Criterion | Met / Partial / Miss | Notes |
|-----------|----------------------|-------|
| **P0-1** Pure chat → L0 `聊` | ✅ Met | `deriveCapabilityLevel(base)` → `"chat"` (test L:22-23). |
| **P0-2** Browser tool → L1 `网页` + toast; BottomBar Tabs/Skills | ✅ Met | `useWebSocket.ts:274,289` stamps `lastBrowserToolAt` on tool.start+result. `contextBarTabsForLevel("browser")===["tabs","skills"]`. Toast in `useCapabilityMode.ts:54-57`. |
| **P0-3** Active computer / host confirm → L2 `计算机`/`计算机 · LIVE` | ✅ Met | `COMPUTER_CLASS_TOOLS` includes host_computer/app/read/write; `taskActive`/`confirmComputer` elevate. LIVE badge driven by `live = status==="running"\|\|"paused"` (`useCapabilityMode.ts:60-62`). |
| **P0-4** L0 BottomBar not six-pack | ✅ Met | L0 = `["skills","knowledge","history"]` — three tabs. |
| **P0-5** Hysteresis: L1 30s; finished L2 stays L2 in window | ✅ Met | `DEFAULT_QUIESCENCE_MS=30_000`; `taskFinishedInWindow` keeps L2 (`mode-controller.ts:85-88`). Tests L:39-48, 91-108. |
| **P0-6** No regression on chat / confirm / computer flows | ✅ Met | Panel still renders `ComputerTaskBar` + full `SecurityConfirmationDialog` when `!isComputer` (`App.tsx:142,148`). |
| **P1-1** L2 opens Cockpit (~720×560) | ✅ Met | `openOrFocusCockpit` creates popup 720×560 (`cockpit-window.ts:10-11,69-75`); auto-fired on background host_computer confirm + computer.task.event:started\|paused (`background/index.ts:339-353`) plus panel `useEffect` on `isComputer` (`App.tsx:119-125`). |
| **P1-2** Panel: Chip + **mandatory abort** + minimal confirm; heavy preview in Cockpit | ✅ Met | `SafetyStrip.tsx` always renders abort when `task && !finished && !abortAcked`. `MinimalConfirm` is tool/risk/allow/deny/stop + open-cockpit-link only. Heavy preview/nonce/whitelist in `ConfirmElevated`. |
| **P1-3** Close Cockpit ≠ stop; Chip reopens; Panel abort works | ✅ Met | `closeCockpit` comment + implementation do not abort task. SafetyStrip `openBtn` reopens. Panel abort sends `computer.task.abort`. |
| **P1-4** Panel input ownership (D12′) — at least non-conductor UX | ⚠️ **Partial** | Placeholder text changes to "排队跟进…" (`App.tsx:751`) but `handleSend` still dispatches `chat.send` unconditionally. Visual-only; Panel is still a parallel conductor. |
| **P1-5** Tray / no-panel path opens Cockpit on host confirm | ✅ Met | Background `handleCompanionMessage` auto-opens Cockpit regardless of panel state (`background/index.ts:341-352`). |
| **P1-6** Confirm timeout auto-deny in Cockpit (~60s) | ✅ Met | `CockpitApp.tsx:239-245` 60s `setTimeout` calls `respond(false)`. Uses `Math.min(request.timeout_ms, 60_000)` when companion sends timeout. |
| **P1-7** Dual surfaces rehydrate via WS broadcast (honest limits) | ⚠️ **Partial** | Both surfaces mount `useWebSocket` → independent stores synced by `chrome.runtime.sendMessage` broadcast. Honest. **But `computerTask` and `pendingSecurityConfirmations` are NOT requested on cockpit boot** — cockpit opens empty if task already running. Thread/messages do rehydrate via `thread.list`/`thread.messages`. |
| **P1-8** Build: `tabs/cockpit.html` present; tsc + plasmo green | ✅ Met | `src/tabs/cockpit.tsx` exists (Plasmo auto-generates `tabs/cockpit.html`). `tsc --noEmit` clean. Tests 238/239 (one fail is pre-existing per brief §3.4). |

## Answers to §4

### Q1 — Does P0 ModeController correctly encode L0/L1/L2 + pin + hysteresis vs the approved design (including D9′–D16)?

**Yes, with one cosmetic omission.** The pure function `deriveCapabilityLevel` correctly implements highest-wins (chat<browser<computer), pin-blocks-down-only, and 30s quiescence for both L1 (last browser tool) and L2 (finished computer task — D15). The `COMPUTER_CLASS_TOOLS` set includes `host_computer`, `host_app`, `host_read`, `host_write`, so desktop-class confirms elevate to L2 even without a live task (matches spec §3.2). D13 escalate-only toast is correct (`useCapabilityMode.ts:50-57` — only fires when `order[level] > order[prev]`). D16 is satisfied at the background level (auto-open on host_computer confirm and `computer.task.event:started|paused`).

**Pin (D3 "blocks auto-down only")** — the derivation logic is correct (`mode-controller.ts:106-110`: `if (order[modePin] > order[derived]) return modePin`). However, **`SET_MODE_PIN` is dispatched nowhere in the UI** — `grep -r "SET_MODE_PIN"` returns only the reducer and test fixtures. So the pin is a tested-but-unexposed knob. Spec lists pin as P2 polish ("queue UX, pin polish"), so this is acceptable for P0/P1, but call it out.

**Hysteresis yo-yo check (P0-5 "No mode yo-yo on short interleaved text")** — chat-only messages don't touch `lastBrowserToolAt`, so a chat-only burst after a browser tool doesn't extend L1. Good. However, **every `tool.start` AND `tool.result` refreshes `lastBrowserToolAt`** (`useWebSocket.ts:274,289`), so a single 30s browser tool keeps L1 alive for ~60s (start + result). Probably fine for UX, but it does mean a slow browser tool inflates the L1 window. Note.

### Q2 — Is dual-surface state (separate stores) acceptable for P1, or is it a ship blocker?

**Acceptable for P1, with one must-fix.** Both Panel and Cockpit mount `useWebSocket` which subscribes to `chrome.runtime.onMessage` broadcasts from background. Background forwards every companion message to `chrome.runtime.sendMessage(msg)` (`background/index.ts:355-362`), so both surfaces see the same firehose. This is exactly the spec's "two renderers, one state … rehydrate via WS broadcast" model.

**Must-fix (Q2 blocker):** `useWebSocket` does not fetch `computerTask` or `pendingSecurityConfirmations` state on boot — only `thread.list`, `skill.list`, `knowledge.list`, `config.get`, `mcp.list` (`useWebSocket.ts:37-41`). Result: **Cockpit opened mid-task shows empty TaskDock and no abort button** until the next `computer.task.event` happens to fire. For a Computer Use surface where abort availability is the central safety promise, this is a real blind spot — the user opens the cockpit expecting the kill switch and finds nothing. Two ways to fix: (a) add a `cockpit.hydrate` message that background satisfies from a SW-side mirror of `computerTask` (cheap, requires SW to also listen to `computer.task.event`), or (b) trigger companion-side snapshot broadcast on cockpit port connect. The SW-side mirror is the smaller blast radius.

`pendingSecurityConfirmations` has the same gap, but it's less severe because (i) confirms usually arrive after cockpit auto-open (the auto-open is triggered by the confirm itself), and (ii) the 60s timeout bounds the window.

### Q3 — Safety: can the user always abort and always see a confirm path if Cockpit is closed/unfocused?

**Mostly yes, with one residual blind spot.**

- Cockpit closed, Panel open at L2: SafetyStrip renders abort button + MinimalConfirm + "打开操控台 ↗" affordance. ✅
- Cockpit open, Panel closed: CockpitApp title-bar abort + ConfirmElevated. ✅
- **Both closed**: task continues in companion; no UI surface. Tray has no abort affordance. The SafetyStrip warning text references "Ctrl+Alt+End" as a hotkey fallback (`SafetyStrip.tsx:71`), but I see no keydown listener wiring this hotkey in the extension — it appears to be companion-side. Acceptable as a last-resort, but should be documented as "if both surfaces close, hotkey or restart companion is your only stop."

- Confirm path with Cockpit closed: Panel MinimalConfirm + "详情 ↗" (opens cockpit). ✅
- Confirm path with both closed: companion-side 60s auto-deny is the backstop. ✅

**CockpitApp self-focus on confirm** is a sub-issue: `useEffect` on `confirm?.confirmation_id` fires `chrome.runtime.sendMessage({type:"cockpit.focus"})` from **inside the cockpit window** (`CockpitApp.tsx:42-46`). The background handler then calls `chrome.windows.update(cockpitWindowId, {focused:true, drawAttention:true})`. Architecturally, focus-on-new-confirm should be **background-driven** (like the auto-open path), not cockpit-self-driven. As written, if the user is in another app and a confirm arrives, the cockpit will steal focus even when the user has chosen to background it. Spec §5 says "On new confirm: `windows.update({focused:true, drawAttention:true})`" — that's an unconditional spec requirement, so this isn't *wrong*, but the implementation site is awkward and will make focus-stealing harder to thread policy through later. Move the trigger to background (mirror the auto-open pattern).

### Q4 — Content-split confirm: does MinimalConfirm + ConfirmElevated satisfy security without regressing whitelist/nonce paths?

**Yes, with one nit.**

Panel MinimalConfirm (`MinimalConfirm.tsx`) sends `{approved, stop_thread, add_to_whitelist: []}` — no nonce, no thread-trust, no session-trust. That's the correct content-split: tool/risk/allow/deny/stop only, heavy features live in Cockpit.

Cockpit ConfirmElevated (`CockpitApp.tsx:220-354`) has whitelist radio (none/exact/wildcard), nonce input with `onPaste` blocked, full_preview/code_preview, and image preview with safe-render guard. ✅

Security parity check vs full Panel `SecurityConfirmationDialog`:
- ✅ `add_to_whitelist` (Cockpit only — fine per content-split)
- ✅ `nonce_response` (Cockpit only — fine)
- ❌ **`add_to_thread_whitelist`** (host_read / host_app thread trust) — **missing from BOTH MinimalConfirm and ConfirmElevated**. This is a **regression** from the full Panel dialog (`App.tsx:252`). In L2 the panel's full dialog is hidden (`App.tsx:148` `!isComputer && <SecurityConfirmationDialog />`), and ConfirmElevated doesn't send this flag. So host_read thread-trust is unreachable while in L2.
- ❌ **`add_to_session_trust`** (host_computer session auto-approve) — same: missing from both, unreachable in L2.

Known limitation #3 calls out session/thread-trust checkboxes specifically, so this is author-acknowledged. But it's more than cosmetic: `host_computer` session trust was a deliberate UX decision (2026-07-26 user test, default-on checkbox), and L2 is precisely when host_computer executes — so the regression lands on the most-affected users. Either: (a) port both checkboxes to ConfirmElevated, or (b) explicitly call this out in P2 scope with a workaround (user must drop to L0/L1 to set trust, which is contrived).

**Nit:** MinimalConfirm's allow button isn't disabled when `nonce_challenge` is set (`MinimalConfirm.tsx:66-72`). Approving a nonce-gated confirm from the Panel would send no `nonce_response`, and companion would reject. Not exploitable (companion is the authority), but inconsistent UX — button should be disabled or hidden when nonce is required.

### Q5 — Input ownership D12′: is current Panel behavior honest enough, or must send be gated?

**Must be gated.** The placeholder "排队跟进…（主指令请在操控台发送）" is honest copy, but `handleSend` still calls `chrome.runtime.sendMessage({type:"chat.send", ...})` unconditionally (`App.tsx:880-885`). So the user *can* send task instructions from the Panel while a Cockpit conductor is running, potentially racing mid-task. This is a clear P1 acceptance criterion miss ("Panel is not parallel task conductor").

Two reasonable fixes:
1. **Hard gate**: when `isComputer && task?.status==="running"`, disable the send button entirely (only allow Stop). Honest, simple.
2. **Soft gate with explicit override**: send `chat.send` but tag it `follow_up: true` and have companion queue it until the running task completes; or pop a confirm "this will interject into the running task — continue?". More work, more flexible.

For P1 the hard gate is enough — queue semantics are explicitly P2.

### Q6 — Window lifecycle: open/focus/close/onRemoved — races, multi-window, SW death?

**Acceptable, with documented limitations.**

- **openOrFocusCockpit** (`cockpit-window.ts:48-82`): checks `windowExists` before reusing `cockpitWindowId`. If the tracked window is gone, nulled + new create. ✅
- **onRemoved** listener nulls `cockpitWindowId` (`cockpit-window.ts:27-31`). ✅
- **closeCockpit** nulls before `chrome.windows.remove` (so a racing onRemoved sees no match). ✅
- **Multi-window race**: `openOrFocusCockpit` is `async`. If two callers invoke it in the same tick (e.g., `host_computer` confirm and `computer.task.event:started` arriving together — both trigger auto-open at `background/index.ts:341-352`), both could enter the `if (cockpitWindowId != null)` branch simultaneously, both see null, both create. JS is single-threaded per event, but the `await` boundary between existence-check and create *can* interleave. In practice the auto-open paths fire on different companion messages separated by network latency, so unlikely. Add an in-flight `Promise` dedup if you want to be safe.
- **SW death**: `cockpitWindowId` is in-memory only. After MV3 SW restart, the variable is null but the actual Chrome window may still be open. Next `openOrFocusCockpit` will create a **second** window, leaving the first orphaned. Not catastrophic (user can close), but should be P2-fixed by either (a) persisting `cockpitWindowId` in `chrome.storage.session`, or (b) enumerating `chrome.windows.getAll` on SW boot and reclaiming the cockpit URL. Note in known limitations.
- **Panel auto-open `useEffect` on `isComputer`** (`App.tsx:119-125`) fires on every transition into L2 — combined with background auto-open, you get two `cockpit.open` messages. Idempotent, so just noisy.

### Q7 — What must be fixed before human product confirmation / merge?

1. **Panel `InputArea` must gate `chat.send` in L2** (D12′, P1-4). Either disable send while `isComputer && task?.status==="running"`, or tag sends as follow-ups and have companion queue. (1-2 hours for hard gate.)
2. **Cockpit hydrates `computerTask` on boot** (Q2 blocker). Without this, the L2 abort promise is hollow when the cockpit opens after `started`. Add a `cockpit.hydrate` (or reuse `computer.task.event` snapshot) message the cockpit sends on mount; background satisfies from a SW-side mirror. (2-4 hours.)
3. **Move confirm-arrival focus trigger from CockpitApp to background** (Q3 sub-issue). The cockpit shouldn't focus itself; background should `windows.update({focused, drawAttention})` on `security.confirmation.request` for the same reason it auto-opens. (1 hour.)
4. **Either expose thread-trust + session-trust in `ConfirmElevated`, OR explicitly document the L2 regression in known-limitations and ship with that.** Don't ship silent regression. (2 hours to port; or 30 min to document.)
5. **Disable MinimalConfirm's allow button when `nonce_challenge` is set** (Q4 nit). (10 minutes.)

### Q8 — What can wait for P2?

- **ModePin UI** — `SET_MODE_PIN` is wired through reducer + tests but no component exposes the toggle. Spec already classifies pin polish as P2.
- **`cockpitWindowId` SW-death orphan recovery** — rare in practice; user can close the orphan. P2 fix via `chrome.storage.session` persistence or window enumeration on SW boot.
- **`openOrFocusCockpit` in-flight dedup** — only matters under tight message racing.
- **L1 ContextStrip + 「展开工作区 ↗」** — spec §4 calls for it but the design amendments (D9′) push L1 expand to P2. Skip is acceptable for P1.
- **ChatView dim in L2** — spec says "chat may dim"; current implementation keeps full opacity. Polish.
- **Cockpit send button disabled on `connectionState!=="connected"`** — minor offline leak; background catches the error so it's UX-only.
- **CockpitApp abort button should also check `!task.abortAcked`** — minor consistency nit with SafetyStrip.
- **`lastBrowserToolAt` cleared on thread delete** — minor thread-scope leak (deletes don't reset the timestamp).
- **E2E browser automation for window open** — known limitation #5.

## Risks & failure modes

1. **Cockpit-abort-blind-spot (Q2/Q3)**: User triggers a host_computer task from the tray; cockpit auto-opens; user closes cockpit; user reopens cockpit manually — TaskDock is empty, no abort visible. Mitigation: hydrate `computerTask` on boot. **Severity: safety — must-fix before merge.**
2. **Panel parallel conductor (Q5)**: User in Panel at L2 sends "actually click OK on the cookie banner" while Cockpit is mid-action; both instructions hit the LLM in a race. Mitigation: gate Panel send. **Severity: behavioral — must-fix before merge.**
3. **Focus theft (Q3 sub-issue)**: CockpitApp fires `cockpit.focus` on every new confirm; if user is in another app, focus is yanked. Spec mandates focus on new confirm, so the *behavior* is correct; the *implementation site* makes it hard to add "only if surface was focused recently" policy later. **Severity: UX ergonomics.**
4. **Thread-trust / session-trust unreachable in L2 (Q4)**: Users who rely on host_computer session auto-approve will be re-prompted for every task split while L2 is active. Regression vs the existing panel flow. **Severity: UX/security-tradeoff.**
5. **SW restart orphans cockpit window (Q6)**: User opens cockpit; SW restarts (MV3 30s idle); next auto-open creates a duplicate; user has two cockpits. **Severity: rare UX glitch.**
6. **Double broadcast on confirm-resolved**: Both Panel and Cockpit dispatch `REMOVE_SECURITY_CONFIRMATION` locally; both surfaces' `security.confirmation.response` might race to companion. Companion must be idempotent on `confirmation_id` — verify on companion side (not in scope of this review but worth a one-line check).

## Suggested next steps

1. **Implement Q7 fixes 1–3 as a single follow-up commit** ("feat(ui): P1 fixes — panel send gate, cockpit hydrate, bg-driven focus"). Estimated 4–7 hours.
2. **Decide on Q7-4**: port trust checkboxes OR document as known limitation. Either way, signal the trade-off to the product owner before merge.
3. **Add a `cockpit.hydrate` test** to `cockpit-window-logic.test.ts` (currently only tests path + size constants) — assert that background responds with current `computerTask` snapshot when cockpit opens.
4. **Manual smoke test matrix** before human confirmation:
   - L0 chat → L1 browser tool → L2 host_computer confirm (toast + badge + cockpit auto-open).
   - Close cockpit mid-task: Panel SafetyStrip still shows abort + reopen.
   - Close BOTH panel + cockpit mid-task: confirm there's no silent continuation (or document the hotkey fallback).
   - Open cockpit mid-task (started before cockpit opened): verify TaskDock + abort appear (will FAIL until Q7-2 is fixed).
   - Trigger host_computer confirm while Panel is closed: cockpit auto-opens (D16).
   - 60s confirm timeout auto-deny fires in cockpit.
   - Nonce confirm: MinimalConfirm disabled / hidden; ConfirmElevated requires typed code.
5. **Pair with companion-side reviewer** to confirm idempotency on duplicate `security.confirmation.response` (both surfaces may respond to the same confirm_id before the broadcast `security.confirmation.resolved` propagates).

---

VERDICT: APPROVE_WITH_FIXES
