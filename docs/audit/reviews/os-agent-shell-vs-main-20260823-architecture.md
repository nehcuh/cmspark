# Architecture adversarial review — OS Agent Shell vs origin/main

| Field | Value |
|-------|--------|
| Date | 2026-08-23 |
| Lane | ARCHITECTURE (independent; did not implement) |
| Range | `origin/main`=`fc187257` → HEAD `659bbce` **plus uncommitted/untracked production** |
| Spec | `docs/decisions/os-agent-shell-brief-2026-08-22.md` S1–S24 · ADR-020 |
| Stance | Default **REJECT** unless the architecture is sound |
| Evidence | `[executed]` git range/stat; `[inspected]` current worktree sources. No tests run. Prior `os-agent-shell-20260823-*.md` **not read**. |

Untracked production in scope: `companion/src/computer/companion-ui-rects.ts`, `companion/src/ws/l2-conductor.ts`.

---

## Capability declaration check (ADR-020)

**Claimed (brief §0 / spike plan):** L0 capture overlay (macOS); full L0/L1 = Side Panel; L2 unchanged; no new `host_*`/`shell`/`netsec`; overlay indexes Composition, does not apply Pack/trust; single loop; SHA256 tray door; overlay is not a confirm writer.

**Observed [inspected]:**

```text
Surface:      L0 overlay (macOS Swift) + Side Panel; L1 = chrome-extension WS; L2 = HUD/Cockpit (unchanged classes)
L2-classes:   none new (COMPANION_UI_CLICK_DENIED is an error code, not a new L2 class)
Compose:      overlay chat.create still sees companion MCP tools; overlay ACL adds mcp.list + voice.stt.* (not index-only)
Autonomy:     single (no auto-spawn / new Board)
Trust:        same SHA256 binary; overlay ACL denies confirmation.response; MCP overlay retargets originWs to Panel
Channel:      community
```

ADR-020 anti-patterns:

| Anti-pattern | Verdict |
|--------------|---------|
| New Side Panel first-class entry | Avoided. OS 一级入口 = summoner (S8 allows 1). |
| New confirm dialect | Avoided. No `summoner.confirm.*` (`protocol.ts:273-278`). |
| New Agent/runtime | **Avoided.** Same `createToolExecutor` + adapter loop. |
| New WS family without declaration | `composer.lease.*` declared in brief S20. Spike-ok; still no ADR. |
| Overlay as fourth axis / “家” | Copy mostly locked. **Behavior** thickens toward Approach B (settings, 新对话, markdown, STT residue). |

**Not a second tool-loop.** The failure mode is **surface creep + dual-L0 SoT holes**, not a parallel runtime.

---

## Strengths vs main

1. **S19 is real, not a comment.** Main bound L1 `tool.execute` to the originating socket (`createToolExecutor(ws)` → `forwardToolToExtension({ ws })`). Worktree splits actuator: `server.ts:763-780` → `forwardL1OrUnavailable` → `resolveL1ActuatorWs` (`l1-actuator.ts:47-58`) uses originating WS only if `chrome-extension://`, else `pickAuthenticatedClientWs()` (`lifecycle.ts:257-267`, still extension-only). Missing peer → `BROWSER_UNAVAILABLE` without `forward` (`l1-actuator.ts:90-93`).
2. **`classifyError` has an explicit code branch** (`security.ts:923`) so copy containing `timeout`/`disconnected` cannot resurrect retry. Adapter stops on `non_recoverable` and preserves `error_code` (`adapter.ts` + `toolChatErrorPayload`).
3. **S21 is per-connection, not Origin-cleave.** Handshake `surface` (`lifecycle.ts:990-991`); ACL before `handleMessage` (`lifecycle.ts:1036-1046`). Tray `skill.list` survives (`summoner-acl.ts:34`).
4. **Confirm writer unchanged (N5/S6 UI).** Overlay has no Allow/Deny. L2 still races tray stdin `respond()` (`l2-admission.ts:1346-1379`).
5. **S1 holds.** Overlay is a client. `chat.create` still enters `message-router.ts:279` → existing LLM adapter. Second WS (`menu-bar-agent.ts:1237-1244`) is another authenticated peer, not another loop.
6. **Uncommitted S20/S22/S23 attempts are in the right modules** (lease CAS helpers, `l2-conductor` gate, window-rect map) rather than a third runtime.

---

## Findings

### BLOCK

**B1. `composer.lease` is not overlay-visibility SoT — stale overlay holds survive thread switch and close.** S20: *overlay visible ⇒ overlay holds; close overlay ⇒ panel*. Uncommitted wiring claims on hydrate/new-thread and releases **only** `summonerThreadId` on close.

