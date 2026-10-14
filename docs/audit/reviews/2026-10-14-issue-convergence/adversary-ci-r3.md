# Independent CI r3 adversarial re-review

2026-10-14 Asia/Shanghai. Non-CI implementer reviewer; I implemented Cooperation, not this CI component. Scope is the complete CI r3 diff plus unchanged production authorization/aggregation/start/config/stop callers. No self-approval of Cooperation, no source edits/recompile/commit/push/issue action. Earlier CI r2 REJECT remains preserved in `adversary-ci-availability-r2.md`; the original failing-product probe and log were not overwritten.

## Frozen scope and identity

Five paths in `/Users/huchen/.codex/worktrees/issue-convergence/cmspark`, branch `codex/stdio-close-settle`, base6594c053. Full diff `/tmp/cmspark-ci-cleanup-r3.diff` verified SHA256 **1ceeb909b75430bb8aeb7da70cc88f2ecfdd2d2cda2d937b2f75faba5f3aa20a**. Full context `/tmp/cmspark-convergence-wave-20261014/review/context-r3.md` SHA256 **e3b17d4cd7ac5f3cf9e469b6ab864b726d94dd3cd248d17071232da65fbe29d4**. Read complete diff/current client, manager, stdio and all new tests; read implementer R3 record as evidence, not approval.

Actual changed files match refreshed root snapshot byte-for-byte, zero mismatch. `/tmp/cmspark-ci-cleanup-independent-r3-hashes.json` records:

| File | Whole-file SHA256 |
| --- | --- |
| companion/src/mcp/client.ts | 03abdd97dc92eb4c95d276f8b8447c38b57d257034549a3ae1ad99e097f11d4b |
| companion/src/mcp/manager.ts | 96e37fea4199471c611e59f6c023a01920472012651871eefa41e2a287e92686 |
| companion/src/mcp/stdio-transport.ts | 909df9cb4d76ca9cd5f34cf15cf0f26472e9a769de94854bc16c3f474ac4c2c2 |
| companion/tests/mcp-compatibility-602.test.ts | 831c3e7f7a990d11136d868f307be5eba974060f1372d06d43ded5e4df2ee0c8 |
| companion/tests/mcp-stdio-tree.test.ts | 49684869a08590a1070a824659a97df32f484ffd30649cffd675510d01ad5414 |

Compiled manager mtime1791944788 is later than source1791944723. Used these frozen compiled paths with canonical isolated runner; did not compete with root's compile outputs or silently test old r2 .test-dist.

## Confirmed r2 P1 is resolved at production manager boundary

The previous production failure was that manager swallowed rejected owned stdio close, deleted prior client, then admitted another same-name subprocess. R3 does not merely hide an error or rename protocol onclose as process success.

Real changed boundaries, verified one-based lines:

- `manager.ts:197–200`: a same-name start waits for the published retiring receipt; a failed receipt rejects, and configuration/generation permission is checked again after pending success.
- `manager.ts:215–219`: prior client enters central `retireClient`; rejection is no longer swallowed before new-client creation at221. No replacement admitted from an unconfirmed receipt.
- `manager.ts:295–315`: central entry is installed before close, clears scheduled timer, revokes confirmation authority and aggregation synchronously, retains original client+shared close promise. Only successful close removes entry/client; rejection sets failed and preserves error metadata/ownership.
- `manager.ts:280–291`: stop doesn't delete before close; revocation happens before awaiting; even failed close drains old starting attempt before returning and keeps entry tracked.
- `manager.ts:88–95`: shutdown enumerates clients and retiring entries, closes other healthy clients, does not blindly clear failed owned receipts. `isCurrentClient` also excludes shutdown/retiring state, so retaining ownership cannot retain tool use.
- `manager.ts:119–185`: config revocation is still synchronous via applyConfig currentConfig/epoch update; reconciliation handles all names, accumulates teardown errors and reports failure after processing other healthy clients. Disable/remove/command replacement/global-off cannot bypass the name barrier on later re-add/re-enable.
- `manager.ts:231–254`: late startup ghosts use the same retiring receipt. Typed startup teardown error is retained without scheduling restart; regular unrelated startup errors retain existing bounded restart policy.
- `manager.ts:349`: restart scheduling refuses any retiring entry; successful pending retirement is not treated as permanent failure. `waitForServerReady` promptly rejects an actually failed tombstone but permits normal pending close/replacement to reach catalog-ready identity.
- `manager.ts:545–560`: UI metadata retains ownership/error while exposing no tools/resources/prompts for retiring entries; live disabled/removed state is respected. Authority remains unavailable through both aggregation and production call admission.

### Original independent red probe unchanged, then affirmative r3 proof

1. Preserved `/tmp/cmspark-ci-reconnect-independent-probe.cjs` and `.log` from r2. They assert and report replacement_connects=1 and manager dropping the old receipt.
2. Re-ran the exact probe with **only compiled-root path changed** to final r3, `/tmp/cmspark-ci-reconnect-independent-original-probe-on-r3.cjs` + `.log`. It now exits1 at expected typed rejection before reaching the old false-admission assertion. This is useful trajectory evidence, but **not treated as a green test by itself**.
3. Added independent positive-invariant r3 probe `/tmp/cmspark-ci-reconnect-independent-r3-proof.cjs` (temporary only, SHA **42c90444fdbcfb1009f3cf14de8150ca6815123bd3b28e3e4e677463732dc29f**). It runs real McpManager/McpClient/OwnedStdioTransport with actual typed deadline rejection from a no-PID held-stdio fixture; only fresh connect is controlled to prevent any external spawn. Seeds a real client catalog/authority, catches the expected rejection and asserts actual outcomes before/after await, repeat start, ready and shutdown. Own temporary CMSPARK_DATA_DIR, no live configuration/service mutation. Exit0, full log:

