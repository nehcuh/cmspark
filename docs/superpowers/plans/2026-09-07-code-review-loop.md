# #464 implementation and verification ledger

GitHub: #465, #466, #467. Base: 68ccb023012fc154d83bff9426d314e091f20862.
Branch: codex/code-review-loop. Design and three implementation checkpoint gates passed with nonblocking observations; final incremental gate also passed, with CI tracked in the audit card. No release claim.

| Checkpoint | Observable acceptance | Required negative cases |
| --- | --- | --- |
| #465 scope + web | Chat creates immutable comparison; real BrowserBridge observation yields files and old/new lines; read survives restart | Unknown thread, injected scope, malformed diff, cut hunk, binary/combined, wrong identity, capacity, unsupported store, conflicting retry |
| #466 terminal | Original task opens one PTY; login shell reuses user setup; confirmed JSON report appears in same task | Different peer/session/job, denied or delayed confirmation, closed terminal, plan-readonly, wrong commit/hash, invalid file/line, duplicate import, storage failure |
| #467 materials | Review is visible as a sourced supplement to both draft kinds, with actual task/requirement/test references | Different draft revision/SHA, missing criteria, stale evidence, unknown coverage, Agent claim overriding machine state |

## Baseline evidence (2026-09-07)

- Node 22.23.2; Companion and extension test TypeScript compilation passed.
- Existing Companion business-evidence suites: 42 passed, 0 failed.
- Existing evidence executor + PTY suites: 16 passed, 0 failed (overlap with above).
- Existing extension terminal wire suite: 8 passed, 0 failed.
- New fixture preparation: temporary Git repository created two commits; `git diff`
  generated actual changes, then production BrowserBridge.execute(get_page_text)
  recorded a synthetic DOM observation. This proves producer wire shape, not a
  real enterprise website layout or pilot acceptance.

## Review discipline

Keep frozen packet hashes, command exits and actual model identities. Design
reviews do not authorize implementation merge. Each code checkpoint needs fresh
machine checks and independent Grok 4.6 + DeepSeek V4 Pro verdicts; every concrete
blocking finding must be fixed or explicitly closed by its originating reviewer.
Review comments and source packets are distinct from real enterprise acceptance.

## Implementation evidence

- All three scoped slices implemented; see `docs/code-review-workflow.md` for actual user steps and limits.
- Full Companion suite: 4996 pass, 23 skip, 0 fail; separate settings suite 20 pass. Final handback correction: production build and PTY suite 23/23 pass.
- Full extension production build and 1281 tests pass after shared Thread type correction.
- Isolated real Chrome/React/xterm UI test passes: copy sends no shell input, report explicitly submits and receives receipt, both panes visible, disconnect disables input/import.
- Actual Grok 4.6 and DeepSeek V4 Pro independently reviewed design, web source, terminal, return UI, and material checkpoints; reports and dispositions under `docs/audit/reviews/464-20260907/`.
- Real code-platform split views, Agent compatibility and both enterprise scenarios remain #450/#452/#454/#455/#457 gates, not synthetic-test claims.
