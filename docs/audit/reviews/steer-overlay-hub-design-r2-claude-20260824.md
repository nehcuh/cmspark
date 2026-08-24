Verification complete. Here is my review.

## Triple review (Claude) — steer/nextRun UI + overlay L0 hub, spec r2

**Method**: read spec r2 + all four lane reports, verified every claimed fold against live code (message-router.ts, summoner-acl.ts, run-queues.ts, menu-bar-agent.ts, lifecycle/composer-lease surface stamping).

### BLOCK folds — verified present in r2

**Security** `[inspected]`
- **S1 allowTrust**: §4 pins the exact contract the lane demanded — `allowTrust = surface !== "summoner"`, 无视 `rest.allowTrust`/`user_gesture`; `user_gesture` kept only as anti-LLM. Replaces the live hardcoded `allowTrust: true` (message-router.ts:2741).
- **S2 cookie orphan**: refuse `pack_trust_cookie_present` when thread holds `mission_pack_trust_snapshot` — the lane's preferred option (refuse > preserve).
- **S3 eligible**: server-side `isOverlayEligiblePack(manifest)` → `pack_not_overlay_eligible`, explicitly "不是只灰按钮”; prefix deny now includes `coding-handoff`; test list covers meeting ok / appsec / coding-handoff / navigate 否.
- **S4 extras**: `workspace_path`/`force_takeover`/`confirmation_phrase` rejected (stronger than strip).
- **S7 mid-run**: whitelist mutation forbidden during live loop (kills both offered-then-blocked and live widening); skills/prompt only.
- **ACL**: only +`pack.list`/+`pack.apply`; `mcp.add` stays denied with test.

**Correctness** `[inspected]`
- **C1**: §2.1 occupied no-enqueue → `run_active` reject, no `existing.abort()` (live supersede at :376-379 replaced); exception list named (file.upload/regenerate stay supersede this PR — declared, not silent).
- **C2**: `abortControllers` authoritative; `chat.done` must not mark idle before drain claim; summoner `thread.select` restores `run_status` (reverses the live strip at message-router.ts:1797-1802); Stop stays busy until `chat.aborted`/`idle`.
- **C3/C4**: `SummonerSubmitEvt.enqueue?` + Node forbidden from `sendChatCreate` + router-side steer|enqueue|create in one tick; submit does not `claimLease` → `OVERLAY_STANDBY`.
- **C5/C6**: textarea unlock explicit (“今日 disabled 必须改”); queue depth via `peekNextRunCount` (exists, run-queues.ts:51); `chat.enqueued`/`queue_full`/`run_active` wired into summoner mapper.

**Product**
- **P-layout**: width ≥640pt (rail 200 + capture ≥420) — the B3 kill criterion.
- **P-copy**: MCP「已连接」read-only chips; meeting/Windows honesty folded (§1 non-goals + §3 copy rules).
- **Enter=steer dissent**: user-locked at grill, not absorbed — per review charter this is an accepted residual, and both required mitigations are in spec (unlock composer §2.3, `run_active` reject §2.1). Busy Shift+Enter=enqueue belongs to the same locked chord family; the busy hint (`回车纠偏 · Shift+Enter 排队`) mitigates the state-dependence.

ADR-020 fit holds: overlay cannot write Trust B (surface-forced allowTrust false, cookie refuse, eligible reject), no confirm dialect added, mcp.add denied.

### Nits (not blocks)
1. **Socket pin implicit** — spec keys on `stampedSurface` but never states rail RPCs ride the summoner-handshake client only, nor the source-lock test. Live architecture already splits clients (menu-bar-agent.ts:1287-1293, overlay = second WS `surface:"summoner"`); implementation must not regress onto the tray client.
2. **Eligible predicate narrower than security's recommendation** — `mcp_servers`/`min_capability`/`requires_modules`/`board_mode` unchecked; `workspace_*` absent from tool deny list; no `overlay_eligible` bit on `pack.list` (Swift gray source unspecified).
3. `sendShortcut` Cmd/Ctrl+Enter users have no busy enqueue chord.
4. `steer_queue_full` missing from error table and overlay mapper list.
5. Steer transcript labeling unspecified (plain `chat.user` echo); enqueue never echoes — optimistic `你:` line would mislabel queued text.
6. Dual thread pickers kept (rail list + `#` search); no layout drawing at 320px/396pt.
7. `handleSummonerContinue` second always-create path unaddressed.
8. PR2 MACHINE list thinner than security's table (no workspace_path-unchanged, no panel-apply→summoner-reapply cookie test).

All lane BLOCKs are folded; the sole dissent is the pre-accepted product residual with mitigations in place. Remaining items are implementation-level tightening.

VERDICT: APPROVE_WITH_NITS
