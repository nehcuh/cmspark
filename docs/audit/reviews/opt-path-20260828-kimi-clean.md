# Kimi independent re-review — 0.5.3 opt path #245 (2026-08-28)

Raw dump (hook noise): `docs/audit/reviews/opt-path-20260828-kimi-20260828-195010.md`

## Verdict rationale

  I re-verified every load-bearing spot-check claim against the code rather than trusting the synthesis. The four-lane BLOCKs are real, the folded pins in §2 correctly address each one, and none of the four REJECT triggers fire:

  - **#230 expansion:** The path explicitly forbids touching `SUMMONER_ALLOW` (pin 7, NEVER list, DoD A3-2b). Verified `summoner-acl.ts:42-43` contains `mcp.toggle_server` and `summoner-acl.test.ts:67` positively locks it — the spec keeps that test frozen while flipping only the dispatch/HTTP/Swift path tests. Removing hidden live paths (confirmed live: `summoner-web.ts:628-637` POST route, `menu-bar-agent.ts:1634-1636` tray bypass, `SummonerOverlay.swift:682-713` real `@objc` handlers) is path removal, not ACL rollback. The SoT distinction holds.
  - **Operate abort:** `abortThreadChat` is thread-keyed and owner-agnostic (`message-router.ts:181-199`) — the strawman version would indeed have killed panel-owned loops. Pin 4 correctly mandates the panel-keyed path: panelIds are per-connection UUIDs (`ws/lifecycle.ts:844-846`), ownership is recorded at loop start (`message-router.ts:563`), and `abortLlmLoopsForPanel` (`message-router.ts:204-213`) filters by owner before aborting, so overlay loops are cleanly distinguishable from sidepanel loops.
  - **XSS:** Quote-breakout is real — `overlay-md.ts:32-34` concatenates `u` verbatim into `href="..."`, and the `esc` that feeds the overlay page (`summoner-web.ts:1413`) escapes only `&<>`; the test file has no quote-breakout negative. CSP `'unsafe-inline'` confirmed at `summoner-web.ts:524-525`. Pin 1 + pin 2 (attribute escaping/DOM assignment + nonce-or-DOM CSP) close it; encodeURI-only is explicitly rejected.
  - **Capture-closed-after-A1:** NEVER list forbids the claim; DoD gates Capture honesty on all of A1–A3.

  The remaining DoD rows are honest product statements: A3-1 demands the full executor set absent from both offer and exec (the catalog really has dozens of executors — `bridge/tool-definitions-catalog.json`, 57 tools — so the five-name denylist was indeed a lie), A3-1b covers the whitelist=null recovery path (`adapter.ts:1528` confirmed live), B1 is a truncated-gate (not length comparison), B2 is fail-closed with DATA_DIR identity.

  ## Confirmed pins (folded correctly)

  - Pins 1, 2, 3, 5, 6, 7, 10, 11, 13, 14: verified against code, correctly folded.
  - Pin 4 (abort key): correct and implementable as written — the two ownership graphs (composer leases vs `llmLoopOwnerPanel`) are confirmed disjoint.
  - Pin 9 (lease-thread binding): consistent with the `ws/composer-lease.ts` registry design.
  - Pin 12 (B2 direction): `/tmp/cmspark-estop.sock` hardcoded (`darwin-estop.ts:28`), CONNECT-first treated as armed with `owner: "external-or-tray"` (`darwin-estop.ts:174-181`), no getpeereid/nonce anywhere — the fail-closed pin is justified.
  - The four overturned strawman pins (ALLOW change, byte-length rule, five-name list, thread-keyed abort) are all correctly folded out.

  ## Missing / still BLOCK

  None. No four-lane pin is missing from the spec.

  ## Nits

  1. **"encodeURI 不够" is factually off.** `overlay-md.ts` uses no `encodeURI` at all — the only URL check is the `^https?://` regex. The fix (pin 1) is unaffected, but the spec's spot-check line should say "no quote-escaping" rather than implying encodeURI is the current sanitizer.
  2. **`host-skylight.swift` claim partially wrong.** `:601-602` makes `--socket-path` a *required* CLI arg (exits 2 without it); only the **flag** path defaults to `/tmp` (`/tmp/cmspark-estop.flag`). The §4 file-map row "默认同路径，不再回落匿名 /tmp" overstates the socket change needed there — skylight needs the flag-path fix and lock-step arg passing, not a socket-default change. Also the flag path itself stays in `/tmp` under the current pin wording; decide whether the flag moves to DATA_DIR too (it should, or say why not).
  3. **A2 abort wiring is under-specified.** `handleSummonerClosed` lives tray-side (`menu-bar-agent.ts:1020-1026`); `abortLlmLoopsForPanel` and the per-connection panelId live companion-side. The spec says "hide 与 last-SSE 走同一 `handleSummonerClosed`" and DoD A2-4 spies `abortLlmLoopsForPanel`, but never states which process calls it or how the overlay connection's panelId is identified (e.g. companion-side close handler aborts by the summoner connection's panelId before/independent of tray notification). One sentence in pin 4 fixing the call-site ownership would prevent an implementer from wiring it tray-side and re-introducing the thread-keyed abort.
  4. **Path citation drift (cosmetic):** catalog is `companion/src/bridge/tool-definitions-catalog.json` (not `llm/`); `abortLlmLoopsForPanel` is defined at `message-router.ts:204` and called from `ws/lifecycle.ts:1418` (spec cites bare `lifecycle.ts:1418`). Fix the citations so the implementer doesn't grep the wrong tree.
  5. **CSP A1-3 "OR" wording:** "仅 DOM 建链后才保留 `unsafe-inline`" only makes sense because the inline SPA script itself needs it — worth clarifying that DOM-built links alone don't remove the inline-script requirement; the nonce option is the one that actually drops `unsafe-inline`. Not a contradiction, just easy to misread.

  ## Recalibrated: implement now? YES only if APPROVE*

  Not yet — nits 2 and 3 should be folded into the spec text first (small edits, no re-scoping). After that, the path is TDD-ready as written: batch shape (one PR, three commits), DoD mechanics, NEVER list, and the frozen-ACL boundary all hold under independent verification.

  VERDICT: APPROVE_WITH_NITS
