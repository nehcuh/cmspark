# OS Agent Shell vs origin/main — SECURITY / TRUST adversarial review

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Reviewer | independent SECURITY/TRUST (default REJECT, T3) |
| Base | `origin/main` `fc187257` (tray-only) |
| Against | `feat/os-agent-shell` HEAD `659bbce` + **uncommitted** + **untracked production** |
| Spec SoT | Brief S6 S8 S10 S13 S17 S19 S21 S22 S23 · §8 Trust · ADR-020 Trust · ADR-017 CU · ADR-023 STT |
| Isolation | Source not modified. Prior `os-agent-shell-20260823-*` reviews not used as evidence. |
| Scope | Production: `companion/src/**`, `chrome-extension/src/**`. Tests only as they lock semantics. |

**Blast**: T3 (OS overlay, ACL, CU clicks, STT, lease). Same SHA256 tray binary grows a third window + a second WS. HUD/tray Allow still live in-process.

---

## Evidence levels

- `[executed]` — hashed `companion/dist/cmspark-tray`; `git` inventory vs `origin/main`.
- `[inspected]` — read current worktree production paths + diffs vs `origin/main` / HEAD.
- `[assumed]` — not executed (no CU inject, no live overlay, tests not run).

Untracked production in this tree: `companion/src/computer/companion-ui-rects.ts`, `companion/src/ws/l2-conductor.ts`.

---

## Threat model deltas vs main (tray-only)

Main tray is already a local HMAC superuser (`cmspark-tray://local`) with privileged stdin `respond()` / `hud.confirm.response`. Overlay does **not** create a new principal. It **widens the same principal’s hit surface** and adds a **client-declared reduced WS** that fail-opens back to that superuser.

| Surface | main (tray-only) | this tree | Trust delta |
|---------|------------------|-----------|-------------|
| SHA256 binary | tray menus + pairing + HUD/tray Allow | **+ overlay** (composer, Send, 🎙, Attach Chrome, settings, 新对话) | CU-clickable chrome grew. Confirm writers unchanged (overlay has none). |
| WS peers | 1× tray Origin, full method set | 2× same Origin. `surface=summoner` ACL **iff client stamps it** | Second peer is reduced only by honesty. Omit → tray ACL. |
| L1 `tool.execute` | bound to originating WS (tray chat would 15s-timeout + recoverable retry) | S19: never `tool.execute` on tray/summoner; missing peer → typed `BROWSER_UNAVAILABLE` | **Closed vs main.** |
| CU self-UI | `companion_ui_exe_basenames` = browsers + `cmspark-agent`. FG yield → `forceForeground` **continue** (skip re-L2) | HEAD added `cmspark-tray` to defaults **and** hardcoded `isCompanionUiOwner`. Worktree **removed the hardcoded match** but **left the default list**. Plus new rect cache deny. | **Worse than main** on the continue path. Rect deny is new, fail-open. |
| STT | `voice.stt.*` chrome-extension only (ADR-023 §7.2 as shipped on main) | summoner + tray Origin allowed. `privacy_ack_v2` is a client bool. Overlay mic stdin PCM/WAV | New audio → Companion path from tray-class peer. |
| Composer | Side Panel only | `composer.lease` CAS; **holder is client-supplied** | Lockout / standby primitive, not a new grant — but not bound to handshake. |
| Config | `config.set` on any HMAC peer | Summoner WS denies `config.set`. Tray **stdin** `saveConfig({summoner})` still writes `config.json` | ACL theater if stdin is the control plane. |
| Chrome launch | tray menu `openChrome` / `openSidePanel` | Overlay `summoner.attach_chrome` → `attachChromeOnly` / `getChromeOpener()`. No LLM tool | Gesture RPC. Silent launch exists (`openChromeSilent`). |
| Confirm dialect | tray stdin `confirm-response` + HUD `hud.confirm.response` + Panel WS | Overlay: no Allow/Deny, no `summoner.confirm.*`. Same-process HUD/tray Allow remain | Fourth dialect **not** added. CU→Allow is S23, not S6. |

HMAC same-user key-read residual is **pre-existing** (brief §8 冒充). Overlay is required to **not** be a second full-privilege WS **because** of that residual (S21). That is the bar this review uses.

