# OS Agent Shell — SECURITY / TRUST adversarial review

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Reviewer | independent SECURITY / TRUST (did not author this code) |
| Scope | `feat/os-agent-shell` merge-base `fc187257` → HEAD `659bbce` **+ dirty tree** |
| Blast | T3. New grant-skip / confirm unbind / ACL hole = BLOCK |
| Posture | **REJECT** (fail closed). Unverified paths treated as open. |
| Evidence | `[executed]` shasum of `companion/dist/cmspark-tray`; git status/diff. All code paths `[inspected]`. No live CU / overlay / HMAC-forged peer run. |

Spec SoT: `docs/decisions/os-agent-shell-brief-2026-08-22.md` (S6, S8, S10, S13, S17, S19, S21, S22, S23, §8 Trust table). Cross: ADR-020 Trust axis, ADR-017 self-ui, ADR-023 §7.2. Ship note `docs/decisions/os-agent-shell-p0-spike-ship-note-2026-08-22.md` is **not** allowed to AMEND LOCK laws unless the cited ADR/brief clause actually moved.

---

## Threat model deltas vs tray-only

Tray-only (pre-shell) already had: HMAC same-user residual (loopback + `~/.cmspark-agent/ws_secret` 0o600), hash-gated Swift stdin `respond()` (privileged, originWs bypass), HUD Allow/Deny in the same `cmspark-tray` process, Origin scheme-gate (`chrome-extension://*` or `cmspark-tray://local`).

Overlay adds:

| Delta | Why it matters |
|-------|----------------|
| Second WS on the **same** tray Origin, self-declared `surface=summoner` | S21 ACL is the **only** thing stopping overlay from being a second full-privilege peer. Omit/spoof surface → tray (ungated). |
| Third lazy window in the **same** SHA256 binary (composer, Submit, mic, Attach Chrome) | CU clickable surface grew. S23 required **pre-inject window-rect hard-reject**. Code instead **widened** self-UI *continue*. |
| Overlay `chat.create` is a new L0 that can drive L1/L2/MCP | Intended (brief §4 note). Confirm must stay N5. Overlay-origin L2 is origin-bound to a socket that **cannot** `security.confirmation.response`. Tray `respond()` still wins. |
| Local STT on overlay (`voice.stt.*` + stdin PCM/WAV) | New audio → Companion path from a tray-origin peer. ADR-023 §7.2 was actually amended; brief §8 Voice lock was **not**. |
| `composer.lease` as chat.write gate | UX lock used as the only overlay/panel writer mutex. Holder is **client-supplied**, not derived from handshake surface. |

No new remote (web-origin) channel. The new principal is **same-user + overlay window + second WS**. HMAC still does not stop that user.

---

## Issues

### BLOCK-1 — S23 not implemented; new CU grant-skip on `cmspark-tray`

**Law:** S23 — click coords on summoner / HUD / tray / pairing window → **hard-reject that CU action** (not `forceForeground` then continue).

**Code does the opposite.**

`companion/src/computer/self-ui.ts:40-67` adds `COMPANION_UI_PROCESS_BASENAMES = ["cmspark-tray"]` and, whenever the operator allow-list is non-empty, treats that basename as companion UI **even if the operator omitted the tray name**. Comment at `:38` admits: *"window-rect hit-test is P1."*

`companion/src/computer/executor.ts:1604-1622` (`isSelfUiYield`): if foreground yielded to that owner and no dialog channel fired → `forceForeground(hwnd)` → **`continue`** (skip re-L2).

`companion/tests/computer-self-ui.test.ts:44-58` locks the **continue** semantics and labels them "S23 / Task 12". That is spec laundering: the test cites S23 while asserting process-level self-UI recovery.

Ship note §1 lists "window-rect self-ui" as an explicit non-goal. A LOCK law cannot be demoted by a spike ship note.

**Attack (UNVERIFIED live, algebra closed in code):**

