# MCP lifecycle and selection: independent adversarial review

Date: 2026-10-11. Reviewer: independent Codex adversary (`p1_adversary`), not the implementation agent.
Scope: issue #592 batch 1, branch `codex/mcp-lifecycle-isolation`, working/staged diff against `2abb87f5`. Includes `manager.ts`, `dispatch.ts`, lifecycle/manager regression tests, new `integration/mcp-selection-gate.test.ts`, and the Windows/MCP reliability specification. No production code was modified by this reviewer. At the implementer's request, the reviewer added two deterministic regression tests for the independently found ghost race; production implementation remains separate.

Capability declaration supplied and checked: T3; Surface L1/L2; existing shell/read confirmation gates; Compose mcp-server; single/multi-worker autonomy; existing L2/session trust; no outbound profile expansion. This review does not certify the later Windows or protocol batches.

## Initial blocking findings (resolved in incremental review)

### P1 — global disable revokes the catalog, but pending/new meta calls still dispatch during teardown

Locations: `companion/src/mcp/manager.ts:89`, `:105`, `:381`, `:394` (and the other resource/prompt routing methods).

`applyConfig` publishes `enabled:false` immediately and empties the namespaced catalog. However, reconciliation closes servers sequentially, awaiting each close. While server A is closing, server B remains in `clients`. All RPC routing methods resolve only that map, without checking the live global switch or live per-server configuration. An already-confirming namespaced call has retained its route; the new selection recheck does not check global availability. Meta tools bypass the namespaced catalog entirely. Both can therefore dispatch a fresh operation after disable was published, until teardown reaches their server.

Independent executable probe used the freshly compiled real `McpManager`, two EventEmitter client doubles, and a deliberately held close for A. The probe applied global disable, yielded into reconciliation, then invoked `callTool(B)` and `listResources(B)` before releasing A. Output (exit 0):

```json
{"globalEnabled":false,"clientsRemaining":["b"],"dispatched":2,"toolResult":{"content":[]},"metaResult":[]}
```

This is a manager/JavaScript boundary reproduction, not a claim of native OS or network behavior. A real slow transport close provides the same await window. The concern is a **new dispatch after revocation**, not undoing an RPC already sent before disable.

Required correction: enforce live availability at the shared RPC client lookup for every namespaced/resource/prompt operation. Reject global disable, a removed/disabled server, and an obsolete transport instance while replacement is pending. Filter the offered catalog against the same live per-server identity/availability where appropriate. Preserve intentional test fixture injection through explicit setup rather than treating missing production configuration as an unconditional bypass.

Required regression: two connected clients, hold the first close, publish global disable, assert that every later-server RPC rejects without invoking its client; exercise a namespaced call whose confirmation resolves in that window and a meta call. Add analogous removed/disabled server assertions to prevent the fix from only addressing the global flag.

### P2 — a ghost closed during queued reconciliation prevents a same-name server from being restored

Locations: `companion/src/mcp/manager.ts:131` and `:198`.

The ghost-after-connect branch closes an obsolete client but leaves the same object in `clients`. If another connection is holding up serialized teardown and a newer configuration restores the ghost's server with the same transport parameters, the newest reconciliation finds that stale map entry. It selects the soft-update branch and never starts a replacement. All configuration promises settle with an enabled server permanently disconnected and no pending start or retry.

A seeded asynchronous overlap probe exposed the state; this was reduced to the following deterministic manager boundary reproduction (connect/close are controlled doubles, no real transport effects):

1. Start A and B with global MCP enabled; A connects and B's handshake is held.
2. Apply an enabled configuration removing both servers. Hold A's close so reconciliation cannot yet reach B.
3. Complete B's handshake; its ghost check observes removal and closes B.
4. Apply the latest configuration re-adding B unchanged; release A's close and await both configuration updates.

Actual result, exit 0:

```json
{"configured":true,"bStarts":1,"clients":[["b","disconnected"]],"starting":[]}
```

Expected: a fresh B connection starts and becomes usable. Remove owned ghost entries and make same-name restoration account for an obsolete start that is still draining; merely deleting the map entry can still join that stale `startingPromises` entry if teardown is held at the other await boundary. Add the reduced multi-server race as a regression, including re-add while B's ghost close remains pending.

## Outcome assessment

