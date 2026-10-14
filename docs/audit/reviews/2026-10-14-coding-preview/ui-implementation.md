# R3 final frozen coding UI repair — #484 / #522

Status: actual producer RED → focused host/real ARM64/actual App DOM GREEN. Source now frozen; NOT self-approved, committed, pushed, merged or issue closure. Root owns renewed independent/named-model review and exact CI. This final R3 includes the compacted-path and typed-metadata refinements requested while R3 was in development; there was no intermediate R3 approval or release.

Full **22-path** patch `/tmp/cmspark-coding-ui-484-522.diff`, SHA256 **8ef010e505083f67cb727257c2896e49030308408933e69602754627ec4d6567**; manifest `/tmp/cmspark-coding-ui-484-522-manifest.json`. Incremental **12-path** delta against root's immutable R2 combined snapshot `/tmp/cmspark-coding-ui-r3-incremental.diff`, SHA256 **4b3c75dc8b0d8f4ca79086c601381291d03fbea02b288330d25f4cb34991acdc**; exact changed list `/tmp/cmspark-coding-ui-r3-delta-summary.json`. All tracked AND new untracked files are in the complete patch. The earlier preliminary R3 hash346a7c24 is superseded and is not this frozen receipt.

Own branch/base remain `codex/coding-ui-484-522` / `e5b3511bc6e3ed36aca9c71314ec21ae1f3bf5a8`. Root may combine these files with main04353ca7 without UI-overlapping Browser changes; I did not broad-rebase, replay old Cooperation changes or edit root's shared frozen snapshot.

## Actual defects and final repairs

- **Office P2, closed followup invisible:** real `handleAcpWsMessage` feature-disabled followup returns an owner/session ACP error; R2 guessed it was a Stop refusal and consumed it, while the reducer refused a closed row. Real captured before-tag producer `/tmp/cmspark-coding-522-producer-r3-before.json` and `/tmp/cmspark-coding-ui-r3-reducer-red.log` show the failure. Root's independent producer probe `/tmp/cmspark-coding-ui-wave-20261014/review/adversary-ui-closed-error-probe.log` retains the original actual hook/reducer failure. Actual App R2 source/producer browser red `/tmp/cmspark-coding-ui-r3-browser-red.log` times out on the closed chip's missing alert. No fabricated error keys were used.
- **Root sibling P2, compacted followup invisible:** after retiring the unchanged captured stopped session while away, return to its actual owner and click the actual closed chip Followup. The real producer refusal was still consumed by the new action routing, but the intermediate row-level reducer rejected compacted records. `/tmp/cmspark-coding-ui-r3-compacted-reducer-red.log` is1 actual failure; `/tmp/cmspark-coding-ui-r3-compacted-browser-red.log` is an actual App missing-alert failure. Both retained, rather than relabelled green.
- **Final typed routing:** producer `companion/src/acp/handlers.ts:69,89` stamps `request_type` from the actual dispatched operation. `coding-control-message.ts:10` routes exact cancel errors to Stop state; `:14` routes only string exact followup/prompt/apply types to operation feedback. Missing/unknown/nonstrings retain the prior processingStatus flow, with no arbitrary String/toString coercion. Actual producer fixture changes only the metadata field for structured/legacy negatives; no schema/permission/tool expansion.
- **Final bounded operation notice:** `agentStore.tsx:1998` accepts a non-Stop error only for a known immutable owner, currently active thread and selected session. It stores one at-most1000-character owner/session notice at state level; it never edits the session records or selection. `selectCodingOperationError` at`:110` exposes it only to that exact current controller. This includes closed/cancel-confirmed/compacted rows and leaves StopPending unchanged. Retry, owner switch/removal, new selected session or dismissal clears the notice; late background/old-session/wrong-owner errors are ignored. `CodingSessionChip.tsx:25,93` keeps the rejection visible and prevents auto-dismiss while this notice exists; panel`:1090` shows the same notice. Compacted rich payload stays absent and record/selection references are explicitly asserted identical.
- **Grok sibling findings:** plain authoritative closed rows are terminal even without ack (`agentStore.tsx:1936`), and same-ID late running cannot revive them. Compaction retains a minimal `cancelled` marker (`coding-session-cache.ts:17`), preserving stopped copy when rich error/ack are absent. Offered/declared-confirmed copy is waiting, and return text says not started (`CodingAgentPanel.tsx:1122,1131`, chip`:84`); running copy remains only for actual running. Non-Stop refusals cannot clear a pending Stop. Existing acknowledged/compacted/wrong-owner Stop fences remain intact.

