# Independent adversarial review — CI r2 / availability r2

2026-10-14 Asia/Shanghai. Reviewer is the Cooperation implementer, **not** CI or Availability implementer. I do not approve my own Cooperation changes or the Office module. Read CI/Availability complete diffs, full changed source/tests and unchanged MCP manager/config/authority and voice hook/capture callers from frozen snapshot `/tmp/cmspark-convergence-wave-20261014/repo`. No repository source mutation, model/provider call, commit, push, issue comment or merge by this reviewer. Independent probes/logs only in temporary paths.

Frozen packet `/tmp/cmspark-convergence-wave-20261014/review/context-r2.md` SHA256 **9e3b1d6625c2b1518b198d9de4cae54d62b3808618c7c75805480b5a732ff921**. Nine reviewed changed files match exact packet whole-file hashes, zero mismatches; details `/tmp/cmspark-ci-availability-independent-hashes-r2.json`.

## P1 confirmed — failed owned-process close receipt is discarded by manager replacement/stop

**CI component remains blocked.** Transport/client correctly distinguish protocol closure from a rejected process-teardown receipt, but unchanged production manager callers still swallow that rejection and lose ownership.

Real source boundaries:

- `companion/src/mcp/manager.ts:204`: `await prior.close().catch(() => {})`; line205 deletes the prior mapped client; lines209–215 create/connect a replacement regardless of failed owned-resource reclamation.
- `manager.ts:268`: stop deletes the owned client **before** line270 swallows failed close. Subsequent remove/re-add or disable/enable can start another configured subprocess after the previous receipt became untracked.
- `manager.ts:240–241`: startup catch schedules restart without discriminating typed teardown failure. The new client `_closing` fence stops the immediate natural onclose path but does not suppress this separate restart path.
- `manager.ts:88–90`: shutdown uses settled stop calls then clears clients, also dropping any unresolved owned receipt. Config authorization still revokes immediately, but authorization revocation is not process reclamation.

Actual independent red probe `/tmp/cmspark-ci-reconnect-independent-probe.cjs` + `.log` executes frozen production **McpManager.startClient**, real **McpClient.close**, and real **OwnedStdioTransport.close**. A deterministic no-PID launcher fixture has already exited but never emits close, inducing the actual typed one-second teardown rejection. Only the fresh client's connect is controlled to avoid any actual external process. Observed, asserted and logged:

```json
{"finding":"unconfirmed teardown admits replacement","replacement_connects":1,"prior_status":"error","old_receipt_dropped_from_manager":true}
```

The old `McpClient` still owns its failed transport receipt in memory, but is no longer manager-tracked. This is the exact integration failure that the component's claimed “unknown teardown cannot admit replacement” contract must prevent. Not an opinion about APIs or a Windows EBUSY diagnosis: it is a confirmed new error-propagation/caller boundary uncovered on the frozen r2 production manager path.

Required repair: retain failed-teardown ownership/tombstone through stop, restart, configuration replacement/removal/re-add and shutdown accounting; prevent replacement until resource ownership has a valid confirmed release boundary. Disable/removal must still synchronously revoke tool/catalog/confirmation authorization. Startup/ghost cleanup must not schedule or leak a replacement on typed unconfirmed teardown. Add actual-manager negative regressions including reentrant/concurrent/config updates; preserve existing bounded close/error and don't add rm retries or relax timeout/identity checks. Root acknowledged this finding and assigned CI r3 to its implementer; this report does not approve an unreviewed r3.

## CI component outcomes already correct in r2