- Claim current, never release previous: `menu-bar-agent.ts:627-638` (`hydrateSummonerThread`), `942-959` (`handleSummonerNewThread`).
- Close releases current only: `678-683`.
- Search 1-hit mutates `summonerThreadId` without claim/release (`744-750`).

Consequence: overlay hydrates A, then 新对话/select B → **A stays `holder=overlay` forever** (in-memory map, `composer-lease.ts:74-75`). Side Panel on A is `OVERLAY_STANDBY` after overlay is showing B or even after overlay closed. Dual-L0 is the brief’s hardest new boundary; this SoT is a lie for every thread the overlay has ever touched except the last.

`applySummonerComposerVisibility` (`composer-lease.ts:250-258`) encodes the correct open/close algebra and **is unused** by the launcher.

**B2. Overlay attach CTA is unconditionally hidden — L0→L1 upgrade surface deleted in the same slice that claims S14.** `Tray.swift:2226-2228` (`applyPhase`): `ctaBox` / `attachButton` / `silentAttachButton` forced `isHidden = true`. Handlers still exist (`1963-1968`) and the CTA view is still built (`2585-2622`), so this is not “not implemented”; it is a live control plane with the user-gesture door welded shut. Brief identity = Chrome-optional same-thread L0 **plus** honest attach. Without a visible S13 gesture, overlay cannot complete the L0→L1 state machine the architecture diagram requires.

(P0 spike non-goal said window-rect is P1. Hiding the P0 CTA is not that trade.)

---

### MAJOR

**M1. Overlay is Approach B residue inside an Approach A shell (S7/S8/Voice).** Brief: overlay 常驻控件 ≤ composer + 检索 + 缺浏览器徽章; 设置/Pack/听写/完整格式 stay in Panel; hydrate plaintext.

[inspected] `SummonerController` (`Tray.swift:1549+`) still contains:

- Header **新对话** + **快捷键** (`2307-2324`) — extra first-class chrome.
- Full **settings box** (idle policy + Chrome foreground) (`2379-2443`) writing config via stdin `summoner.settings.set` (`1986-1991` → `menu-bar-agent.ts:982-987` `saveConfig`).
- Mic button in the composer (`2490-2499`); `applyPhase` hides it (`2239`) but layout still reserves 28pt (`2501-2507`). STT protocol + ACL remain (`protocol.ts:204-217`, `summoner-acl.ts:22-26`, `stt-handlers.ts:54-61`).
- Assistant **markdown** parse (`Tray.swift:2139-2143`). S7 hydrate is plaintext; streaming is now rich text.
- MCP status field (hidden after apply, `1688-1694`) + `mcp.list` on summoner ACL.

This is how a thin capture shell becomes a native chat app without an Approach B decision. ADR-020 “杂” metric: new stdin cmds + new WS types + overlay settings.

**M2. S21 ACL drifted; stdin whitelist is the real hole.** Brief S21 allow: `chat.create/abort`, `thread.list/select/create`, `history.query`. Hard-deny: `pack.apply+allowTrust`, `config.set`, `unattended.arm`, `mcp.add`, `confirmation.response`. Stdin: 开窗/热键/hydrate.

Allowlist extras (`summoner-acl.ts:11-28`): `composer.lease.*` (necessary for S20), **`voice.stt.*`**, **`mcp.list`**. Tests lock the extras (`summoner-acl.test.ts:45-63`).

Stdin inbound (`protocol.ts:97-112`) is a second control plane: `settings.set`, `mic.*`, `new_thread`, `select`, `continue`, `attach_chrome`. **`config.set` is denied on WS and performed anyway via `persistSummonerPatch`.** HMAC-local, but S21’s point was: overlay is not a second superuser. Privileged tray stdin already had `respond()`; this adds config mutation and STT without the ACL.

**M3. `composer.lease.claim` is not bound to handshake surface.** `handleComposerLeaseFamily` (`composer-lease.ts:141-163`) accepts any `holder` from any authenticated peer. Summoner ACL allows `composer.lease.claim` with no holder check. Extension/tray (ungated) can claim `overlay`. Dual-L0 SoT is spoofable by any HMAC peer, not “overlay visible”.

**M4. S6 letter vs MCP retarget.** Brief: 禁止解绑非 outbound 的 `originWs`. Overlay MCP confirm rebinds `originWs` to the extension WS (`mcp/dispatch.ts` `confirmChannel` + `{ originWs: confirmWs }`; `confirm-target.ts:19-28`). Chrome absent → MCP confirm **fails** (does not fall back to tray `respond()`). L2 overlay-origin still binds `originWs` to summoner WS and races tray (`l2-admission.ts:1290-1293, 1346-1379`) — Panel Confirm Center does **not** see overlay-started L2. Two confirm geometries for one overlay chat loop.

