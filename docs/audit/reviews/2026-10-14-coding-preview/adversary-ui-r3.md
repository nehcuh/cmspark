# Final R3 Coding UI independent adversarial review

Reviewer: `/root/office_batch`, non-author of UI #484/#522. Date: 2026-10-14. Base: `04353ca73b06e245cf0f114ec1ec946b90173dad`. Scope: the 22-path UI component in the frozen combined snapshot, including its shared WebSocket boundary with preview #532. No source, GitHub, commit, push, app or native environment changes. This does not approve my authored Browser/Office work or the whole release.

## Verdict

**APPROVE_WITH_NITS — final R3 UI component only.** The confirmed R2 P2 that hid closed-session operation refusals, and the compacted-session sibling, are fixed. All four Grok R2 lifecycle/Stop/cancellation/waiting-copy findings are addressed. No remaining confirmed P0/P1/P2 blocker. UI capability remains **T2**: bounded display/cache, existing controls and explicit local clipboard copy. Preview #532 remains separately reviewed T3.

#522 remains partial because its general CLI entry is still missing in the documented scenarios. Root must complete the specified Grok4.6 increment, complete Kimi/final PiPro/DeepSeekV4Pro gates and exact head/native/main CI. This report is an independent component verdict, not merge authorization.

## Packet and source identity

Read the complete UI implementation report and retained R2/R1 history, complete 22-path diff, complete 12-path incremental diff, original #484/#522 bodies, my complete R2 REQUEST_CHANGES report and the full Grok R2 report. Inspected the packet's full-file/caller sections and actual frozen callers. Previously reviewed preview and repeated source material were cross-checked against their exact bytes.

- Full UI diff: `8ef010e505083f67cb727257c2896e49030308408933e69602754627ec4d6567`.
- R2 → final R3 incremental diff: `4b3c75dc8b0d8f4ca79086c601381291d03fbea02b288330d25f4cb34991acdc`.
- Complete context: `c1d2db7663f543b2482a47d05bea8dd083bd194652b3b2db23fd59c38877e5a9`, 6,741 lines, 419,824 Unicode characters / 434,633 bytes.
- All 37 combined source hashes and the 22 UI files were mechanically reverified. All 38 packet full-file/caller code blocks match the frozen source by byte/line. Receipt: `review/office-ui-r3-packet-proof.json`. The first checker regex matched zero sections; it was corrected and required more than 25 matches before recording the final 38-section PASS.
- Shared `useWebSocket.ts` uses combined hash `895e8ad8d9bdfee1d9dda5a211568afe2a4df87b1503c43abfa473644a9b29a6`, rather than the standalone UI hash. My separate preview integration proof recreated the clean three-way merge and checked the entire confirmation request case for byte identity. No routing was dropped.

## Outcome: confirmed defect and sibling fixes

### Closed and compacted operation refusals

`companion/src/acp/handlers.ts:60–70,84–91` now stamps `request_type` from the actual dispatched operation on both owner-mismatch and ordinary errors. It does not trust a caller-supplied metadata field, rebind ownership or weaken confirmation.

`coding-control-message.ts:10–20` maps only exact cancel errors to `ACP_CONTROL_ERROR`. Exact string followup/prompt/apply types map to `ACP_OPERATION_ERROR`. Missing, unknown and non-string types return null without coercion, preserving the hook's previous processingStatus path. The actual merged `useWebSocket.ts:2412–2429` consumes typed actions and otherwise retains its current-thread guard and old feedback flow.

`agentStore.tsx:1998–2006` requires a known immutable row, active matching owner and currently selected session. It stores one notice of at most 1,000 characters at state level, including for closed, cancel-confirmed and compacted rows. It changes neither the rich records, selection, session state nor StopPending. `selectCodingOperationError:110–118` exposes the notice only to that exact current controller. Retry, owner switch/removal, new selection or dismissal clears it; foreign/background/old-session errors cannot contaminate the replacement controller.

`CodingAgentPanel.tsx:1090–1092` shows separate alerts; `CodingSessionChip.tsx:93` shows the same operation alert and `:23–33` prevents automatic dismissal while it exists. Actual producer refusals now remain visible after cancellation and retirement without reopening the session or restoring old output. This directly resolves my R2 counterexample. Pre-existing non-Stop runtime callback lastError handling is outside this repair; it is not claimed fixed.

### Grok R2 sibling findings

| Original finding | Final source and observed behavior |
| --- | --- |
| Closed without ack could return to running | `agentStore.tsx:1935` rejects non-closed states after stored closed or cancelConfirmed. A new ID is required for a new lifecycle. Actual closed events and late running input are tested. |
| An unrelated ACP error could clear pending Stop | Exact request_type routing separates operation notices from Stop state. A real non-Stop refusal leaves StopPending unchanged. |
| Compaction lost the cancelled outcome | `coding-session-cache.ts:17–18` retains a minimal cancelled boolean; reducer `:1963`, panel `:1131`, chip `:84` preserve “已停止” without an ack or rich error text. |
| Offered/confirmed copy claimed running | Panel `:1122/:1131` and chip `:84` show waiting until actual running. Offered comes from the actual manager; confirmed is explicitly a declared UI lifecycle case. |

