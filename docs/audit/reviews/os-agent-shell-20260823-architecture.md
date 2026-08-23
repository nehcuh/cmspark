# OS Agent Shell — Architecture adversarial review

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Lane | ARCHITECTURE (isolated; other 20260823 lanes not read) |
| Scope | `feat/os-agent-shell` HEAD `659bbcebeca13dd136080c0ef47ed7da1ce3700b` + working tree (uncommitted grok-bot slice) |
| Base | `origin/main` merge-base `fc1872571d36e75d9ce137a2d5c6c323b7a70e0a` |
| Brief | `docs/decisions/os-agent-shell-brief-2026-08-22.md` S1–S24 |
| Plan | `docs/superpowers/plans/2026-08-22-os-agent-shell-p0-spike.md` |
| Journeys | `docs/superpowers/specs/2026-08-23-os-agent-shell-user-journeys.md` (untracked) |
| Reviewer | independent; did not implement; READ-ONLY except this file |

Comments that restate the brief are not architecture. This review traces sockets, leases, stdin cmds, and UI chrome.

---

### Capability declaration check (ADR-020)

**Claimed (brief §0 / spike plan):**

```text
Surface:      L0 capture overlay (macOS); full L0/L1 = Side Panel; L2 = HUD/Cockpit
L2-classes:   none new
Compose:      index only (thread.list); no Pack apply / allowTrust
Autonomy:     single
Trust:        SHA256 tray binary; overlay not a confirm writer; S19 non-retryable; S21 per-connection ACL
Channel:      community
```

**What the code actually hangs on**

| Axis | Verdict | Evidence |
|------|---------|----------|
| Surface | L0 capture **plus** a second chat chrome stack | Overlay hydrates 40 lines, streams tokens, STT, tool-name rows, settings remnant, MCP names protocol. Not a Side Panel 一级入口 (ADR-020 anti-pattern 1 dodged). It **is** a new OS-level L0 surface that has stopped being thin. |
| L2-classes | no new host_*/shell/netsec tools | LOCK |
| Compose | MCP **index** leaked onto summoner ACL (`mcp.list`); Pack apply denied | `companion/src/ws/summoner-acl.ts:11-27`. Overlay may invoke companion MCP tools via the **chat** loop (allowed by spike plan). Confirm retargeted to Panel (`mcp/confirm-target.ts`). |
| Autonomy | single loop | LOCK. No auto-spawn. |
| Trust | overlay is not N5 writer | LOCK for Allow/Deny chrome. **Broken** for S21: overlay stdin writes `config.json` via `saveConfig` (`menu-bar-agent.ts:609-611,957-962`). |
| Channel | community | LOCK |
| Runtime | Companion still unique tool-loop | LOCK for S1. Overlay is not a second LLM. |
| Confirm dialects | no `summoner.confirm.*` | LOCK for S6 UI. New **notice** frame `mcp.confirm.pending` is a cousin, not a writer. |
| GOAL / ADR-020 one-liner | frozen | `docs/GOAL.md:9` still 浏览器内的 AI Agent. S24 LOCK. |

ADR-020 anti-pattern 3 (new runtime): **not committed**. Anti-pattern 2 (new confirm dialect): **not committed**. Anti-pattern 1 (new primary chrome): **violated at OS layer** — S8 cap (`composer + 检索 + 缺浏览器徽章`) is already exceeded.

---

### Strengths

1. **S1 is real, not a comment.** Overlay has no LLM. `chat.create` is fire-and-forget on a second WS (`menu-bar-agent.ts:1210-1230`, `companion-client.ts` `sendChatCreate`). Tokens travel stdin. Companion remains SoT.

2. **S19 L1 split is actually wired.** `createToolExecutor` L1 tail calls `forwardL1OrUnavailable` with `pickExtensionWs: pickAuthenticatedClientWs` (`server.ts:762-781`). `resolveL1ActuatorWs` refuses tray origin as actuator (`l1-actuator.ts:22-33`). `pickAuthenticatedClientWs` remains extension-only (`lifecycle.ts:257-267`). Fake-WS tests prove forward is not invoked on missing peer (`tool-forward-actuator.test.ts:63-89`).

3. **S6 overlay is not a confirm writer.** Swift SummonerController has no Allow/Deny. `isSummonerConfirmDialect` rejects `summoner.confirm.*` (`protocol.ts:259-265`). ACL hard-denies `security.confirmation.response` (`summoner-acl.ts` + `summoner-acl.test.ts:24-37`). L2 still races tray stdin `respond()` (`l2-admission.ts:1134-1173`). MCP overlay path retargets to extension WS (`confirm-target.ts:12-28`).