1. `host_computer` is LIVE. HUD and overlay live in `dist/cmspark-tray` (HUD Allow at `Tray.swift:1141`, tray popover Allow at `:867`).
2. Model emits a click whose screen coords land on HUD Allow / overlay Submit / mic / Attach.
3. OS delivers the click **before** any CMspark hit-test (there is none). Privileged stdin `confirm-response` / `hud.confirm.response` / `summoner.submit` fires.
4. Executor then sees fg owner `cmspark-tray` → `isCompanionUiOwner` true → **continues without re-L2**.

Pre-shell, `cmspark-tray` was **not** in that basename list. Foreground-yield to tray/HUD fell through to re-L2 pause (`executor.ts:1628-1634`). The click still landed (pre-inject deny was already missing), but the **post-click pause was the backstop**. Task 12 **removed that backstop** for the entire Swift UI process.

This is a **new grant-skip**. T3 BLOCK.

**Fix:** pre-inject hit-test of action coords against overlay/HUD/tray/pairing window rects; on hit, **throw** (hard-reject that action). Do not classify `cmspark-tray` as self-UI-continue until that exists. Process-level match may remain as "user clicked Chrome/tray, re-raise target" **only** when the *injected* coords are outside companion windows.

---

### BLOCK-2 — Handshake `surface` is client-declared; omit → full tray ACL

`companion/src/ws/lifecycle.ts:990-991`:

```text
st.surface = rawSurface === "summoner" ? "summoner" : "tray"
```

`companion/src/ws/summoner-acl.ts:34`: `if (surface !== "summoner") return { ok: true }`.

S21: overlay is **not** a second full-privilege WS **because** HMAC cannot stop same-user key read. The ACL is that defense. It is keyed off a field the client stamps at handshake.

| Spoof | Effect |
|-------|--------|
| Overlay/attacker **omits** `surface` or sends `"tray"` | **Tray ACL (ungated).** `pack.apply`, `config.set`, `security.unattended.arm`, `mcp.add`, `security.confirmation.response`, `voice.model.*` all allowed. |
| Tray sends `surface=summoner` | Fail-closed (loses `skill.list`). Not expansion. Gains overlay-only STT (see MAJOR-2). |
| Summoner forges `Origin: chrome-extension://…` **and** `surface=summoner` | `pickAuthenticatedClientWs` (`lifecycle.ts:257-267`) may pick them as L1 actuator; ACL then **denies** `tool.result` (not on allowlist). Fail-closed. |
| Same forge **without** summoner surface | Pre-existing HMAC residual: they **are** the L1 actuator. S17 is client-side only (`companion-client.ts:31` default origin). Production menu-bar does not override origin `[inspected]`. |

Production overlay client **does** send `surface: "summoner"` (`menu-bar-agent.ts:1210-1216`, `companion-client.ts:538`). That is a convention, not a server bind. Compromised overlay Swift is the **same** hash-gated binary that already owns privileged `respond()` — overlay is not a separate principal. The hole is: **any** HMAC peer that simply does not say "summoner" is a superuser. Overlay did not make HMAC worse; it **failed to make overlay a distinct, server-enforced principal**, which is the entire point of S21 given the documented residual.

T3: cannot prove overlay stays ACL-bound if the client lies. Fail closed = BLOCK.

**Fix:** bind surface from something the overlay process cannot omit without losing the overlay channel (e.g. dedicated path / pairing token / server-issued surface nonce at `summoner.open`). Omitting surface on a connection that just opened the overlay window must **not** fail open to tray. At minimum: fail closed (`surface` required; unknown → drop).

---

### MAJOR-1 — `composer.lease` is used as a write gate; holder is not bound to surface

`handleComposerLeaseFamily` (`composer-lease.ts:141-152`) accepts client `holder: "overlay"|"panel"` and any `thread_id`. Handshake surface is **not** consulted. `claimOverlayLeaseCas` (`:197-229`, uncommitted) always claims `"overlay"` from the overlay client; a panel/tray/HMAC peer can still claim `"overlay"` on every thread it listed.

`gateChatCreateOnLease` (`:109-126`) is the **only** chat.create writer mutex. Overlay **must** hold overlay lease to send; panel is denied with `OVERLAY_STANDBY`.

