# Lane E — Architecture adversarial review (S107 health)

- **Date**: 2026-09-08
- **HEAD**: `4a63de56` (`fix(workspace): 修复听写与代码任务归属，补齐对话分类 (#485)`)
- **Product**: 0.6.6 (docs/architecture.md still banners **0.6.0** / v2.4.8, 2026-09-06)
- **Scope**: module boundaries vs `docs/architecture.md` + ADR-020; god-files; dual SoT; axis violations; WS protocol drift. Read-only except this file.
- **Evidence**: `[inspected]` source + LOC counts; `[assumed]` runtime skip algebra not re-executed this lane.

---

## Verdict

**APPROVE_WITH_MAJORS** — not REJECT.

The composition hole that would trigger REJECT is **not present**:

| Attack | Result |
|--------|--------|
| Builtin / installed Pack writes god-mode | Blocked (`FORBIDDEN_PACK_KEYS` + validator). Overlay `pack.apply` strips `allowTrust`. |
| Pack / MCP / UI skip Surface L2 silently | No. L2 algebra lives in companion `tool/l2-admission.ts`. UI `CapabilityLevel` is a badge, not a gate. MCP critical still force-confirms unless **三旗** cruise. ACP never waived. `terminal.open` always confirms (cruise does not skip). |
| Widen outbound **default** profile (#228 freeze) | No. `OUTBOUND_MCP_ALLOWLIST` remains the 8-tool default; interact / context are **named extra keys**, not default expansion. |

User-origin Pack `trust.skip_l2` **does** write three-flag cruise (`applyUserPackTrust`). That is the documented Trust-B exception (ADR-020 §3.B + phrase step-up), not a silent Pack/MCP/UI bypass. Overlay cannot take that path.

What fails this review is **accretion vs modularization**: one tool-loop still holds, but the WS switch, settings blob, and protocol SoT have outrun the architecture document and the C10 / #321 splits.

---

## Grade

**6.6 / C+**

Calibration (adversarial, not generous):

| Score | Meaning |
|------:|---------|
| 9–10 | Versioned protocol, ≤1 god-file, docs lock-step with modules |
| 8 | Real modules; leftover god-files with shrinking coupling |
| **7** | Gates hold; docs/protocol lag one season |
| **6** | Gates hold; god-files re-inflate; dual SoT on Surface |
| 5 | Composition starting to leak into new runtimes / confirm dialects |
| ≤4 | Pack/MCP/UI can skip L2 or widen outbound default → REJECT |

This tree is a **7 on Axis A (Surface gates)** and a **5 on protocol/docs/god-files**. Weighted **6.6**. A B- would require `PROTOCOL_VERSION` honesty and at least one of `{message-router, SettingsSlideout}` actually shrinking.

---

## Module map

ADR-020: **one** Companion tool-loop. Surface L0→L1→L2; Composition (Pack/Skill/MCP/outbound/ACP) attaches; Autonomy (loop/workers/board) is not a deeper agent.

```
Surface L0  chat (UI badge)     ── Composition: skill/knowledge/pack/mcp/user-env/acp/outbound
Surface L1  CDP / cookies       ── WS → extension peer (l1-actuator)
Surface L2  host/CU/shell/netsec/spawn/ACP/PTY  ── l2-admission + SecurityConfirmationManager
Autonomy    loop / fleet / board
Trust/Channel  cruise 三旗 · capability_profile community|enterprise
```

| Claimed module (docs) | Code SoT | Boundary quality |
|-----------------------|----------|------------------|
| Capability / modules | `companion/src/capability/modules.ts` | **Good.** shell/netsec require `capability_profile=enterprise` on enable. Companion is SoT (`config.ts:366`). |
| Pack | `packs/validator.ts` + `pack-engine.ts` | **Good on builtins.** `FORBIDDEN_PACK_KEYS` (`types.ts:282`) reject auto_approve/god/unattended. Overlay eligibility is **server** SoT (`overlay-eligible.ts:8`). Trust-B is an explicit exception, gated `user_gesture` + `allowTrust` + phrase. |
| Security L2 | `tool/l2-admission.ts` (FREEZE comment L4) | **Good algebra, oversized file.** `L2_GATE_TOOLS` (`:64`) + `host_computer` platform gate. ACP `isAcpL2ForceTool` never waived. |
| MCP inbound | `mcp/dispatch.ts` | **Good.** Offered-catalog gate + critical-cap union; cruise waive is logged. Overlay confirm retargets to extension peer. |
| Outbound MCP | `outbound-mcp/profile.ts` + `facade.ts` | **Good vs #228.** Default 8 tools (`profile.ts:21`). `gateOutboundCall` fail-closed `PROFILE_FORBIDDEN`. Exfil needs grant flag **and** operator HITL. |
| Orchestrator / Board | `orchestrator/` · `board/` | **Coherent.** Spawn remains L2 HITL (in `L2_GATE_TOOLS`). Board is Autonomy, not Composition. |
| Computer / Host | `computer/` · `host-use/{darwin,win,linux}` | **Coherent interface, uneven flesh.** Linux `hostRead` throws `NotImplementedOnPlatform` (`linux/index.ts:4`) — honest. Win host_read Phase-1 Outlook-only. |
| Terminal / PTY | `pty/handler.ts` + ext `terminal/wire.ts` | **Bolted WS family**, not a second runtime. Panel-only; darwin-only; `user_gesture`; L2 confirm **never skipped by cruise** (file header + `requestConfirmation` always). **Missing from architecture.md tree.** |
| 0.7.0 evidence / code-review | `business-evidence/` · `code-review/` | **Bolted onto chat loop** (ADR-020-correct). Scope injected by executor, never from model params (`executor.ts:8–10`). Capture hooks `get_page_text/html` after L1 forward. **Missing from architecture.md tree.** |
| Summoner overlay | `summoner/` · `ws/summoner-acl.ts` · `llm/adapter.ts` `filterToolsForSurface` | **Real L0 gate** — but only for `surface=summoner`, not UI chat badge. Native executors stripped (`adapter.ts:221–227`). |
| Loop | `loop/` | Autonomy overlay; default off. Index-level in architecture.md; independent ADR still missing (doc admits this). |
| ACP | `acp/` | Composition façade, default off. L2 always. UI `SURFACE_BY_TOOL` does **not** list ACP tools. |
| Tray / Host split | `tray/tray-adapter.ts` `detectTrayBackend` | **One interface, two flesh.** darwin-arm64 Swift (HUD, overlay, native pairing/confirm). Else systray2 (Win/Linux/Intel Mac): no HUD, no summoner window, pairing = clipboard. |

**architecture.md drift (module tree `docs/architecture.md:438–467`)**: lists `server.ts` / `message-router.ts` / computer / host-use / packs / capability / mcp / outbound-mcp. Does **not** list `pty/`, `business-evidence/`, `code-review/`, `summoner/`, `loop/`, `acp/`, `site-context/`, `ws/`. §1.5 still says Tool Executor lives in `server.ts` (`architecture.md:161`); C10 moved algebra to `tool/l2-admission.ts` and lifecycle to `ws/lifecycle.ts`. `createToolExecutor` remains an orchestration shell (`server.ts:453`).

---

## God-file table

Physical line counts at HEAD (`Get-Content`.Count). Splits that did **not** reduce coupling are marked.

| File | LOC | Split claim | Coupling after split |
|------|----:|-------------|----------------------|
| `companion/src/message-router.ts` | **5644** | C10 handlers under `message-router/handlers/` (~1.4k extracted) | **Not reduced.** 222 `case "` arms remain in one `handleMessage` switch (`:1011`). New families (`knowledge.graph`, `thread.search`, `terminal.*` via handler, pack distill, outbound grants) landed **in** the switch. Growing: 5565 → 5571 across #453/#468. |
| `chrome-extension/.../SettingsSlideout.tsx` | **4381** | `SettingsPage.tsx` (27 LOC heading wrapper) + section components | **Cosmetic.** Pages are `<section>` chrome; the 4k form/state/cruise/voice/CU still lives in one component. |
| `chrome-extension/.../hooks/useWebSocket.ts` | **2460** | `normalize-config.ts` extracted | **Fan-in god.** Untyped `msg.type` string dispatch; no shared WS union. Not on the original inspect list; it is the extension twin of message-router. |
| `companion/src/llm/adapter.ts` | **2499** | `filterToolsForSurface` is a 7-line summoner filter | Chat-loop still owns tool-call rounds, quarantine, surface filter, propose-required. |
| `chrome-extension/.../ChatView.tsx` | **2300** | Workspace rewrite #470 | Flat (~2288 → 2286). Not shrunk. |
| `companion/src/packs/pack-engine.ts` | **2087** | — | Trust snapshot / apply / restore / user-pack save in one engine. Correct SoT, oversized. |
| `companion/src/tool/l2-admission.ts` | **1922** | C10-B extract from `server.ts` | **Algebra freeze succeeded; file is the new god.** server.ts 1052 is a win. |
| `chrome-extension/.../store/agentStore.tsx` | **1886** | — | Global UI SoT; every new WS family adds actions. |
| `companion/src/computer/executor.ts` | **1687** | — | CU runtime; re-L2 cruise skip at `:680–698`. |
| `companion/src/config.ts` | **1560** | — | Nested `CompanionConfig` SoT. |
| `chrome-extension/.../App.tsx` | **1340** | #321 PR-7 “InputArea 纯搬家”; #470 workspace | **Partial win.** 2395 → 1322 at `d9d22655`, now 1340. **`function InputArea` still starts at `App.tsx:312`** and owns composer/voice/ingest. Hooks (`useComposerMentions`, `useComposerIngest`) were cut out; the component was not. `InputArea.tsx` does not exist. |
| `companion/src/server.ts` | **1052** | C10 H1/H2 | **Actual shrink.** Orchestration shell + `createToolExecutor`. Best C10 outcome. |

**#321 / #470 verdict:** App.tsx coupling to composer **dropped ~1k LOC to hooks**, then **re-grew**. Workspace rewrite did not touch ChatView/SettingsSlideout. InputArea “split” is a naming lie if the success criterion is a separate module.

---

## Findings

### BLOCK

*None.* No Pack/MCP/UI path skips Surface L2 without the documented Trust-B / 三旗 / ADR-021 unattended grant. Outbound default profile is not widened.

### MAJOR

**M1 — Surface L0 is a UI badge, not a companion gate (dual SoT / axis language).**

- Docs: L0 = 「无 CDP tool」 (`architecture.md:15`, ADR-020 §3.A).
- UI: `deriveCapabilityLevel` (`mode-controller.ts:45`) is highest-wins from recent tools + pin. Comment in `surface-by-tool.ts:8`: *“this is UI mode elevation, not companion L2 forceConfirm algebra.”*
- Companion: `filterToolsForSurface` (`adapter.ts:221–227`) strips native executors **only** when `surface === "summoner"`. Panel/tray chat in “L0 聊” still offers CDP tools to the LLM.
- `SURFACE_BY_TOOL` (`surface-by-tool.ts:15`) omits `acp_*`, `terminal.open`, `draft_*`, `code_review_*`. Missing tools **default to L0** (`:64`). ACP is in `L2_GATE_TOOLS` (`l2-admission.ts:80–82`) so a pending ACP confirm **does not** raise the ModeBadge to `computer`.

Not a skip of L2 (companion still confirms). It **is** a dual source of truth that lets the product say “L0” while the catalog is L1. ADR-020 anti-pattern #2 cousin: confirm dialects / badges diverging from the gate table.

**M2 — WS protocol is unversioned accretion.**

- `PROTOCOL_VERSION = 1`, `PROTOCOL_MIN = 1`, `PROTOCOL_MAX = 1` (`protocol.ts:10–16`). Negotiation exists; the number never moved.
- `architecture.md` §1.3 (`:91–113`) lists ~12 families (`chat.*` / `tool.*` / `config.*` / `skill.*` / `thread.*` / `history.*` / `security.confirmation.*` / `system.ping`).
- `message-router.ts` has **222** `case` arms: `ui.command`, `terminal.*` (delegated), `knowledge.graph`, `thread.search`, `composer.lease.*`, `task_loop.*`, `voice.*`, `meeting.*`, `pack.*`, `modules.*`, `outbound_mcp.grants.*`, `acp.*`, `computer.model.*`, …
- ADR-020 §7: new WS message families need ADR or the capability-declaration list. `terminal.*` / `knowledge.graph` / `ui.command` / `thread.search` have specs/issues, **not** an architecture §1.3 update and **not** a protocol bump.
- No shared `WsMessage` union. Extension `useWebSocket.ts` and companion switch are parallel string SoTs. `ui.command` actions are **copied** (`companion/src/ui-command.ts:5` ↔ `chrome-extension/src/background/ui-command.ts:4`, comment: “Duplicate lockstep”). Outbound profiles likewise (`outbound-grants.ts` ↔ `outbound-profiles.ts:1–3`).

**M3 — God-files re-inflate; mechanical splits ≠ decoupling.**

See table. `message-router.ts` remains the composition root. `SettingsSlideout.tsx` is the settings schema UI. `l2-admission.ts` is the security god. Shipping more 0.7.0 tools as extra `case` arms and extra Settings sections will make this worse without a protocol module or page-per-file settings.

**M4 — `terminal.open` is a parallel L2 dialect.**

- Not in `L2_GATE_TOOLS`. Not in `SURFACE_BY_TOOL`.
- Own WS family, own `session.requestConfirmation({ toolName: "terminal.open" })` (`pty/handler.ts:118`). Header claims cruise never skips — true because it does not consult `isFullAutonomyCruise`.
- Darwin-only (`handler.ts:74–81`). Windows gets a closed frame, not a capability module flag.
- ADR-020 anti-pattern #2: new confirm dialect when Confirm Center already exists. Functionally safe; architecturally a second door.

**M5 — 0.7.0 enterprise slices are bolted onto the chat loop (acceptable) but invisible in the architecture tree (not acceptable).**

- `draft_*` / `code_review_*` are LLM tools; scope is executor-owned (`business-evidence/executor.ts:8`, `code-review/executor.ts:6`). Evidence capture is a post-forward hook on L1 page reads (`captureLocalPageResult`). This is **not** a new runtime — ADR-020-correct.
- They still add catalog surface, WS, Settings, and Mission Packs without updating §0 / §1.3 / the src tree. Architecture.md continues to describe 0.6.0.

**M6 — Settings schema vs `config.ts` defaults (flattening dual SoT).**

- Companion SoT is nested: `config.security.auto_approve_dangerous` (`config.ts:512–518`), `capability_profile` (`:478`), `modules` (`:482`).
- Side Panel `LLMConfig` flattens cruise flags onto the LLM object (`types.ts:263–275`, `normalize-config.ts:53–66`). A third copy exists in Pack Trust (`skip_l2` → three flags, `pack-engine.ts:205–213`) and a fourth in autopilot-tier UI.
- Defaults match (all false / community) `[inspected]`. The risk is **write-path confusion**, not a current widen. SettingsSlideout 4381 lines is where a mistaken flatten will ship.

**M7 — Windows vs Darwin tray/host split is coherent as an interface, not as a product surface.**

- `detectTrayBackend` (`tray-adapter.ts:179`): Swift **only** `darwin && arm64`; everyone else systray2.
- `UnifiedTray` optional-chains HUD / summoner / native confirm (`tray-adapter.ts:126–145`). Non-Swift = clipboard pairing + no overlay window.
- Host: darwin AppleScript; win PowerShell subset; linux stub. Computer gated on win32|darwin (`l2-admission.ts:126–128`).
- PTY: darwin only. osascript: macOS-only fail-closed (`:287`).
- This is **one** topology with honest degradation, not a second agent. architecture.md does not spell the Darwin-only overlay/PTY/HUD contract next to the Windows NSIS claim in the banner (`architecture.md:3`).

### MINOR / NITS

- architecture.md banner still **0.6.0** while product is **0.6.6** (`architecture.md:3`). Loop / expert “独立 ADR 待补” still true.
- `skip_l2` name collides with Surface L2. It means “write 三旗 cruise”, not “skip host_computer token.” Overlay + phrase + restore snapshot make it safe; the name invites the hole this lane was hunting.
- `community` profile can still `updateModuleConfig` for shell/netsec **if already enabled** (`modules.ts:155–165`) — documented Side Panel convenience; worth a comment in ADR-014.
- `host_computer` mid-task re-L2 **is** skipped under 三旗 for non-force tags (`computer/executor.ts:680–698`). Initial task L2 is the ADR-017 gate; cruise-as-unattended-lite is product, but it is another Trust packaging path.
- `server.ts` comment block (`:440–451`) is the real C10 contract; architecture.md §1.5 was not updated to match.

---

## Open questions

1. **Should UI `CapabilityLevel=chat` ever filter the LLM catalog** (true L0), or is L0 permanently “quiescent badge”? If the latter, ADR-020 / architecture.md §0 must stop saying 「无 CDP tool」.
2. **Single table for Surface?** Generate `SURFACE_BY_TOOL` from companion `L2_GATE_TOOLS` + CDP catalog, or accept two tables and test lockstep (today: no lockstep test for ACP/terminal).
3. **`PROTOCOL_VERSION`**: bump on new families, or document “v1 = additive string types, never bump”? Current code advertises a version that cannot encode `terminal.*`.
4. **Who owns Settings?** Page-per-file vs keep SettingsSlideout. `SettingsPage` as it stands is not a split.
5. **Windows overlay / PTY**: accepted degradation through 0.7.0, or a Surface-L2 hole in the *product* sense (same binary, missing L2 conductor on Win)? Architecture should say which.
6. **message-router**: continue extracting `handlers/*` per family, or split `handleMessage` into a registry keyed by `type` prefix? Mechanical `import()` of 8 handlers did not stop 5644 LOC.
7. **0.7.0 evidence tools**: stay L0-catalog (no badge elevation) forever? That matches “materials on L1 pages,” but `code_review_*` + PTY report loop already couples L1 capture to L2 shell.

---

## Must-inspect checklist

| Item | Result |
|------|--------|
| ADR-020 vs gates in capability / security / packs / mcp / outbound / orchestrator / board / computer / pty | Gates exist and are companion-side. UI badge is not a gate. |
| God-files + #321 / #470 | App.tsx shrunk then re-grew; InputArea not a file; Settings/ChatView/message-router not shrunk. |
| WS protocol versioning | `PROTOCOL_VERSION=1` forever; 222 router cases; no shared types. |
| Dual SoT Surface / settings | ModeBadge vs L2_GATE_TOOLS; LLMConfig flatten vs CompanionConfig nested. |
| Enterprise 0.7.0 slices | Chat-loop tools + WS, not a new runtime. Tree/docs omit them. |
| Windows vs Darwin tray/host | Unified interface; Swift/PTY/HUD Darwin-only; Linux host stub honest. |

---

*Lane E independent. No product code edited. `[inspected]` unless noted.*