---

## BLOCK

### BLOCK-1 — S23: rect deny is a cache; production still `forceForeground` **continue**s `cmspark-tray`

**Law:** click coords on summoner / HUD / tray / pairing → **hard-reject that CU action** (not `forceForeground` then continue). ADR-017: companion UI must not become a silent grant-skip for re-L2.

**What changed vs main**

1. `origin/main` `companion_ui_exe_basenames` did **not** include `cmspark-tray`. FG yield to the Swift tray paused for re-L2.
2. This branch **added** `"cmspark-tray"` to the default allow-list. `[inspected]` `companion/src/config.ts:444-447`. Comment at `config.ts:59-70` still calls this a “UX heuristic, NOT a security boundary” and documents silent continue.
3. HEAD also hardcoded `COMPANION_UI_PROCESS_BASENAMES = ["cmspark-tray"]` inside `isCompanionUiOwner` (match even if operator deleted the name). Worktree **reverted that hardcoded match** so `self-ui.ts` equals main. `[inspected]` `git diff HEAD -- companion/src/computer/self-ui.ts`.
4. Worktree added `assertClickClearsCompanionUi` before click/scroll/drag inject. `[inspected]` `executor.ts:1369-1383` + untracked `companion-ui-rects.ts`.

**The continue path is still production-true.** Executor:

```1614:1632:companion/src/computer/executor.ts
        const selfUiBasenames = deps.config.security?.companion_ui_exe_basenames ?? []
        const isSelfUiYield =
          fgYielded &&
          isCompanionUiOwner(fgOwnerExe, selfUiBasenames) &&
          ...
        if (isSelfUiYield) {
          ...
          const raised = await deps.injector.forceForeground(hwnd).catch(() => false)
          if (raised) {
            continue
          }
```

`isCompanionUiOwner("cmspark-tray", DEFAULT_CONFIG.security.companion_ui_exe_basenames)` is **true** via `allow.has(base)` (`self-ui.ts:56-57`). Overlay `open()` does `NSApp.activate(ignoringOtherApps: true)` (`Tray.swift:1610`). HUD does the same (`Tray.swift:1048-1049`). That **is** the FG yield S23 forbids treating as self-UI.

**Test laundering.** `companion/tests/computer-self-ui.test.ts:44-54` asserts `isCompanionUiOwner("cmspark-tray", ALLOW) === false` with `ALLOW` that **omits** `cmspark-tray`. Production defaults **include** it. The test name says “NOT process-level self-UI continue (S23 window-rect instead)” while the config the executor actually loads does the opposite. `[inspected]`

**Rect deny does not close S23.**

| Gap | Why it is a grant-skip | Where |
|-----|------------------------|--------|
| Fail-open empty cache | No rects (race, first frame, Swift crash after show) → `screenPointHitsCompanionUi` returns null → inject proceeds. Then FG yield to `cmspark-tray` **continue**. | `companion-ui-rects.ts:62-68`, `executor.ts:1623-1632` |
| Push cache, not live windows | host.swift already has `kCGWindowBounds`. This path trusts last stdout `companion.ui.rect`. **No `windowDidMove` / `windowDidResize`.** Drag HUD/tray-confirm/overlay → stale rect → click the Allow that moved. | `Tray.swift` `func window*` = only `windowWillClose` (`:660,:921,:1201,:1769`). Emit on show/hide/`relayout` only (`:657,:867,:1055,:1616,:2258`). |
| Coordinate space | Overlay emit: `yTop = NSScreen.main.height - f.maxY` (`Tray.swift:41-57`). `NSScreen.main` is the **key** screen, not the window’s screen; Cocoa `frame` origin is primary-bottom-left; `infoLive.rect` is Quartz `kCGWindowBounds` (`darwin-adapters.ts:276-300`). Multi-monitor → miss. | |
| Window origin ≠ click landing | Inject uses **client origin** + client point (`host.swift:1719-1726`). Executor hit-tests **window bounds** + client point (`executor.ts:1371-1381`). Title-bar delta (~28px) shifts the tested point vs CGEvent. | |
| Type / key / drag-end ungated | `type` and `key` skip `assertClickClearsCompanionUi`. Overlay/HUD `NSApp.activate` can make the panel key. `keyChord(Return)` can fire HUD/tray Allow (`allowClicked` is `@objc` on the button; default button + Return is the ordinary AppKit path). Drag only checks **start** point. | `executor.ts:1332-1368`, `1374-1377` |
| Missing rects never fail closed | `assertClickClearsCompanionUi` returns void when `hit === null`. S23 wants deny-on-companion-UI, not “deny if we happen to remember a rectangle”. | `companion-ui-rects.ts:71-78` |

