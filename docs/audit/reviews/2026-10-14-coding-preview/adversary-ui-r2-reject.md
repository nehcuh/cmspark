# Independent adversarial UI review #484 / #522 — R2

Reviewer `/root/office_batch`, non-author of this UI component. Date2026-10-14. Base exact main `04353ca73b06e245cf0f114ec1ec946b90173dad`. Scope ONLY frozen21path Coding UI/cache group, not my authored Office or Browser groups and not another component's release approval. No source/GitHub/installed-app/permission changes.

## Verdict

**REQUEST_CHANGES — one confirmed P2 regression. No P0/P1 found.** Correct the ACP error routing regression below and revalidate affected caller/negative cases before component approval. Most cache/Stop/copy behavior is well constrained and machine green; that does not negate the reproduced missing feedback. Capability/blast **T2** is reasonable: bounded UI display/cache plus explicit local copy and existing owner-stamped controls; no new L2 capability, silent execution, outer-agent kill or authorization path found.

This is the independent agent gate only. Exact Grok4.6 + DeepSeekV4Pro required by484, root's Kimi/Pi reports and exact head/main CI remain independent gates; none is replaced by this report or its focused tests.

## Confirmed finding P2: non-Stop ACP refusals disappear for closed sessions

Files/lines:
- `chrome-extension/src/sidepanel/utils/coding-control-message.ts:10–13` translates every `type:error,family:acp` with nonempty session/thread IDs into ACP_CONTROL_ERROR, irrespective of operation.
- `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:2419–2420` consumes that action and breaks before the previous SET_PROCESSING_STATUS feedback path.
- `chrome-extension/src/sidepanel/store/agentStore.tsx:1966–1972`, specifically1969, deliberately ignores that action for closed/cancelConfirmed/compacted rows. This is useful for late Stop callbacks but is too broad for other actual user controls.
- Reachable UI: `CodingSessionChip.tsx:46–66` sends acp.session.followup for a closed row; `:106–111` renders the closed-session followup button. The same route handles existing prompt/apply errors. No new button or malformed wire data is needed.

Reproduction using actual producer/callers on exact frozen R2:
1. Isolated CMSPARK_DATA_DIR, synthetic Node agent config, actual AcpManager.propose then cancel (no child/process/terminal launched).
2. Disable ACP through actual local test config; call actual handleAcpWsMessage('acp.session.followup', matching stored owner/session, synthetic goal).
3. Actual handler returns `type:error,family:acp,error:'acp: feature disabled — enable in 设置 → 编程助手'` plus exact session_id/thread_id. The owner stamping is the real handler, not handcrafted expected keys.
4. Actual codingControlAction yields ACP_CONTROL_ERROR. Actual agentReducer returns the identical state object, no row controlError. useWebSocket's unconditional break prevents the old processingStatus path as well.

Owned probe receipt `/tmp/cmspark-coding-ui-wave-20261014/review/adversary-ui-closed-error-probe.log`, exit0, `REPRODUCED`, `reducerDroppedError:true`. Existing unrelated processingStatus value stayed `加载中`; this was not an empty-status-only assertion. The reproduction does not request human confirmation, manipulate an installed app or use user configuration.

Expected: a current explicit followup/prompt/apply refusal remains visible, while stale Stop callbacks must not reopen/contaminate closed/replaced sessions. Limit routing to an identifiable pending Stop transaction, or retain an operation-specific fallback to existing feedback when the new reducer cannot consume the error. Do **not** remove immutable owner/cancelConfirmed/closed fences wholesale; they guard genuine late callbacks. Add a real-handler error negative regression for a closed-session user action and keep existing Stop-late-error tests passing. Existing five new backend cases and successful Stop browser cases do not cover this regression.

## External outcome / issue disposition

### #484 eligible rich inactive cache