Not a tool grant. It **is** an authorization primitive in the chat path:

- Overlay/HMAC summoner: `thread.list` + claim overlay on all ids → Side Panel composers bricked until release.
- Panel/tray can claim `holder: "overlay"` without the overlay being visible (lease stuck if overlay never `release`s).
- Overlay can `chat.create` on **any** `thread_id` after claim (no membership check).

Security-sensitive code must not treat lease as "this socket is the overlay." It currently almost does (chat.write). `[inspected]` no other tool/L2 path reads the lease.

**Fix:** derive holder from `authState.surface` (summoner → overlay, else panel). Ignore client `holder`. Optionally bind claimable `thread_id` to the hydrated overlay thread.

---

### MAJOR-2 — STT origin amend is real in ADR-023 §7.2; brief §8 and ADR-023 §1.3 still forbid it

`[inspected]` git: `4c7ea33` + `7f75932` **did** amend ADR-023 §7.2 (not ship-note-only laundering). Live gate:

- `isVoiceSttOriginAllowed` (`stt-handlers.ts:56-62`): chrome-extension **or** (`cmspark-tray://local` **and** `surface === "summoner"`).
- `SUMMONER_ALLOW` includes `voice.stt.*`; `voice.model.*` denied (`summoner-acl.ts:22-27`, tests `summoner-acl.test.ts:66-77`).
- Tray menus (`surface: "tray"`) → ACL + origin_denied. `[inspected]` no tray-menu dictation path.

Still open:

1. **Brief §8 Voice** still says "召唤器不做听写；不要灰色麦克风图标." ADR-023 §1.3 non-goal still says "Worker / Cockpit / **tray 🎤**." Only §7.2 moved. Internal spec contradiction. Spike ship note cannot override a LOCK table the brief still prints.
2. **`privacy_ack_v2` is a client boolean.** Overlay hardcodes `privacy_ack_v2: true` (`client.ts:350, 380`; `menu-bar-agent.ts:825` comment "mic press = ack"). Server (`stt-handlers.ts:192-197`) only checks `!== true`. Any summoner-surface HMAC peer can start local STT without a mic press. Equivalent to Side Panel's flag, **plus** a new tray-origin path. Not a tool grant; it **is** a new audio ingest channel.
3. **Caps exist on WS, not on stdin.** `STT_MAX_CHUNK_BYTES=256KiB`, `STT_MAX_SESSION_BYTES=2.5MB` (`session-caps.ts:12-16`); `validate.ts` enforces chunk size. `summoner.mic.wav` / `mic.chunk` (`protocol.ts:389-397`) only require `data: string`. Hash-pinned Swift is the sender; a replaced binary (hash mismatch → rebuild) or a huge stdin line is a DoS residual, not a new grant.
4. **Dictate → composer, not auto-send** (`menu-bar-agent.ts:1221-1223`, `mapVoiceSttToSummonerCmd`). Prompt injection via Whisper text is the same residual as Side Panel STT: user still hits send. `[inspected]` no auto-send.

**Fix:** either AMEND brief §8 + ADR-023 §1.3 in the same commit as §7.2, or remove overlay STT. Server-side ack must not be a self-asserted bool (bind to overlay-mic session id issued after a counted gesture, or drop STT from overlay).

---

### MAJOR-3 — Overlay `chat.create` is type-allowed; panel-grade optional fields are not stripped

`validate.ts:27-39` lets `chat.create` carry `skill_ids`, `hostname`, `url`, `context_refs` (≤8). `message-router.ts:323-328` applies `llm_override` (including `api_key` / `base_url`) on **any** chat.create. ACL gates **type**, not fields.

Production `sendChatCreate` (`companion-client.ts:282-286`) only sends `{thread_id, message}`. A summoner HMAC peer is not so limited:

- `llm_override.base_url` → exfil thread to attacker endpoint.
- `skill_ids` / `context_refs` → composition without Panel.

S21 "overlay chat.create may reach L2/MCP" does not imply overlay may retarget the model. `[inspected]` no summoner strip of `llm_override`.

