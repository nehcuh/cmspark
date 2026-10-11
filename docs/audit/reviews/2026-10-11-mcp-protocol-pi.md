## Scope

Read-only Pi rereview of the frozen Issue #592 protocol/cooperation/outbound batch: catalog pagination + `listChanged`, structured results, durable MCP bindings in cooperation plans/workers, outbound cancellation, generated outbound arg schemas. Diff `/tmp/cmspark-592-protocol-frozen.diff` (SHA256 `c79ab0e2…0b8802a17`, 2394 lines) over base `50c04f25`. Nothing in the repository was edited.

## Independent verification (not taken on trust)

| Check | Result |
|---|---|
| `sha256sum` of frozen diff | `c79ab0e2df56461b30a399c3089c6addf35471a58fbdfde39ff0eef0b8802a17` ✔ |
| `git diff --cached` vs frozen diff | byte-identical (`diff` empty) → frozen snapshot == index == worktree ✔ |
| `/tmp/cmspark-592-final-validation-manifest.json` (975 files, base `50c04f25`) | recomputed all 975 SHA256 by hand: **0 mismatches, 0 missing** ✔ |
| `/tmp/cmspark-592-final-full-host.log` | 3202/3169+33 + 2371 + 20 = 5593 tests, 5560 pass, 33 skip, 0 `not ok` ✔ |
| `/tmp/cmspark-592-final-arm64.log` | 807 tests, 806 pass, 1 skip, 0 fail ✔ |
| `/tmp/cmspark-592-final-build.log` | `tsc` production build clean ✔ |
| `git diff --check` | exit 0 ✔ |
| **Own run** of the 7 focused files (Node 22.23.2, isolated `CMSPARK_DATA_DIR`) | **143 tests / 143 pass, 0 fail / 0 skip, exit 0** — reproduced the reviewer's 143 claim ✔ |
| New regressions present in the *full* host **and** arm64 logs (subtest names, e.g. "colliding MCP aliases cannot bypass a bound capability after real catalog reordering", "a colliding alias rechecks its dispatch route after confirmation", "confirmation cancellation only rejects its own request", "cancel navigate during production admission") | present and passing in both ✔ |

## Recheck of the three previously fixed blockers

1. **Alternate-alias identity bypass — fixed.** `plannedWorkerMcpError` (`companion/src/orchestrator/cooperation-plan.ts:82`) now selects bound capabilities by *resolved identity*, not literal spelling: `boundNames = task.required_tools.filter(r => r === name || (binding && route && binding.server_name === route.serverName && binding.tool_name === route.toolName))` (`:89-96`), then re-checks `tm.isToolAllowed(workerId, name)` and `assertBoundMcpCapability(..., currentName = name)` per binding (`:100`). Unresolvable alias → `currentMcpBinding` throws `unknown or unavailable` → fail-closed. Real-SDK regression (catalog reversed, original schema changed, alias `_2` invoked) asserts denial and `calls == ["read_value"]`.
2. **Confirmation-time route/identity split — fixed.** `runOnce` re-runs the *planned* gate and compares the live route against the captured dispatch route synchronously before `manager.callTool` (`companion/src/mcp/dispatch.ts:409-413`), and the retry path (`:455-460, 466`) re-enters `runOnce`, so it re-checks. `manager.callTool` sends the captured `route` (`manager.ts:403-410`), so the checked identity is the dispatched identity. Both regression variants (schema-only retarget → `/changed since planning/`; catalog re-reverse → `/route changed during authorization/`) reach **zero** SDK CallTool.
3. **Structured error data loss — fixed.** `structuredData` is projected on success *and* on `isError` (`dispatch.ts:416-418`), carried through the error branch (`:423`), the outer retry/admission rejection (`:458`) and the terminal return (`:473-475`) while `success`/`error`/`rawErr` semantics are unchanged. The real-SDK test covers all four success/error × structured-only/mixed combinations plus the post-approval admission rejection.

## Correctness / security pass (highlights)

- Catalog: one deadline over the whole chain, repeat-cursor, page/item caps, complete-before-replace, same-client publication guard, coalesced `dirty` follow-up (`client.ts:262-330, 337-401`); failures preserve the prior catalog. Injection scan is iterative with cycle guard and covers `$defs`/`items`/keys (`aggregator.ts:34-56`).
- Binding digest = sorted-key SHA256 over config+inputSchema, so no credential reaches the plan (`cooperation-plan.ts:43-48, 60-62`); planning/spawn/launch/snapshot all re-validate, legacy checkpoints without bindings fail closed, wildcard∩exact-parent resolves to concrete tools without widening (`spawn.ts:26-36, 45-74`).
- Cancellation: signal is threaded bridge→HTTP→runner→`createToolExecutor`→L2/URL/image admission→extension-dispatch pre-check (`bridge.ts:64,128`, `http-client.ts:156-162`, `companion-http.ts:640,650`, `server.ts:469,636,665,679,683,698,864`); abort settles only its own pending prompt, blocks late approval and fires the terminal event (`security-confirmation.ts:268-269, 368-383`).
- Outbound schema: advertised and enforced schemas are the same function of the native contract (`tool-schema.ts:9-63`), all 20 profile tools have schemas and fixtures, AJV + native zod both applied, `domain` stays envelope metadata.

## Findings

**P0 / P1: none.** No overlooked blocker that violates the stated DoD.

**P2 (non-blocking, no DoD violation):**
1. `companion/src/mcp/dispatch.ts:352-355` — the MCP trust-level confirmation still calls `securityConfirmations.request(..., { originWs: channel.originWs })` without a signal. Trigger: worker/parent aborts while a `trust_level: manual` MCP prompt is open → the prompt is not revoked. Dispatch is still prevented (`client.ts:424-427` aborts before the SDK request), so "preventing subsequent dispatch" holds; only the lingering prompt / first-use cache write is stale. Outside the batch's declared outbound+L2/exfil boundary.
2. `companion/src/server.ts:725-728` → `companion/src/tool/companion-dispatch.ts:1679-1691` — `sendConfirmation` has no signal, and there is no post-confirmation abort check. Trigger: **Windows only**, `host_write` with Hello unavailable under god-mode/auto-approve skip-L2 → aborting during the nonce prompt does not revoke it, and an approval typed afterwards proceeds to the write. Explicitly out of scope here (Windows is a separate batch / later certification gate); flagging so it is not read as covered.
3. SDK private cache (`node_modules/@modelcontextprotocol/sdk/.../client/index.js:557`, `cacheToolMetadata`) clears+repopulates per page, so with multi-page catalogs only the last page keeps `outputSchema`/taskSupport entries. Declared as documented-not-solved in the spec and `docs/mcp.md`; a genuine residual weakening for page-1 tools, correctly *not* claimed otherwise.
4. Stdio outbound callers that omit `tabId` now get `INVALID_ARGUMENTS` from the advertised schema instead of L9 `TAB_ID_REQUIRED`; the HTTP path deliberately preserves `TAB_ID_REQUIRED` + queue disclosure (`companion-http.ts:635-640`). Intentional per spec, UX-only.

## Conclusion

The adversary report's APPROVE is **confirmed, not refuted**. Its P1/P2 resolutions exist at the cited locations, are reachable in production wiring, and are pinned by real-SDK regressions that I re-ran myself (143/143) and cross-checked inside the full host and arm64 logs. The report's honesty boundaries hold: no remote CI, no merge claim, no Windows native acceptance, `structuredContent`/cancellation limits stated, machine totals taken from logs. Residual items above are P2 nits or explicitly declared/out-of-batch limits.

VERDICT: APPROVE_WITH_NITS
