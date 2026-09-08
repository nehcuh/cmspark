# #473 conversation management gate

Issue: https://github.com/nehcuh/cmspark/issues/473
Base: 913c328e850c62f3575084b67902ecce119949c6. Source scope is frozen in the closure manifest; later #474 only adds icon work and additive shared documentation. No #473 production source changed after closure freeze.

Capability: T2 thread metadata/UI; T3 visibility-only Stop/confirmation checks. Surface extension/history; existing thread.create/update/extract/cleanup/graph; no L2 class, permission, autonomy, default background job or transport channel change. Human tags are independent metadata. AI grouping is a derived first-AI-tag view, not a clustering backend. Manual groups remain one folder per thread; global tag rename/batch movement/deleting AI tags are not claimed.

## Machine evidence

All commands ran locally with Node 22.23.2. Logs retained under `/private/tmp/cmspark-473-*` during execution; frozen packets include terminal tails.

- `npm --prefix chrome-extension run build`: exit 0; `npm --prefix chrome-extension test`: 1285 pass, zero failures.
- `npm --prefix companion run build`: exit 0; `npm --prefix companion test`: 5021 total, 4998 pass, 23 skip; additional 20 pass, zero failures. Combined #474 later run: 5022 total, 4999 pass, 23 skip; additional20 pass.
- `uv run --no-project --with playwright python chrome-extension/scripts/test-thread-management-ui.py`: exit 0, real App with synthetic transport, widths320/390/759/760/1440; metadata success/failure, real action messages, graph provenance, no implicit writes. 320×480 Stop/risk/+ hit tests with manager and menu; pending confirmation auto-closes manager, no implicit submit; outside-close exits selection.
- `uv run --no-project --with playwright python chrome-extension/scripts/test-workspace-ui.py`: exit 0, existing workspace/keyboard/context/settings/confirmation regression.
- Actual router response fields and real ThreadManager persistence/reload/AI replacement/clear/invalid writes covered. Save helper checks matching envelope and thread ids, fields, ignored ACK, server error, abort and timeout cleanup.
- Unchanged production response id wrapper: `companion/src/ws/lifecycle.ts:1472` stamps `id: msg?.id`; catch at1477 preserves error id. Router itself intentionally does not stamp envelope id. Final supplemental packet provides this omitted context.

Screenshots are fixture App screenshots, not live user data or installed application evidence. No DMG build, replacement or actual user classification/cleanup performed.

## Review sequence and disposition

The user's accepted pair Grok4.6 + DeepSeekV4Pro supersedes the generic skill's Pi lane. Independent invocations; neither receives the other's report. The `claude` executable is the DeepSeek transport, not a Claude-family review. Model metadata is archived; no model internal reasoning archived. No exit-code-only approval.

- Design DeepSeek attempt1 returned tool-call XML without a verdict: INVALID, not approval. Rerun independently.
- Design Grok/r2 P1/MAJOR: graph provenance fixed with root user_tags; id+field save contract explicit; first AI tag/re-extraction movement explicit; narrow priority measured; visible/accessibility name aligned; AI-empty group last; action renamed AI提取标签. Design r2 DeepSeek approved with nits.
- Implementation Grok REJECT: AI-only extraction eligibility restored; graph color test added; actual handler wire fields asserted; outside-close restores selection exit. DeepSeek labeled the graph issue MAJOR/non-blocking; it was fixed regardless.
- Closure Grok APPROVE_WITH_NITS. DeepSeek REJECT only for missing unchanged WS envelope-wrapper evidence; supplied actual lifecycle source in final supplement, no speculative router-id mutation.
- Final supplemental verdicts are recorded in final reports; release gate remains subject to both approvals and latest-head CI.

Nits: manual+AI duplicate chips prefer 人工 intentionally (not a claim that AI lacks the tag); readonly AI field in editor shows full provenance. Two menus expose the same actions for backward discoverability, retaining existing names. AI empty-view static explanation covers missing group hint. Cancel is disabled during save to discourage duplicate submission; closing cancels waiting, not an already sent write, and copy is explicit. Late replies still update the global store; helper listener removed on settlement. Timeout unit uses fake timer and verifies listener cleanup; it is not a live delayed-network test. Form and global update allowlist are distinct: form constructs only two fields, existing global security fields are unchanged. Server merges current fields synchronously; no new revision scheme needed here. Graph slim sanitization remains bounded display-only data; server owns normalization. Wide confirmation button disabled in code; header/Stop is the measured short-screen priority target. Background synchronous ACK return pattern is existing and successful browser transport is covered; no evidence of a new port regression. `panelMaxHeight` still controls portal style; not dead. Generic save payload typing follows the existing runtime event boundary; server/field validation is the correctness gate.

## Trace cases

1. A review omitted unchanged production lifecycle wrapper from the closure packet.
2. DeepSeek correctly withheld evidence-based approval despite working code; final supplement includes the actual response/error id stamp.
3. Attribution: implementation-agent evidence packaging gap.
4. Protects save-success correlation; no invented assertion on the wrong router layer.

1. First design DeepSeek returned XML instead of review text.
2. Exit0 was not treated as approval; independent rerun produced a valid report.
3. Attribution: external judge invalid output.
4. Protects judge-verdict validity rather than trusting process success.

1. Outside-click browser assertion checked visibility before React's reopen render settled.
2. Immediate assertion failed; locator wait then passed without changing product behavior.
3. Attribution: test synchronization by implementation agent.
4. Protects selection-mode reset without flaky timing.

Final supplement: Grok APPROVE; DeepSeek APPROVE_WITH_NITS (optional missing-id callers outside this helper). The unchanged wrapper closes the prior gap. DeepSeek final report describes browser checks as a real path; correction: they use synthetic transport, while actual lifecycle source establishes the production id stamp. No real WS roundtrip is claimed.