**M5. `L2_CONDUCTOR_ELSEWHERE` is wired, but not S22.** Untracked `l2-conductor.ts:12-31` + `message-router.ts:307-308`: overlay `chat.create` denied iff `getComputerTaskAbortRegistry().size > 0`. That map is populated when a `host_computer` task **starts** (`companion-dispatch.ts:1661`), not while L2 is **pending**. Process-global, not per-thread. Panel/tray still send during LIVE (test-locked). Overlay UI has no conductor copy. S20 “LIVE 时 N6 优先 / 排队或禁用” is a gate on the next `chat.create`, not a queue.

**M6. Tray.swift god-object vs main.** [executed] `origin/main` 1229 lines → HEAD 2670 → worktree **2708**. Pairing + Confirm + HUD + **SummonerController** + hotkey Carbon + mic capture in one SHA256 binary. S10 *requires* one binary, not one file. This is the HUD N1 cost exploding: IME×CU OPEN question now lives in the same process *and* file as CU HUD. Blast radius of any overlay typo includes pairing secret window and N5 confirm.

**M7. Protocol explosion (stdin + second WS + rects + lease family).** By S21 design, chat is a second WS. Added on the **same** Swift pipe: summoner dialect (~20 cmd/evt), `companion.ui.rect` (`Tray.swift:42-58`, `swift-tray-bridge.ts:538`), HUD/confirm already there. New WS family `composer.lease.*`. Overlay notice `mcp.confirm.pending`. ADR-020 §7 “新 WS 消息族需 ADR 或声明” — brief covers lease; rects + settings.set were not in S21 whitelist.

---

### NIT

**N1.** `type`/`key` CU actions skip `assertClickClearsCompanionUi` (`executor.ts:1332-1368` vs click/scroll/drag `1369-1383`). Overlay-focused typing can land in the summoner composer. S23 is worded as 点击坐标; still a self-ui continue analogue.

**N2.** FOREGROUND-YIELD still `forceForeground` + `continue` when `cmspark-tray` is in `companion_ui_exe_basenames` (`config.ts` default list; `executor.ts:1623-1632`). Uncommitted **removed** hardcoded `COMPANION_UI_PROCESS_BASENAMES` from `self-ui.ts` but config still matches tray. Window-rect (untracked `companion-ui-rects.ts:71-79`) is the actual S23 click gate — correct split **if** Swift emits rects (it does for overlay/HUD/tray/pairing). Process-level continue for “overlay frontmost, click on WeChat” is OK under S23’s AND.

**N3.** `APPLY_COMPOSER_LEASE` UI (`useWebSocket.ts:475-481`) drops events for non-active threads; switching back to an overlay-held thread does not restore standby until the next error. Server still gates (B1 is the SoT bug; this is display lag).

**N4.** `SWIFT_TRAY_SHA256` comment is “2026-08-22 after press-hold mic” (`swift-tray-bridge.ts:57-59`) while worktree Swift added rects + hid CTA. Rebuild/hash must lockstep or the door auto-rebuilds — operational, not conceptual.

**N5.** Win/Linux adapters no-op summoner (`systray2-bridge.ts:177-179`, `readline-tray.ts:95-97`). Honest. Installer “家仍在侧栏” copy **UNVERIFIED** (no installer diff vs main).

---

## Hunt answers