Original issue explicitly requests count/bytes for noncurrent/nonrunning records, minimal closed markers, immutable owners, no resurrection, A/B return and server-backed real results. Implementation meets that component scope:
- `coding-session-cache.ts:3–4,20–38`: <=16 eligible rich records and256KiB serialized UTF-8, deterministic oldest first; current selected, all nonterminal/unknown states and actionable diff records protected. Dismissed eligible terminal row compacts immediately. Count/bytes refer to eligible rich subset, not whole state.
- `:10–17`: preserves minimal ownership/session metadata and client-owned cacheCompacted marker. Marker count itself remains intentionally unbounded; running/current/actionable exclusions can also grow. This is a bounded rich-cache repair, not a universal frontend memory guarantee or server-session garbage collector.
- `agentStore.tsx:1913–1917` rejects owner changes, compacted late events and acknowledged-cancel state reversal. `:1947–1955` old-session progress never replaces a newer selection. `:1981–1989` Clear removes selection and compacts bulk without deleting immutable marker.
- `companion/src/acp/manager.ts:184–229` projects before listeners, not merely after JSON has already entered the extension. `ui-progress.ts:7–53` caps UTF-8 wire display, text/timeline and <=64 metadata-only diff descriptors; real actionable descriptor can survive after index64. It drops no stored diffs and never rewrites owner IDs to fit. Oversized identity frame withholds display, not backend data/control authority.
- `ws/lifecycle.ts:648–667` stores canonical full message before bounded live projection. `manager.ts:546–596` keeps complete parsed diffs and handback. Existing generic thread history hydration remains canonical and is outside the 128KiB live display projection; do not claim ordinary history is bounded by this batch.

#484 may be a closure candidate **after** confirmed P2 repair and its prescribed exact judge/CI gates. UI's compacted-result copy assumes an available saved result; cancelled sessions do not create a new handback (manager.cancel:1081–1134). That is a nonblocking wording nit: consider “如有已保存结果，可返回所属主对话查看” for a cancelled marker instead of implying every cancelled output was persisted. It does not undermine cache ownership/budget guarantees.

### #522 Stop and entry

Stop component satisfies the requested honest monitor feedback on supported events: `useCodingStop.ts:8–37` owner captures, visible missing/wrong owner, runtime lastError/refusal/throw, pending-only forwarding,10s unconfirmed retry; `agentStore.tsx:1958–1964` matching receipt adds stopped/timeline once. Actual matching closed event also clears pending. Late callbacks target original row, not replacement; cancel-confirmed state cannot return to running. `manager.cancel:1081–1134` remains only bridge lifecycle and existing child teardown, never taskkill of user outer terminal; Mode C copy still warns external agent may survive.

Original522 allows either a live ACP input or an open/focus terminal **or copying the generated command**. The new CLI copy is a legitimate limited alternative, not a fake TUI: manager retains the complete actual opener result only,32KiB UTF-8 whole-command acceptance, explicit copy only. `CodingAgentPanel.tsx:1158–1189` says manual execution launches Agent and doesn't switch into an already running terminal; CLI composer stays disabled at718–730/1247–1283. `manager.ts:288,324–336` copy deadline starts before opener settlement; `win-spawn.ts:383–396` unchanged60s unlink constant and `open-local-terminal.ts:1596–1598` cleanup remain. Copy expiry cannot extend secret-bearing task file retention.

**Do not call this persistent entry/resume or unconditional whole522 DoD.** Command is unavailable when open_local_terminal snapshot is false (manager:256–258), when command generation fails/oversizes, or after conservative expiry. The UI truthfully directs to an existing terminal but supplies no programmatic focus/resume. The original ticket has no explicit persistent-copy requirement, so safe expiry is not itself a code defect; however a CLI-only user beyond the window has only this limited delivery, and real Windows dogfood interaction was not executed by this reviewer. Report Stop repair plus temporary generated-command alternative with those boundaries, rather than claiming every CLI-only configuration now has an always-usable interactive path. Root should retain explicit residual scope / acceptance if treating original522 as broader ongoing entry requirement.

