# Independent adversary — next workbench direction (Trust / Architecture)

> **Lane**: TRUST / ARCHITECTURE (ADR-020)  
> **Role**: independent adversary — did **not** implement #219 and will not rubber-stamp overlay as a confirm surface or Trust-B writer. Hostile to `file.upload` ACL holes.  
> **Date**: 2026-08-24  
> **Repo**: `/Users/huchen/Projects/cmspark`  
> **Prompt**: `docs/audit/reviews/_prompts/workbench-next-direction-adversary-20260824.md`  
> **WIP**: PR #219 `feat/steer-nextrun-overlay-hub` (T2, not merged; code adversary REJECT on drain)  
> **This is not an implementation review.** Direction only. No production edits.

```text
Surface:      L0 overlay shell (same tool-loop). Not a second runtime.
L2-classes:   none on overlay — overlay never Allow/Deny, never host_read
Compose:      pack.apply overlay allowTrust FORCED false by surface; mcp.list read-only
Autonomy:     existing single-loop steer/nextRun
Trust:        monotonic — overlay MUST NOT write Trust B; MUST NOT be originWs
Channel:      summoner ACL; omitted handshake surface = tray = ungated (load-bearing)
```

Routing override. Named TRUST direction adversary with a fixed write path. `vibe route` is not the work.

Evidence tags: `[inspected]` live files below. `[assumed]` only where noted. No MACHINE run — this lane is not scoring #219 merge.

---

## Sources `[inspected]`

| Artifact | Why |
|----------|-----|
| `docs/adr/020-capability-model-three-axes.md` | L0 includes 附件; one tool-loop; Trust B only `user_gesture`+`allowTrust`; Pack is not a runtime |
| `docs/adr/018-host-use.md` Decision 6 | Linux Host write-path honesty; overlay must not pretend L2 parity |
| `companion/src/ws/summoner-acl.ts` | Allowlist; omitted surface not gated; `file.upload` **absent**; `mcp.add` / confirm **absent** |
| `companion/src/ws/lifecycle.ts` `:1036–1063`, `:1287–1296` | ACL then stamp; `security.confirmation.response` intercepted **after** ACL; `originWs: ws` per socket |
| `companion/src/message-router.ts` `file.upload` `:598–1056` | Caps via `partitionUploadFiles` / `validateImageCaps`; **no** `gateChatCreateOnLease`; **no** `gateChatCreateOnConductor`; occupied **supersedes** `:821–825` |
| `companion/src/message-router.ts` `pack.apply` `:2745–2804` | `allowTrust: !overlayApply`; refuse extras / ineligible / trust cookie / live loop |
| `companion/src/packs/overlay-eligible.ts` | Server SoT; empty `tools.allow` + no `trust` ⇒ eligible |
| `companion/src/packs/pack-engine.ts` `:1494–1652` | Trust write only `allowTrust===true` + `origin=user`; `allowTrust_false` skips globals |
| `companion/src/ws/composer-lease.ts`, `l2-conductor.ts` | Lease + L2-live conductor gates on `chat.create` / `chat.steer` / `chat.regenerate` — **not** on `file.upload` |
| `companion/src/llm/split-upload-files.ts` | 4 images / 4MiB / 6MiB total; HEIC/SVG deny |
| `companion/src/ws/validate.ts` `file.upload` | ≤10 files; name/type/content strings; optional hostname |
| `companion/tests/summoner-acl.test.ts` | Denies `config.set` / `security.confirmation.response` / `mcp.add` / unattended arm. **No** `file.upload` row |
| `companion/src/tray/systray2-bridge.ts` `:177–179`, `readline-tray.ts` | `sendSummoner` / `hydrateSummoner` no-ops |
| Spec r2 `docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md` | Overlay not Allow/Deny; `allowTrust` surface-forced false; Win/Linux overlay **non-goal of #219** |

---

## 0. Reflection vs ADR-020 — keep the map, kill the runtime reading

Owner framing (quick summon / Side Panel / CU) **maps** to ADR-020 Axis A + Composition. Implementer is right: this is **not three runtimes**. Overlay is an L0 UX shell on the **same** Companion tool-loop. `[inspected]` ADR-020 §2–§3.