CU click on HUD/tray Allow is the original Sec B2. Overlay has no Allow; **HUD and tray confirm in the same binary still do** (`Tray.swift:902,1176-1178`). S23 exists so CU cannot press those. A pre-inject cache that can be empty, stale, or in the wrong space, plus a process-level continue that **main did not grant to `cmspark-tray`**, is a new CU grant-skip.

**Fix (minimum to lift BLOCK):**

1. Remove `"cmspark-tray"` from `DEFAULT_CONFIG.security.companion_ui_exe_basenames`. Re-L2 when the Swift binary is FG.
2. Live hit-test: CGWindowList (or AX) for the tray pid **at inject time**, same space as `cuClientOriginScreen`. Do not trust a Swift push cache as the only gate.
3. Gate **all** injective actions (click/scroll/drag **end**/type/key) or deny the whole task while any companion UI window is visible.
4. Tests must call `isCompanionUiOwner("cmspark-tray", getConfig().security.companion_ui_exe_basenames)` — not a hand-built list that omits the production name.

Until then S23 is **FAIL**. New `COMPANION_UI_CLICK_DENIED` is a named hole, not a closed gate.

---

### BLOCK-2 — S21: summoner ACL is optional; omit/spoof `surface` → tray superuser

**Law:** overlay is **not** a second full-privilege WS because HMAC cannot stop same-user `ws_secret` read. ACL binds the **connection**. Handshake `surface=summoner`. Hard-deny `pack.apply`/`allowTrust`, `config.set`, `security.unattended.arm`, `mcp.add`, `security.confirmation.response`.

**Server bind** `[inspected]`:

```990:991:companion/src/ws/lifecycle.ts
            const rawSurface = (msg as { surface?: unknown }).surface
            st.surface = rawSurface === "summoner" ? "summoner" : "tray"
```

```34:34:companion/src/ws/summoner-acl.ts
  if (surface !== "summoner") return { ok: true }
```

Comment in `summoner-acl.ts:7-8` states the fail-open: omitted/undefined **is not gated**. Tests **lock** it (`summoner-acl.test.ts:40-43`).

Production overlay client **does** send `surface: "summoner"` (`menu-bar-agent.ts:1237-1243`, `companion-client.ts:547`). That is a **convention**. Any HMAC peer that:

- omits `surface`, or
- sends `surface: "tray"` / garbage

is the tray superuser: `config.set`, `pack.apply`+`allowTrust`, `security.unattended.arm`, `security.confirmation.response`, `mcp.add`, `voice.model.*`.

HMAC residual is documented. S21’s **entire point** was a server-enforced reduced principal for the new overlay socket. A discriminator the client may decline to send is not a discriminator. Compromised Swift is already the hashed binary with stdin `respond()` — overlay is not a separate principal — but **any other local HMAC client** (extension-shaped forge is separate; loopback Origin forge is the residual) that simply does not say “summoner” stays a superuser **and the overlay process can do the same by omitting one field**.

`stampCmsparkSurface` (`composer-lease.ts:96-100`) overwrites `__cmspark_surface` **after** ACL, for lease/conductor only. It does not re-bind methods.

**Fix:** fail-closed unknown/omitted surface on the **summoner client constructor path** (dedicated connection that the server marks summoner itself — e.g. first message after a server-issued overlay nonce, or bind ACL to a server-side flag set only when Node opens the overlay client). Do not accept client `surface` as the only switch. Alternatively: treat tray Origin + non-summoner as today, but **refuse a second tray-origin socket** unless it presents a server-issued overlay ticket.

