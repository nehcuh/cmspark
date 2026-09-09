# #496 — residual list_tabs run state

Base: `719890f4f160aef9b62b83d7eafa72e5a7b5dae8`. Issue: [#496](https://github.com/nehcuh/cmspark/issues/496).

## Cause and scope

`resolveBrowserSiteTarget` invokes the authenticated tool executor for a server-owned metadata read. The executor published `tool.start`, but the matching chat `tool.result` belongs to the LLM adapter, which this internal read does not traverse. The orphan tool card contributes to UI busy state after `chat.done`, including when restored from the per-thread cache. The stop ACK correctly reports that no controller remains.

Only the validated internal metadata read now omits the chat start event. The browser read, existing admission gates, audit logging, normal model tool starts, and `stopped:false` semantics remain intact. No UI capability was removed and no permission was widened. This is shared code; the report came from Windows but the reproduction is not platform-specific. Updating only the extension cannot fix an old Companion producer. Restart the updated Companion and reload the extension to discard pre-existing runtime cards.

Capability declaration: panel / internal browser metadata read / existing L0–L1 executor composition / no added autonomy / existing authenticated extension trust / unchanged WS channel. Blast tier: T2.

## Machine evidence

All commands ran with Node 22.23.2. The isolated test runner sets a fresh data directory before application imports.

| Check | Result | Evidence |
| --- | --- | --- |
| Regression before fix | Expected failure: unpaired internal `tool.start` | `red-site-context.log.gz` |
| Targeted regression, three runs | 29 tests, then 4 tests twice; all pass | `targeted-green-{1,2,3}.log.gz` |
| Companion full suite | 5,059 pass, 23 skip; serial settings another 20 pass | `companion-tests.log.gz` |
| Companion build | Exit 0 | `build.log.gz` |
| Extension suite | 1,339 pass, no failures | `extension-tests.log.gz` |
| Browser baseline substitution | Expected failure: completed attachment run remains busy | `browser-red.log.gz`, `check-base.cjs` |
| Browser patched producer | Three consecutive passes: attachment completion, cached new/old thread switches, history hydrate | `browser-green.log.gz` |
| Windows cross-build | Setup.exe and ZIP produced; ZIP structure and patched bundle verified | `windows-package.log.gz`, `package-verification.json` |

The browser fixture captures frames from the real executor, chat adapter and `thread.select` router using synthetic model/tab responses and an isolated text attachment. It replays those frames through the production React WebSocket hook, store, busy derivation and ChatView. It does not replace the UI hook or assert against a hand-written tool-event schema. Windows physical UI testing remains with the user; neither this replay nor the cross-build claims that verification.

Reproduce from the repository root after dependency installation:

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22
(cd companion && npx tsc -p tsconfig.test.json)
node companion/scripts/run-tests.mjs .test-dist/tests/site-context-tool-events.test.js
uv run --no-project --with playwright python chrome-extension/scripts/test-chat-run-ui.py
```

`check-base.cjs` documents the baseline experiment and restores the compiled server in `finally`; its evidence paths use the original `.omx/artifacts/chat-run-496` directory. The baseline and fixed browser tests use the identical UI fixture. No user conversations, attachments, or production configuration are needed.

## Independent reviews

Review packets include the actual patch, full new tests/fixtures, surrounding producer/consumer code and machine output. They pin Grok 4.6 and DeepSeek V4 Pro. Review completion is recorded in `verdict.json`.

DeepSeek initially returned `APPROVE_WITH_NITS` while labelling hypothetical and unchanged behavior P1/P2. On a source-grounded recheck it explicitly retracted those claims and returned `APPROVE`: raw model metadata flags are stripped, invalid options do not hide starts, and the unchanged actuator peer binding rejects mismatched results. Both reports and the recheck packet are retained; an implementation opinion was not substituted for the judge's re-evaluation.

Grok returned `APPROVE_WITH_NITS`. Its test-hardening recommendation was adopted: the browser test now also asserts that the store contains no running tool cards and accepts either colon width in the visible label check. Its claim that the broken build would pass the busy assertion is contradicted by `browser-red.log.gz`: the fixture uses derived `threadBusy`, which includes running cards, not only the cleared busy map. The real formatter uses an ASCII colon. No production code changed after review; the strengthened browser test passed all three repeats. Grok's first CLI attempt exhausted its turn limit without a verdict (`grok-incomplete.md`) and was not counted as a review.

## Trace case

1. Complete a synthetic attachment conversation with website context, then switch away and back.
2. Baseline read succeeded but its chat card stayed running; patched producer yields idle UI across all three repeats.
3. Attribution: application lifecycle defect in an internal read's event publication, not a Windows browser hang.
4. Protected capability: truthful task status while retaining ordinary browser tool execution and stop semantics.