Historical522 described a Darwin-only embed gate; exactmain already contains584 Windows platform support. Inspected `coding-handoff/embed-entry.ts:87–100`, panel:806–825, manager:272–276 and open-local-terminal:1227–1231; this batch does not change them. Do not attribute that old premise or a Windows PTY/native acceptance to this UI patch;432 remains independent.

## Process and machine evidence

Read the complete original484/522 issue bodies, full R2 implementation report and full21path diff; inspected full new helpers/tests/recorded fixture and packet full-file/caller sections, then actual frozen production caller ranges beyond the packet. All21 source files mechanically reverified against current manifest before and after focused probes. R1 report/table hashes are historical, not current frozen approval.

Packet identity:
- context.md SHA256 `d5c5340125a3867eb9425ff74e202991c687afbfa107179f3e060ba36729ea7e` (232798 bytes)
- full.diff SHA256 `afd6118dc75c88b39878f157b436c3e9b6a4f9f16f1208f56c19268056661c43` (90909 bytes)
- implementation.md SHA256 `f0769c4ec80b9c4c958585ce51fe87be5bfbf6126e6bd23ad17c0e18a11f980b`
- manifest SHA256 `ef1d3c8d38ee2f45d6e348f59cbe55da543673e8263c7972b18cbc7bff6ceb6a`
- machine SHA256 `5e2473103cba10e028d2a6e707802c9a84f137ab11c5c00808fbc14d850a278f`

Shared gate scope retained accurately: host Companion5930/5878PASS52existing skips, front1533PASS and both builds0 apply to unchanged product. R1 freshARM failure is genuine and retained in machine-r1-failed.json/linux-test.log; positive test's native Linux resolver needed a valid owned TERMINAL selector before fake opener. R2 alters only test portability, restores environment via after and adds actual missing-native-terminal/refused-opener negative. Shared freshARM R2 targeted143/142PASS1existing skip plusfront43 and both builds0; this is not Linux full inventory. No product timeout/skip/permission changes.

Independent verification on frozen snapshot (nvm22.23.2):
- Initially existing compiled Companion test artifact ran4/4 R1 cases, receipt retained as `review/adversary-ui-companion-focused.log`; **not** R2 approval evidence. Source hashes were correct but .test-dist stale. Test compilation then canonical affected runner produced actual R2 **5/5 PASS**,0fail/skip/cancel, log `review/adversary-ui-companion-r2-focused.log` (2448.44ms).
- Extension actual control/cache/owner tests **13/13 PASS**,0fail/skip/cancel, `review/adversary-ui-extension-focused.log`.
- Actual Chromium App/panel/chip DOM script independently rerun with uv and isolated recorded real producer JSON, **six grouped scenarios PASS**, `review/adversary-ui-dom.log`. It tests real role controls/click, runtime lastError/refusal/throw, forwarding-not-stop, wrong-owner ack, real ack/closed, old callback replacement, missing receipt timeout, exact clipboard/no host action, failure and expiry,100 rich closed records/count/bytes and stale compacted control. It uses a stub transport, isolated clipboard and aligned frozen expiry clock; not an installed extension/live Companion/native Windows terminal. No independent keyboard/OS process interaction claim from this click-driven run.
- Additional adversarial display probe `review/adversary-ui-extra-probe.log`: actual production helper with100 descriptors, actionableonlyindex99, full synthetic bodies and 60 Unicode-heavy timeline rows => event126174bytes, live handback27834bytes, late actionable descriptor preserved, no diff bodies, original inputs unmutated, oversized owner frame null. No stored message mutation.
- Actual non-Stop closed refusal probe reproduces confirmedP2, above. Passing tests do not override this negative.

No whole-repo repetition, no source mutation, no dependency/package/lock changes, no GitHub comment/close/commit/push. Recompilation changed generated snapshot test artifacts only; frozen source hashes still match. Component approval withheld pending P2 repair and targeted counterfactual regression. All external named reviews/exact CI/native acceptance claims remain root-owned.