- `stdio-transport.ts:61` captures ChildProcess close before exit-triggered teardown. `exit` is not treated as successful inherited-stdio closure. Final stdout remains read until actual receipt or bounded failure; explicit and natural close share the same promise.
- `stdio-transport.ts:128–140` retains the one-second process bound, rejects typed teardown failure, then notifies protocol onclose. This is necessary because SDK onerror alone leaves pending request handlers/timeout state live. One protocol close is not a process-success receipt.
- `client.ts:159–165` marks `_closing` and error before protocol onclose; immediate automatic disconnected listener is suppressed. `client.ts:271–289` does not turn a failed stdio cleanup into disconnected success and keeps its transport reference.
- Existing native tests check actual close event before return, owned fixture PID ESRCH and immediate directory deletion without retry/polling, sentinel process protection, final-message drainage, repeated/reentrant callback and real SDK handler clearing.

These are positive component properties, not enough to overrule the manager P1. Native Windows close/cwd/identity verification remains pending; macOS native and synthetic launcher/held-stdio success do **not** establish Windows EBUSY was fixed. Existing #623 PowerShell owner timeout is not addressed by this diff.

## Availability #491 — component APPROVE

Outcome: derived graph/distribution/retrieval remains usable when only disposable persistence fails; genuine computation failure continues to return rebuilding rather than fake data.

- `skill-engine.ts:479–489` isolates cache persistence failure and emits only fixed diagnostic plus system error code, marks in-memory computed index dirty. New warning does not print paths or knowledge content. Existing computation diagnostic semantics were not silently weakened.
- `skill-engine.ts:495–516` carries graph display/LLM/lock/ack forward, installs computed index before the cache-write attempt. Computation exceptions at517–520 invalidate index and clear dirty flag as before.
- `skill-engine.ts:561–570` a same-fingerprint dirty index attempts persistence on a subsequent explicit derived-index read while still returning usable memory if persistence fails; fresh valid disk load clears dirty flag. Source fingerprint drift still rebuilds current docs; no stale index substituted to claim new data.
- Tests exercise real temporary EISDIR/ENOTDIR cache fault, including root-run Linux-compatible fault construction, actual KnowledgeEngine sources, actual `knowledge.graph` handler, retrieval source selection/system-prompt sources, distribution, new source import and carried graph lock, then repaired cache path and real disk read. Separate controlled computation failure retains honest rebuilding.

No grant/permission/live config change or source-document chmod/rewrite. This is retrying only a disposable derived-cache write on a requested read, not retrying an external effect. Unchanged graph label/lock/ack setters retain their existing direct-write semantics; this review does not claim all historical metadata-setter cache faults were redesigned.

## Availability #486 — component APPROVE, actual hook browser acceptance added independently

