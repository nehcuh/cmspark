Verification complete. Here is my review.

# Dual external review — ChatShell plan r2 (#239)

Patch freshness [executed]: `git status` matches the patch header exactly (same staged/untracked list, base `043a5f4` = HEAD). Not stale.

## r1 plan-blocker closure (all verified against real code [inspected])

1. **Tray `onAppMessage` gap** — CLOSED. menu-bar-agent.ts:1832-1833 filters `msg.type !== "security.confirmation.request"` → return, exactly as pin 1 claims; fan-out ≠ subscribed. Plan adds a second `companionClient.onAppMessage` and explicitly keeps the summoner client (:1867) opener-free.
2. **Broadcast with `id` swallowed** — CLOSED in substance. companion-client.ts:528 `if (msg.id && this.pendingRequests.has(msg.id))` returns before the appMessageCbs fan-out (:576). No-id prescription is the safe call (see nit 4).
3. **`opened` false-success** — CLOSED. Pin 3 mandates `OVERLAY_SHELL_UNAVAILABLE` fail-closed; `useWebSocket.sendMessage` confirmed callback-less (useWebSocket.ts:26), so the plan's `chrome.runtime.sendMessage(..., cb)` detour is the correct mechanism.
4. **`threads[0]` swallowing** — CLOSED. Auto-select confirmed at summoner-web.ts:940 and :1255; `openSummonerWebShell` confirmed argless (menu-bar-agent.ts:1637). Pin 4 changes signature + `selectThread(thread_id)`.
5. **`placeWindow(true)` ≠ face** — CLOSED. `.body{display:none}` at :679; `setExpanded` (:887) does `classList.toggle("expanded")` + `placeWindow`. Existing `placeWindow(false)` at :1253 and test :138 both named for update; test :137 (`hud expanded` literal) correctly unaffected.
6. **Lockstep ENOENT** — CLOSED. Lockstep test resolves `ROOT = companion/` (ws-router-validator-lockstep.test.ts:13-14); the :147 test auto-fails any router `case` without a validator key, so "lockstep 测不用改" is accurate. validate.ts:1188 fail-closed default makes the validator key mandatory in production.
7. **Pop-out buried in EmptyState / SW not forwarding** — CLOSED. SW `default:` bounce confirmed at background/index.ts:1490-1497; bulk-forward list at :1330-1383. Pin 9/10 + Task 5 test (`emptyFn` slice between `function EmptyState` :1687 and `const markdownCSS` :1707 — both markers real).

## r2 spec pins not reopened [inspected]

- **ACL non-growth**: `SUMMONER_ALLOW` (summoner-acl.ts:14-45), `SUMMONER_WEB_DISPATCH_ALLOW` and `SUMMONER_WEB_EVENT_ALLOW` (summoner-web.ts:36-78) all clean of `overlay.shell.open` / `list_tabs` / `tab.*` / `ui.dock`. Task 4 locks all three.
- **Trust**: origin gate reads `session.origin` (SessionCallbacks carries it, message-router.ts:238-263; voice.stt precedent at :2388-2398), ignores `rest.origin`, with a forged-origin test. Summoner surface denied twice (pre-router gate lifecycle.ts:1060 + handler). Broadcast payload = `type` + `thread_id` only. Extension handshake carries no origin in payload (ws-client.ts:161) — origin comes from WS headers, so the fence is real.
- **No 贴回 / no Allow-Deny / no page on overlay**: Task 3 bans `当前页：`/`要对这页做什么`/`正在看` in summoner-web source; `:966` confirmed as the page-title copy today (test genuinely red first); existing `允许|拒绝|Allow|Deny` lock (:175) kept. ctaBox/`SUMMONER_OPEN_CONFIRM`/`SUMMONER_ATTACH_FOOTNOTE` verified present (:822-829).
- **Copy contract not shared React**: separate `chat-shell-copy.ts` + source-text lockstep test (no cross-tree import). Chips fill-not-send (pin 12 + Task 2 Step 4). No Swift files in map. Working-tree wireframes now clean of 正在看/贴回侧栏/今天 — the plan header's “线稿已跟 pin” claim checks out.
- **TDD**: Tasks 1/2/3/5 red-first verified (missing module, stale copy, :966/:1253 literals, ChatView lacks 弹出对话框 today). Task 4 mixes red-first (validator — unknown types pass in NODE_ENV=test, so the no-thread_id assertion is red until the key exists; handler ENOENT) with regression locks — acceptable.

## ADR-020 checklist [inspected]

Declaration present and correct (plan:19-26). Axes fit: pure L0 Surface, L2 none, chips are static templates not a composition protocol, Autonomy n/a. Trust monotonicity intact — new message type gets a *new* origin gate, nothing loosened; no new confirm dialect, no new runtime (thin handler + existing `openLoopbackPage`); originWs N/A (no `securityConfirmations.request` changes). Pack-first untouched. No bare 中层 Agent framing. Channel community. Diff is docs-only (plan + review artifacts) — nothing shippable to regress.

## Non-blocking nits

1. **Companion test command ENOENT** (plan:84, "How tests run"): compiled names keep the `.test` suffix (verified `companion/.test-dist/tests/summoner-web.test.js`); the plan's `.test-dist/tests/summoner-web.js` etc. would fail. Loud failure, trivial fix (`*.test.js` or just `npm test` via run-tests.mjs).
2. **Task 3 test vs Step 3 contradiction**: `assert.match(html, /要我帮你做什么/)` on summoner-web.ts *source* forces inlining the literal, but Step 3 says inject `CHAT_SHELL_TITLE_NONE` — an interpolated constant leaves no literal in the source (cf. `${SUMMONER_MIC_SIDEBAR}` at :966). Reconcile: match the identifier, or read client.ts.
3. **Task 5 error-channel conflation**: bulk-forward replies `{ok:true}` immediately (background/index.ts:1393-1401), so `OVERLAY_SHELL_*` never arrives in the `cb`; it reaches the panel via the generic runtime relay (:431). Implementable, but the plan should name that second listener.
4. **Pin 2 rationale overstated**: an id'd broadcast is only swallowed when the id collides with a pending request (companion-client.ts:528 requires `pendingRequests.has`); non-colliding ids do reach appMessageCbs. The no-id rule is still correct as defense against id collision.
5. **thread_id → HTML channel unspecified**: URL query vs `thread.select` dispatch not named, and no test locks `selectThread(thread_id)` / absence of silent `threads[0]` (pin 4 has no assertion despite :940/:1255 being the known offenders).
6. **Resize flash**: spawn args stay `--window-size=720,120` (pinned by summoner-shell-open.test.ts:71) while the face now defaults expanded (520) — planner/test absent from the file map. Cosmetic.
7. **`srcFile` helper**: used in Task 4 snippets but defined only in summoner-web.test.ts:23; each new test file must define it.

All seven r1 plan blockers are genuinely closed with verified anchors; remaining issues are command/name/mechanism nits that fail loudly rather than silently.

VERDICT: APPROVE_WITH_NITS