4. **S11 stolen hotkeys are actually banned** in TS (`hotkey.ts:64-68,128-133`) and (uncommitted) Swift occupied labels.

5. **S13 attach is a UI RPC.** `attachChromeOnly` / `handleSummonerAttach` call `getChromeOpener()`, not an LLM tool. CTA copy contains `我们不能替你打开侧栏`. Catalog grep for `openChrome` as a tool is empty [inspected].

6. **Handshake surface is connection-keyed, not Origin-cleaved.** `st.surface = rawSurface === "summoner" ? "summoner" : "tray"` (`lifecycle.ts:990-991`); ACL runs after auth (`lifecycle.ts:1036-1044`); `stampCmsparkSurface` overwrites client spoof (`composer-lease.ts:96-100`). Tray `skill.list` survives. That matches the S21 *shape* even though the *set* drifted.

7. **Uncommitted grok-bot slice does reduce some chrome.** Header 设置 button and `召唤器 · 实验` label removed; MCP field forced hidden (`Tray.swift:1637`); transcript switched from bubble stack toward plaintext lines; first-paint badge is `检测浏览器…` not hardcoded 未连接.

These are not enough. The lease is a toy, the overlay is thickening, and the tests will not hold the laws.

---

### Issues

#### BLOCK

**B1 — `composer.lease` is not a source of truth. Overlay close does not release. Overlay open does not claim. Mutations are not broadcast. After one overlay send, Side Panel is permanently `OVERLAY_STANDBY` until Companion restart.**

- What's wrong:
  - Registry is a process-local `Map` (`composer-lease.ts:38,75`). Restart = all leases vanish (defaults `holder: "panel"`, rev 0).
  - Overlay claims **only on submit** (`menu-bar-agent.ts:690-697` → `claimOverlayComposerLease` → `claimOverlayLeaseCas`). Open / hydrate / `summoner.ready` never claim. Dual drafts while overlay is visible and idle.
  - `summoner.closed` is a no-op (`menu-bar-agent.ts:976-978`). Swift comment *says* "Close releases the overlay" (`Tray.swift:1706-1707`) and emits `summoner.closed`. Node never calls `composer.lease.release`.
  - `handleComposerLeaseFamily` returns only to the requesting socket (`message-router.ts:1033-1038`). No `broadcastToClients`. Side Panel listens for `composer.lease` (`useWebSocket.ts:475-481`) but overlay claims travel `sendRequest` on the **summoner** client and never reach the panel. Panel standby is **only** `chat.error OVERLAY_STANDBY` after a failed send (`useWebSocket.ts:450-454`).
  - `claimOverlayLeaseCas` retries `LEASE_REV_MISMATCH` by **stealing** overlay with the returned rev (`composer-lease.ts:197-229`). Tests *lock the steal* (`composer-lease.test.ts` uncommitted: panel claim between get/claim → overlay still wins). S20 is "overlay-visible ⇒ overlay holds", not "overlay send always wins even after close".
  - `claimOverlayComposerLease` swallows errors and still `chat.create`s (`companion-client.ts:341-347`).
- Why it matters: S20 is the dual-L0 contract. A lease that does not follow visibility is an in-memory mutex on `chat.create`, not a composer SoT. Brief 9.2.11 ("one writable, other named standby") is false until the panel *fails a send*. After overlay talks once, panel cannot talk even with overlay gone. That is the opposite of "关掉 overlay ⇒ Panel".
- Fix:
  1. Claim overlay on `summoner.ready` / hydrate for that `thread_id`.
  2. `summoner.closed` → `composer.lease.release` (or claim `holder: panel`) for every overlay-held thread.
  3. Broadcast `{type:"composer.lease", thread_id, holder, rev}` to **all** authenticated peers on claim/release.
  4. Bind claim `holder` to handshake surface (summoner may only claim overlay; panel only panel). Delete the steal retry or gate it on overlay-visible.
  5. Persist or accept restart=panel **and** re-claim on overlay reconnect. Document it. Tests must fail if close does not release.

**B2 — Overlay is sliding from Approach A (thin L0 capture) to Approach B (native chat app) without an AMEND.**