Hard-denies **when surface is actually summoner** are real (`summoner-acl.ts:11-27`, `lifecycle.ts:1036-1043`, tests `:24-38`). That is not the hole.

---

## MAJOR

### MAJOR-1 — stdin `saveConfig` bypasses the `config.set` S21 hard-deny

Summoner WS cannot send `config.set`. Overlay **does** persist via tray-process `saveConfig`:

- `persistSummonerPatch` `menu-bar-agent.ts:608-610,982-987` (`summoner.settings.set` → `resume_idle_minutes`, `chrome_foreground`)
- `persistSummonerHotkeyChosen` `:778-783`

Same `saveConfig` that `config.set` uses (`config.ts:1174+`). Deep-merge into `~/.cmspark-agent/config.json` (0o600). Brief §8 / S21: overlay must not write settings; Pack/Trust keys are not in today’s patch object `[inspected]`, but the **channel** is the privileged stdin the ACL was written to constrain.

`chrome_foreground` changes whether attach focuses Chrome (`client.ts:218-225`). Not god-mode. Still a control-plane write the WS ACL claims to forbid.

**Fix:** in-memory overlay prefs for the spike, or a summoner-scoped file that `saveConfig` cannot merge into `security.*` / `llm.*`. Do not call `saveConfig` from overlay stdin.

### MAJOR-2 — `composer.lease.claim` `holder` is client-supplied (fake authz / lockout)

`handleComposerLeaseFamily` (`composer-lease.ts:141-152`) takes `rest.holder` as `"overlay"|"panel"`. ACL allows `composer.lease.claim` on summoner (`summoner-acl.ts:19`). Tray (ungated) can claim either.

`gateChatCreateOnLease` (`:109-126`) compares **handshake** surface → incoming holder vs stored holder. Chat.create is **not** fooled by a spoofed `__cmspark_surface` (`stampCmsparkSurface` overwrite). Good.

What **is** client-chosen: who **owns** the lease. Effects:

- Summoner WS `holder:"panel"` → overlay cannot talk; panel can. Self-DoS / dual-draft if overlay UI still thinks it holds.
- Tray/panel WS `holder:"overlay"` without a visible overlay → Side Panel locked (`OVERLAY_STANDBY`) with nobody typing. Composer hostage.
- Lease is **not** used today as a skip for L2 / unattended / pack `[inspected]` `grep` of holder vs admission.

S20 says holder = overlay-visible ? overlay : panel. Visibility is **not** a server observation; it is whatever the client claims on claim().

**Fix:** ignore `rest.holder`; set holder from `stampedSurface` (`summoner`→overlay, else panel). Claim on summoner always overlay; release always panel.

### MAJOR-3 — STT origin: ADR-023 §7.2 amended; brief §8 and ADR-023 §1.3 still forbid overlay 🎤; ack is a bool

`[inspected]` `git diff origin/main -- docs/adr/023-voice-local-stt-path-b.md`: §7.2 now allows `cmspark-tray://local` **and** `surface===summoner`. Tray surface (including omitted) still denied. `voice.model.*` still denied on summoner ACL (`summoner-acl.test.ts:66-77`).

Still in force:

- Brief §8 Voice: 「召唤器不做听写；不要灰色麦克风图标」
- ADR-023 §1.3 non-goal: 「Worker / Cockpit / **tray 🎤**」
- Journeys J5 / overlay mic (`Tray.swift` `SummonerMicCapture`, stdin `summoner.mic.*`) contradict both

`isVoiceSttOriginAllowed` (`stt-handlers.ts:56-62`) is Origin + client `surface`. `privacy_ack_v2 !== true` is a **wire bool** (`validate.ts:473-475`, handler `:192-194`). ADR-023 §7.2 text: overlay **press-mic** “视为” ack. Server cannot tell a counted OS gesture from `{privacy_ack_v2:true}` on a forged summoner socket.

New residual vs main: any HMAC peer that **does** stamp `surface=summoner` may stream PCM/WAV into Companion whisper. Main: extension only.

**Fix:** AMEND brief §8 + ADR-023 §1.3 in the same commit as §7.2, **or** delete overlay STT. Bind ack to a server-issued overlay-mic session id after a counted gesture; do not accept a self-asserted bool.

