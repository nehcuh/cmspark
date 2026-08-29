# Kimi impl dual — PR #246 / #245

All checks complete. Here's my independent review of `fix/245-capture-p0` (head `6e538dfb`) against the #245 A+B spec.

  ## Verification method

  Read current code on the branch (not the patch file), traced each DoD item to source, compiled both test builds, and ran the targeted suites:

  - `npx tsc -p tsconfig.test.json` (companion + chrome-extension): clean
  - overlay-md / overlay-l0 / composer-lease / overlay-capture-acl: 71/71 pass
  - summoner-web / summoner-acl / summoner-workbench-compose / summoner-client: 114/114 pass
  - knowledge-crud-ws / knowledge-crud / computer-darwin-estop-owner / summoner-overlay / summoner-shell-open: 92/92 pass
  - chrome-extension knowledge-truncated-save: 3/3 pass

  ## REJECT criteria — all clear

  - `SUMMONER_ALLOW` still contains `mcp.toggle_server` (`ws/summoner-acl.ts:43`); the only ALLOW delta is *adding* `meeting.*`, and `summoner-acl.test.ts:67` still pins the freeze. No #230 rollback.
  - hide does **not** abort via `abortThreadChat(lease.thread_id)`. Chain is: `hideSummonerWebShell` → `invokeOnShellClosed` → tray `handleSummonerClosed` → `releaseAllOverlayComposerLeases` → router `composer.lease.release_overlay` branch (`message-router.ts:1391-1396`) calls `abortLlmLoopsForPanel(session.panelId)` *before* lease release. `llmLoopOwnerPanel` is stamped per-connection (`message-router.ts:572,1514`; every WS gets a UUID panelId at `lifecycle.ts:844`), so panel-owned Operate loops on the same thread survive.
  - XSS: `overlay-md.ts` escapes `"`/`'` in URLs before attribute insertion; `esc` runs before inline; quote-breakout negative test passes. CSP is per-request `script-src 'nonce-…'` (`summoner-web.ts:616-625`), no `unsafe-inline` for scripts.
  - Truncated Save: UI omits body via `buildKnowledgeUpdateMessage` (`knowledge-save.ts`), handler refuses body when `getKnowledge` returns truncated (`handlers/knowledge.ts:52-59`), engine refuses body when on-disk bytes > wire cap (`skill-engine.ts:1490-1497`). Short unctruncated replace still allowed (positive tests green).
  - estop: socket/flag/nonce all under `DATA_DIR` (`darwin-estop.ts:49-59`), CONNECT requires 0600 socket + 0600 nonce file + `timingSafeEqual` greeting (`connectToEstop`), `sun_path` 104 checked, Swift `host.swift`/`host-skylight.swift` pass `--socket-path/--flag-path/--nonce-file` in lockstep and no longer default to `/tmp`.
  - No overlay Allow/Deny dialect: `pushSummonerWebEvent`/`dispatchAllowed` reject `/confirm/i` except read-only `mcp.confirm.pending`.
  - No #228 expansion: diff touches nothing in cookies/evaluate/L2 defaults.

  ## DoD spot checks

  - A3-1/A3-1b: adapter denies full catalog + `mcp__`/`host_`/`workspace_`/`acp_` prefixes; offer filter + exec wrapper both gated on stamped `surface`; tabId-hallucination recovery disabled for summoner; tests prove client-supplied `surface` is ignored and `validate.ts` didn't grow the field. drainNextRun re-enters `handleMessage` with `session.surface`, so the recursive create is stamped too.
  - A3-2: `/api/mcp/toggle` → 404, `SUMMONER_WEB_DISPATCH_ALLOW` has no toggle, tray `dispatchSummonerWeb` returns `SUMMONER_L0` error for toggle/add, Swift `mcpRowClicked`/`mcpAddClicked` are no-ops. `mcp.list` retained.
  - A3-3: `gateOverlayCurrentThread` (`composer-lease.ts:128`) requires holder==="overlay" for pack.apply/skill.activate/deactivate/knowledge.set_active; A3-4 pinned by test.
  - A2-3: last-SSE `req.on("close")` → `invokeOnShellClosed` (with launch-grace reschedule), STT/meeting aborted via `abortOverlayCaptureSessions`.
  - A3-5/B1 copy: Capture=可以继续聊、Operate=打开侧栏 (`client.ts`, Swift copy in lockstep); truncated-save copy is not the download copy.

  ## Nits (all inside the allowed AWN envelope)

  - Hidden MCP rail in the HTML still POSTs `/api/mcp/toggle` (`summoner-web.ts:2414`) → gets 404. Allowed.
  - `isSummonerNativeExecutorDenied` denies the *entire* native catalog (broader than the executor set, e.g. `use_skill`) — fail-closed, explicitly allowed.
  - I ran the targeted suites, not the full companion suite. Allowed.
  - `SWIFT_TRAY_SHA256` was bumped (`swift-tray-bridge.ts:59`), suggesting the tray binary was rebuilt; host/skylight binary rebuild status not verified from here. Allowed either way, worth confirming before release packaging.

  VERDICT: APPROVE_WITH_NITS
