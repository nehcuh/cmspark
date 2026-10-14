# Coding UI #484 / #522 — Grok 4.6 review

Frozen identity used: complete21path R2 diff `afd6118dc75c88b39878f157b436c3e9b6a4f9f16f1208f56c19268056661c43`, source manifest `ef1d3c8d38ee2f45d6e348f59cbe55da543673e8263c7972b18cbc7bff6ceb6a`, base `04353ca73b06e245cf0f114ec1ec946b90173dad`. R1 ARM focused failure remains a real failure; R2 is a single-file test-portability delta. Exact-head CI is pending. Machine counts are implementer receipts; this review did not execute tests, hashes, or native UI.

## Verdict on scope

**#484 T2 is complete** for inactive rich coding cache and live display projection, with the documented exclusions (unbounded tiny markers, ordinary `thread.messages` reload, `acp.list` non-hydration, global frontend memory).

**#522 copy is an honest 60s terminal-workflow alternative**: same `MODE_C_TEMPFILE_TTL_MS = 60_000`, deadline starts at opener request (earlier than unlink-after-settle), click rechecks, timer hides Copy, oversized/missing commands are unavailable as a whole, copy is a local clipboard gesture. Future #481 / #432 / native PTY / T4 work stays unapproved.

Stop treats runtime `{ok:true}` as forwarding. Matching `acp.session.cancel.ack` or a closed lifecycle event is what completes UI stop. Coordinate/title/client 10s wait does not change backend teardown, file TTL, or platform gates.

## Confirmed findings

### P0

None confirmed from the shown source.

### P1

None confirmed from the shown source. The Stop/ack/owner fence, cache exclusions, producer bound, and 60s copy contract hold on the paths that are actually in the packet.

### P2

1. **Closed-without-ack is a weaker stop latch than ack.**
   `agentStore.tsx:1916-1917` ignores late non-closed events only when `cancelConfirmed` is set. `ACP_CANCEL_RECEIPT` (`:1958-1964`) sets that latch; a plain closed `ACP_SESSION_EVENT` (`:1924`, `:1944`) sets `state: "closed"` and clears `stopPending` but leaves `cancelConfirmed` unset.
   **Scenario:** companion closed/`error: "cancelled"` arrives, UI shows 已停止 and hides Stop; a later in-flight `state: "running"` event for the same owner/session is applied, `live` becomes true, Stop returns, while `error ?? previous` can keep `"cancelled"`.
   **Evidence:** reducer source + `coding-control-522.test.ts:24` only locks the ack path. In-order WS makes this uncommon; still a real latch hole.

2. **Any `family: "acp"` error with session+thread becomes a control error.**
   `coding-control-message.ts:10-13` → `ACP_CONTROL_ERROR` at `agentStore.tsx:1966-1973`, which writes `controlError` and sets `stopPending` to false.
   **Scenario:** user is in the 10s wait; an unrelated ACP error with the same ids arrives; pending clears and the raw error (sliced to 1000) is shown as a Stop alert. Completion is still not claimed.

3. **Compact drops `error`, so cancelled-without-ack can read as Done after retirement.**
   `coding-session-cache.ts:10-17` keeps `cancelConfirmed` and `state`, and drops `error`. Panel/chip use `cancelConfirmed || error === "cancelled"` (`CodingAgentPanel.tsx:1126`, `CodingSessionChip.tsx:79`).
   **Scenario:** closed+cancelled never got an ack, then the row is compacted; return UI shows 已收起 plus Done.

4. **`confirmed` is treated as live for copy.**
   `CodingAgentPanel.tsx` live includes `confirmed` (diff hunk at 247); back-link uses that live flag (`:1117`) as “本会话继续运行”. Confirmed is L2-accepted, before running. Stop-on-confirmed is reasonable; the running claim is early.

## Nits / bounds (non-blocking)

- Failed Mode C timeline still includes `可手动粘贴: ${r.commandLine.slice(0, 400)}` (`manager.ts:341-342`). The Copy button stays complete-or-nothing (`progress-caps.ts:26-28`). Pre-existing slice; official copy path is the bounded complete command.
- Chip followup/apply still swallow `lastError` (`CodingSessionChip.tsx:56-58`, `:67-68`). Outside Stop DoD.
- Companion tests share `TERMINAL`, `__testSetOuterOpeners`, `saveConfig`, and `getAcpManager()`. Host+Linux 5/5 is a receipt; file-level isolation is unverified here.
- Client `Date.now()` vs companion deadline can skew Copy visibility around TTL. Hypothetical.