```json
{"replacement_connects":0,"old_receipt_still_tracked":true,"retiring_failed":true,"authorization_revoked_before_wait":true,"aggregated_tools":0,"visible_status":"error","visible_tools":0,"ready_rejected":true,"repeated_reconnect_rejected":true,"shutdown_preserves_owned_receipt":true,"restart_timers":0}
```

Thus the actual replacement count changes **1→0**, ownership dropped becomes **ownership retained**, and usable catalog/authority is revoked before waiting. The new production test controls additionally cover disable/remove/command/global-disable/re-add, startup typed failure, delayed-start ghost and healthy-client teardown alongside failed receipt.

## Startup cause, actual SDK and process receipt remain separate

- `client.ts:215–227` retains typed teardown as primary so manager fences ownership, preserves original startup error in `cause`, and clears the SDK ref only when actual protocol onclose has already removed its SDK transport. Original startup cause is not silently replaced by generic timeout text. Owned transport stays retained even though SDK requests are closed.
- `client.ts:281–293` explicit/reentrant close keeps error rather than disconnected success and does not emit redundant identical error status. StdIO cleanup propagates failure; HTTP behavior/ACL/owner identity are not relaxed.
- The unchanged reviewed r2 stdio piece still closes the unusable protocol exactly once on deadline, clears actual SDK pending responses/timeouts and keeps the process close promise rejected. Existing tests execute actual SDK initialize/list-tools/call with deterministically paused native stdout and verify handlers empty/transport undefined/error/no disconnected signal. No hand-built SDK handler maps pass as production data.
- Natural and explicit close still share the original bounded promise. Final stdout is drained until real receipt or existing1000ms deadline. Owned group/job identity remains the same. No rm retry, test timeout increase, user permission override, new auto dispatch, effect replay or hidden transport change.

## Positive controls and independent machine evidence

Re-ran exact frozen r3 all-MCP-family inventory `/tmp/cmspark-ci-cleanup-r3-test-files.json` plus existing process/ACP/Windows-job boundary files through production `scripts/run-tests.mjs`, Node **22.23.2** via nvm. Fresh independent result:

**483 tests / 472 pass / 11 existing platform skips / 0 failures / 0 cancelled**, exit0, **12872.096625ms**. Full output `/tmp/cmspark-ci-cleanup-independent-r3-mcp.log`. Not simply copied the implementer's identical reported count. One cooperation-mcp baseline test file is part of the inventory; this does not approve my new Cooperation patch, which is a separate frozen component.

Reviewed and observed passing producer controls include:

- Failed actual close retains old manager client and retiring receipt, zero replacement, ready/call refusal, no restart timer, ownership kept through shutdown.
- Config disable/remove/changed command/global-off immediately revoke authority and prevent failed-receipt name reuse after re-add/re-enable; unrelated healthy client still closes on global-off.
- **Confirmed-close positive control:** two concurrent starts remain pending until actual controlled close event, then exactly one replacement connects and ready completes. This rules out an always-blocking implementation being mistaken for safe functionality.
- Startup typed failure and delayed-handshake ghost stay tracked without another child or restart; original cause and real SDK closed-ref versus retained transport tested.
- Native macOS owned wrapper target, sentinel isolation, actual close-before-return and immediate target cwd deletion remain passing with no retries. Final response drainage normal-control stays passing next to deliberate stalled protocol failure.

git diff --check PASS. Production build exit0 is provided implementer/root receipt; not rerun by this independent reviewer because no source changed since compiled machine run.

## Component boundary and remaining deployment gates

No remaining confirmed blocker in this exact CI r3 component. The conservative failed tombstone is intentionally permanent for this manager lifetime: a late close/stream event does not silently clear it, retry it or start another process. Reconnecting that name requires a new manager/Companion lifetime; this is explicit failure/ownership behavior rather than proof the old process was reclaimed. The report does not assert unknown Windows locking process identity or native Windows EBUSY fixed.

Native Windows final-SHA job, fresh Linux ARM64 grouped gates, final Kimi/Pi complete review synthesis, exact-head PR CI and merged-main CI remain separate required checks. MacOS native/controlled held-pipe tests are not substitutes for Windows Job/kernel descendant/cwd evidence; ChildProcess.close alone is not a general certificate for every possible stdio:ignore descendant. No #623 PowerShell timeout repair claim; no enterprise T4/PR626 approval; no whole-wave/release/installation approval. Availability prior component approval remains scoped to its unchanged hashes; other component implementations are not approved here.

**VERDICT: APPROVE CI r3 component at diff SHA1ceeb909b75430bb8aeb7da70cc88f2ecfdd2d2cda2d937b2f75faba5f3aa20a and the five whole-file hashes above. Confirmed r2 P1 has an actual production-boundary negative-to-positive invariant change. Final Linux/independent synthesis/Windows and exact-head CI must still pass before merge/release.**