- Global off/on restart recovery, failed-handshake draining, retry cancellation and stale generation guards are meaningful improvements. The real stdio regression fixtures provide stronger evidence than state-only mocks.
- The shared selection gate now closes the original meta-tool gap, handles both thread-id spellings, binds session-resolved threads across async prompts, fails closed for missing explicit threads/parents/cycles, and intersects worker and ancestor selection.
- Rechecks before invocation, before directory expansion after confirmation, and before the eventual retry cover the intended selection revocation points. Existing trust/capability confirmation logic remains present.
- The first revision failed the lifecycle DoD at the dispatch and ghost-restoration boundaries above. Both were corrected and independently checked in the incremental review below.

## Trajectory and component assessment

- The implementation is scoped to batch 1, with no unrelated production files or outbound authority expansion.
- Serialization, generation checks, client-identity checks, and conditional start-promise deletion address distinct races rather than replacing them with broad retries.
- The failing boundary belongs in the manager's RPC/client eligibility component, shared by both dispatcher paths. Duplicating another dispatch-only global check would leave direct manager consumers inconsistent.

## Machine evidence inspected

- `/tmp/cmspark-592-p1-host-all.log`: 200 tests, 199 pass, 1 skip, 0 fail.
- `/tmp/cmspark-592-p1-container.log`: same counts, 0 fail; implementing agent identifies this as the fresh arm64 locked-dependency container run.
- `/tmp/cmspark-592-p1-build.log`: TypeScript/build command completed, with no error in the supplied output. Exit 0 was supplied by the implementing agent; plain log text does not independently encode the process exit status.
- Independent revocation-window probe: actual tool return exit 0, output above.

The existing green tests await completed global teardown before checking absence, or focus on handshake/retry revival. They do not cover dispatch to a second server while teardown of the first is pending. No Windows claims are made by this batch or this review.

## Four-line regression case

1. Publish MCP global disable while one connection has a slow close, then complete a pending confirmation or issue a meta call to another connection.
2. Catalog revocation succeeds, but the existing routing methods still invoke the second connection.
3. Attribution: implementation gap at a shared authorization/lifecycle boundary; not an external MCP failure.
4. Protect: user revocation must prevent new MCP dispatch while asynchronous cleanup proceeds.

VERDICT: REJECT

## Incremental review and resolution

The preceding rejection is retained as review history. The final verdict below applies to the updated batch, including fixture setup changes in the existing capability/meta/offered-catalog test suites.

**P1 resolved.** `requireAvailableClient` now guards all five manager RPC paths using a shared `isCurrentClient` predicate: global enabled, live server enabled/present, owned client identity, and matching transport-affecting configuration. The same predicate filters aggregation. The held-close regression asserts all RPCs reject before client invocation. An independent fresh compiled-manager probe additionally checked global-off, individual server-off, removal, and transport replacement: 20 RPC attempts rejected, zero underlying client dispatches, and an empty stale catalog for all four states (exit 0). Pending-confirmation callers reach these guarded methods, so cached routes cannot bypass the live check.

**P2 resolved.** Ghost cleanup conditionally removes its owned map entry and reaggregates. Reconciliation recognizes newly re-added names independently of a leftover client snapshot. A joined start rechecks its captured generation and the live configuration after awaiting the previous attempt, starts a fresh missing/disconnected connection when eligible, and preserves scheduled backoff/dead-server state and existing non-disconnected clients. This avoids turning a genuine failed handshake into an immediate retry loop.

The two deterministic ghost tests cover both completed and still-pending ghost close at re-add. The initial test harness itself raced A's startup and was cancelled awaiting an unintended second ghost; it was corrected to await A's successful start before removal, preserving all B assertions. Fresh compilation plus the manager suite then exited 0 with 32/32 passing. No production code was authored by this reviewer.

Further independent boundary exercise: 100 seeded asynchronous overlap sequences (1,200 configuration updates) against the updated compiled manager, with simulated short connect/close delays. The final connected set and transport configurations matched the last configuration in every sequence, with zero modeled live orphan after shutdown (exit 0). This supplements the deterministic cases; it is not a claim of native transport coverage or exhaustive interleaving proof.

Latest host and fresh-arm64 logs now both report **203 tests, 202 pass, 1 skip, 0 fail, 0 cancelled**. The implementing agent remains responsible for final build/CI and Pi rereview at the shipped revision. The original stdio tests supply real-child lifecycle coverage; the adversarial delay probes supply deterministic manager-boundary coverage.

No remaining blocker found for batch 1's stated lifecycle and live-selection scope. Windows adaptations and protocol/cooperation changes remain separate batches. This is the independent adversarial approval only, not a substitute for Pi confirmation or remote CI.

VERDICT: APPROVE
