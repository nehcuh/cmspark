All changes verified. Here is my complete review:

---

## Review: AppsPanel direct-pick UX + Cockpit chat.user echo

### Bug 1 鈥?AppsPanel add-app direct pick UX

**Changes:** Extracted `PolicyPicker` component; moved picked banner + policy radio ABOVE the candidate list; shrunk candidate list to 88px when picked; added visual selected state (border, accent background, checkmark prefix, `aria-pressed`); stable list keys via `candidateKey()`; identity comparison via `isSameCandidate()`; BottomBar maxHeight 200鈫?20px.

**Assessment:** 鉁?Correct. The root cause was that the policy row rendered below the candidate list, buried under a full unfiltered list (160px list + padding > 200px panel). Moving it above and shrinking the list on pick ensures selection feedback is visible on first paint. The `candidateKey`/`isSameCandidate` utils are pure functions, well-tested. `PolicyPicker` extraction removes the duplicated policy-radio block and the `autoDisabled` logic is correctly wired (`!!picked.aumid` for enumerate, `false` for manual).

**No regressions found.** Tab switching clears `picked`. Search/filtering does not lose the pick (correct 鈥?banner stays visible even if the picked item is filtered out of view). Manual tab's PolicyPicker is conditioned on `manualPath.trim()` as before.

### Bug 2 鈥?Cockpit chat.user echo to Side Panel

**Changes:** Background SW sends `chat.user` broadcast after successful `chat.send` (both normal path and `getActiveTabHostname` error path); Cockpit now does optimistic `ADD_MESSAGE` with `clientMessageId`; Side Panel's `InputArea` uses the same `clientMessageId` format; `useWebSocket` `messageListener` handles `chat.user` 鈫?dispatches `SET_PROCESSING` + `ADD_MESSAGE`; `agentReducer` `ADD_MESSAGE` dedups by `id`.

**Assessment:** 鉁?Correct. The architecture is sound:

1. Both surfaces generate `clientMessageId` as `${threadId}_user_${Date.now()}`, pass it through `chat.send` 鈫?service worker, which echoes it verbatim as `message_id` in the `chat.user` broadcast.
2. The dedup in `agentReducer` prevents the receiving surface from double-adding when the `chat.user` echo arrives after its own optimistic `ADD_MESSAGE`. Test confirms this.
3. `shouldApplyStreamEvent` gates the `chat.user` handler to the active thread only 鈥?a Cockpit message on thread-A won't pollute the Side Panel's thread-B view.
4. The old Cockpit code never dispatched `ADD_MESSAGE` at all, so user messages were invisible in the Cockpit (companion never echoes them). This diff fixes that.

**No security regressions.** All `chrome.runtime.sendMessage` calls are internal to the extension. `clientMessageId` is only used as a React key / Redux dedup key 鈥?no injection surface.

---

### Nits (non-blocking)

1. **`useWebSocket.ts:198` 鈥?`SET_PROCESSING` for cross-surface echo lacks a comment.** When the Cockpit sends a message on the active thread, `chat.user` handler dispatches `SET_PROCESSING(true)` in the Side Panel store. This is intentional (the thread *is* processing a response) but could surprise a reader 鈥?a one-line comment would help.

2. **`background/index.ts:413` 鈥?`echoUser` fallback `clientMessageId` is fragile.** If a future caller omits `clientMessageId`, the fallback `${threadId}_user_${Date.now()}` will differ from the optimistic ID the caller computed, breaking dedup. All current callers pass it, so this is theoretical, but a `console.warn` on the fallback path would future-proof it.

3. **No integration test for Cockpit 鈫?Side Panel echo.** The unit test covers `ADD_MESSAGE` dedup, but there's no test verifying the end-to-end flow (Cockpit send 鈫?SW broadcast 鈫?Side Panel receive). Understandable given Chrome extension testing constraints, but worth noting.

---

VERDICT: APPROVE_WITH_NITS