| Owner sentence | Architecture | Trust consequence |
|----------------|--------------|-------------------|
| Quick summon → talk + apply AI | **Surface L0** + Composition (eligible Pack / already-connected MCP tools) | Overlay may *talk* and *apply composition*. May **not** Allow/Deny, write Trust B, add MCP, or host-read |
| Complex work → browser Side Panel | **Surface L1** (CDP / domain confirm / Cockpit) | Confirm dialect stays panel/tray `originWs`. Overlay is not a second confirm family |
| Non-web deep work → Computer Use | **Surface L2** × same loop | Overlay already `L2_CONDUCTOR_ELSEWHERE` on `chat.create` while `host_computer` LIVE `[inspected]` `l2-conductor.ts:18–31`. Do not add overlay HUD / CU parity |

ADR-020 Axis A L0 **already lists 附件** (“对话、附件”). Attachments on summon are not a new Surface and not Host-Use. They are L0 user-supplied bytes on the existing `file.upload` WS method — **if and only if** the method stays HMAC + caps + lease + conductor, and is **not** `host_read`. `[inspected]` ADR-020 `:44–45`.

Cross-platform honesty: Companion + extension already run on Win/Linux/macOS. Summoner **UI** is Swift-only; systray2 `sendSummoner`/`hydrateSummoner` are no-ops `[inspected]`. A Mac-only “workbench” is a Channel lie. Linux/Windows CU stays incomplete (ADR-018 Decision 6); C must not claim L2 parity.

**Verdict on the reflection:** not wrong. Overlay is not a full workbench **and must not become one** by growing confirm / Trust B / Host file ACL. The next slice is L0 completeness (talk + attach + composition) on **all three OS**, not a deeper Surface.

---

## 1. Current Trust boundary (do not regress)

Load-bearing facts, not slogans:

1. **ACL is the only overlay/tray split.** Origin is `cmspark-tray://local` for both. Comment in `summoner-acl.ts:8–9`: omitted/undefined surface is **tray, not gated**. Handshake that forgets `surface:"summoner"` is a full-privilege peer. `[inspected]`
2. **`file.upload` is not summoner-allowed.** Opening the ACL without handler gates is the hole this lane exists to kill. `[inspected]` allowlist `:12–34`; tests never mention `file.upload`.
3. **`file.upload` is a second chat.create** (parse → `chatCreate` with `session.executeTool`). It currently:
   - does **not** call `gateChatCreateOnLease` (unlike `chat.create` `:333`, `chat.steer` `:582`, `chat.regenerate` `:1210`);
   - does **not** call `gateChatCreateOnConductor`;
   - **supersedes** an occupied loop (`:821–825`).  
   Panel-only this is ugly. Overlay-allowed this is: upload into a panel-held thread, abort the panel LLM, or conduct while L2 is LIVE. `[inspected]`
4. **`pack.apply` overlay Trust-B write is already refused by surface, not client.** `allowTrust: !overlayApply` (`:2792`). Client `rest.allowTrust` is ignored. Cookie thread → `pack_trust_cookie_present` (`:2780–2785`) so `allowTrust false` cannot orphan an S46 snapshot. Eligible is server SoT. `[inspected]` This is the #219 Trust design. Keep it. Do not “improve” it by letting overlay write Trust so meeting-minutes can skip confirms.
5. **Confirm is origin-bound to the requesting socket** (`lifecycle.ts:1287–1296` `{ originWs: ws }`). Overlay `chat.create` that trips L1 confirm binds `originWs` to the **summoner** socket. Summoner **cannot** send `security.confirmation.response` (ACL deny, tested). Result: **fail-closed timeout**. That is correct. “Overlay tools hang → allow confirm on overlay” is the Trust regression this lane will REJECT on sight. `[inspected]`
6. **`mcp.add` denied.** Overlay may `mcp.list` (read-only chips). Adding a server is Composition **plus** a new tool surface. Stays Side Panel. `[inspected]`

#219 drain REJECT is a **correctness** hole (nextRun drain surface stamp), not a reason to reopen `allowTrust`. Merge #219 after that fix is a **gate**, not the destination.

---

## 2. Candidates

### A. Finish #219 then **stop** overlay — **KILL as destination**

Land #219 (drain fix + Pi rereview) **yes**, as a merge gate. **Stop overlay after that: no.**

Stopping freezes:

- Win/Linux summon as a no-op (`systray2-bridge.ts`) while the product narrative says “enterprise workbench”;
- attachments as Side Panel-only, contradicting ADR-020 L0;
- a Mac Swift rail that can apply L0 packs but cannot take a PDF — users will demand NSOpenPanel next (B).