- What's wrong: S7/S8 lock overlay thin: hydrate ≤20 plaintext, resident chrome ≤ composer + search + detached badge, **no settings**, **no dictation** (brief §8 Voice), **no plugins**. Code + uncommitted tree:
  - Hydrate cap **40** (`hydrate.ts:5`, Swift `suffix(40)` / `capLines` `Tray.swift:1710-1713`). Brief S7 "上限建议 20".
  - Press-hold 🎙 + `SummonerMicCapture` AVAudioEngine (`Tray.swift:1431-1508,2377-2386`) + `voice.stt.*` on summoner ACL (`summoner-acl.ts:22-26`). Brief forbade dictation. Ship-note later AMEND — **not folded into S21/S8**.
  - Settings **UI** still in the window: `settingsBox` + resume-idle + chrome-foreground (`Tray.swift:2266-2330`). Header button removed (uncommitted) but `settingsClicked` (`1886-1888`) and stdin `summoner.settings` / `summoner.settings.set` remain. Persist is `saveConfig` (`menu-bar-agent.ts:609-611,957-962`) — **ACL-bypassing config write**.
  - Protocol grew `summoner.tool`, `summoner.mcp`, `summoner.dictate`, `summoner.mic.*`, `summoner.new_thread`, `summoner.settings*` (`protocol.ts:52-90`). S21 stdin whitelist was "开窗/热键/hydrate".
  - Assistant lines still `AttributedString(markdown:)` (`Tray.swift:2034-2057`). Journeys spec and overlay tests claim plaintext / no bubbles. Markdown parse is still there.
  - Header `新对话` (`Tray.swift:2202`) is a second primary control beyond S8.
- Why it matters: ADR-020 and the brief exist to stop a fourth surface becoming a product. Protocol + UI chrome is the architecture. A spike that needs STT, idle policy, MCP badges, tool names, and markdown is not "证伪薄入口". It is Approach B in a tray process.
- Fix: Freeze stdin to the P0 set in the plan. Delete settings box / `summoner.settings*`. Keep STT only if brief S8/S21 is **formally AMENDed** with a one-line law (overlay STT, `voice.model.*` still Panel). Cap hydrate at 20. Kill markdown parse. Hide 新对话 behind `#` search or Panel.

**B3 — S20 LIVE / S22 conductor is unimplemented. `L2_CONDUCTOR_ELSEWHERE` exists only in the brief and the spike plan.**

- What's wrong: `rg L2_CONDUCTOR` hits **docs only**. `gateChatCreateOnLease` does not inspect CU LIVE / HUD conductor (`composer-lease.ts:109-126`, `message-router.ts:302-305`). Overlay `chat.create` during `host_computer` LIVE is a second loop on the same thread. N6 says conductor = active wide shell; overlay input queues or disables.
- Why it matters: Brief §10 lists `L2_CONDUCTOR_ELSEWHERE` in the **P0 实现最小集**. S24 says HUD L2 productization does not yield. Overlay send during LIVE is a second conductor.
- Fix: If CU task running or HUD/Cockpit is conductor, overlay `chat.create` returns typed `L2_CONDUCTOR_ELSEWHERE` (copy without `timeout|disconnected|not found`). Composer disabled. No Allow on overlay (already true). Tests against a fake LIVE registry, not a string snapshot.

#### MAJOR

**M1 — S21 allowlist has drifted and is spoofable at the same residual as Origin, plus a stdin privilege hole.**

- File: `summoner-acl.ts:11-27`, `lifecycle.ts:990-991`, `menu-bar-agent.ts:609-611,957-962`.
- Brief S21 allow: `chat.create/abort`, `thread.list/select/create`, `history.query`. Plan added `composer.lease.*` (necessary). Code also allows `voice.stt.*` and `mcp.list`. Hard-deny set is tested; **the extra allows are also tested as if they were S21** (`summoner-acl.test.ts:45-64`). Tests lock the drift.
- Handshake `surface` is client-supplied after HMAC. Same-user spoof of `surface: "tray"` on a second socket gets full tray methods. Brief admits this residual. Fine **if** overlay never needs a stronger fence. It now does: STT + mcp.list + lease steal.
- Overlay settings/hotkey persist via tray-process `saveConfig`, not `config.set`. S21 hard-deny of `config.set` is theater if stdin can write `config.json`.
- Fix: Publish an S21 AMEND table. Deny `mcp.list` until P2. Require `surface` from the **server-side constructor** of the summoner client (already set) and refuse `surface` changes after `auth.ok`. Route overlay prefs through a summoner-scoped key **or** keep them in-memory for the spike. Do not treat `saveConfig` as "not config.set, so allowed".

