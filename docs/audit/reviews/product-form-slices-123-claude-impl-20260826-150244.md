# Impl review — `2026-08-26-product-form-slices-123.md`

## Spot-checks: plan claims vs code (all six verified `[inspected]`)

| Claim | Code reality | Verdict |
|---|---|---|
| `rejectAll` kills unbound on any peer close | `security-confirmation.ts:509-515` — doc comment states ws-filtered mode rejects entries "whose originWs matches **(or is undefined — broadcast-style)**"; `lifecycle.ts:1399` calls `rejectAll("disconnect", ws)` on every close | ✅ plan Task 6 targets a real, current hole |
| disclosure-session is in-process Map | `disclosure-session.ts:17` — `const sessions = new Map<...>()`; exports `acceptOutboundDisclosure` / `hasOutboundDisclosure` / `clearAllOutboundDisclosureSessions` used by plan tests all exist | ✅ |
| url-cookie-admission same origin bind as L2 | `url-cookie-admission.ts:248,357` — `isOutboundMcpCall ? {} : { originWs: ws }`, identical pattern to `l2-admission.ts:1291-1293` | ✅ Task 7's "same hole, same fix" is accurate, line anchors correct |
| grant CLI does not exist | zero matches for `outbound-grant` in `index.ts`; `printUsage` has no such block | ✅ Create-only, no clobber risk |
| compose test source-regex MCP rails | `summoner-workbench-compose.test.ts:137-153` reads `SummonerOverlay.swift` and asserts `summoner.mcp.toggle` (141) / `summoner.mcp.add` (145) present — delete → red, hide → green | ✅ hide-not-delete strategy is the only way to keep it green |
| extension surface is "tray" | `lifecycle.ts:990-991` stamps non-summoner as `"tray"`; `validate.ts:766-767` only permits `"tray" \| "summoner"` — no "extension" value exists | ✅ Task 5's filter warning (`!== "summoner"`, not `=== "tray"`) is factually grounded |

## Reject triggers — all countermanded

- **No invented overlay confirm**: BLOCK list forbids overlay grant-issue/confirm.response; Task 5 BLOCKs Allow/Deny payloads to overlay (notice-only `mcp.confirm.pending`); Task 10 keeps `assertSummonerAllowed("summoner","security.confirmation.response").ok === false`. ✅
- **No CLI HTTP**: Task 2 MUST-NOTs `listen()`/`createServer`/`fetch`/POST + grep test banning `acceptOutboundDisclosure` import in `grant-cli.ts`; flag writes to the grant **file**, not the Map. Verified today's HTTP arming path (`companion-http.ts:423-429` `companionAcceptDisclosure`) is what Task 3 kills, and e2e line 217's POST-ack happy path exists to go red. ✅
- **Neither hole missed**: Task 6 = `rejectAll`, Task 7 = both `l2-admission.ts` and `url-cookie-admission.ts`. ✅

## Extra grounding verified

- `pickAuthenticatedClientWs` (`lifecycle.ts:257-262`) does filter `chrome-extension://` — Task 5's fan-out inclusion claim is implementable as written.
- `L2AdmissionContext.wsAuthGet` (`l2-admission.ts:184`) returns `{authenticated, origin}` — no `surface` yet, so Task 7's "must grow surface" is correct.
- Existing `security-confirmation-origin.test.ts:98` only locks bound-entry behavior; Task 6's spare-the-unbound change won't collide, and the no-arg drain test (:139) is preserved by design.
- `mcp/confirm-target.ts:6-10` 侧栏 copy exists exactly as Task 9's replacement targets; Swift/HTML anchors (`ctaBox` :1349, 展开工作台 :1362, mic :751, fallback :1130) and both copy tests' regexes match.
- Compose test line 149 currently forbids **any** `确认` in the Swift HUD — Task 11's regex narrowing is *required* for SoT §6 copy, and the plan caught it. Biggest PR-C trap, handled.
- Docs claims confirmed: mcp.md JSON (:267-280) / TOML (:295-305) snippets really omit `CMSPARK_OUTBOUND_GRANT`; `acknowledge: true` documented as the exfil unlock (:330); bake-off (:24,38-39) and TROUBLESHOOTING (:129) still say `Bearer ws_secret`.
- Gate algebra ordering (GRANT_* → flag → HITL) makes "revoke kills exfil even with live Map" hold; existing test at :98 unaffected by Task 6.

## Checklist application

Capability declaration block present in plan header ✅. Axes: no new confirm dialect (reuses security.confirmation + tray race); no new runtime ✅. originWs guidance (#5) deviates from "bind requesting ws" for summoner — deliberate, SoT §7-locked (untrusted HTML surface can never be approval origin), and strengthens the historically-weak MCP/navigate case. Trust monotonicity preserved: CLI issuance is local-argv trust; session Map ≠ 30-day grant flag; no confirm-skip anywhere (Win/Linux fail-closed via `waitForExtensionPeer` timeout, never approved). T3 dual-review ordering is stated.

## Nits (non-blocking)

1. **Error-code migration breadth**: current `DISCLOSURE_REQUIRED` emitters span `facade.ts:86,92`, `companion-http.ts:289,295`, and stdio descriptions; plan's file list covers them but should grep-verify no stale `DISCLOSURE_REQUIRED` survives beside the new `DISCLOSURE_NOT_GRANTED`/`DISCLOSURE_HITL_REQUIRED` pair.
2. **Task 4 test sketch regex**: `/LOCALAPPDATA|Local\\\\CMspark/` — `\\\\` matches two literal backslashes; doc will have one. Passes via the `LOCALAPPDATA` branch anyway, but fix the escape when implementing.
3. **Task 5 rationale slightly imprecise**: post-auth surface ∈ {tray, summoner}, so `=== "tray"` is equivalent *today*; the durable argument for `!== "summoner"` is deny-list robustness. Guidance is safe as written.
4. Minor anchor drift: POST /disclosure route actually dispatches from ~436 (arm call at :428), plan says ~458; auth.ok emit at :1006 vs plan's ~989. Both within "~" tolerance.

VERDICT: APPROVE_WITH_NITS