Trust-safe boredom is not Trust-monotonic architecture. A as P0-then-stop is incoherent with the reflection this prompt asked us to judge.

### B. More Swift (NSOpenPanel, richer rail) — **KILL**

Mac-only Channel lie. Owner already said do not over-focus macOS. Trust-hostile because:

- Two attachment stories (Chrome `file.upload` vs Swift NSOpenPanel) trains a later “just `host_read` the path” shortcut (ADR-018 L2 + biometric/nonce). That **is** T3.
- `file.upload` would be ACL-widened for one OS, then HTML-on-Win/Linux duplicates the ACL story under time pressure.
- Swift is already a privileged picker/hotkey process. Growing it as the workbench increases the chance overlay becomes the confirm HUD.

### C. Cross-platform summon **shell** + `file.upload` on all three OS; Swift adapter or frozen — **PICK (constrained)**

This is the only candidate that:

- matches ADR-020 (L0 对话+附件, one loop, Pack composition, no new runtime);
- tells the truth on Win/Linux (replace systray2 no-ops instead of pretending the Mac rail *is* the product);
- reuses the **existing** upload method (HMAC WS + caps) instead of inventing Host-Use-by-picker.

C is **not** “full workbench.” If C ships Allow/Deny, `mcp.add`, Trust-B write, or Node-fs in the renderer, this lane’s verdict on **that PR** is REJECT. Constraints in §3–§5 are load-bearing, not nits.

### D. Other — **not needed**

A sequenced “land #219 then C” is **gating**, not a fourth direction. Panel-only attachments + Mac rail is A∪B. No new L2 overlay HUD.

---

## 3. C + attachments — what MUST stay denied on overlay

ACL is fail-closed (`SUMMONER_ALLOW` membership). **Do not add** these types. Do not “forward” them. Do not let the HTML shell speak them on the **tray** socket.

### MUST deny (Trust / confirm / Trust-B write)

| Method / capability | Why | Today `[inspected]` |
|---------------------|-----|---------------------|
| `security.confirmation.response` | Overlay is **not** a confirm surface. Adding it makes overlay `originWs`. New confirm dialect. ADR-020 anti-pattern §6.2 | Denied; test `summoner denies trust elevation` |
| Any overlay Allow/Deny / Cockpit / CU HUD | Same. L2 conductor stays panel/HUD | `L2_CONDUCTOR_ELSEWHERE` on create/steer/regen only |
| `mcp.add` / `mcp.update` / `mcp.delete` / `mcp.toggle_enabled` / `mcp.toggle_server` | Mutate Composition tool surface; inbound MCP can be L1/L2-class tools | `mcp.add` denied; only `mcp.list` allowed |
| `pack.save_user` | Only path that **persists** `origin:user`+`trust`. Overlay authoring Trust B | Denied (not on allowlist) |
| `pack.install` / `pack.uninstall` / `pack.delete_user` | Install strips trust **and** uninstall restores globals. Overlay must not restore Trust B | Denied |
| `pack.unapply` | `unapply` → `restoreTrustSnapshot`. That **is** a Trust-B write (restore). Overlay apply is composition-only; unapply is Side Panel | Denied |
| Overlay `pack.apply` with `allowTrust:true` | Client lie already ignored; keep `allowTrust: !overlayApply`. Never honor `rest.allowTrust` / `confirmation_phrase` / `force_takeover` / `workspace_path` | Router `:2760–2794` |
| `config.set` / `security.unattended.arm` | Global cruise / god-mode / unattended | Denied; tested |
| `tool.result` | Overlay is not a CDP/Host executor. Do not let it forge results | Denied; intercept is **after** ACL |

### MUST deny (file / Host / session)

| Method / capability | Why |
|---------------------|-----|
| `host_read` / `host_write` / `host_app` / `host_computer` as the attachment path | Attachments are L0 WS bytes, not ADR-018 TargetId. NSOpenPanel / `<input type=file>` / WKWebView FileReader → base64 → `file.upload`. Companion **must not** `readFile(userPath)` |
| `workspace_*` / `shell_exec` / `osascript_eval` | L2 / enterprise. Overlay is not the Host |
| `apps.*` | Persistent coordinate / policy bits |
| Renderer Node `fs` / `child_process` in the companion window | HTML/WKWebView shell with Node integration **is** Host-Use without L2. T3. Renderer is a dumb FileReader |
| Tray `CompanionClient` (omitted surface) for overlay ops | Spec r2 already forbade tray client for `pack.apply`. Same for `file.upload`. Omitted surface bypasses ACL entirely |

