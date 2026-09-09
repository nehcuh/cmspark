P1 — Suppression condition checks `finalParams.__site_context_tab_id !== undefined` after `contextReadParams`, but the internal metadata path also has other server-owned params (`__thread_id`); any LLM/WS JSON `list_tabs` call whose params include `__site_context_tab_id` as a JSON value will still reach `tool.start` unless the spoofed key is stripped first. The test `"ordinary list_tabs stays visible, even with spoofed internal params or id"` passes `{ __thread_id, __site_context_tab_id: 17 }` directly to `execute`, expecting a start; this confirms spoofed JSON params are stripped to `undefined`, but it does not cover the narrow window if stripping fails or if another internal marker is restored. Not exploitable end-to-end because `contextReadParams` always strips and only opts-in restores, so this is defensive-only; the suppression check would be safer on `invokeOpts?.siteContextTabId !== undefined` directly rather than the derived param.

Evidence: `companion/src/server.ts:467`, `companion/src/server.ts:571`, `companion/src/site-context/admission.ts`.

P2 — `ws.send` for `tool.start` is still called before the multi-agent pregate (`server.ts:571` vs `server.ts:590`), while the existing fixed semantics around `tool.start` vs `tool.execute` remain unchanged. The internal metadata path is also still emitted as a `list_tabs` `tool.execute` to the authenticated extension; this is by design per capability, but it means a malicious local WebSocket peer could send a `tool.result` for the internal `site-context-*` id before the real extension result and `handleToolResult` will accept it if `originWs` is not the real extension peer (existing SEC-E check). This is outside the issue's observable DoD and does not alter `stopped:false` semantics.

Evidence: `companion/src/ws/tool-forward.ts:handleToolResult`, `companion/src/server.ts:571`.

P2 — The UI test harness is a browser replay of recorded production-like frames, not a real Windows Chrome extension run. The issue's real `执行中: list_tabs` residual after first turn + cached thread switch is plausibly covered by the suppression check and `tool.result` pairing, but the observable DoD "real model list_tabs remains visible" and "real Windows physical UI" are delegated to the user and not evidenced here. No Mac Chrome inference was made, and the test scope is L0/L1 only.

Evidence: `chrome-extension/scripts/test-chat-run-ui.py`, `companion/scripts/record-chat-run-fixture.cjs`.

No P0 findings. Existing `stopped:false` semantics are not modified.

VERDICT: APPROVE_WITH_NITS