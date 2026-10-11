# Independent adversarial review: MCP protocol, cooperation and outbound reliability

Date: 2026-10-11. Issue: #592, R5–R10. Reviewer: independent Codex adversary; production implementation was authored by other agents. Scope: the complete tracked diff and new source/tests in `codex/mcp-protocol-reliability`, initially based on `2abb87f5837506f6557057fe98d425a0a6527d80`, then integrated with the lifecycle/selection batch and reassessed on base `50c04f252d5055e02f54ebd3cffc37f91fecec7b`. The dependency symlink is excluded. This review does not claim remote CI, merge completion or Windows native acceptance.

## Outcome

Final review verdict: **APPROVE** after repairs and independent integrated regression execution. No unresolved blocking finding remains. The initial verdict was **REJECT**: two concrete R8 identity-boundary bypasses were independently reproduced through a real MCP SDK server, InMemoryTransport, production McpClient/aggregator, ThreadManager, planned worker binding and executeMcpTool. Neither probe manufactured alias mappings. The structured error-data loss was also independently reproduced. All three findings are resolved as recorded below.

### P1 — alternate catalog aliases bypass the planned capability identity

Resolved finding. Initial location: `companion/src/orchestrator/cooperation-plan.ts`, `plannedWorkerMcpError`, the early return using `task.required_tools.includes(name)` (initial line 87).

The SDK fixture initially advertises `read_value` then `read__value`. Both sanitize to the same alias base; aggregation assigns the latter a `_2` suffix. A plan binds the first tool, and its worker has the existing `mcp__*` grant. Reversing catalog order and changing the original tool's input schema moves that bound capability to the `_2` alias. Calling the declared name is correctly rejected, but the alternate spelling skips the planned identity check and reaches the changed bound capability.

Independent probe output before repair:

```json
{"oldError":"Error: required MCP capability changed since planning: mcp__fixture__read_value","aliasError":null,"alternateRoute":{"serverName":"fixture","toolName":"read_value"},"result":{"success":true,"data":[{"type":"text","text":"value"}]},"calls":["read_value"]}
```

Required correction: match bindings against the requested alias and its actual server/tool identity, rather than only the literal spelling in required_tools. The existing worker/parent grants must still be checked. An unchanged bound capability may remain callable under a new alias if those grants permit it.

### P1 — confirmation-time alias changes separate checked identity from dispatched identity

Resolved finding. Locations: `companion/src/mcp/dispatch.ts`, initial route capture in executeMcpTool and runOnce (initial lines 203 and 374–378). This second issue was reproduced after the first route-based binding repair was present.

Plan and worker setup are the same. Reverse the catalog without changing its schema, then invoke the `_2` alias for the bound `read_value`. While the actual confirmation request is awaiting approval, restore the original catalog order and change `read_value`'s schema. The new planned gate resolves `_2` to unbound `read__value`, so it has no matching binding to validate; actual callTool still receives the captured route for `read_value`. Thus a successful confirmation dispatches the changed bound capability.

Independent probe output:

```json
{"initialRoute":{"serverName":"fixture","toolName":"read_value"},"afterConfirmationRoute":{"serverName":"fixture","toolName":"read__value"},"result":{"success":true,"data":[{"type":"text","text":"value"}]},"calls":["read_value"]}
```

Required correction: immediately before each dispatch/retry, enforce agreement between the live alias route and the route actually sent to callTool, in addition to the planned binding check. A removed or retargeted alias must fail closed across confirmation. A regression must exercise actual SDK catalog refresh while confirmation is pending and assert no SDK CallTool reaches the changed capability.

### P2 — structured error results lose actionable data

Resolved finding. The initial error branch in `executeMcpTool` dropped structuredContent even though McpClient preserved it. A real SDK error containing `code: VALIDATION_ERROR`, a `record.id` field violation and `retryable: false` became only `{success:false,error:...}` at dispatch. This loses machine-readable failure details and contradicts the batch's structured result preservation contract. The required correction is to preserve structured data while retaining failure status and the existing error message; success-only preservation is insufficient.

## Trajectory assessment

The design is anchored in issue #592 and the batch spec. Its scope stays within existing MCP, cooperation, browser outbound profiles and confirmation boundaries. It does not add an outbound profile or grant broader worker authority. The implementation uses existing request signals and admission gates instead of introducing a second authority system.

Review challenged real asynchronous boundaries, rather than interpreting passing totals as acceptance. Catalog ordering was changed through the actual SDK; planned binding persistence and worker grants were exercised through production managers; confirmation-time changes were injected at the actual asynchronous decision boundary. The two resulting blockers demonstrate why tests that mutate one alias map entry or test only the declared required_tools spelling are insufficient.