**M2 — Dual L0 coupling is hidden and the protocol exploded.**

- Two WSes from one tray process (`menu-bar-agent.ts:1190-1230`): tray (menus, HUD spike, `skill.list`) + summoner (chat, STT). Same Origin `cmspark-tray://local`.
- Same stdin JSON pipe as HUD/pairing/confirm (`Tray.swift:530-574` plus HUD/pairing cases above). `decodeSummonerOutbound` is a growing switch. One malformed cmd parser, four products.
- Panel standby is a React store flag (`agentStore.tsx:181-184,804-815`) fed by a chat.error that the overlay claim never broadcasts (B1).
- `tool.start` still `ws.send`s on the **conversation** origin (`server.ts:553-559`), then Node maps it to `summoner.tool` (`client.ts:228-231`). Not `tool.execute` (S19 holds) but overlay now renders tool names — chat-app chrome.
- Fix: stdin = window/hotkey/hydrate/token/done/error only. Tool/MCP/settings/STT either stay on the summoner WS (already there for STT) or die. Extract `SummonerController` from `Tray.swift` (see M3). Broadcast lease (B1).

**M3 — `Tray.swift` is a 2594-line god-object. Summoner is a class in a file that also owns pairing, tray confirm, HUD, and now a microphone.**

- File: `companion/src/tray/Tray.swift` (2594 lines). `SummonerController` starts ~1511. `SummonerMicCapture` ~1431. `HudController` ~985. Confirm / pairing live above.
- Architectural cost: IME×CU (S10 OPEN) cannot be reasoned about per window. `NSApp.activate(ignoringOtherApps: true)` on overlay open (`Tray.swift:1572`) and HUD open (`1014`) fights the `.nonactivatingPanel` style (`2158`) and the HUD comment that tray confirm must not steal FG (`823-828`). CU self-ui is process-level `cmspark-tray` (`self-ui.ts:40,65-67`); activating the accessory app **is** the CU-target steal S10 was left OPEN to measure.
- Fix: Split Swift targets or at least files: `Summoner.swift`, `Hud.swift`, `Pairing.swift`, `Confirm.swift`. Keep **one SHA256 binary** (S10 LOCK). Do not "fix" S10 by activating harder.

**M4 — Tests lock trivia and currently disagree with Swift. They will rot, and several already describe an API that does not exist.**

- `summoner-overlay.test.ts` (uncommitted) requires `makePlainLine` and forbids `refreshLog()` in `appendToken`. Working-tree Swift has **no** `makePlainLine` (`rg` empty) and `appendToken` **does** call `refreshLog()` (`Tray.swift:1613`). Forbids `NSAttributedString(markdown` — the real call is `AttributedString(markdown:` (`2047-2050`). Test is green-path theater: it cannot see the markdown parse it was rewritten to ban.
- `tool-forward-actuator.test.ts:119-134` is a source lockstep grep of `server.ts`. Useful as a tripwire, not a protocol lock.
- `composer-lease.test.ts` locks steal-on-retry (B1) as success.
- `summoner-acl.test.ts` locks `voice.stt.*` and `mcp.list` as "remaining S21 methods".
- Overlay-standby tests (uncommitted) snapshot copy `这边暂时打不了字，正在召唤器里说`. Fine for UX; they do not prove lease broadcast or close-release.
- Fix: Protocol tests: (1) close → holder panel; (2) overlay-visible → panel `chat.create` denied **and** panel receives `composer.lease` without sending; (3) `tool.execute` frames recorded on actuator fake, never origin; (4) Swift markdown parse = fail; (5) no `makePlainLine` fiction.

**M5 — Uncommitted grok-bot slice is not a decoupling. It is more protocol/UI plus a SHA256 bump.**

- Reduces: header 设置, 实验 chip, bubble stack, MCP field visibility, hardcoded 未连接, search hint `P0 不搜正文` → `只搜标题，不搜正文`.
- Adds: `claimOverlayLeaseCas` (good extraction, bad steal), `summonerHotkeyPickerRows`, journeys spec + `summoner-journeys.test.ts`, idle-resume still in config (`config.ts:343-351`), `SWIFT_TRAY_SHA256` changed to `6d7de4ed…` (`swift-tray-bridge.ts:58`) **[unverified]** against a rebuilt binary in this review.
- Leaves: settingsBox, markdown parse, stdin settings/mcp/tool, lease not released, tests that don't compile against Swift.
- Net: coupling not reduced. Journeys spec documents STT/settings/MCP as "protocol now covers" — that is how Approach B gets laundered into P0.