`pack.apply` itself **stays allowed** under the #219 contract: overlay-eligible + `allowTrust` forced false + cookie refuse. Do **not** widen `isOverlayEligiblePack` in this slice (empty `tools.allow` + `mode:unchanged` is already the residual false-positive; see §6).

`file.query_chunks` stays denied (not P0). `chat.regenerate` stays denied (lease dual-writer already exists from panel; do not give overlay a second writer).

---

## 4. `file.upload` ACL contract (the hole)

**Order of operations for C — do not reverse:**

1. Add `gateChatCreateOnLease` + `gateChatCreateOnConductor` to the **existing** `file.upload` handler (panel-safe; overlay-required).
2. Occupied + overlay: **reject** `run_active` (same as #219 `chat.create`). Do **not** keep `:821–825` supersede on `stampedSurface==="summoner"`. Supersede from overlay is aborting the panel/L2 conductor by another name.
3. Then add `"file.upload"` to `SUMMONER_ALLOW`.
4. Tests: summoner allow `file.upload`; summoner deny confirm / `mcp.add` / `pack.save_user` / `pack.unapply` / `config.set`; overlay upload without overlay lease → `OVERLAY_STANDBY`; overlay upload while CU LIVE → `L2_CONDUCTOR_ELSEWHERE`; overlay `pack.apply` + `allowTrust:true` still does not write globals; omitted handshake surface is **not** treated as overlay.

**Caps — identical to panel, not a second budget `[inspected]`:**

- `partitionUploadFiles` + `validateImageCaps` (4 / 4MiB / 6MiB)
- `file_upload.max_file_size` for docs
- `validate.ts` ≤10 files
- Companion + client `WS_SOFT_MAX` (10MiB−256KiB). Overlay Swift/HTML **must** refuse oversized frames locally the way the SW does, or the HMAC peer gets a close instead of `file.upload_error`

**Session:**

- Same HMAC pairing. `session` required (`:599`).
- `stampedSurface` from handshake overwrite — never trust client `__cmspark_surface` (`stampCmsparkSurface`).
- Overlay `file.upload` must ride the **summoner** socket, not tray.
- `hostname` / `url` on overlay: **ignore or refuse**. Panel uses active-tab hostname for site knowledge `[inspected]` `validate.ts:770–771`. Overlay is not Chrome; a client-supplied hostname is site-knowledge spoof. Belt, not optional.

**Not Host-Use.** If the implementation grows a `path` field and companion reads it, the slice has become T3 Host-Use and this direction is void.

---

## 5. T2 vs T3

Prompt: blast **T2 unless Trust/file paths force T3**.

| Slice | Blast | Why |
|-------|-------|-----|
| #219 drain fix + merge | **T2** | Trust algebra already designed (`allowTrust` surface-forced false). Drain is correctness |
| C as specified: HTML/WKWebView/companion **window** + ACL-add `file.upload` with §3–§4 | **T2** | New L0 UX shell + widen allowlist of an **existing** L0 method. No new confirm family, no Trust B, no Host TargetId, no second runtime |
| C if any tripwire below | **T3 — stop, re-ADR** | Trust / file ACL changed in kind |

**T3 tripwires (any one escalates; do not “just this once”):**

1. Overlay can `respondFrom` a confirmation (`security.confirmation.response` allowed, or `originWs` rewritten to overlay, or confirm forwarded to overlay UI).
2. Overlay can write or restore Trust B (`allowTrust true`, `pack.save_user`, `pack.unapply`, `pack.uninstall`, `config.set`, unattended arm).
3. Attachments via `host_read` / workspace / Node `fs` in the shell renderer.
4. Handshake default or origin-cleave change so omitted `surface` becomes overlay **or** overlay can omit `surface` and still speak as overlay (today omit = tray = **more** privilege — tests must lock “C shell always stamps summoner”).
5. New WS message family for “workbench confirm” / “workbench mcp.add”.

Eval: T2, no auto-merge. Independent Trust adversary on the C PR, then Pi rereview. MACHINE must include the ACL deny rows in §3, not only “upload succeeds on Mac.”

---

## 6. Residuals (named; do not widen in C)

- **`isOverlayEligiblePack` empty allow.** `mode:unchanged` + `allow:[]` + no `trust` ⇒ eligible `[inspected]` `overlay-eligible.ts:15–17`. Apply does not *add* L1 tools; it also does not *strip* a thread that already has navigate. Overlay `chat.create` already runs whatever the thread whitelist is. C must not “fix” this by allowing Trust packs. Optional later belt: overlay apply refuses to mutate `tool_whitelist` (spec r2 already wanted this mid-loop; #219 refuses apply entirely while loop live).
- **Cookie tools** (`get_cookies` / `set_cookie`) are not in `DANGEROUS_TOOL`. Out of scope for C.
- **Overlay-bound `originWs` timeout** for L1 confirms triggered from overlay `chat.create` is fail-closed, not a bug to fix by adding confirm UI.
- **#219 drain** (unmerged REJECT) — correctness gate before stacking C on that branch.

---

## 7. P0 slice (C) and explicit non-goals

**P0 (one slice):** Cross-platform L0 summon **shell** (HTML or WKWebView or companion window — one implementation, three OS) that can: talk (`chat.create` / steer / nextRun as already designed), attach via **existing** `file.upload` under §4, apply **overlay-eligible** packs with `allowTrust` forced false. Mac Swift is **adapter** (hotkey / panel chrome) or **frozen**. systray2 no-ops replaced, not painted over.

**Prerequisite (not the direction):** merge #219 after drain fix. Do not start C on the rejected WIP. Do not reopen `allowTrust`.

**Non-goals (explicit):**

- Overlay Allow/Deny, Cockpit, CU HUD, `security.confirmation.response`
- `mcp.add` / MCP management
- `pack.save_user` / install / uninstall / unapply / Trust-B write
- NSOpenPanel-as-product (B); more Swift rail features
- `host_read` attachments; Node fs in renderer
- L2 parity on Linux/Windows; overlay as L2 conductor
- Widening overlay-eligible; meeting **workbench** UI in overlay (composition apply ≠ 会议工作台)
- New runtime / second LLM loop / Electron-as-agent
- Stopping overlay work after #219 (A as destination)

Capability declaration for the C PR (must appear in the PR body):

```text
Surface:      L0
L2-classes:   none
Compose:      pack.apply overlay allowTrust FORCED false; file.upload L0 bytes
Autonomy:     single (existing steer/nextRun)
Trust:        overlay not originWs; not Trust-B writer; lease+conductor on file.upload
Channel:      community; handshake surface=summoner mandatory
```

---

## Findings (direction-level)

| ID | Sev | Claim |
|----|-----|--------|
| T-D1 | P0 direction | Pick **C**. A-stop and B are incoherent with ADR-020 L0 + Channel honesty. `[inspected]` |
| T-D2 | **BLOCK on C PR** | `file.upload` today has no lease, no conductor, and **supersedes**. ACL-add without §4 is overlay aborting panel/L2. `[inspected]` `message-router.ts:598–825` vs `:333–336` |
| T-D3 | **BLOCK on C PR** | Confirm / `mcp.add` / `pack.save_user` / `pack.unapply` / `config.set` must stay ACL-denied. “Workbench” is not a reason to mint a confirm surface. `[inspected]` `summoner-acl.ts` + tests |
| T-D4 | **BLOCK on C PR** | HTML/companion window that omits `surface:"summoner"` is tray = ungated. Shell must stamp summoner; tests must prove omit ≠ overlay. `[inspected]` `summoner-acl.ts:8–9,40` |
| T-D5 | **BLOCK on C PR** | Attachments via Host-Use / Node fs = T3. Bytes on `file.upload` only. `[inspected]` ADR-018 vs `file.upload` payload |
| T-D6 | nit / residual | Overlay-eligible empty allow; overlay `originWs` timeout. Do not “fix” in C. `[inspected]` |

---

The reflection is not wrong. The unsafe/incoherent slices are A-as-stop and B. C is endorsed **only** as an L0 shell + `file.upload` under the deny list and ACL contract above. A C PR that puts Allow/Deny or Trust-B write on overlay is REJECT, not a nit.

DIRECTION: C

VERDICT: APPROVE_WITH_NITS