Local test evidence inspected: full host log reports three disjoint groups totalling 5,567 tests, 5,534 pass and 33 skips; fresh Linux arm64 log reports 781 tests, 780 pass and one skip. The production build passed. These are pre-repair and pre-lifecycle-integration evidence, not final approval. The separate real-executor cancellation run reports 72 passing tests. Overlapping focused runs are not added to totals. Review probes selected Node 22, isolated CMSPARK_DATA_DIR and used in-memory SDK transports without browser/OS actuation.

## Component assessment

- **R5–R6 catalog refresh:** tools, resources and prompts share bounded pagination, repeated-cursor detection, a total refresh deadline, complete-before-replace publication and SDK identity checks. List-change handlers coalesce overlapping notifications and retain a dirty follow-up, while failures preserve the previous complete catalog. Stale connection results cannot publish into the new client. No further blocking issue was established in these paths.
- **R7 protocol data:** structuredContent survives dispatch alongside content; legacy content-array responses retain their shape. Schema normalization preserves definitions and $defs. Metadata scanning walks nested keys and values with cycle protection. The SDK's private per-page outputSchema/taskSupport cache limitation is explicitly documented; full CMspark enumeration is not represented as complete MCP task support.
- **R8 cooperation:** durable bindings hash configuration and schema without persisting config secrets. Planning, readiness, launch and dispatch check current availability, parent selection and effective grants. Worker wildcard intersection does not expand a bounded parent grant. The two bypasses above initially blocked approval and are now resolved; they are identity problems even though the wildcard itself is an existing authorized grant.
- **R9 cancellation:** SDK signal crosses bridge and HTTP into runner/executor and L2, URL/cookie and image admission. Shared session bootstrap has a post-await aborted check, preventing cancellation from cancelling unrelated callers while stopping the cancelled dispatch. Confirmation abort removes only its own pending entry/timer, denies it and rejects later approval; notification failure does not prevent settlement. Real executor integration tests assert no extension dispatch after cancelled pending confirmation. Already dispatched extension work is not retractable by this change, and the documentation explicitly limits cancellation claims accordingly. No additional blocking finding was established.
- **R10 schema contract:** catalog generation and boundary validation share generated schemas; native argument parsing retains refinements. Flat and wrapped forms, explicit leased tab identity and separate domain fields are covered through SDK/bridge/HTTP tests. Existing profile membership and grant/HITL checks remain. No additional blocking finding was established.

## Integration and limits

The worktree integrated lifecycle/selection commit `62e7cb1fa1676c658f2be1c283245d4ece8871fd`, then aligned its base with `50c04f252d5055e02f54ebd3cffc37f91fecec7b` on main. Incremental inspection confirms that runOnce checks selection, planned identity and live/captured route agreement synchronously before manager.callTool; the manager then checks live configuration and connection availability. Retries reuse this sequence. Explicit and session-resolved thread bindings remain stable across asynchronous confirmation, including ancestor selection and deleted-thread rejection. Integrated regression execution passed as recorded below. macOS and Linux arm64 evidence does not establish Windows native behavior. This report does not claim OAuth, legacy SSE, sampling, elicitation or resource-template support.

## Repair reassessment

Repairs are present: plannedWorkerMcpError matches actual bound server/tool identity across aliases; runOnce compares the live route with the captured dispatch route immediately before calling the manager; structured errors preserve data through both the error branch and final dispatch return. Permanent real-SDK regressions cover catalog reordering, changed schema, confirmation-time schema/route changes with zero server calls, and all four success/error × structured-only/mixed result combinations. Independent final execution selected Node 22 and an isolated data directory, then ran these seven freshly compiled files: mcp-manager, mcp-protocol-reliability, cooperation-mcp, integration/mcp-selection-gate, outbound-mcp-cancellation, outbound-mcp-schema and integration/security-gates. Result: **143 tests, 143 pass, zero failures/cancellations/skips, exit 0**, log `/tmp/cmspark-592-protocol-adversary-final.log`. The permanent regressions reproduce both earlier real-SDK counterexamples and now deny dispatch; unchanged alias relocation remains allowed within the existing grant. Structured errors preserve exact field/retry data, including a subsequent admission rejection. Live selection revocation, manager lifecycle races, cancellation isolation and generated schema enforcement also pass in this integrated run.

The reviewer verified all **975 source/test SHA-256 entries** against `/tmp/cmspark-592-final-validation-manifest.json` after the run: zero mismatches. `git diff --check` passes. Full host/container/build reruns for this frozen snapshot are being performed by the implementation/validation lane and remain separate merge gates; this independent code-review approval does not assert their outcomes, remote CI success or merge completion.

VERDICT: APPROVE
