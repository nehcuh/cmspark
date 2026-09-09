## #496 review

**Bug:** site-context metadata `list_tabs` published a chat `tool.start` with no adapter `tool.result`. `chat.done` clears `threadBusy` (`useWebSocket.ts` 454–458) but leaves a `status: "running"` tool row (`649–711`). Stop is idle; the card survives cache switch (`applyActiveThreadSwitch` stashes `messages`). That matches the report.

**Fix path:** `resolveBrowserSiteTarget` still uses the authenticated executor + `invokeOpts.siteContextTabId`. `contextReadParams` drops client `__site_context_tab_id` and restores it only for `list_tabs` + `Number.isSafeInteger(id) && id >= 0`. `createToolExecutor` skips the sidebar `tool.start` iff that restored flag is present (`server.ts` 467, 567–579). LLM `executeTool(...)` is still 4-arg, so model `list_tabs` still gets `tool.start` + adapter `tool.result` (`adapter.ts` 1656, 1709–1715). `stopped:false` / `shouldClearBusyOnChatAborted` untouched.

`tool.start` and `tool.execute` already ride different sockets (`originating ws` vs `pickAuthenticatedClientWs`), so the extension actuator cannot require a prior `tool.start`. Skipping UI start is the right layer; it is not a new grant (L0/L1, same `list_tabs` execute).

**Evidence:** red test showed unpaired `tool.start` with restored internal keys; tests 26–29 / 1–4 green; 5082 companion tests pass; build green. Do not treat Mac Playwright as Windows physical UI (T2).

### P2 — Playwright DoD does not pin the stuck card

`test-chat-run-ui.py` checks `#busy` (`threadBusy`) and `get_by_text('执行中: list_tabs')`.

- Original bug is **busy already false** + running card (Stop: no active task). `#busy == 'false'` would pass on the broken build.
- CHANGELOG user copy is `执行中：list_tabs` (fullwidth `：`); the locator uses ASCII `:`. Substring match will not hit fullwidth copy, so the visual assert can be vacuously 0.
- Recorded frames are not asserted `type !== 'tool.start'`; store is not asserted free of `tool_calls[].status === 'running'`.

Companion tests **do** lock the wire fix (`site-context-tool-events.test.ts`: no start for metadata; start still emitted for spoofed params and invalid `siteContextTabId`). This is coverage hardness, not a product hole.

### Not issues / unrelated

- Spoof `__site_context_tab_id` in model params cannot hide `list_tabs` (strip-then-restore; test 3).
- Invalid `siteContextTabId` (`-1` / `NaN` / `1.5`) does not take the skip (test 4).
- Failed metadata also emits no start (test 2).
- `chat.done` still not completing *real* in-flight tools: pre-existing, not this change.
- Windows sidepanel not re-run here: in-scope T2, not a reject.

VERDICT: APPROVE_WITH_NITS
