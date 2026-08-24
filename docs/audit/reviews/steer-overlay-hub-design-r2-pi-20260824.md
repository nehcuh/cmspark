I've read the spec r2, all four lane reports, and spot-checked the live code the lanes cited. Verifying the folds:

**Security lane (S1–S4) — all folded, verified:**
- S1 `allowTrust`: spec §4 forces `allowTrust = surface !== "summoner"`, ignores `rest.allowTrust`. Live router hardcodes `allowTrust: true` (`message-router.ts:2740`) — the fold is real and necessary. ✓
- S2 cookie orphan: §4 refuses overlay apply when `mission_pack_trust_snapshot` present (`pack_trust_cookie_present`). ✓
- S3 server eligibility: §4 `isOverlayEligiblePack` server-side, 404/`pack_not_overlay_eligible` ("不是只灰按钮"). ✓
- S4 strip `workspace_path`/`force_takeover`/`confirmation_phrase`: §4 rejects non-empty. ✓ ACL adds only `pack.list`/`pack.apply` (live `summoner-acl.ts` has neither). ✓

**Correctness lane (C1–C6 + must-fixes) — all folded, verified:**
- C1 occupied create → `run_active` reject, no abort (§2.1). Live code still `existing.abort()` (`message-router.ts:373–379`) — the fold is real. ✓
- C2 busy SoT: `abortControllers` authority, `chat.done` not idle before drain, `run_status` restored on summoner select (§2.2). Live code strips it (`stampedSurface === "summoner" ? undefined` at `:1797`) — fold is real. ✓
- C3/C4: router mapping + `submit.enqueue?: boolean`, no `claimLease`, `OVERLAY_STANDBY` (§2.4). Live `SummonerSubmitEvt` has no modifier (`protocol.ts:83`) — fold is real. ✓
- C5 unlock panel textarea (§2.3); live code disables on `threadBusy` (`App.tsx:1771–1776`) — fold is real. ✓
- C6 whitelist frozen during live loop (§4). Plus `idle_enqueue`, `chat.enqueued` depth, error mapping, Stop-stays-busy. ✓

**Product lane:** P-layout (≥640pt, §3) and P-copy (已连接 MCP, composition-only copy, §0/§3) folded. B1 (Enter=steer) is the accepted residual per the task rule — both mitigations are in spec: unlock composer (§2.3) and `run_active` reject (§2.1), plus labeled 纠偏/排队 buttons.

**Remaining — nits only:**
1. B2: busy Shift+Enter = enqueue is deliberately retained (§2.3, §7 #3) — same dissent family as the pre-accepted B1, partially folded (labeled 排队 button, wire modifier, idle Shift+Enter=newline preserved); chord assignment (Shift vs Alt) is a UX preference.
2. Eligible predicate narrower than the lane's recommended set — `min_capability`, `mcp_servers`, `board_mode` unchecked (concrete shipped false-positives `coding-handoff`/`evaluate`/`acp_*` are caught).
3. `pack.list` `overlay_eligible` bit + tray-socket pin not stated (server enforcement makes both cosmetic/implementation-level).
4. Cmd/Ctrl+Enter (`sendShortcut`) busy behavior undocumented; dual thread switchers (rail + `#`) retained.

No Trust-monotonicity, supersede, or SoT BLOCK survives in r2; the residual items are refinements, not safety/protocol holes.

VERDICT: APPROVE_WITH_NITS