**Fix:** if `authState.surface === "summoner"`, drop `llm_override`, `skill_ids`, `context_refs` (and any other panel-only extras) before `handleMessage`.

---

### MAJOR-4 — Overlay-origin L2 confirm is origin-bound to a socket that cannot respond; tray `respond()` remains the privileged race winner

`createToolExecutor(ws)` closes over the **originating** socket (`server.ts:443`, `lifecycle.ts:825`). Non-outbound L2 (`l2-admission.ts:1287-1293`) sets `{ originWs: ws }`. Overlay cannot send `security.confirmation.response` (ACL + no UI). `respondFrom` would origin-mismatch the Panel.

Tray stdin still races via `SecurityConfirmationManager.respond()` (`security-confirmation.ts:491`, `l2-admission.ts:1375-1379`) — **bypasses originWs**. That is the pre-existing privileged channel S6 preserves.

MCP namespaced tools **do** retarget (`mcp/confirm-target.ts:19-28`, `dispatch.ts:59-80`) to the extension peer. Generic L2 (`evaluate`, `host_computer`, …) does **not**.

When Chrome **is** attached, overlay-origin L2 never appears as Panel MinimalConfirm (N2). Conductor is tray/HUD. S6 text: "Chrome 缺席时 … tray stdin". Chrome-present overlay L2 is unspecified and currently tray-only. Not a silent grant (overlay cannot click Allow). It **is** a conductor leak and a reason HUD Allow is more exposed (see BLOCK-1).

Outbound MCP confirm **fans out to every authenticated client** (`l2-admission.ts:1243-1251`), including summoner. Overlay ignores the frame (`mapChatMessageToSummonerCmd` has no confirm arm). Summoner still cannot respond (ACL). Origin is **unbound** for outbound — pre-existing L8. Overlay as extra authenticated peer slightly widens "who receives the JPEG preview / confirm payload" (broadcast). NIT adjacent.

---

### MAJOR-5 — Overlay L0 can ride an already-armed unattended grant

S21 hard-denies `security.unattended.arm` — overlay cannot **arm**. Overlay `chat.create` is allowed. If Panel/tray already armed ADR-021 grant, overlay talk can drive `host_computer` with initial L2 + re-L2 skipped (existing unattended algebra). Brief §8: "值守中热键可搜历史，**不可点 Allow**." It does not say "cannot talk." Talking under cruise is a new OS-level trigger for silent CU.

**Fix:** when unattended is armed, summoner `chat.create` should fail closed or force L0-only (no L2 tools) unless a Panel/HUD confirm is in the loop. Search-only during cruise matches the brief more closely.

---

### NIT-1 — S21 allowlist expanded past the brief sentence

Brief S21 allow: `chat.create/abort`, `thread.list/select/create`, `history.query`.

Code (`summoner-acl.ts:11-28`) also allows `system.ping`, `composer.lease.*`, `voice.stt.*`, `mcp.list`.

Hard denies in the brief (`pack.apply`/`allowTrust`, `config.set`, `security.unattended.arm`, `mcp.add`, `security.confirmation.response`) are tested (`summoner-acl.test.ts:24-38`) and enforced before lifecycle confirm/tool.result handlers (`lifecycle.ts:1036-1062`). `[inspected]` those types cannot run on summoner.

`mcp.list` is read-only retrieval (S8 "检索已配置 server"). `handleMcpFamily` is shared with `mcp.add` (`message-router.ts:1837-1845`) but dispatched by **type**; ACL denies mutate types first. Uncommitted `Tray.swift` hides MCP chrome (`mcpField?.isHidden = true`). Still a wire expansion.

`history.query` is in the brief allowlist; overlay search **implementation** uses `thread.list` titles only (`client.ts:55-71`, `menu-bar-agent.ts:730-737`). Overlay **could** dump ops history (URLs/tools). Local, not cloud.

---

### NIT-2 — SHA256 pin vs uncommitted Swift

`[executed]` `shasum -a 256 companion/dist/cmspark-tray` = `6d7de4ed3e673ee527fd9a7b4225c5d6841d351956434682d882dadd4d989838`.

