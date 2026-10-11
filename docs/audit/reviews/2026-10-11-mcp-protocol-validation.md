# MCP protocol and cooperation validation

Date: 2026-10-11. Issue: [#592](https://github.com/nehcuh/cmspark/issues/592).
Implementation contract: [MCP protocol, cooperation and outbound contracts](../../superpowers/specs/2026-10-11-mcp-protocol-cooperation.md).

## Snapshot and scope

This record covers the final working implementation based on `50c04f252d5055e02f54ebd3cffc37f91fecec7b`, including the lifecycle/selection batch merged through PR #594. Its source tree was verified identical to the reviewed P1 commit `62e7cb1fa1676c658f2be1c283245d4ece8871fd` before updating the base. All 975 Companion source/test files were hashed into a local manifest; every hash remained unchanged after the complete runs. These results are not evidence of remote CI success, merge completion for this batch, or Windows native acceptance.

The implemented paths cover bounded atomic catalog refresh and list-change notifications; structured results and schema definition retention; durable MCP capability bindings in cooperation plans and worker execution; outbound cancellation propagation; and generated outbound argument schemas enforced at the execution boundaries. Profile membership and existing grant/HITL requirements remain in force.

## Regression evidence

New tests use the real MCP SDK and InMemoryTransport for pagination, notifications, structured results and wire schemas. They also exercise ThreadManager reload, planned worker creation through Companion dispatch, live alias/config/schema changes, confirmation-time revocation, loopback HTTP execution, and cancellation through production admission/confirmation paths. Browser/CDP effects are injected so these tests cannot actuate the user's browser.

The independent adversarial pass found and reproduced two runtime binding bypasses with real SDK catalogs: a sanitization collision moving a bound tool to an alternative alias, and confirmation-time alias retargeting allowing an old captured route to execute. Both are fixed with regression tests. Runtime checks match actual server/tool bindings across aliases and compare the live route with the authorized route immediately before execution. Structured error results also retain their data while preserving failure semantics, including an outer retry/admission rejection. The SDK fixture covers structured-only/mixed content and success/error results, with field errors and `retryable: false`.

The final integrated host focus passed 35/35 tests. An independent reviewer then ran 143/143 tests across seven integrated files, checked the same 975 hashes, and approved the final source snapshot; see [adversarial review](2026-10-11-mcp-protocol-adversary.md). Earlier pre-rebase runs (5,567 host tests and 781 container tests) are superseded by the final evidence below. Overlapping focused runs are not added together as unique coverage totals.

| Check | Result |
|---|---|
| Test TypeScript compilation | Pass on host and container |
| Full compiled Companion host suite | 5,593 total; 5,560 pass, 33 platform/condition skips, zero failures; runner exit 0 |
| Fresh Linux arm64 targeted suite | 58 test files; 807 total; 806 pass, one Windows-only skip, zero failures; container exit 0 |
| Production `npm run build` | Pass after all source/test changes |
| `git diff --check` | Pass |

Host commands source nvm and select Node 22.23.2 before compiling/running. The full suite uses the repository's isolated compiled test runner (`node scripts/run-tests.mjs`), including its final serial settings tests. It does not reuse the user's live configuration.

The arm64 run uses a fresh `docker run --rm --platform linux/arm64` instance of `cmspark-cooperation-validation:590`, with Node 22.23.1. It copies the current repository into a writable workspace while excluding `.git`, `node_modules`, `.test-dist` and `dist`. The image's independent locked dependencies remain in place; host `node_modules` is not mounted over them. The image and checkout package-lock SHA-256 both equal `aab57d4346d662355958ccd3ffad3885fbff39a960fef0af765bc1e40e45f4e9`. It recompiles tests and selects every non-underscore test matching MCP, cooperation, image, security, URL, L2, admission or orchestrator names, including matching integration tests. This selection is recorded in the container log.

Local evidence files are `/tmp/cmspark-592-final-full-host.log`, `/tmp/cmspark-592-final-arm64.log`, `/tmp/cmspark-592-final-build.log` and `/tmp/cmspark-592-final-validation-manifest.json`. The complete host runner produces three disjoint result groups (3,202 + 2,371 + 20 tests); their sum above counts unique tests, not repeated runs. The container's 807 tests overlap host coverage and are not added to the host total. The independent review log is `/tmp/cmspark-592-protocol-adversary-final.log`.

## Remaining gates and limits

The lifecycle/selection integration and independent adversarial review are complete. [Kimi](2026-10-11-mcp-protocol-kimi.md) returned APPROVE after reading the complete frozen diff and independently passing 111 focused tests; [Pi](2026-10-11-mcp-protocol-pi.md) returned APPROVE_WITH_NITS. Neither review changed the frozen source/test snapshot. Remote CI and merge remain pending for this batch; local results do not replace them.

The reviewed full diff is `/tmp/cmspark-592-protocol-frozen.diff`, SHA-256 `c79ab0e2df56461b30a399c3089c6addf35471a58fbdfde39ff0eef0b8802a17`. Final review reports and this receipt were staged afterward without modifying that artifact or the 975 source/test hashes. Kimi's structured-result shape and point-in-time wildcard notes describe intentional contracts. Separate cancellation work is tracked in [#595](https://github.com/nehcuh/cmspark/issues/595): inbound manual-confirm prompt lifetime and Windows `host_write` nonce-fallback signal propagation. Inner confirmation prompt-lifetime limitations noted in review remain outside this outbound-focused batch.

The SDK's private per-page outputSchema/taskSupport cache remains an upstream compatibility limitation; complete CMspark catalog enumeration must not be described as complete MCP task-protocol support. Cancellation prevents pending work at observable admission boundaries; it does not undo already executed side effects. Generated outbound schemas cover the existing profiles only. No OAuth, legacy SSE, sampling, elicitation or resource-template expansion is included.

Windows launch/upgrade, Known Folders, ConPTY and UIA behavior require their separate Windows evidence. Linux arm64 and macOS test success cannot establish those guarantees.
