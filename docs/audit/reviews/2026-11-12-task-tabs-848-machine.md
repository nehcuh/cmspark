# Task browser tabs #848 — machine evidence

Base: `e0bf978abf95f1870eb241cfdf8631324c3cc7a5`. Node: `22.23.4`. Scope and capability declaration: [spec](../../superpowers/specs/2026-11-12-task-browser-tab-lifecycle.md). Blast: T3. Existing permissions, tab leases and outbound profiles remain in force.

| Check | Result |
| --- | --- |
| `chrome-extension`: `npm test` | Exit 0; 1,886 passed, 0 failed |
| `chrome-extension`: `npm run build` | Exit 0 |
| `companion`: `tsc -p tsconfig.test.json --pretty false` | Exit 0 |
| `companion`: targeted `node scripts/run-tests.mjs …` | Exit 0; 209 passed, 0 failed |
| `companion`: catalog/bridge/run-progress/numbered-snapshot/overlay compatibility suites | Exit 0; 121 passed, 0 failed |
| `companion`: `npm run build` | Exit 0 |
| `chrome-extension`: `node scripts/record-task-tabs-fixture.mjs --verify-lifecycle` | Exit 0; actual production bridge + page capture + source ledger + guarded early/final close; closed-page evidence reloaded |
| `git diff --cached --check` | Exit 0 |

Companion suites: `task-pages-848`, `task-tabs-chat-path-848`, `task-tabs-server-path-848`, `business-evidence-executor`, `business-evidence-store`, `ws-tool-forward`, `orchestrator-tab-lease`, `orchestrator-tool-pregate`, `tool-forward-actuator`, `tool-schemas`, `plan-readonly-327`, `tool-persistence-redact` (compiled `.test-dist/tests/*.test.js`).

The multi-page producer/consumer run proves early release and completion cleanup, retention of foreground/edited/adopted/navigated/uncaptured pages, explicit keep-open and original user tabs, and source/evidence retrieval after closure. Chrome APIs are simulated; this is production-code integration evidence, not a claim that the installed extension was upgraded or that a real browser session was driven.

Logs from this session: `/tmp/cmspark-848-extension-tests-full.log`, `/tmp/cmspark-848-extension-build.log`, `/tmp/cmspark-848-companion-tsc.log`, `/tmp/cmspark-848-companion-tests.log`, `/tmp/cmspark-848-companion-build.log`, `/tmp/cmspark-848-integration.log`.

## Integration cases corrected during independent review

1. Automatic close reused the server executor after `chat.done`, producing an unmatched `tool.start`; trusted per-execution cleanup metadata now suppresses only that internal start. Actual server-shell regression passes. Cause: AI integration omission. Protects completed sidebar state.
2. Autonomous worker reads gained Chat evidence scope but checked only their own plan stamp; capture now checks effective inherited policy before and after dispatch. Actual server-shell regressions pass. Cause: AI integration omission. Protects parent plan mode.
3. Top-frame-only edit inspection missed ordinary framed/plaintext editors; the probe now checks every injected frame, verifies frame completeness and uses native editable state. Browser-default select/range values are normalized. Probe/retention regressions pass. Cause: AI incomplete inspection. Protects user drafts.
4. Image-admission phase frames omitted task context and falsely transferred ownership; both dispatch paths now carry the same server-owned context. Phase-frame/server-shell regressions pass. Cause: AI missed secondary route. Protects image-research cleanup.

## Final review disposition

Independent adversarial review: APPROVE. Pi (`deepseek/deepseek-v4-flash`): APPROVE_WITH_NITS, CLI exit 0; full report and genuine final verdict are saved alongside this record. Pi also independently ran focused checks and reverted-fix experiments.

The unrelated catalog whitespace nit was folded after rereview; parsed JSON was compared to the reviewed index version and is identical. This is the only post-review implementation-file change. The retained Pi notes are nonblocking: initial-activation timing is explicitly unconfirmed; a double-fault close receipt remains durably `closing` and never claims `closed`; source dispatch wiring was verified directly and covered by schema/catalog/scope component tests. The #848 feature maintainer owns those notes; they are not additional acceptance requirements or new follow-up issues.

The reviewed patch is preserved as `2026-11-12-task-tabs-848.patch.gz` (gzip round-trip and uncompressed SHA-256 verified). This avoids treating unified-diff context markers as source-file trailing whitespace; final whole-change whitespace validation passes.