### MAJOR-4 — S22 conductor gate is LIVE-only; pending L2 / HUD Allow still in-process

`gateChatCreateOnConductor` (`l2-conductor.ts:19-31`) fires only when `getComputerTaskAbortRegistry().size > 0` **and** surface is summoner. Registry is written **after** L2 admission, when `host_computer` starts (`companion-dispatch.ts:1653-1661`). **Pending** HUD/tray Allow (45s confirm) is not in the map. Overlay may `chat.create` during that window. Brief S22: LIVE **or pending L2**.

Overlay still paints **no** Allow `[inspected]` SummonerController; `isSummonerConfirmDialect` (`protocol.ts:273-278`). HUD/tray Allow remain clickable (BLOCK-1). Conductor leak is overlay **talk** during pending L2, not a fourth writer.

`L2_CONDUCTOR_ELSEWHERE` is put in `data.error_code` (`l2-conductor.ts:9,29`). Overlay mapper also reads `data.error_code` (`client.ts:272-277`). Not a drop.

### MAJOR-5 — Summoner `chat.create` still accepts `llm_override`

ACL is **type**-level. `chat.create` is allowed. Router still applies `rest.llm_override` api_key / base_url / model (`message-router.ts:312-328`) with no summoner strip. Overlay production client does not send it `[inspected]`; a summoner-stamped HMAC peer can retarget the model/key. S21 “overlay chat.create may reach L2/MCP” is not a license to retarget LLM config.

**Fix:** strip `llm_override` (and `allowTrust` / `user_gesture` if they ever ride along) when `stampedSurface === "summoner"`.

---

## NIT

### NIT-1 — S21 allowlist drifted past the brief sentence

Brief allow: `chat.create/abort`, `thread.list/select/create`, `history.query`.  
Code also: `composer.lease.*` (needed for S20), `voice.stt.*`, `mcp.list`, `system.ping`. Tests treat extras as “remaining S21 methods” (`summoner-acl.test.ts:45-64`). Hard-denies in the brief sentence are enforced. Publish an AMEND table; do not lock drift as if it were the law.

### NIT-2 — SHA256 pin vs working-tree binary `[executed]`

| Pin | SHA256 |
|-----|--------|
| `origin/main` | `ebd1ee4a6ba5d05840c23716368aec8b67a79905466e8a9fc4a26c8c38b589c7` |
| HEAD | `267e24b256459ad0386a2054f710f672fd65994d81b0441437094dbbe310f483` |
| worktree `swift-tray-bridge.ts:59` | `8b1d06196d7e8786fb27c360a74d320ab13f8e8a6f86ce8caabfa22cbcea73a9` |
| `companion/dist/cmspark-tray` | **same as worktree pin** |

S10: one gate, one binary. Dirty tree is internally consistent (Swift saved → rebuilt → pin updated). HEAD pin is stale vs current source. Dist is gitignored. Hash mismatch refuses spawn (`swift-tray-bridge.ts:84-86`) — not auto-rebuild-on-integrity-failure. Commit pin + Tray.swift together. Not a silent grant.

### NIT-3 — S13 `openChrome` is not an LLM tool; silent launch exists

No `openChrome` / `force_launch_browser` in `tool-definitions.ts` `[inspected]`. Overlay attach is stdin `summoner.attach_chrome` → `attachChromeOnly` (`client.ts:217-225`) → `getChromeOpener().openChrome` or `openChromeSilent`. Copy includes 「我们不能替你打开侧栏」 (`:29-30,:165-166`). God-mode / unattended / `auto_approve_*` do not call `getChromeOpener` `[inspected]`. Default attach is **silent** (`openChromeSilent`) unless `foreground===true` (settings + button). Gesture still required to emit the stdin event. HOLD S13; silent launch is a product/IME×CU note, not a tool schema.

### NIT-4 — Overlay confirm dialect not added (S6 UI)

No `summoner.confirm.*` in Swift emit paths `[inspected]`. Decoder drops `summoner.confirm*` (`protocol.ts:273-320`). ACL denies `security.confirmation.response` on summoner. Tray stdin `confirm-response` / HUD `hud.confirm.response` remain the N5 writers (S6 preserves them). CU clicking those writers is BLOCK-1, not a new dialect.

