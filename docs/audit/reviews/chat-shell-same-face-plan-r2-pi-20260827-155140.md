I've completed a thorough verification. Here's my review.

# Plan dual review — ChatShell #239 (T2 implementation plan)

## Verification method
Read the plan, spec (r2 LOCKED), both r2 adversary syntheses, the verdict JSON, the capability checklist, and — critically — the live source: `summoner-acl.ts`, `summoner-web.ts`, `menu-bar-agent.ts`, `tray/companion-client.ts`, `ws/validate.ts`, `message-router.ts`, `ws/lifecycle.ts`, `extension-peer.ts`, `background/index.ts`, `ws-client.ts`, `useWebSocket.ts`, `ContextStrip.tsx`, `ChatView.tsx`, `empty-state-copy.ts`, `summoner/client.ts`, plus the lockstep test. Confirmed `git status`/`git diff`: patch is current for the plan/prompts; the wireframes + spec have a post-patch r2-sync pass in the working tree (see nit 3).

## Impl lane — every plan claim checked against real code

**r1 blockers → r2 pins, all genuinely folded (not papered):**
1. **Tray opener** — `menu-bar-agent.ts:1832` really is `if (!msg || msg.type !== "security.confirmation.request") return`; a separate `companionClient.onAppMessage` is required, and registering on `summonerClient.onAppMessage` (:1867) would wrongly push to `pushSummonerWebEvent`. Pin 1 correct.
2. **No-id broadcast** — `companion-client.ts` `handleMessage` consumes any `msg.id` matching `pendingRequests` before fan-out to `appMessageCbs` (:528-536 vs :576-577). Pin 2 verified.
3. **Fail-closed** — `openSummonerWebShell()` (`menu-bar-agent.ts:1637`) has no `threadId` param; HTML defaults to `threads[0]` (`summoner-web.ts:940, :1255`). Pin 4 real.
4. **Whole face ≠ placeWindow** — `.body{display:none}` at `summoner-web.ts:679`; `placeWindow(false)` at `:1253`; `setExpanded` toggles class + `placeWindow` at `:887-895`. Pin 6 verified; `summoner-web.test.ts:138` does assert `/placeWindow\(false\)/` and `:175` asserts no 允许/拒绝.
5. **Overlay empty has page title** — `summoner-web.ts:966` contains `<strong>要对这页做什么？</strong>` → Task 3 test 1 is genuinely RED today.
6. **SW must forward** — `background/index.ts:1490-1496` `default:` returns "Unknown message type"; grep confirms zero `overlay` strings in the SW → Task 5's RED holds. `ChatView.tsx` has no `弹出对话框` today; `function EmptyState` (:1687) / `const markdownCSS` (:1707) region markers exist as the test cites.
7. **Lockstep** — `ws-router-validator-lockstep.test.ts` extracts router `case "..."` arms and `const validators:` keys; a new `overlay.shell.open` case + `validate.ts` key is auto-covered, no test edit needed. `validate.ts` fail-closes unknown types in strict mode (:1195-1203). Pin 5 correct.
8. **Extension surface is tray** — extension `auth.handshake` (`ws-client.ts:161`) carries no `surface`, so `lifecycle.ts:1006-1007` stamps `tray` → `assertSummonerAllowed` passes (ACL only gates `surface==="summoner"`); `session.origin` = WS Origin `chrome-extension://…` (`lifecycle.ts:835, :1341`) → handler's `session.origin` check (ignoring forged `payload.origin`) is wired correctly.
9. **ACL untouched** — `SUMMONER_ALLOW` (`summoner-acl.ts:14-45`) and `SUMMONER_WEB_DISPATCH_ALLOW` (`summoner-web.ts:36-58`) contain no `list_tabs`/`tab.*`/`ui.dock`/`overlay.shell.open`; `SUMMONER_WEB_EVENT_ALLOW` + `pushSummonerWebEvent` gate (:241) blocks the tray's summonerClient from leaking the broadcast into HTML SSE.
10. **Test command** — extension `npm test` = rmSync + `tsc -p tsconfig.test.json` + `node --test .test-dist/tests/*.test.js` (package.json:10); lockstep `ROOT = path.resolve(__dirname,"..","..")` matches the compiled `companion/.test-dist/tests` layout. `ContextStrip.tsx:51` uses `{active:true, lastFocusedWindow:true}` as cited; `tabs` permission present (package.json:48).

## ADR-020 capability checklist
Declaration present in prompt + plan header (Surface L0 / L2-classes none / Compose static chips fill / Autonomy n/a / Trust overlay-never-Allow-Deny + F-I-4 + no tab.* / Channel community). Axes fit: pure L0 Surface, no L2, no new composition protocol, no new runtime (copy contract, not shared ChatView; no `chrome.*`/`agentStore` into summoner-web). Trust monotonicity holds: `SUMMONER_ALLOW` unchanged, `overlay.shell.open` kept off it and origin-gated to `chrome-extension://`, no `sidePanel.open` on Companion side (F-I-4). No new confirm dialect; originWs n/a. No bare "中层 Agent" language. Task 4's `assertSummonerAllowed("summoner","overlay.shell.open")` → denied test is already green (guard, not RED), acceptable.

## Nits (non-blocking)
1. **Dual-process tray-absence detection underspecified** (plan Task 4 Step 3): `OVERLAY_SHELL_UNAVAILABLE` is only reachable in the co-located path (`getTrayInstance()` non-null); in daemonized dual-process the handler can't introspect the client list, and the "SW 超时/错误 toast" product path relies on an unspecified SW→cb mechanism — the SW's `wsClient.send` has no request/response correlation, so the companion error frame would arrive via the generic frame forward (`handleCompanionMessage` → UI), not through the `sendMessage` cb. Fail-closed-by-silence is acceptable and documented, but pin the UI-side error-frame listener explicitly.
2. **Broadcast echo not pinned**: the no-id broadcast fans out to all clients including the sending extension's own WS; `handleCompanionMessage` forwards unknown frames to the UI. Harmless if the UI ignores unknown types, but one line ("SW/UI 忽略 overlay.shell.open echo") would close the loop risk.
3. **Patch vs working tree**: the patch artifact (155140) contains the pre-sync wireframes (filled 贴回侧栏 in tray mock E, 正在看 copy); the working tree has since applied the full r2-sync pass — verified zero `正在看`/`今天`/filled 贴回 remain in `wireframes.html`, and the spec status now reads "r2 LOCKED · dual Claude+Pi 均 AWN". Plan/prompts identical. Artifact ordering only.

## Outcome
All 7 r1 impl blockers are closed in the plan with accurate file:line anchors, the protocol (`overlay.shell.open`, validator + router + thin handler + origin-gated session + no-id broadcast + tray opener + SW forward) is fully specified and traced through the live code, and the tests are genuinely RED-today where they must be. Implementable; the nits are mechanism-level details, not gaps that would ship a wrong or unsafe behavior.

VERDICT: APPROVE_WITH_NITS