## Frozen file SHA256

| File | SHA256 |
| --- | --- |
| `chrome-extension/scripts/render-workspace-fixture.cjs` | `5d81f1c1f489b9684ee7c987f8029c04a98ab195711a4ff1d6141b9562d8c401` |
| `chrome-extension/scripts/test-coding-feedback-ui.py` | `cac0e97e811f7f77d82c722c3bc878ce894a0414741616a273a27b7a60da117d` |
| `chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx` | `c14577c0ccd00d86e8ba4f032673ae169ee10a57db08b53efbaaa6a915dbf18d` |
| `chrome-extension/src/sidepanel/components/CodingSessionChip.tsx` | `c1280d74e0de6a782f71f24f799b42f93cc4efa67c68562ec8fd8e5e33990195` |
| `chrome-extension/src/sidepanel/hooks/useCodingStop.ts` | `2be72b1ee4a7b12d3649e328d2b78577d7021f4ad72cb70a0203168133c5f5d9` |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | `51815f9d8dc7397b81c582690ce6866a6906d06f8088242750aa79b0297273cb` |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | `cf90a62f0513e73ee55d498beb5e434c9bf2e3d7a28394d21acb29d1c4c5ad23` |
| `chrome-extension/src/sidepanel/utils/coding-control-message.ts` | `6819d5bbb530af0a726c679e4d5568c0370da197f76da92d4a2bfe1bf24fa138` |
| `chrome-extension/src/sidepanel/utils/coding-session-cache.ts` | `c3294280a9687357e53c401b3657c8bd568fea15562ea0b67da53ed962cd4c7a` |
| `chrome-extension/tests/coding-control-522.test.ts` | `746d964817153f186deeb27ab0e05f56f471d164ca0afed2d82277aac12acb44` |
| `chrome-extension/tests/coding-session-cache-484.test.ts` | `68f8a42da8569d823050c7764de4e2d555c7b006820d60abdcc17cda5b40cb08` |
| `chrome-extension/tests/fixtures/coding-control-522.json` | `be67be7e311dff3f92ed1957c112081cb9a113e30c293bde65e4785c6a89df39` |
| `chrome-extension/tests/fixtures/coding-control-522.md` | `26697e4cf1b7021982b928f98257e9dba32737dedf4be7e7214354cd5f2677b9` |
| `companion/src/acp/manager.ts` | `32c60e15324531422be664e6b3fe1ab81ca7a68b7164e823662c7d03439d3aa5` |
| `companion/src/acp/progress-caps.ts` | `6661551656525e285b5dad8e7c19c79eab47ab18b97ce1b00e1d693fd260e8a5` |
| `companion/src/acp/types.ts` | `296acba4e3d870b47e2bfe8cdcc4735f33c23bbafd1d305008d1da53a215874e` |
| `companion/src/acp/ui-progress.ts` | `2b999c6bd8eb77550a1898396eea457098671973dfac1f0d2ff9638d2245f8e2` |
| `companion/src/acp/win-spawn.ts` | `e13987425ca99b9a3ea406351dcc7c706046bbea45fe913bf9335fbf71100363` |
| `companion/src/ws/lifecycle.ts` | `5286642ed74559be663a5337e1031cccd52b58cfec9a88a36a08ec3686f039ef` |
| `companion/tests/acp-coding-feedback-522.test.ts` | `84ab3cfa8bc472d75092fce92d4a47155cad944197c66565a7ee6c16cc72adf6` |
| `docs/superpowers/specs/2026-10-14-coding-session-feedback-cache.md` | `9243794d6225f4999e53aa1b9e42f28a33843f257bd1859fabaca72f02566851` |

VERDICT: REQUEST_CHANGES (confirmed P2), no P0/P1; T2 component scope only, no release/merge/whole522 claim.