Existing wrong-owner, compacted, closed and cancel-confirmed Stop fences remain at `agentStore.tsx:1932–1935,1981–1997`. There is no wholesale unlocking of terminal rows. Actual manager.cancel at `:1081–1134` still closes only the monitor/bridge and uses existing owned-child teardown; no new outer-terminal kill or focus capability.

## Cache, producer and command boundaries

- `coding-session-cache.ts:3–4,21–40` enforces 16 eligible rich rows and 256KiB serialized UTF-8, oldest eligible first. Current selected, nonterminal/unknown/running and actionable-diff rows remain protected. Minimal marker count and protected exclusions remain unbounded; there is no global frontend memory claim.
- Actual manager `:205–229` projects before listeners. `ui-progress.ts:7–53` limits the live frame to 128KiB and at most 64 metadata descriptors, preserving a true actionable descriptor beyond index64. Full bodies/hunks stay in canonical backend diffs. Oversized identity is withheld, not rewritten.
- `ws/lifecycle.ts:648–667` saves the full canonical handback before live projection. Ordinary conversation-history hydration remains outside this display budget.
- Generated commands remain complete-or-unavailable at 32KiB UTF-8. Manager `:288,324–336` starts the copy deadline before opener settlement; `win-spawn.ts:383–396` preserves the original 60,000ms unlink. Copy is an explicit local gesture, with a timer and click-time expiry fence, no execution/focus authority and no file-lifetime extension.
- #522 still lacks usable CLI entry when open_local_terminal is false, the command is missing/oversized, or it has expired. Manual-switch advice is not an implemented entry in those cases. Do not use Closes #522; #481/#432 native workbench/PTY remain separate.

## Independent focused evidence

Node 22.23.2 via nvm on the frozen compiled combined snapshot. No full suite or production builds repeated. The executed new cases and actual counterfactual demonstrate that generated test artifacts contain final R3, not stale R2.

1. Frontend control/cache/owner tests: **21/21 PASS**, zero failure/skip/cancellation, 64.883ms. `review/office-ui-r3-extension-focused.log`. Includes closed/compacted errors, exact metadata, notice bounds/reset, StopPending preservation, cancelled marker and closed latch.
2. Independently executed the inspected owned producer probe `review/adversary-ui-r3-counterfactual.cjs`, exit0; own receipt `review/office-ui-r3-counterfactual.log`. Actual manager propose/cancel and actual handler followup/prompt/apply errors pass through the production translator/reducer for closed and compacted owners. Errors are visible with identical record and selection references; foreign/old notices are ignored, owner switch clears them, non-Stop errors preserve pending Stop, and structured request_type is never coerced. Uses a new temporary data directory and synthetic agent; no child launch or user configuration.
3. That probe also checks exact 256KiB / +1 byte and 16 / 17 count boundaries, exact 32KiB command / +1 byte, an actionable descriptor only at index99, no full diff bodies in the 123,529-byte projection, all 100 original diffs retained, and oversized identity withheld. These synthetic probes do not assert native pixel fidelity.
4. Independently reran actual Chromium App/panel/chip DOM: **10 scenario groups PASS**, zero page errors. `review/office-ui-r3-dom.log`. Tests actual closed followup rejection in chip/panel and a fresh App's compacted-owner return/followup with the unchanged captured producer refusal; no rich-cache resurrection. Also covers Stop transport failures, forwarding versus receipt, wrong owner, late callback, missing receipt, exact clipboard copy/no host action/expiry, cancelled no-ack marker and waiting copy. Uses isolated transport/clipboard/opener; no installed extension or native Windows terminal. It is click-driven and is not presented as independent keyboard/native-business acceptance.

## Trajectory, infrastructure and machine scope

R1 headless ARM fixture failure remains preserved. R2 provided a scoped owned TERMINAL selector and a real resolver negative; no product permission/timeout waiver. My R2 actual closed-refusal red and the intermediate compacted-refusal reds remain in the packet. Final R3 fixes them with typed metadata and bounded state-level notices rather than relaxing terminal or owner fences.

The other non-author reviewer failed selected-model capacity twice, ending without a complete verdict. `review/adversary-ui-infra-failures.md` records both. Those incomplete attempts are neither approval nor source rejection. Their actual focused logs remain machine evidence, but this complete report supplies the independent agent verdict. No model substitution or retry loop by this reviewer.