| Pin | Value |
|-----|--------|
| HEAD `swift-tray-bridge.ts` | `267e24b2…` (ship note) |
| Dirty tree pin | `6d7de4ed…` |
| On-disk binary | `6d7de4ed…` |
| `Tray.swift` mtime | 2026-08-23 17:53:56 |
| Binary mtime | 2026-08-23 17:54:06 |

Dirty tree is internally consistent (Swift saved, then rebuilt, then pin updated). HEAD pin is **stale vs current source**. Dist binary is gitignored. Hash mismatch on a clean HEAD checkout triggers the existing auto-rebuild path (`swift-tray-bridge.ts:221`). Not a silent grant. S10 still one gate, one binary. Commit pin+rebuild together.

---

### NIT-3 — Overlay does not show pairing secret; confirm dialect not on overlay

Pairing secret is `show-pairing-window` → `PairingController` (`Tray.swift:468-474, 587-717`), not `SummonerController`. Overlay `jsonLine` types are `summoner.*` only (`Tray.swift` jsonLine grep: submit/search/mic/attach/continue/closed/ready/hotkey — **no** `confirm-response`). Protocol rejects `summoner.confirm.*` (`protocol.ts:259-265, 296, 362`).

Tray/HUD Allow still exist in-process (S6/S22: overlay must not grow a fourth dialect — it did not). Privileged `confirm-response` handler (`swift-tray-bridge.ts:476-485`) will honor **any** stdout line of that type from the hashed binary. Overlay source does not emit it `[inspected]`. CU clicking HUD Allow is BLOCK-1, not a Swift dialect leak.

---

### NIT-4 — Retrieval does not upload message bodies to the cloud by default

Title search: `filterThreadsByTitle` on `thread.list` (`client.ts:55-71`). Hint `只搜标题，不搜正文` (uncommitted protocol). No LLM call on `summoner.search`.

`thread.select` returns **full** messages (`message-router.ts:1666-1677`) for local hydrate; `hydratePlaintext` caps 40 lines × 4000 chars (`hydrate.ts:5-24`) — S7 suggested 20; local only.

Chat.send **does** send the user message (and companion thread history) to the configured LLM. That is L0, not "search uploaded the vault." S12 second-gesture-to-include-hit-in-LLM: selecting a title hit hydrates; send is a separate Return. `[inspected]` search path does not concatenate bodies into `chat.create`.

---

### NIT-5 — S13 `openChrome` is not an LLM tool; god-mode/unattended do not call it

`[inspected]` no `openChrome` / `launch_browser` in `companion/src/bridge` tool catalog (matches ship note grep). Callers: `attachChromeOnly` (`client.ts:180-188`) from `summoner.attach_chrome` stdin (`menu-bar-agent.ts:948-949`) and tray Chrome menu (`:586-588` `openSidePanel` — **not** overlay). Default attach is `openChromeSilent` (no focus steal) unless `foreground: true`. Still a user-gesture UI RPC from overlay button (`Tray.swift:1879-1883`). God-mode / `auto_approve_*` / unattended algebra never references `getChromeOpener()`.

---

### NIT-6 — S19 L1 actuator split looks closed `[inspected]`

`forwardL1OrUnavailable` (`l1-actuator.ts:58-70`): tray/summoner origin → `pickAuthenticatedClientWs()` (extension-only, `lifecycle.ts:257-267`); missing peer → `BROWSER_UNAVAILABLE` **without** calling `forward`. `createToolExecutor` terminal path (`server.ts:762-781`) uses that helper. `classifyError` (`security.ts:923`) returns `non_recoverable` when `context.error_code === "BROWSER_UNAVAILABLE"`. Adapter passes top-level `error_code` (`adapter.ts:1438-1449`). Tests: `l1-actuator.test.ts`, `tool-forward-actuator.test.ts`, `classify-error-browser-unavailable.test.ts`.

`tool.start` still goes to originating `ws` (`server.ts:553`) — status only, not `tool.execute`. Summoner ACL denies `tool.result`, so overlay cannot complete a forged L1 even if picked (see BLOCK-2 forge table).

