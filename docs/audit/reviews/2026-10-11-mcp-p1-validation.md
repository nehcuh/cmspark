# Issue #592 — MCP lifecycle and thread isolation, batch 1

Base: `2abb87f5837506f6557057fe98d425a0a6527d80`.
Frozen reviewed patch SHA-256: `dbb706e1f39b7b565946d1c209dd3f4d3200d9ea57104a0ee38a06086e76f177`.
Source diff (manager + dispatch) SHA-256: `08b850bcbbf008ee19c4291a686faa88645bfbbbab08d555883a73ffe3459e6d`.

## Machine evidence

Executed on 2026-10-11 with Node 22.23.2. All commands below returned exit 0.

| Check | Result |
| --- | --- |
| `npm run build` in companion | TypeScript build passed |
| Compile tests, then project runner with MCP and MCP integration test files | 203 tests; 202 passed, 1 skipped |
| Fresh Linux arm64 container, source copied read-only from checkout; same targeted runner | 203 tests; 202 passed, 1 skipped |
| `node scripts/run-tests.mjs` over full compiled Companion suite | 5,561 tests; 5,528 passed, 33 skipped |
| `git diff --check` | Passed |

Raw local logs: `/tmp/cmspark-592-p1-build.log`, `/tmp/cmspark-592-p1-host-all.log`, `/tmp/cmspark-592-p1-container.log`, `/tmp/cmspark-592-p1-full.log`. They are session-local evidence, not portable test fixtures. Reproducible regressions are committed in `mcp-manager`, `mcp-lifecycle`, and `integration/mcp-selection-gate` tests.

## Independent gates

- T3: existing inbound MCP surface, unchanged trust levels/L2 confirmation and transport choices. No outbound profile changes.
- Independent adversary: [report](2026-10-11-mcp-p1-adversary.md), APPROVE.
- Pi rereview: [report](2026-10-11-mcp-p1-pi.md), APPROVE_WITH_NITS; independently reran 61 load-bearing tests three times.
- Kimi final frozen-snapshot review: [report](2026-10-11-mcp-p1-kimi.md), APPROVE; independently compiled and ran 114 tests, all passed. CI must pass on the PR before merge.

## Boundaries and follow-up ownership

Already-dispatched external RPCs are not rolled back. Revocation blocks new RPCs and removes stale aggregated tools immediately while transports close asynchronously.

Pi's non-blocking UI consistency findings remain owned by the MCP maintainer as follow-ups to #592: `listServers()` can briefly expose a stale connected/enabled status during teardown; worker offers can exceed ancestor selections even though dispatch denies them; a manually confirmed server can prompt before its revoked availability is reported. These do not bypass execution gates and are not claimed fixed here. Transient probe counts in the adversary report are corroborative evidence; the committed regression tests are the portable acceptance criteria.