## DoD (inspected)

| Contract | Result |
|---|---|
| Inactive rich ≤16 rows and ≤256KiB UTF-8 | `coding-session-cache.ts:3-4,20-38`; reducer prune on session events, thread switch, clear. Oldest-first, sessionId tie. |
| Protected current / nonterminal / unknown / pending diffs | Candidates require `closed\|handback` and `!hasPendingDiff`; current id excluded unless dismissed. |
| Compacted = identity marker; late events cannot restore bulk/selection | `cacheCompacted` early-return `agentStore.tsx:1916`; clear passes `dismissedId`. |
| 128KiB display projection, no diff bodies, ≤64 descriptors, keep an applyable | `ui-progress.ts:7-53`; manager emits only after `boundCodingProgress` (`manager.ts:205-229`). |
| Canonical diffs/history retained | `lifecycle.ts:660-667` saves then projects; producer test asserts 100 stored diffs and unchanged saved message. |
| Oversized identity withheld, owner ids not rewritten | `ui-progress.ts:50-52`; `manager.ts:229` logs `state` only. |
| Stop: send ok ≠ stopped; matching ack/closed; 10s unconfirmed/retry | `useCodingStop.ts:4-37`; `codingControlAction({ok:true})` is null; receipt reducer owner-checked. |
| Copy: local, ≤32KiB whole command, 60s conservative, no execute/focus | `manager.ts:286-336`; panel copy at `CodingAgentPanel.tsx:1158-1179`; `acp_get_status` excludes the field (test). |
| Mode C Stop = monitor/bridge | Existing label/title helpers; no new kill API. |
| R2 test env restore, no GUI, positive+negative | `acp-coding-feedback-522.test.ts:35-131`; `t.after` restores `TERMINAL` / openers. |

`output_truncated` is explicit on partial live frames. Compacted UI tells the user to open the owning thread’s saved result (`CodingAgentPanel.tsx:1085-1086`).

## Trust / model text

- Launch command is UI-only on ACP progress events. Focused `acp_get_status` assertion shows it is absent from that tool payload.
- Companion control errors are user alerts (`error.slice(0, 1000)`), not a new tool field.
- Live handback may append product copy (“此处仅显示部分输出…”) to the **broadcast** body; canonical `ThreadManager` message is saved first (`lifecycle.ts:660-667`).
- Packet does not include every `AcpSessionRecord` serializer. Extra dump-into-tools paths are **missing context**, not a confirmed leak.

## Trajectory / tests / machine

- R1 ARM `launched.length > 0` failure is retained. Cause described matches production: Linux resolver runs before `outerOpeners.linux`; a headless image with no emulator correctly returns `ok:false`. R2 scopes `TERMINAL` to the owned Node binary and adds a real no-emulator/refused-opener case. That is a fixture fix, not a product waiver.
- Host R1: companion 5930 / 5878 pass / 52 skip, extension 1533/1533, both builds 0 — valid for the 20 unchanged product paths. R2 host/Linux focused 5/5 overlay is the only new execution claim.
- Exact-head CI and the DeepSeekV4Pro twin review are still open merge gates. Availability of this judge is not approval.

## Missing context (limits of this review)

Unshown: `open-local-terminal.ts` resolver body, SW `acp.session.cancel` `sendMessage` return shape, full `useWebSocket` handback/error switch, `copyTextToClipboard` / `composerDisabled`, `run-tests.mjs` concurrency, other session-to-tool dumps, native GUI/PTY.

If the SW callback returns a companion ack **without** `ok: true` and **without** a WS `cancel.ack`, `useCodingStop.ts:28-31` would show “停止请求未发送成功”. Browser fixtures model `{ok:true}` as forwarding; production SW is unverified here.

## Claim boundary

This batch is T2 UI + bounded projection + Stop receipt honesty + a 60s copy alternative. It does not close #481, #432, default outbound, or native interactive PTY. Marker cardinality stays unbounded until a server watermark exists.

VERDICT: APPROVE_WITH_NITS
