All spot-checks verified against actual code:

1. **rejectAll** — `security-confirmation.ts:515` today rejects `originWs === undefined` on *any* peer close (broadcast-style, per its comment). Plan Task 6 correctly targets this: with `ws` arg, reject **only** `pending.originWs === ws`; no-arg still drains; comment updated. Matches synthesis lock #4. Line ref ~508–544 is accurate.

2. **disclosure-session Map** — `outbound-mcp/disclosure-session.ts` exists (`acceptOutboundDisclosure` / `hasOutboundDisclosure` / `clearAllOutboundDisclosureSessions`), currently armed by HTTP POST `/disclosure` (companion-http.ts:428) and stdio META_ACCEPT (stdio-server.ts:197). Plan Tasks 1/3 explicitly decouple the grant-file flag (`allow_page_export`) from the in-process session Map — CLI must not call `acceptOutboundDisclosure`; caller `acknowledge` ignored; first exfil HITL in daemon only (Task 10). ✓

3. **index.ts usage** — `printUsage` currently ends at `mcp-outbound` block; switch exists (~307). Task 2 adds `outbound-grant` case (initDataDir + dynamic import) and a usage block next to `mcp-outbound`, named 租手钥匙, never Handoff. ✓

4. **confirm-target 侧栏** — current strings say "Chrome 侧栏批准"/"打开 Chrome 侧栏". Task 9 rewrites to 确认台 copy with tests asserting `/确认台/` and `doesNotMatch /侧栏/`. ✓

**Reject conditions checked:**
- **五分钟 green at PR-A?** No. Blast: "not green until PR-B T2.7"; PR-A DoD = "Not green"; Task 4 stop: "Do not claim 五分钟完成"; Task 10 puts machine DoD at PR-B. ✓
- **Overlay can confirm?** No. Task 5 BLOCK: Allow/Deny payload to overlay; `mcp.confirm.pending` only; `resolveConfirmBinding` never returns overlay as originWs; Task 6 overlay close can't kill unbound; Task 7 tray map never keyed by overlay, notifier = 确认台/托盘; Task 10 overlay `respondFrom` cannot resolve exfil, `assertSummonerAllowed("summoner","security.confirmation.response").ok === false` stays; UAT: overlay shows 打开确认台, no 允许/拒绝. ✓

Four-lane synthesis fully reflected (Product: PR-B milestone gating + tests-follow-SoT via Task 11/12; Impl: grant-file disclosure, rejectAll, event-based wait in Task 8; Security: CLI no listen/POST, HUD no grant this slice, overlay no confirm.response; External: mcp.md disclaimer + grant in every snippet + NSIS + 禁 Handoff).

VERDICT: APPROVE
