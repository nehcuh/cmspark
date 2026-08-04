# Architecture Lane

**Range:** `79d7420..d4c4ebf` (tip `d4c4ebf`)  
**Lane:** Architecture (module boundaries, ADR-022 × ADR-020, dual-entry, stdio vs HTTP, Composition export L1, Trust packaging, skill_install gates, SPA scroll placement, docs↔code)  
**Status:** **WATCH**  
**Recommendation:** **APPROVE_WITH_NITS**

| Field | Value |
|-------|--------|
| Evidence | `[inspected]` sources + prior P0c/L8/L9 synthesis; no live bake-off run in this lane |
| Prior | S41 architecture WATCH; outbound P0c APPROVE_WITH_NITS; L8/L9 B1 fixed → Pi APPROVE_WITH_NITS |
| ADRs | [ADR-022](../../adr/022-outbound-mcp-server.md) · [ADR-020](../../adr/020-capability-model-three-axes.md) · [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md) |
| Docs | [docs/mcp.md#outbound-mcp](../../mcp.md) |

---

## Verdict (one screen)

Outbound MCP at tip is a **real Composition export** of curated L1 — not a second product runtime, not default-on, and correctly reuses `createToolExecutor` + tab lease + confirm stack. Module layout under `companion/src/outbound-mcp/` is coherent. L8/L9 B1 (`isToolAllowed` killing synthetic holders) is closed in code. skill_install Trust packaging is **largely closed** vs S41 (L2 forceConfirm, binding payload, content/zip budgets, audit).

**WATCH** because Trust for product ship is still incomplete by ADR-022 design: **`ws_secret` is dual-used as MCP bearer**, **L3+ disclosure is agent-self-accepted with no human gate**, dual process disclosure/invoke paths are dual SoT, and ADR DoD “bind originWs” is intentionally weakened for L8 fan-out. None of these are merge-blockers for **Phase 0 bake-off** if docs stay honest; all become **REQUEST_CHANGES** if anyone claims P1 grant / privacy / Trust-complete ship.

---

## Capability axes (ADR-020) — this tip

| Piece | Surface | Composition | Autonomy | Trust | Channel | Fit |
|-------|---------|-------------|----------|-------|---------|-----|
| Outbound MCP default profile | curated **L1** only | **mcp-server export** (`cmspark__*`) | none (no Board/spawn export) | domain + L2 confirm + server disclosure session; **no** per-caller grant | community | **OK** — not “中层 Agent” |
| Meta tools (`accept_data_disclosure`, `list_outbound_profile`) | — | adoption / session state | none | self-ack only (see F1) | community | partial Trust |
| Dual-entry lease | L1 interactive tabs | — | reuses ADR-015 lease | Side Panel wins | community | **OK** |
| skill_install | L0 durable write | Skills install primitive | none | L2 forceConfirm + allowlist + budgets | community | **OK** post-S41 |
| SPA `scroll` | L1 Extension CDP | not outbound | — | same as other CDP | community | **OK placement** |

**Axis language check:** ADR-020 lists Outbound MCP as Composition export; code comments and `docs/mcp.md` match. No new Agent type, no Mission Board fork, no L2/host/shell/cookies on default profile (`profile.ts`).

---

## Findings

### F1 — L3+ disclosure is **agent-self-accepted**; no human HITL  
**Severity:** Medium-High (Trust packaging / privacy honesty)  
**Where:**

- `companion/src/outbound-mcp/stdio-server.ts:107-145` — `cmspark__accept_data_disclosure` only checks `acknowledge === true`
- `companion/src/outbound-mcp/companion-http.ts:330-343` — `POST /outbound-mcp/v1/disclosure` same rule under Bearer `ws_secret`
- `companion/src/outbound-mcp/disclosure-session.ts:28-42` — pure in-memory map; no tray/Side Panel confirm

**Architecture issue:** ADR-022 L3+ requires that page text/screenshot tools are **data-exfil class** and that disclosure is **Companion session-enforced** (not client flag). Code correctly **ignores** caller `disclosure_accepted` (`facade.ts:23-26,79`) — good. But **accepting** disclosure is still a free MCP/HTTP call by the untrusted coding agent. Net: any holder of `ws_secret` can enable exfil for any `caller_id` without a human seeing the Chinese disclosure string.

**Ask:** Before claiming privacy-aligned ship: require tray/Side Panel (or OS) confirm on first disclosure per caller (or bind to P1 grant UX). Until then, docs must not imply “user accepted cloud exfil.”

---

### F2 — Incomplete Trust story: `ws_secret` dual-used as MCP caller auth (L4+)  
**Severity:** Medium (known P1 debt; architecture dual identity)  
**Where:**

- `companion/src/outbound-mcp/companion-http.ts:4-5,87-95` — Bearer = Extension pairing secret
- `companion/src/outbound-mcp/stdio-server.ts:74-80` — `getOrCreateSharedSecret()` into HTTP dispatcher
- `docs/mcp.md:215` — documents shared `ws_secret`
- ADR-022 L4+ / Decision map: grant **待 P1**; background says `ws_secret ≠ MCP caller auth`

**Architecture issue:** One secret gates Extension↔Companion **and** any loopback process that can POST `/outbound-mcp/v1/invoke`. Phase 0 transport is “stdio only” for **product framing**, but **HTTP is a full second entry surface** for anyone with the secret (stdio is convenience, not the trust boundary). Loopback bind is correct (`server.ts` `httpServer.listen(port, "127.0.0.1")`).

**Ask:** Keep honest “P1 grant required for ship.” Do not market loopback/Bearer as multi-tenant or multi-IDE isolation. Prefer separate outbound grant material from `ws_secret` at P1.

---

### F3 — Dual sources of truth: process-split disclosure + dual invoke stacks  
**Severity:** Medium (layering / operational complexity)  
**Where:**

- Disclosure: `disclosure-session.ts` Map is **per process**. stdio dual-writes accept (`stdio-server.ts:123-130` local + `companionPostDisclosure`). Companion process is execute-time SoT (`companion-http.ts:7-8,162-176`).
- Invoke: `bridge.invokeOutboundTool` (stdio process gate+dispatch) **and** `companionInvokeOutbound` (companion gate+lease+runner) both reimplement gate / exfil re-check / audit (`bridge.ts:53-154`, `companion-http.ts:145-290`).
- Audit: `gateOutboundCall` logs `ok: true` **before** dispatch (`facade.ts:98-105`); dispatch then logs again → multiple lines per call with weak `confirm_outcome`.

**Architecture issue:** Fail-closed if dual-write fails (good). But desync windows, double audit semantics, and two codepaths that must stay lock-step increase drift risk (mid-term ADR “single registry / no dual-write” still open for tool schema; now also for invoke).

**Ask:** Collapse production path to **one** companion-side invoker (HTTP-only gate+lease+audit); treat stdio as thin MCP adapter. Unify audit to one final line with real confirm outcome.

---

### F4 — ADR DoD “bind originWs” vs L8 unbound confirm fan-out  
**Severity:** Low-Medium (spec vs implementation tension)  
**Where:**

- ADR-022 §5.1: outbound `securityConfirmations.request` **must** bind `{ originWs: <mcp-bound or synthetic origin> }`
- `companion/src/outbound-mcp/origin.ts:17-26` — `originWs: null` always; synthetic id never fed into confirm manager
- `companion/src/server.ts:1691-1738` — outbound uses **unbound** confirm (`confirmOriginOpts = undefined`) + fan-out to all authenticated peers + tray + `node-notifier`

**Architecture issue:** L8 product requirement (IDE must not depend on Side Panel focus) **conflicts** with strict origin-binding. Code chose L8 correctly for usability; synthetic origin is dead packaging for confirm binding. Residual: any authenticated peer (tray spoof, second extension) can approve outbound confirms (same class as pre-existing multi-peer risk when unbound).

**Ask:** Amend ADR-022 DoD #1 to “L8: unbound fan-out + tray; originWs reserved for non-outbound / nonce paths” **or** introduce a synthetic origin peer that only tray/global UI may satisfy. Do not leave ADR letter contradicting code.

---

### F5 — Composition export surface quality: empty MCP schemas + allowlist dual-write  
**Severity:** Low-Medium (leaky abstraction / drift)  
**Where:**

- `companion/src/outbound-mcp/stdio-server.ts:52-62,92-99` — `openArgsSchema()` with `additionalProperties: true` and empty `properties` for all tools
- `companion/src/outbound-mcp/profile.ts:7-16,27-30` — separate allowlist + strip-prefix map to internal names
- Catalog SoT remains `bridge/tool-definitions-catalog.json` (not generated from profile)

**Architecture issue:** External agents get no typed args (tabId required only at lease time as runtime error). Rename/remove of internal tools silently breaks map. ADR admits Phase 0 explicit map — acceptable, but composition surface is thinner than inbound MCP tooling.

**Ask:** Mid-term single registry generating internal + `cmspark__*` schemas; short-term document required args per tool in MCP descriptions (especially `tabId`).

---

### F6 — skill_install residual Trust packaging (post-S41)  
**Severity:** Low-Medium (improved; not fully tight)  
**Where:**

- **Closed vs S41:** L2 in `L2_GATE_TOOLS` + forceConfirm (`server.ts:911-912,1363-1370`); token validate (`server.ts:3406-3420`); `bindingPayloadFor` (`security-policy.ts:86-100`); content 256KiB (`skill-install.ts:93,145-150`); zip extract budgets (`skill-engine.ts:828-920`); audit lines (`skill-install.ts:121-131`); dest honesty from engine return.
- **Residual:** Downloads allowlist still **segment** match (`skill-install.ts:65-70`); silent overwrite on re-import (`skill-engine.ts:823`, zip path `856-858`) — now behind L2, but confirm text does not always surface “overwrite existing name”; `use_skill` `loadContent` still returns raw body without prompt-injection sanitizer (`skill-engine.ts:348`).
- **Not exported on outbound** (profile forbid) — Composition boundary correct.

**Ask:** Bind Downloads to known roots; optional overwrite flag in L2 preview; sanitize skill body on load if skills become high-trust system prompt.

---

### F7 — SPA scroll placement (extension CDP vs skill vs outbound) — **correct**  
**Severity:** Info / solid  
**Where:**

- Implementation: `chrome-extension/src/background/browser-bridge.ts` scroll + `spa-scroll-expr.ts` (CDP/SPA scroller pick)
- Catalog: `scroll` is Side Panel L1 tool (`tool-definitions-catalog.json`)
- Outbound: **not** on allowlist; docs explicitly `PROFILE_FORBIDDEN` (`docs/mcp.md:297-299`, `docs/TROUBLESHOOTING.md`)
- Skills: no skill owns browser scroll primitive

**Architecture note:** Scroll stays **Surface L1 / Extension**, not Composition skill and not outbound default export. Long-page outbound path (`navigate` + `get_page_text`) is the intended narrower export. Do **not** add `cmspark__scroll` without reopening L3 bake-off scope and dual-entry lease already covering `scroll` in `TAB_LEASE_TOOLS`.

---

### F8 — Coupling debt: god-file integration still grows  
**Severity:** Low (expected; track)  
**Where:** `companion/src/server.ts` — loopback HTTP route (`161-186`), runner wire (`215-238`, `5603-5610`, `5870-5875`), L9 Side Panel wins (`651-664`), outbound skip whitelist (`666-671`), L8 fan-out/tray/notify (`1599-1731`)

**Architecture note:** Outbound correctly **did not** fork a parallel executor, but `createToolExecutor` remains the integration nexus. Prefer extracting outbound confirm/lease hooks later; do not grow a second CDP stack.

---

### F9 — Mid-flight Side Panel wins vs outbound CDP (design residual)  
**Severity:** Low  
**Where:** `dual-entry.ts:134-158` — `forceReleaseTab(..., { hasPending: false })`  
Prior L8/L9 adversary N2: Side Panel can start parallel CDP while outbound navigate/wait_for still in flight. Acceptable “Side Panel wins” semantics for Phase 0; bake-off metrics should treat rare thrash as known.

---

## Solid

1. **ADR-020 axis fit:** Outbound = Composition export of L1; skill_install = Composition write primitive; no “中层 Agent” runtime.  
2. **Fail-closed profile:** `profile.ts` allowlist-only; cookies / evaluate / host / shell / netsec / skill_install forbidden by omission.  
3. **Server-side disclosure flag ignore:** `facade.ts` deprecates client `disclosure_accepted` — correct L3+ direction (accept path still weak — F1).  
4. **Process topology:** stdio MCP **opt-in only** (`index.ts:346-351`); daemon/start do not auto-spawn; loopback-only HTTP.  
5. **True bridge reuses one executor:** `ensureOutboundToolRunnerWired` → `createToolExecutor(extensionWs)` — not a second CDP runtime; prefers `chrome-extension://` over tray (`server.ts:194-207`).  
6. **L9 dual-entry:** explicit `tabId`, holder `outbound_mcp:<caller>`, Side Panel force-release, structured `queue_disclosure_zh`; multi-agent cap 2 reused. B1 fix (`!isOutboundMcpCall` around ThreadManager whitelist) preserves synthetic holder without fake ThreadManager threads.  
7. **L8 shape:** tray-eligible + multi-panel fan-out + OS notify + `OUTBOUND_CONFIRM_REQUIRED` mapping (tightened regex post-adversary).  
8. **skill_install gates:** L2 + binding + budgets + audit align code with `SKILL_INSTALL_CAPABILITY` declaration.  
9. **Docs alignment (mostly):** `docs/mcp.md` outbound section matches profile tools, non-default-on, Bearer path, L8/L9 behavior, scroll exclusion; ADR implementation map marks grant as **待 P1**.  
10. **Inbound stack untouched:** `companion/src/mcp/` remains client; no re-export of inbound tools through outbound façade.

---

## ADR / Trust alignment notes

| ADR-022 lock | Code tip | Note |
|--------------|----------|------|
| L1 no all-in Browser MCP without Phase 0 | curated 8 tools | OK |
| L2 Composition export only | façade + createToolExecutor | OK |
| L3 curated L1; no cookies/eval/L2/shell | profile allowlist | OK |
| L3+ exfil disclosure session | server Map + ignore client flag | **partial** — accept is self-serve (F1) |
| L4 never “from MCP ⇒ allow” | same securityConfirmations path | OK (no confirm-skip) |
| L4+ grant ≠ loopback | Bearer `ws_secret` | **deferred P1** (F2); honest in ADR |
| L5 Skill adoption only; `cmspark__*` | no skill-as-browser-service; naming OK | OK |
| L8 confirm without Side Panel focus | tray + fan-out + notify | **shape OK**; tray-less = fail-closed to panel |
| L9 dual-entry lease; Side Panel wins | dual-entry + server hook | OK post-B1 |
| Phase 0 stdio only / not default-on | CLI opt-in; HTTP internal bridge | **nuance** (F2/F3) |
| DoD originWs bind | unbound for outbound | **spec drift** (F4) |
| Single tool registry | explicit map | debt (F5) |

**skill_install vs ADR-020 Trust monotonicity:** S41 issue (ungated durable write looser than host_read) is addressed with L2 forceConfirm that god-mode cannot skip. Residual allowlist/overwrite nits do not re-open “Composition as free L0 write.”

**SPA scroll:** Placement matches Surface L1; keeping it out of default outbound profile is correct Trust/narrow-export discipline for Phase 0 bake-off.

---

## Recommendation detail

| Claim | Allowed? |
|-------|----------|
| Merge P0c + L8/L9 code path for human bake-off | **YES** (APPROVE_WITH_NITS) |
| “Composition export L1, not second runtime” | **YES** |
| Product ship / default-on / CWS | **NO** |
| Trust-complete MCP-caller auth (grant) | **NO** — P1 |
| “User accepted data disclosure” privacy narrative | **NO** until F1 HITL |
| skill_install Trust-complete marketing | **Mostly yes** for L2 path; note F6 residuals |

**Nits to track (non-blocking for Phase 0):**

1. F1 disclosure HITL (or explicit “agent-ack only” doc language)  
2. F4 ADR DoD #1 amend vs L8  
3. F3 single invoker + single audit line  
4. F5 schema generation / tabId in tool descriptions  
5. F6 Downloads root + overwrite preview  
6. Integration residual: mid-flight Side Panel wins (F9)

---

## Top findings (quick index)

| ID | Sev | One-liner | file:line |
|----|-----|-----------|-----------|
| F1 | Med-High | Exfil disclosure self-accepted by MCP agent | `stdio-server.ts:107-145`, `companion-http.ts:330-343` |
| F2 | Med | `ws_secret` = Extension + MCP bearer (grant still P1) | `companion-http.ts:87-95`, `stdio-server.ts:74-80` |
| F3 | Med | Dual process disclosure + dual invoke/audit stacks | `disclosure-session.ts`, `bridge.ts`, `companion-http.ts` |
| F4 | Low-Med | originWs DoD vs L8 unbound fan-out | `origin.ts:17-26`, `server.ts:1691-1738` |
| F5 | Low-Med | Empty MCP schemas + profile/catalog dual-write | `stdio-server.ts:52-62`, `profile.ts:7-30` |
| F6 | Low-Med | skill_install segment Downloads + silent overwrite residual | `skill-install.ts:65-70`, `skill-engine.ts:823,856-858` |

---

*Architecture lane S42 · WATCH · APPROVE_WITH_NITS for Phase 0 bake-off path · not Trust-complete ship.*