| # | Question | Answer |
|---|----------|--------|
| 1 | Companion still unique tool-loop vs main? | **Yes.** Same adapter + `createToolExecutor`. Overlay is a client. `[inspected]` |
| 2 | Dual L0: lease claim on open, release on close, broadcast? | **Partial.** Uncommitted claims on hydrate/new, releases current on close, broadcasts successful claim/release (`composer-lease.ts:197-201`, `message-router.ts:1037-1048`). **Does not** claim-from-visibility of a single thread; **does not** release previous; Panel never claims (default holder=panel is OK). **B1.** |
| 3 | conversation origin ⊥ actuator (S19)? | **Yes.** `l1-actuator.ts:47-58` + `server.ts:763-780`. Tray/summoner never get `tool.execute`. |
| 4 | Overlay thickening vs Approach A? | **Yes, thickening.** Markdown, settings, 新对话, STT/MCP residue, hidden-but-present CTA/mic. **M1/B2.** |
| 5 | S21 ACL vs brief? | Hard-denies hold. Allowlist and **stdin** drifted. **M2.** |
| 6 | God-object Tray.swift vs main? | **1229 → 2708 lines.** Same binary (S10), worse modularity. **M6.** |
| 7 | `L2_CONDUCTOR_ELSEWHERE` wired? | **Yes, LIVE-only, process-global, chat.create only.** Untracked file imported by router. **M5.** |
| 8 | S23 window-rect vs process-level continue? | Rects added and hooked on click/scroll/drag. Process-level self-ui **continue** remains via config basename. Type/key ungated. **N1/N2.** Spike plan called full rects P1; worktree did them anyway. |
| 9 | Protocol explosion stdin + second WS? | **By design (S21) plus extras:** settings/mic/rects/lease. **M7.** |
| 10 | Uncommitted slice: identity vs new coupling? | Identity: lease open/close, `error_code` on `chat.error`, conductor gate, S23 rects. New coupling: launcher↔lease CAS, Swift rects↔CU executor, MCP `originWs` retarget, STT origin amend, **CTA hidden**. Net: S20 closer, S14 worse. |

---

## S1–S24

| ID | Status | Note |
|----|--------|------|
| S1 | **LOCK** | Unique Companion loop. |
| S2 | **AMEND** | Capture-shell copy; overlay chrome contradicts “not 家”. |
| S3 | **LOCK** | L1 only via extension peer; typed miss. |
| S4 | **BROKEN** | Attach handlers exist; CTA hidden (`Tray.swift:2226`). |
| S5 | **LOCK** | Same `thread_id` on overlay send/hydrate. |
| S6 | **AMEND** | No overlay Allow. MCP unbinds `originWs`; L2 overlay-origin not fanned to Panel. |
| S7 | **AMEND** | Hydrate cap 20 exists; markdown + settings + 新对话. |
| S8 | **AMEND** | Extra controls; `mcp.list`; no `pack.apply`. |
| S9 | **LOCK** | Close ≠ abort (release is best-effort). |
| S10 | **LOCK** | One Swift binary + SHA256 door. Process model still OPEN (IME×CU in-process). |
| S11 | **LOCK** | Hotkey picker present; no stolen default in overlay header. |
| S12 | **LOCK** | Title search `#`; hint `只搜标题，不搜正文`. |
| S13 | **AMEND** | UI RPC `getChromeOpener` only; **no visible button** (B2). |
| S14 | **BROKEN** | Binary badge remains; honest CTA hidden. |
| S15 | **UNVERIFIED** | No overlay on Win/Linux adapters; installer copy not in diff. |
| S16 | **LOCK** | Attach path is Google Chrome. |
| S17 | **LOCK** | Origin `cmspark-tray://local`; `pickAuthenticatedClientWs` extension-only. |
| S18 | **UNVERIFIED** | Observability of P0 falsification (8+5 users) is process, not code. |
| S19 | **LOCK** | Implemented and test-shaped. |
| S20 | **BROKEN** | Fields exist; visibility SoT leaks (B1); claim not surface-bound (M3). |
| S21 | **AMEND** | Connection ACL yes; allowlist + stdin extras. |
| S22 | **AMEND** | Overlay still has no confirm buttons; conductor gate LIVE-only. |
| S23 | **AMEND** | Window-rect hard-deny on click/scroll/drag; process continue remains; type/key hole. |
| S24 | **LOCK** | No GOAL.md / ADR-020 one-liner in range. |

---

## Architectural status

**WATCH** on S1/S3/S19 (the v1 REJECTs that mattered).  
**BLOCK** on dual-L0 SoT (S20) and the L0→L1 attach surface (S4/S14).  
Overlay thickening is a slow Approach B slip, not a new runtime — still disqualifying for a brief that exists to prevent that slip.

## VERDICT: **REJECT**

Not because Companion grew a second tool-loop — it did not, and that is the main-vs-branch win. Reject because the two architectural inventions this brief exists to add (**dual-L0 lease as SoT**, **honest Chrome-optional attach**) are not true in the worktree, while the overlay simultaneously accretes settings/STT/markdown that S7/S8/Voice forbade.

**Bar to flip:** (1) overlay-visible thread is the only overlay holder — release previous on switch, release all overlay holds on close, bind claim holder to `surface`; (2) restore a visible S13 attach CTA or delete the dead control plane; (3) either strip overlay settings/STT/markdown/MCP chrome or explicitly AMEND S7/S8/S21/Voice in the brief before calling this Approach A.

---

*Independent ARCHITECTURE lane. No source modified. Worktree as of 2026-08-23 including uncommitted production.*