The frozen shared card records full host Companion 5,939 tests / 5,887 pass / 52 existing skips / zero failures or cancellations, frontend 1,546 pass and both builds0. Fresh locked ARM64 runs targeted 204 / 203 pass / one existing Windows-only skip, frontend102 pass and both builds0. ARM is targeted combined coverage, not a full Linux inventory or native Windows proof. Component host20/frontend51/DOM10 and ARM20+51 are separate incremental evidence. Required final named reports and exact-head/native-Windows/main CI remain pending in this review packet.

## Nonblocking nit and disposition

`CodingAgentPanel.tsx:1088` still says a compacted session has “已保存的结果” even when actual cancellation produced no new handback. Conditional copy would be more precise; this existing R2 wording nit does not affect ownership, Stop feedback or cache bounds.

#484 component DoD is met subject to its prescribed Grok4.6 + DeepSeekV4Pro and final standard gates. #522 Stop and temporary valid-command behavior are correct within the delivered scope; its overall CLI entry remains partial. No claim that all UI issues, my authored components or native T4 acceptance are complete.

## Final actual UI source SHA256

| File | Frozen combined SHA256 |
| --- | --- |
| `chrome-extension/scripts/render-workspace-fixture.cjs` | `5d81f1c1f489b9684ee7c987f8029c04a98ab195711a4ff1d6141b9562d8c401` |
| `chrome-extension/scripts/test-coding-feedback-ui.py` | `279c91f6338e9895fe4abc765220b325f27ff5f947ec4951425cd74bbe377e22` |
| `chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx` | `f263d6c1ba51a91e4bea18ee5364e5eadd032362f12e0b755abebe38e993df33` |
| `chrome-extension/src/sidepanel/components/CodingSessionChip.tsx` | `bbce4e5dfb6f8566f98c8732ec5a5f7ce869cf3faa6b096297ef7b1c1a59df9d` |
| `chrome-extension/src/sidepanel/hooks/useCodingStop.ts` | `2be72b1ee4a7b12d3649e328d2b78577d7021f4ad72cb70a0203168133c5f5d9` |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | `895e8ad8d9bdfee1d9dda5a211568afe2a4df87b1503c43abfa473644a9b29a6` |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | `d813d6274d23bf20dfabfa91774723ed7d6acba80fe524e1ff1c708764261dc9` |
| `chrome-extension/src/sidepanel/utils/coding-control-message.ts` | `14486a9798cbab4f61d614d493021c4776b082f0c59559fecf535b1a291d20b3` |
| `chrome-extension/src/sidepanel/utils/coding-session-cache.ts` | `5ed14986eae213e9c88c2ce78c3966fc3342978609d51ebc415d7e6b1f04b17c` |
| `chrome-extension/tests/coding-control-522.test.ts` | `2afab710c48159e9cefe5f013610f82615463db8dbbdda28d46629ce8fd7b2e9` |
| `chrome-extension/tests/coding-session-cache-484.test.ts` | `68f8a42da8569d823050c7764de4e2d555c7b006820d60abdcc17cda5b40cb08` |
| `chrome-extension/tests/fixtures/coding-control-522.json` | `48c84063fac2e4d390da4b0d61c978717d77c97a578ae17baf91fd5272ad39a4` |
| `chrome-extension/tests/fixtures/coding-control-522.md` | `5f1e038ba548272dae1cec879aa0f4445ed7cb28228230f9dd33e2fd2ce4edde` |
| `companion/src/acp/handlers.ts` | `cbd99857b6ffe63d95277bdcf21e0f2c2c389b33487c146f5db44e99705585eb` |
| `companion/src/acp/manager.ts` | `32c60e15324531422be664e6b3fe1ab81ca7a68b7164e823662c7d03439d3aa5` |
| `companion/src/acp/progress-caps.ts` | `6661551656525e285b5dad8e7c19c79eab47ab18b97ce1b00e1d693fd260e8a5` |
| `companion/src/acp/types.ts` | `296acba4e3d870b47e2bfe8cdcc4735f33c23bbafd1d305008d1da53a215874e` |
| `companion/src/acp/ui-progress.ts` | `2b999c6bd8eb77550a1898396eea457098671973dfac1f0d2ff9638d2245f8e2` |
| `companion/src/acp/win-spawn.ts` | `e13987425ca99b9a3ea406351dcc7c706046bbea45fe913bf9335fbf71100363` |
| `companion/src/ws/lifecycle.ts` | `5286642ed74559be663a5337e1031cccd52b58cfec9a88a36a08ec3686f039ef` |
| `companion/tests/acp-coding-feedback-522.test.ts` | `7353886dfddc595350528597a703475e33919223f1dcb5fe1cab1f7c938574dd` |
| `docs/superpowers/specs/2026-10-14-coding-session-feedback-cache.md` | `8676b77dd88e1f7463ea359cb87564671593c1aeb2815c5eab8951a74101800f` |

VERDICT: APPROVE_WITH_NITS — final R3 UI only; no confirmed blocker, T2; #522 partial and final named/native/exact-CI gates preserved.