- `local-stt-adapter.ts:481–488` acquires capture first, rejects dead/aborted/not-wanted/old-generation result and aborts the acquired late handle before announcing listening.
- `local-stt-adapter.ts:501–509` installs stop resolver/timer before callback, so onStart-triggered stop/abort can resolve the armed recording promptly. Conditional `capture===handle` prevents an old coroutine clearing replacement capture.
- `local-stt-adapter.ts:842–856` reports initial onStart once per logical recording, guards old run before errors/end/reset/upload. Existing stop/abort/destroy reset generation guards are retained. No continuous PCM/ASR queue implementation or real model performance claim (#494 remains separate).

Issue #486 explicitly asks production adapter **plus useVoiceInput browser** verification; adapter unit tests alone do not satisfy that row. I inspected the existing `chrome-extension/scripts/test-voice-hook-ui.py`, which already uses the real React hook but tests progressive classic PCM. Created a separate independent temporary probe derived from its actual React fixture, configured nonstream continuous. Bundle imports frozen real **useVoiceInput**, real adapter factory, modified nonstream adapter and production **audio-capture**. Only Chrome runtime, getUserMedia tracks and MediaRecorder are synthetic, allowing exact delayed-grant ordering without a real microphone/model.

Actual headless Chrome scenarios all pass (`/tmp/cmspark-486-browser-independent-probe.py`, `.json`, `.log`):

| Scenario | Observed actual React phases | Handle/state assertion |
| --- | --- | --- |
| ready | idle → starting → listening → processing → idle | No listening/STT start before pending capture resolved; track released after stop |
| stop before grant | idle → starting → idle | No listening at any time; late granted track0 released; no voice.stt.start |
| change owner, start replacement, grant replacement then old capture | idle → starting → idle → starting → listening → processing → idle | Old track0 released; replacement remains listening and its track1 is untouched until user stops; drafts preserved; no auto chat send |

No page errors; all original draft text retained. Browser probe ran via `uv run --no-project /Users/huchen/Projects/ITCra/.venv/bin/python`, Node22 esbuild, existing uv-managed Playwright and locally installed headless Chrome; no project source changes. This supplies the missing browser hook row **within the intended synthetic capture scope**, not native OS permission, acoustic accuracy, ASR performance or installed extension/companion E2E. Root may archive this probe or make it durable before closure; its precise nonstream configuration and phase receipts must remain available.

## Independent machine evidence and limits

Node22.23.2. Frozen snapshot compiled outputs, no competing recompilation/source edits:

1. Canonical isolated runner `mcp-stdio-tree`, `mcp-compatibility-602`, `mcp-manager`, `knowledge-clusters`, `knowledge-graph`: **99 tests / 98 pass / 1 existing platform skip / 0 fail/cancel**, exit0, 2180.1995ms. `/tmp/cmspark-ci-availability-independent-r2.log`.
2. Extension `voice-local-continuous` production adapter tests: **13/13 pass**, zero skips/failures/cancels, exit0,1556.141ms. `/tmp/cmspark-486-independent-node-r2.log`.
3. Real-manager held-stdio red probe reproduces the P1 as asserted, exit0 reporting a failing product invariant; this is **not** counted as functional green.
4. Actual Chromium hook/nonstream/capture probe: three outcome/trajectory scenarios PASS, exit0; full receipts as above. Synthetic tracks/recognizer are explicitly disclosed.
5. Nine scope whole-file hashes match packet with zero mismatch. Group CI diff SHA **c655383be1a51a16c588fe0a334ac6f7cc5bc14e2e4195ed73c656ba74143d93**; availability diff SHA **73102906de4a330282f60165a72433a12fb082ac352d385e1863a1e5445367e7**.

Provided host inventory5901/5849 pass/52 existing skips/zero fail+cancel and frontend1527 pass/builds0 are recorded machine inputs, not independently rerun entire inventories here. Linux ARM64 and exact fresh-head CI are pending and not deemed passed. Component approvals cannot bypass those final gates or ITCra T4. I do not approve Cooperation/Office/new r3/source changes, nor claim whole release or original vw2ob1 trace resolved by these checks.

## Source identities and disposition

Verified actual lines refer to `/tmp/cmspark-convergence-wave-20261014/repo/` frozen files:

- MCP client SHA **2cb274fa484be83fb7e16f586f76d86a07f2d357f0abf98189c55c505340093d**,159–165/271–289; owned stdio SHA **909df9cb4d76ca9cd5f34cf15cf0f26472e9a769de94854bc16c3f474ac4c2c2**,61/128–146.
- SkillEngine SHA **98858543059b2eca49c0bced1b3927a4753184a4d2a2a18c54e47c051ba9bf90**,479–520/561–583.
- Nonstream adapter SHA **7cf1cfc6b1c6c1a07b898b6d6ef8d44ce2b84bdc14dbff8bdef038c8b6ead616**,481–518/842–856.
- Unchanged production manager SHA **5e4b363c74c2d62b7373948ac19cc376df87da10cf819387eaa833fb817c8136**,204–215/268–272/240–241 is part of the confirmed caller failure; its exact hash and hook/probe hashes are recorded in `/tmp/cmspark-ci-availability-independent-hashes-r2.json`.

**VERDICT: REJECT CI r2 (confirmed P1 manager ownership/replacement hole). APPROVE Availability r2 components #491/#486 at these exact hashes, including independently verified synthetic real-hook browser row. No whole-wave/release/merge approval; require repaired CI r3 independent review, final Linux and exact-head CI.**