These are bounded existing-behavior fixes. No new runtime, owner rebinding, permissions, autoexecution, native focus/kill, timeout changes or60-second file-lifetime extension. Non-Stop **runtime callback** swallowing remains preexisting and outside this incremental fix; this report claims only actual delivered Companion error feedback.

## Machine evidence for final source

| Gate | Actual result / receipt |
|---|---|
| Host Companion production handler/owner/final producer focused group | **20/20 PASS**,0 fail/skip/cancel; `/tmp/cmspark-coding-ui-r3-companion-focused.log`; tests `acp-coding-feedback-522`, `acp-handlers-gates`, `acp-owner-dispatch` after test compilation. Handler/test source unchanged by final frontend refinement. |
| Host frontend control/cache/owner/embed focused group | **51/51 PASS**,0 fail/skip/cancel; `/tmp/cmspark-coding-ui-r3-extension-focused.log`. Includes actual compacted-owner refusal, immutable record/selection, current-owner notice reset/bound, structured metadata, pending Stop, closed late-running and cancelled retirement negatives. |
| Actual browser App/panel/chip | **10 scenario groups PASS**, no browser page errors; `/tmp/cmspark-coding-ui-r3-browser-green.log`. Includes unchanged actual producer closed refusal in chip/panel, separate fresh-page compacted-return-Followup rejection, no rich-cache resurrection, runtime Stop failures, authoritative receipt, late callbacks, valid command copy/no host call/expiry/missing command, cache budget, cancelled noack and honest waiting copy. Isolated synthetic transport/clipboard/native opener; no model or live terminal execution. |
| Actual ARM64 Linux | **20/20 Companion +51/51 frontend PASS**,0 fail/skip/cancel; `/tmp/cmspark-coding-ui-r3-linux-focused.log`. Root's existing fresh `cmspark-coding-ui-wave:20261014` image; exact22 source files mounted readonly, both affected test suites compiled inside Linux. Command `/tmp/cmspark-coding-ui-r3-linux-command.sh`. This is incremental real Linux evidence, not a repeated whole-repo inventory. |
| Host builds | Companion and frontend **exit0**, `/tmp/cmspark-coding-ui-r3-companion-build.log`, `/tmp/cmspark-coding-ui-r3-extension-build.log`; final frontend built after notice reset refinement. Companion compiled product source unchanged thereafter. |
| Patch whitespace/source inventory | `git diff --check` PASS; exactly22 known changed/new paths, no unexpected source changes, all hashes below. |

Actual producer after-tag capture `/tmp/cmspark-coding-522-producer-r3-after.json` records offered, actual concurrent CLI prompt refusal, wrong-owner cancel refusal, owner-stamped ack/closed output and actual closed followup/prompt/apply refusal. Fixture provenance `chrome-extension/tests/fixtures/coding-control-522.md`. Only synthetic opaque IDs and owned workspace/executable/task-file paths normalized; production payload keys preserved. Declared confirmed is explicitly a UI lifecycle input, not falsely described as emitted by today's manager.