Live end-to-end (Chrome quit, overlay talk, L1, zero retry) **not executed** this review. Units are not a CU run.

---

### NIT-7 — Hydrate cap 40 vs S7 "20"

Product, not Trust. Noted so it is not claimed as a security close.

---

## S6 / S13 / S17 / S19 / S21 / S22 / S23 verdict per law

| Law | Verdict | Why |
|-----|---------|-----|
| **S6** | **AMEND-risk / mostly held** | Overlay does not render or emit Allow/Deny. No `summoner.confirm.*`. `originWs` not unbound for non-outbound L2. Tray stdin `respond()` still privileged. Overlay-origin L2 cannot be answered by Panel (MAJOR-4). Fourth dialect: **not** added. |
| **S13** | **HOLD** | No LLM `openChrome` tool. Gesture stdin only. God-mode / unattended do not call opener. |
| **S17** | **HOLD on production client; residual on server** | Overlay uses `cmspark-tray://local`. Server still accepts any `chrome-extension://` + HMAC as L1 actuator (pre-existing). Summoner+forged extension origin fail-closes on `tool.result`. |
| **S19** | **HOLD `[inspected]`** | Conversation ⊥ actuator. Missing peer → typed non-retryable `BROWSER_UNAVAILABLE`. Forward not called. |
| **S21** | **FAIL (BLOCK-2) + hard-denies held** | Hard-deny types are actually denied. Allowlist grew (lease/STT/`mcp.list`). Surface is client-stamped; omit → tray superuser. That is the hole S21 exists to close. |
| **S22** | **HOLD on overlay chrome; FAIL via S23** | Overlay has no confirm buttons. HUD in the same process still has Allow. CU can click HUD (BLOCK-1). LIVE CU + overlay visible is not a second conductor **in paint**, but is a second **hit target**. |
| **S23** | **FAIL (BLOCK-1)** | No window-rect hard-reject. Process-level **continue**. Tests celebrate the violation. |

S8 `pack.apply`+`allowTrust`: denied by ACL **and** `user_gesture` on the type. Double-closed `[inspected]`. S10: one hash gate; dirty tree pin matches rebuilt binary `[executed]`. S12 search: local titles `[inspected]`.

---

## Residual risks (pre-existing, overlay-adjacent)

- HMAC same-user + loopback Origin forge (documented in brief §8 冒充). Overlay does not remove it.
- Hash-gated Swift stdin `respond()` / `hud.confirm.response` — compromise of `cmspark-tray` is still "self-approve L2." Overlay grew the window surface of that binary.
- `broadcastToClients` includes summoner (config, MCP status, computer JPEG previews). Overlay is another authenticated siphon of those frames. Same-user.
- `chat.abort` on summoner (`lifecycle.ts:1085-1096`) flips **all** computer task aborts. Safe direction; overlay close does **not** abort (S9 held, `menu-bar-agent.ts:766-767`).
- Loopback HTTP `/healthz` + outbound-MCP Bearer (`lifecycle.ts:221-246`) is not a summoner bypass for chat/ACL.

---

## VERDICT: **REJECT**

Two T3 BLOCKs:

1. **S23** — CU self-click on overlay/HUD/tray is not hard-rejected; Task 12 added a **new** self-UI continue for `cmspark-tray` (grant-skip of re-L2).
2. **S21** — summoner ACL is optional; handshake `surface` fail-opens to tray. Overlay is not a server-enforced reduced principal.

Do not ship overlay as a Trust-closed L0 until (a) pre-inject window-rect deny exists and the `cmspark-tray` continue path is not a confirm/submit hit, and (b) surface cannot be omitted into the tray ACL.

MAJOR (lease holder spoof, STT spec contradiction + client-asserted `privacy_ack_v2`, unstripped `llm_override` on summoner `chat.create`, overlay-origin L2 conductor, unattended ride) must be fixed or explicitly AMENDED in the brief — not in a ship note.

NITS (allowlist extras, SHA256 commit hygiene, pairing/search/S13/S19) are not the reject.

**Default posture was REJECT. Evidence did not move it.**