**M6 — S15 Windows honesty was not landed as a law.**

- `scripts/installer.nsi:41` still tells users to load the extension and open the Side Panel. It does **not** contain the locked sentence `Windows 仍用 Chrome 侧栏`. Pre-existing Side Panel instructions are not an overlay-degrade disclosure. Brief: missing sentence = 文档失败.
- Fix: one line on finish page + about. Do not invent a Win overlay.

#### NIT

**N1 — Hydrate 40 vs brief 20.** `hydrate.ts:5`. If you keep 40, AMEND S7. Don't silently double.

**N2 — `tool.start` on conversation origin** (`server.ts:553-559`) + `summoner.tool` chrome. S19 is about `tool.execute`. Still teaches the overlay to be a tool HUD. Drop it for P0.

**N3 — MCP field hidden in `applyMcp` (`Tray.swift:1637`) while ACL still allows `mcp.list` and tests require `MCP · ` in Swift.** Dead protocol. Delete both or show neither.

**N4 — `settingsClicked` is now unreachable from the header.** Dead code in a 2594-line file. Delete the box.

**N5 — Default lease holder is `"panel"` for *any* non-summoner surface** (`incomingHolderFromSurface`, `composer-lease.ts:77-78`). Tray-menu `chat.create` (if it ever existed) would count as panel. Today tray does not chat. Don't let it start.

**N6 — S23 window-rect hit-test is P1 per spike plan.** Process basename `cmspark-tray` is present. Not a P0 BLOCK. Do not pretend S23 is LOCK.

**N7 — SHA256 pin updated in working tree.** Rebuild-lock is the right mechanism. This review did not hash the binary. Treat mismatch as a ship-stopper, not an architecture law.

---

### Law lock table: S1–S24

| ID | Status | Evidence |
|----|--------|----------|
| **S1** unique Companion runtime | **LOCK** | Overlay has no LLM; `chat.create` on summoner WS; tools execute in Companion. |
| **S2** capture shell, not 家 | **AMEND** | Title `CMspark 召唤器（实验）` never 主界面 (`Tray.swift:1398`, overlay tests). Chrome: 新对话 / 🎙 / settings remnant / markdown. Identity copy holds; surface thickness does not. |
| **S3** L1 only extension WS | **LOCK** | `resolveL1ActuatorWs` + `pickAuthenticatedClientWs`. Missing peer → `BROWSER_UNAVAILABLE` (`l1-actuator.ts:9-15,30-31`). |
| **S4** attach existing Chrome | **LOCK** [insumed from `platform.ts` opener; no `open -n`] | `attachChromeOnly` / `openChrome` / `openChromeSilent`. |
| **S5** same `thread_id` | **LOCK** | `submitSummonerTalk` / `hydrateSummonerThread` reuse id; continue uses `summonerThreadId`. |
| **S6** no overlay Allow; N2/N5 | **LOCK** | No Allow chrome; ACL denies `security.confirmation.response`; tray `respond()` remains. MCP notice is not a writer. |
| **S7** thin overlay, hydrate 20, TALK empty | **BROKEN** | TALK empty-state yes (`isSummonerSearchQuery` `#` prefix). Cap 40. Markdown parse. Settings/STT/MCP chrome. |
| **S8** compose index; no 插件; chrome cap | **BROKEN** | `mcp.list` on ACL; MCP copy in Swift; 新对话 + 🎙 + settingsBox; Pack apply denied (the one piece that holds). |
| **S9** close ≠ abort | **LOCK** | `summoner.closed` does not `chat.abort` (`menu-bar-agent.ts:976-978`, overlay test). **Does not release lease (B1).** Close≠abort and close≠release are different laws. |
| **S10** one SHA256 binary; process OPEN | **OPEN** | One `cmspark-tray` / `SWIFT_TRAY_SHA256`. `NSApp.activate(ignoringOtherApps: true)` on overlay (`Tray.swift:1572`) vs `.nonactivatingPanel` (`2158`). IME Return gated by `hasMarkedText` (`1751-1782`). Spike IME×CU **not executed** in this review. |
| **S11** no stolen default hotkey | **LOCK** | TS + Swift stolen set; picker occupied labels (uncommitted). |
| **S12** search closed (titles) | **LOCK** | `#` → title/alias; hint 只搜标题，不搜正文. `history.query` allowed but unused. |
| **S13** attach = UI RPC | **LOCK** | No `openChrome` LLM tool. |
| **S14** detached first-class, P0 binary | **LOCK** | attached/detached + probing badge. No five-state pretence. |
| **S15** Win/Linux honest degrade | **BROKEN** | `installer.nsi:41` has no `Windows 仍用 Chrome 侧栏`. Pre-existing Side Panel steps ≠ this law. |
| **S16** Google Chrome only | **LOCK** [inspected] | Copy 激活 Google Chrome; opener is Chrome. |
| **S17** Origin `cmspark-tray://local` | **LOCK** | Second WS same Origin; `surface=summoner`. `pickAuthenticatedClientWs` extension-only. |
| **S18** P0 falsification observable | **UNVERIFIED** | Ship note: 8+5 **NOT RUN**. Architecture cannot pass a gate that was not run. |
| **S19** conversation ⊥ actuator | **LOCK** | `forwardL1OrUnavailable`; `tool.execute` sent to actuator WS (`tool-forward.ts:192`). Origin still gets `tool.start` (N2). |
| **S20** composer.lease SoT | **BROKEN** | B1. In-memory; no close-release; no open-claim; no broadcast; CAS steal; LIVE N6 missing (B3). |
| **S21** stdin + per-connection ACL | **AMEND** | Shape LOCK (connection not Origin). Set BROKEN vs brief (STT, mcp.list, lease, stdin settings). Surface spoof = existing HMAC residual. |
| **S22** LIVE overlay no confirm buttons | **AMEND** | No overlay Allow (**LOCK**). Conductor gate missing (**BROKEN**, B3). |
| **S23** self-ui hard-reject overlay/HUD/tray | **UNVERIFIED** / P1 | Process basename `cmspark-tray` (`self-ui.ts:40`). Window-rect explicitly P1 in spike plan. Overlay `NSApp.activate` makes process-level skip **more** likely, not a coordinate hard-reject. |
| **S24** HUD L2 does not yield; GOAL frozen | **LOCK** | GOAL one-liner unchanged. HUD still in the same binary. Overlay send-during-LIVE (B3) **does** yield conductor in practice. |