Root's previous whole-host5930/5878pass52existing skip and front1533/full builds were R1/R2 combined baseline evidence, not today's R3 whole-inventory claim. No duplicate full-repo rerun requested; root coordinates remaining shared gates. R2 Grok's APPROVE_WITH_NITS does not supersede Office's actual P2; all original red records and full named-model reports remain. R3 final requires affected independent rerereview and named-model increment; actual requested `grok-4.6` may resolve to `grok-4.6-build`, root retains exact model metadata. Do not substitute CLI brand or unrelated models for specified Grok4.6 / DeepSeekV4Pro. Exact CI has not started for this frozen patch.

## Issue closure boundaries

**#484:** proposed full bounded inactive coding-cache behavior, actual producer emission projection and backend canonical-history separation are implemented; real producer10,127,213-byte/100diff RED →124,776-byte/64descriptor GREEN from R1 is retained below. Current scope is `codingSessionsById` inactive/noncurrent rich cache, not generic conversation-history pagination. Protected live/current/actionable rows and unbounded tiny identity-marker count are stated explicitly. DoD still needs root's specified fresh independent/named reviews and exact CI before closure.

**#522 remains PARTIAL:** Stop feedback and current optional valid original command copy are implemented and verified. Default `open_local_terminal=false`, missing/oversize command and command older than the original60s TTL still have **no usable CLI entry**; manual-switch instruction is not the required entry implementation. No fake persistent/resumable command is offered. Do not write `Closes #522`; remaining safe entry design/implementation is still needed. Existing ACP same-session input, independent embedded-terminal work and optional copy during validity do not cover these missing scenarios. #481 stays OPEN/explicit partial; #432 native proof is not supplied by this UI batch.

## Final exact file hashes

| Path | SHA256 |
|---|---|
| `chrome-extension/scripts/render-workspace-fixture.cjs` | `5d81f1c1f489b9684ee7c987f8029c04a98ab195711a4ff1d6141b9562d8c401` |
| `chrome-extension/scripts/test-coding-feedback-ui.py` | `279c91f6338e9895fe4abc765220b325f27ff5f947ec4951425cd74bbe377e22` |
| `chrome-extension/src/sidepanel/components/CodingAgentPanel.tsx` | `f263d6c1ba51a91e4bea18ee5364e5eadd032362f12e0b755abebe38e993df33` |
| `chrome-extension/src/sidepanel/components/CodingSessionChip.tsx` | `bbce4e5dfb6f8566f98c8732ec5a5f7ce869cf3faa6b096297ef7b1c1a59df9d` |
| `chrome-extension/src/sidepanel/hooks/useCodingStop.ts` | `2be72b1ee4a7b12d3649e328d2b78577d7021f4ad72cb70a0203168133c5f5d9` |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | `51815f9d8dc7397b81c582690ce6866a6906d06f8088242750aa79b0297273cb` |
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

## Retained R2/R1 history (historical source identities/gate scope; final R3 above supersedes current-path references)

# R2 frozen test-portability repair — #484 / #522

Status: R2 affected-file host + real ARM64 Linux PASS; source frozen, independent named reviews/exact CI pending. No commit/push/self-approval.

R1 remains a real failure: root's fresh ARM image passed both builds but focused suite142 tests had140 pass,1 failure,1 existing Windows skip; `launched.length > 0` failed in `acp-coding-feedback-522.test.ts`. Original `/tmp/cmspark-coding-ui-wave-20261014/linux-test.log` and preserved `/tmp/cmspark-coding-ui-linux-r1-failure.log` retained. R1 full diff/manifest/report saved as `/tmp/cmspark-coding-ui-484-522-r1.diff`, `/tmp/cmspark-coding-ui-484-522-r1-manifest.json`, `/tmp/cmspark-coding-ui-implementation-r1.md`; r1 hash `e518534438dab121877190f795f26e02875e435efb6284a8775f19dc81478098` is not R2 approval evidence.

## Actual cause and bounded fix

`open-local-terminal.ts:1421` calls actual `resolveLinuxTerminalFromPref` BEFORE `outerOpeners.linux`. The headless image has no native `/usr/bin` emulator and no TERMINAL selector, so actual code correctly returns `ok:false`, no opened level, and the generated complete manual paste command. The test accidentally expected its fake successful opener to be reached without providing a resolvable terminal. This is a portability defect in the positive fixture, not evidence that production should pretend a GUI terminal opened.