### NIT-5 — `chat.error` `error_code` kept on the overlay path `[inspected]`

`toolChatErrorPayload` (`l1-actuator.ts:17-39`) puts `error_code` **top-level**. Adapter uses it for non-recoverable (`adapter.ts:1450-1464`). Overlay `mapChatMessageToSummonerCmd` reads top-level **or** `data.error_code` (`client.ts:264-278`). Lease/conductor use `data.error_code`; overlay still forwards. Swift `summoner.error` passes `error_code` (`Tray.swift:573-576`). Recoverable-loop `chat.error` at `adapter.ts:1479-1483` still **drops** the code — pre-existing, not overlay-specific. `classifyError` first-branches `error_code === "BROWSER_UNAVAILABLE"` (`security.ts:923`). HOLD S19 typing.

### NIT-6 — S17 Origin HOLD on production clients

Overlay/tray Origin stays `cmspark-tray://local` (`companion-client.ts:31`, handshake does not send a fake `chrome-extension://`). `pickAuthenticatedClientWs` remains extension-only (S19 tests). Server still accepts any `chrome-extension://` + HMAC as L1 actuator (pre-existing residual, extension-id pin OPEN). Summoner + forged extension Origin fail-closes `tool.result` on a socket that cannot CDP.

### NIT-7 — S8 / stdin whitelist growth (product-Trust cousin)

Stdin grew past “开窗/热键/hydrate”: `summoner.settings*`, `summoner.mic.*`, `summoner.new_thread`, `summoner.tool`, `summoner.mcp`. Overlay chrome exceeds S8 cap (🎙, 新对话, 快捷键, settingsBox). Pack `allowTrust` is still denied. Not a Trust elevation by itself; cited so S8 is not claimed closed.

### NIT-8 — `COMPANION_UI_CLICK_DENIED` → `classifyError` default non_recoverable

Message `computer: click lands on ${hit} — hard-denied (S23)` does not match recoverable substrings (`security.ts:955-1064`). Default non_recoverable. `companion-dispatch.ts:1873-1877` puts `errorCode` in `data.error_code`, so adapter can surface it (NIT-5). No auto-retry of the denied click **if** the throw happens. Does not fix fail-open miss (BLOCK-1).

---

## Must-trace (1–10)

| # | Trace | Result |
|---|--------|--------|
| 1 | `summoner-acl.ts` allowlist; omit surface → tray ACL | **FAIL** BLOCK-2. Allowlist extras NIT-1. Fail-open `surface !== "summoner"` → `{ok:true}`. |
| 2 | `tool.execute` never on tray/summoner; `BROWSER_UNAVAILABLE` | **HOLD** S19. `forwardL1OrUnavailable` (`server.ts:763-780`, `l1-actuator.ts:83-95`). Tests `tool-forward-actuator.test.ts`. `classifyError` explicit non-retryable. |
| 3 | Overlay confirm dialect / Allow-Deny | **HOLD** S6 UI. No overlay Allow. HUD/tray Allow same process → S23. |
| 4 | S13 `openChrome` tool schema / god-mode opener | **HOLD**. No tool. Gesture stdin. God-mode does not call opener. Silent launch NIT-3. |
| 5 | S23 rects + `assertClickClearsCompanionUi`; `cmspark-tray` removed from `isCompanionUiOwner` continue? | **FAIL** BLOCK-1. Hardcoded basename **removed** in worktree. **Default config still lists `cmspark-tray`.** Continue path live. Tests omit the name. |
| 6 | STT origin; `saveConfig` stdin vs `config.set` | **FAIL** MAJOR-3 + MAJOR-1. §7.2 amended; §8/§1.3 not. Stdin writes config.json. |
| 7 | `composer.lease` as fake authz; holder client-supplied | **FAIL** MAJOR-2. Not used as L2 skip today. Holder not derived from handshake. |
| 8 | SHA256 pin vs tray binary (worktree) | **HOLD** S10 `[executed]`. Pin matches dist. Commit with Swift. |
| 9 | `chat.error` `error_code` leak/drop | **HOLD** NIT-5. Overlay mapper + `toolChatErrorPayload` keep the code. |
| 10 | `COMPANION_UI_CLICK_DENIED` vs `forceForeground` continue | **FAIL** BLOCK-1. Named deny is click-cache-only; continue still process-level for `cmspark-tray`. |