---

### Three layers (eval)

**Outcome — "Chrome quit, same thread L0 talk"**

Mechanically plausible: overlay hydrates a thread, `chat.create` on summoner WS, Companion loops, L1 missing peer → typed `BROWSER_UNAVAILABLE` without retry (`security.ts:923`, adapter classifies `error_code`). Same `thread_id`. CTA honesty present.

It will still fail as a *product architecture* because: (1) after that talk the Side Panel composer is stuck until Companion restarts; (2) overlay+panel dual-open does not standby until the panel send fails; (3) LIVE CU is not fenced; (4) 8+5 falsification not run. Outcome is a demo, not a SoT.

**Trajectory — sprawl**

```
stdin window/hotkey/hydrate
  → + token/done/error
  → + STT mic/dictate
  → + settings/idle/chrome_foreground
  → + tool names + mcp.list
  → + new_thread + silent attach + markdown
  → + CAS steal helper + journeys spec
```

ACL, lease, second WS, Swift god-object, Panel standby store, MCP confirm retarget, SHA256 bumps. That is not a thin spike. That is a second client.

**Component — every BLOCK/MAJOR has file:line above.** Highest-leverage files:

| File | Role | Failure |
|------|------|---------|
| `companion/src/ws/composer-lease.ts` | alleged S20 SoT | in-memory toy + steal |
| `companion/src/menu-bar-agent.ts` | overlay runtime | no release; settings `saveConfig`; two WSes |
| `companion/src/ws/summoner-acl.ts` | S21 | drifted set |
| `companion/src/tray/Tray.swift` | L0 UI | god-object; activate; markdown; settingsBox; mic |
| `companion/src/server.ts:762-781` | S19 | actually good |
| `companion/src/ws/l1-actuator.ts` | S19 | actually good |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts:475` | standby | dead without broadcast |

---

### Architectural Status: **BLOCK**

S1/S19/S6 are the parts that were supposed to be hard. They landed. S20 (the dual-L0 contract) and S7/S8 (thinness) did not. A spike that cannot release a lease and cannot stop growing stdin cmds is not ready to be called an L0 capture shell.

### VERDICT: **REJECT**

Fix B1 (lease follows visibility + broadcast + close-release) and freeze S21/S8 chrome (B2) before any APPROVE_WITH_NITS; B3 (LIVE conductor) is P0 per the brief's own error table.