R2 modifies **only** `companion/tests/acp-coding-feedback-522.test.ts`; all other20 frozen file SHA256 values unchanged, mechanically verified. The positive actual lifecycle fixture scopes `process.env.TERMINAL` to the already-owned Node executable and explicitly uses `auto` preference. The fake Linux opener asserts the selected path equals that owned selector; no native binary/GUI is invoked. `test.after` restores the exact original TERMINAL value or removes the variable if originally absent, including early assertion failures. Original nonempty-launch/full generated-command/exact-owner/expiry/tool-negative assertions remain intact.

An additional real Linux no-terminal/refused-opener negative test removes the selector temporarily and uses the actual native resolver. On headless ARM and this macOS host, no emulator exists: the fake opener is never invoked, result honestly reports no terminal and preserves the generated complete manual command. On a future desktop Linux runner with an emulator, the controlled opener throws for both L1/L0; the same failure/fallback contract is verified. Neither branch skips the case or opens a GUI. The original env/opener overrides are restored by test.after. No product-source changes, permissions, original60,000ms unlink TTL, process timeout or Windows behavior changed in R2.

## Incremental machine receipt

- Host/macOS nvm22: tsc test compile + canonical affected-file runner **5/5 PASS**,0 failure/skip/cancel; `/tmp/cmspark-coding-ui-host-r2-focused.log`.
- Real Docker ARM64 Linux: existing fresh `cmspark-coding-ui-wave:20261014` image (inspected architecturearm64), only this exact test-source file mounted read-only over frozen R1 path; tsc test compilation then canonical affected-file runner **5/5 PASS**,0 failure/skip/cancel; `/tmp/cmspark-coding-ui-linux-r2-focused.log`. New negative executes actual missing-emulator preflight, no fake PASS/skip.
- `git diff --check` PASS. Source manifest mechanically verifies only one changed file vs R1. No host whole-repo/front repeat because product20paths unchanged. Root's shared R1 host inventory5930total5878PASS52existing skips, front1533PASS and both builds0 are retained product-baseline evidence; do not silently relabel them an R2 full inventory or claim143fullfocused rerun. Exact CI/named reviews will run frozenR2.

```sh
# Host: nvm use22, companion test compilation first
node scripts/run-tests.mjs .test-dist/tests/acp-coding-feedback-522.test.js
# Linux: test source overlay only, temporary container discarded
 docker run --rm --platform linux/arm64 --entrypoint bash -v /Users/huchen/.codex/worktrees/cooperation-convergence/cmspark/companion/tests/acp-coding-feedback-522.test.ts:/opt/cmspark/companion/tests/acp-coding-feedback-522.test.ts:ro cmspark-coding-ui-wave:20261014 -lc 'cd /opt/cmspark/companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/acp-coding-feedback-522.test.js'
```

## Frozen artifact identity

Full21path R2 diff `/tmp/cmspark-coding-ui-484-522.diff`, SHA256 **afd6118dc75c88b39878f157b436c3e9b6a4f9f16f1208f56c19268056661c43**. Full R2 manifest `/tmp/cmspark-coding-ui-484-522-manifest.json`. Incremental single-test delta `/tmp/cmspark-coding-ui-r2-test-portability.diff` SHA256 `c1a3bb2f6ff61ced204b1e348fdcc7abaa224e46ee36cfeeac7b2f8c51b9bb9a`. Changed test SHA256 `84ab3cfa8bc472d75092fce92d4a47155cad944197c66565a7ee6c16cc72adf6`.

Root's combined snapshot remains main04353ca7 + these21paths. Own implementation worktree remains e5 base, no broad rebase/drop. The exact named Grok4.6 and DeepSeekV4Pro judge routes are available per root's real probes; availability is not code approval. No substitute model, self-approval or issue closure.