---

## Per-law

| Law | Verdict | Note |
|-----|---------|------|
| **S6** | **HOLD** (UI) / **FAIL via S23** | Overlay is not a confirm writer. No fourth dialect. `originWs` not unbound. Tray stdin `respond()` still privileged. CU can still click HUD/tray Allow (BLOCK-1). |
| **S8** | **AMEND / chrome cap broken** | `pack.apply`+`allowTrust` denied. Overlay chrome + `mcp.list` + STT exceed “composer + 检索 + 徽章”. |
| **S10** | **HOLD** | One `SWIFT_TRAY_SHA256`. Worktree pin matches binary `[executed]`. Process model still OPEN (IME×CU). Overlay `NSApp.activate` fights `.nonactivatingPanel`. |
| **S13** | **HOLD** | No LLM opener. UI RPC + gesture. God-mode/unattended do not call it. |
| **S17** | **HOLD** (clients) | Origin reused. `pickAuthenticatedClientWs` extension-only. Surface is not Origin. |
| **S19** | **HOLD** `[inspected]` | Conversation ⊥ actuator. Missing peer → typed non-retryable `BROWSER_UNAVAILABLE`. Forward not called. |
| **S21** | **FAIL** BLOCK-2 + MAJOR-1 | Hard-denies work **when** surface is summoner. Omit → tray. Stdin `saveConfig` bypasses `config.set`. Allowlist drifted. |
| **S22** | **HOLD** paint / **FAIL** pending | No overlay Allow. LIVE `chat.create` gated. Pending L2 not gated. HUD Allow is the S23 hit target. |
| **S23** | **FAIL** BLOCK-1 | Rect cache + continue. `cmspark-tray` still in production self-UI list. Tests celebrate the wrong allow-list. |
| **§8 Trust table** | **FAIL** | Binary gate HOLD. Confirm writer HOLD. Self-click FAIL. Overlay-not-superuser FAIL (optional ACL). Voice lock vs STT FAIL (spec split). |
| **ADR-020 Trust** | **FAIL** | New OS L0 is fine as Surface. Trust monotonicity broken by CU continue-on-tray + optional ACL. No new L2-class. |
| **ADR-017** | **FAIL** (self-UI) | Task-level L2 still required up front. Mid-task re-L2 now skippable when Swift tray is FG — **new vs main**. |
| **ADR-023** | **SPLIT** | §7.2 amended to allow overlay STT; §1.3 non-goal and brief §8 do not. Ack is self-asserted. |

---

## What actually closed vs main (do not reject on these)

- S19 L1 split is real. Tray-origin chat no longer `tool.execute`s itself into a recoverable timeout loop.
- Overlay is not a MinimalConfirm writer. N2/N5 not rewritten as a fourth dialect.
- `BROWSER_UNAVAILABLE` is typed and first-branched in `classifyError`.
- Production summoner client stamps `surface: "summoner"` (convention, not a bind).
- SHA256 remains a single gate; pin matches the rebuilt dist in this worktree.

---

## VERDICT: **REJECT**

Two BLOCKs on T3:

1. **S23** — CU self-click on overlay/HUD/tray is not hard-rejected in production: `cmspark-tray` is a self-UI **continue** in default config; window-rect deny is a fail-open stdout cache with no move listener and a coordinate mismatch vs CGEvent. This is **new vs tray-only main**.
2. **S21** — summoner ACL is a client-stamped sticker. Omit `surface` → full tray method set. Overlay is not a server-enforced reduced principal.

Do not merge to main. Do not call P0 Trust-closed until (a) `cmspark-tray` is out of the continue path **and** inject-time live window hit-test denies companion UI, and (b) overlay connections cannot fail-open into tray ACL.

NITS (allowlist extras, SHA256 commit hygiene, S13/S19/chat.error) are not the reject.