## Retained R1 implementation and evidence (historical; R2 overrides its frozen hash/status)

# Coding UI #484 / #522 — frozen implementation for shared independent gates

Status: IMPLEMENTED + focused host machine/browser PASS; NOT self-approved, NOT committed/pushed, NOT issue closure/release approval. Root owns final host/Linux/CI and exact Grok4.6 + DeepSeekV4Pro independent reviews. Freeze source after this report.

Branch `codex/coding-ui-484-522`, worktree `/Users/huchen/.codex/worktrees/cooperation-convergence/cmspark`, base `e5b3511bc6e3ed36aca9c71314ec21ae1f3bf5a8`. Later Browser+623 main `04353ca73b06e245cf0f114ec1ec946b90173dad` is root-owned, unrelated paths; no broad rebase/drop performed. Old own eight Cooperation files verified byte-equal to main before known-path-only stash; backup `/tmp/cmspark-cooperation-pre-coding-ui-backup.diff` + `.json`, stash retained, duplicate patch not applied.

Full patch `/tmp/cmspark-coding-ui-484-522.diff` SHA256 **e518534438dab121877190f795f26e02875e435efb6284a8775f19dc81478098**, including all 21 changed/new paths. Exact file manifest `/tmp/cmspark-coding-ui-484-522-manifest.json`; tracked-only git diff intentionally omits untracked new files and is not the complete patch.

## Outcome / DoD matrix

| Issue | Production change | Real evidence | Closure boundary |
|---|---|---|---|
| #484 inactive rich cache | 16 eligible rich rows AND 256KiB serialized UTF-8 bytes; oldest eligible retire to minimal immutable owner/session metadata. Current selected, running/offered/confirmed/unknown and actionable diffs protected. Terminal Clear retires immediately; compacted late events cannot recreate output or select a controller. | Original reducer 4/4 RED; new cache + existing owner reducer 11/11 green, final frontend group43/43. Actual Chromium App tests100 closed rows, byte/count bound, protected owner, owner-return notice and no stale resurrection. | Tiny identity-marker count intentionally unbounded without a server watermark/epoch; exclusions deliberate. This bounds inactive rich coding cache, not global frontend/history memory. |
| #484 real producer | ACP live progress and live handback display project before WS listeners/broadcast, 128KiB UTF-8 budget; finite text/timeline fields, no full diff body/hunks, <=64 actual descriptors retaining a true actionable descriptor. `output_truncated` explicitly signals partial display. Oversized identity metadata withheld rather than rewriting ownership. | Identical actual manager producer probe on compiled frozen e5 emits **10,127,213 bytes**, 100 full diff descriptors: RED. Current emits **124,776 bytes**, 64 metadata descriptors, no full bodies: GREEN. Real canonical100 parsed diffs remain backend-complete; actual ThreadManager saved message unchanged after live projection. | Generic ordinary `thread.messages` initial/reload sends canonical saved messages and remains out of this coding-cache scope. It is not claimed globally frame/memory bounded. `acp.list` only lists agents, no closed-session hydration. |
| #522 Stop | Shared actual panel/chip Stop hook captures exact owner/session; request only marks pending. Runtime lastError/refusal/throw and Companion error visible. Actual matching ack/closed event establishes stopped status; repeated ack idempotent, late running cannot undo ack. Lost receipt10s => visible unconfirmed/retry, never completion. | Real CLI manager starts isolated Node stdin child; actual handler wrong-owner refusal cannot cancel, actual owner-stamped cancel ack and monitor-stop timeline recorded. Chromium baseline e5 panel RED swallowed error; current browser lastError/refusal/throw, forwarding-not-stop, wrong-owner ack, real ack/event, late callback/replacement, chip error and missing-receipt retry GREEN. | Mode C Stop remains monitor/bridge only; outer/embedded agent is not killed. No tool/permission/native kill changes. UI wait deadline does not change backend teardown/process timeout. |
| #522 CLI entry alternative | Retains exact original generated outer command <=32KiB UTF-8. Copy is local explicit gesture, no runtime execute/focus/relaunch. Conservative expiry starts at opener request + existing60s temporary-file unlink TTL; timer removes Copy and click rechecks. Missing/oversize/expired clearly unavailable, direct user to existing external terminal. | Actual producer command/expiry retained in owner-stamped events. Actual `acp_get_status` excludes new command field/content (UI-only). UTF-8 boundary test accepts exact32KiB and declines whole oversized command; no truncation. Chromium clipboard equals recorded original command, sends zero host actions, failure visible, expiry hides Copy, CLI composer remains disabled. | Supported temporary copy alternative only while valid; no claim of persistent resume or programmatic focus. Existing original file retention unchanged; constant extraction preserves60,000ms. Test clock aligns frozen actual expiry, never modifies production clock. |

Original issues read in full. #484 explicitly requires **Grok4.6 + DeepSeekV4Pro**, not generic Kimi/Pi/Flash substitution. #481 remains OPEN (explicit delivered partial phase, project entity/native/global activity future). #432 native real PTY/packaged interactive proof remains missing; synthetic xterm/PTY does not close it.

## Machine / browser evidence (this frozen group)

- Companion canonical runner:142 total,141 PASS,1 existing Windows-only PS5.1 encoding skip,0 failure/cancel; `/tmp/cmspark-coding-ui-companion-focused.log`. Actual new cases cover UTF-8 command bound, owner-stamped real CLI command/cancel producer + tool projection negative, real oversized terminal producer/canonical result preservation, oversized identity withholding. Focused related outer-terminal/Mode C/handler/owner suites only.
- Extension43/43 PASS,0 skip/failure/cancel; `/tmp/cmspark-coding-ui-extension-focused.log` (cache/control/owner/embed-entry). tsc test compile succeeds.
- Actual Chromium App/panel/chip6 grouped scenarios PASS `/tmp/cmspark-coding-ui-browser-green.log`, including missing receipt timeout, automatic original-command expiry, local clipboard failure and count/UTF-8 retirement. Browser uses isolated transport + captured real producer JSON; no live Companion/server/model/terminal/installed extension.
- Existing actual App responsive/ownership/control workspace smoke PASS `/tmp/cmspark-coding-ui-workspace-browser.log`; no all-frontend repetition.
- Companion `npm run build` exit0 `/tmp/cmspark-coding-ui-companion-build.log`; extension `npm run build` exit0 `/tmp/cmspark-coding-ui-extension-build.log` (Plasmo). Sidepanel hygiene PASS; `git diff --check` PASS.
- Red records retained: `/tmp/cmspark-coding-ui-cache-red.log`4 failures; `/tmp/cmspark-coding-ui-command-red.log` actual discarded command; `/tmp/cmspark-coding-ui-browser-red.log` frozen baseline missing visible callback error; `/tmp/cmspark-coding-ui-producer-red.log` original10MB closed frame. Red baseline source extracted by git archive from exacte5, compiled with same nvm22 dependencies, own temporary data only. `/tmp/cmspark-coding-ui-producer-baseline-path` records isolated source directory.
- Same standalone real producer probe `/tmp/cmspark-coding-ui-producer-boundary-probe.cjs` runs against either compiled root; current `/tmp/cmspark-coding-ui-producer-green.log` contains exact JSON receipt. No fake payload keys; public final command/control fixture captured from real producer `/tmp/cmspark-coding-522-producer.json` and checked in `chrome-extension/tests/fixtures/coding-control-522.json` (only synthetic tasks/identities, normalized opaque IDs/owned paths).

Focused commands (nvm22 first):

```sh
# companion (test compilation first)
node scripts/run-tests.mjs .test-dist/tests/acp-coding-feedback-522.test.js .test-dist/tests/acp-open-local-terminal.test.js .test-dist/tests/acp-embed-mode-c.test.js .test-dist/tests/acp-handlers-gates.test.js .test-dist/tests/acp-owner-dispatch.test.js
# extension (test compilation first)
node --test .test-dist/tests/coding-control-522.test.js .test-dist/tests/coding-session-cache-484.test.js .test-dist/tests/coding-session-owner-483.test.js .test-dist/tests/coding-panel-embed-entry.test.js
uv run --no-project /Users/huchen/Projects/ITCra/.venv/bin/python scripts/test-coding-feedback-ui.py
uv run --no-project /Users/huchen/Projects/ITCra/.venv/bin/python scripts/test-workspace-ui.py
```

## Exact named review gates / configuration entry points

Only path/model metadata discovered; no secret configuration content read or copied. Historical actual model provenance in `docs/audit/0.7.0-20260907/model-identity-correction.md`, `451-review-disposition.md`, `reviews/452-grok-r2.md`, `reviews/457-deepseek-r3.md`.

- Old custom Grok wrapper `/Users/huchen/.local/bin/grok`, configuration `/Users/huchen/.grok/config.toml`, exact model `grok-4.6`. Root independently proved old0.2.111 client426 upgrade blocker, preserved symlink, then installed official1.0.52 into independent private prefix and real explicit Grok4.6 availability exited0. The private installed path is root-owned; do not overwrite the custom wrapper.
- Historical DeepSeek route `/opt/homebrew/bin/claude`, configuration `/Users/huchen/.claude/settings.json`, actual model `deepseek-v4-pro`. Root's current explicit Claude route returned400 model missing; this CLI route is not current approval evidence.
- Root independently proved `pi --provider deepseek --model deepseek-v4-pro` no-tools actual availability exit0. Existing CLI located `/Users/huchen/.nvm/versions/node/v24.20.0/bin/pi`, settings entry `/Users/huchen/.pi/agent/settings.json`; invoke through root's correct Node setup, pin actual provider/model response identity. Pi brand is not a judge family; exact actual DeepSeek model must be recorded.
- Both exact judges now available according to root's actual probes, but **this frozen diff has not yet been independently reviewed**. Root must run both on this same frozen hash. Availability ≠ approval. Linux and exact CI likewise pending; do not self-close or claim release.

## Source anchors / complete hashes

Key actual source lines: `CodingAgentPanel.tsx:176–197` expiry/session state; `:1085` retirement/partial display; `:1160` command copy fence. `useCodingStop.ts:5` owner capture/runtime result/receipt deadline; `agentStore.tsx:1908` owner/cache gate and `:1958` receipt; cache helper`:20`. `manager.ts:205` bounded actual emitter, `:288` conservative command deadline, `:325/:336` actual opened/failed command retention. `ui-progress.ts:7` prelistener budget and `:57` live handback display projection. `ws/lifecycle.ts:660` canonical message save before `:665` bounded live broadcast. `win-spawn.ts:383` unchanged existing60s TTL constant. Paths below are repo-relative to frozen worktree; line anchors are one-based, verify against manifest.

| File | SHA256 |
|---|---|
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
| `companion/tests/acp-coding-feedback-522.test.ts` | `1ed09704da19bd5bb1283e20e37743f5ba8bbcddcec6398e30df44cd7c2c459f` |
| `docs/superpowers/specs/2026-10-14-coding-session-feedback-cache.md` | `9243794d6225f4999e53aa1b9e42f28a33843f257bd1859fabaca72f02566851` |

VERDICT: IMPLEMENTED / FOCUSED_MACHINE_PASS / INDEPENDENT_GROK4.6_DEEPSEEKV4PRO_LINUX_EXACT_CI_PENDING. No commit, push, merge or self-approval.

R2 final VERDICT: AFFECTED_HOST5_PASS / AFFECTED_ARM64_LINUX5_PASS / ONLY_TEST_PORTABILITY_DELTA / INDEPENDENT_NAMED_REVIEWS_AND_EXACT_CI_PENDING. Frozen source writes stopped.
