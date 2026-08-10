# Multi-adversarial deep review — project health (multi-level × multi-dimension)

**Date:** 2026-08-10  
**Tip:** `5c64604` (`origin/main`, product **0.5.0** cut + #160 unattended silence + #161 Windows voice/shell token)  
**Method:** Five **independent read-only** explore agents + orchestrator spot-check of HIGH findings  
**Lanes:** Security · Architecture · Correctness · Product-UX · Docs-Compat  
**Scope:** Full product surface (not only recent PR range). Local dirty tree (`run-esbuild-bundle.mjs`, `host-integrity.ts`) noted but not treated as main tip.  
**Prior same-day tip review:** [`multi-adversarial-main-tip-20260810.md`](./multi-adversarial-main-tip-20260810.md) (4-lens, packaging install focus) — this report **supersedes** for project-wide priority; tip-review residuals still apply.

**Routing note:** `vibe route` suggested `omx/team` (tmux impl orchestration). **Override** → repo post-ship multi-lane pattern (`memory/project-knowledge.md` · multi-adversarial-then-dual-then-ci-merge).

---

## Executive synthesis

| Lane | Verdict | Grade | Confidence |
|------|---------|-------|------------|
| Security | **REQUEST_CHANGES** | B− | 0.82 |
| Architecture | **REQUEST_CHANGES** | C+ | 0.82 |
| Correctness | **REQUEST_CHANGES** | C+ | 0.84 |
| Product-UX | **REQUEST_CHANGES** | D+ | 0.82 |
| Docs-Compat | **REQUEST_CHANGES** | D+ | 0.86 |
| **Orchestrator final** | **REQUEST_CHANGES** | **C+** | **0.84** |

### One-line judgment

**No consensus Security-P0 unauthenticated remote compromise.**  
Ship for **macOS arm64 personal / Windows zip personal** remains **conditional YES** — with eyes open on armed 值守 residuals.  
**Do not promote** unattended / enterprise / Pack-Trust as “safe autopilot” marketing until honesty + dual-clock + worker isolation residuals land.

### Cross-cutting themes (deduped)

1. **Dual Trust clocks** — process-memory unattended grant vs durable `auto_approve_*` dual-write; restart/TTL clear grant but not cruise.  
2. **Silence looks like safety** — Confirm Center empty + 急停 without “值守仍开” toast.  
3. **Token bind ≠ execute** — shell cwd / netsec ports expand after approve.  
4. **Multi-table lock-step** — WS validators ↔ router ↔ extension SW; tool catalog ↔ schemas ↔ bridge.  
5. **Stale SoT trains wrong security** — Aug-02 design (re-L2 still confirm) vs ADR-021 silence; mcp.md `require_grant=false`; CU “config only”.  
6. **NEW (this pass):** Worker `HARD_DENY` is spawn-time only; `thread.update` can rewrite `tool_whitelist`.  
7. **NEW (this pass):** Pack `trust.skip_l2` writes three-flag cruise **without** Settings phrase step-up → durable host_computer/evaluate forceConfirm waive path.

---

## Consensus findings (deduped)

Severity legend:

| Tag | Meaning |
|-----|---------|
| **Sec-P0** | Unauth / remote compromise or unintended privilege without user arming |
| **Prod-P0** | User will mis-arm or misread residual risk under intended features |
| **Struct-P0** | Structural collapse / evolvability blocker (not remote exploit) |
| **P1** | Real hole, residual bypass of user intent, or high-cost drift |
| **P2** | Nit / residual / deferred debt |

### Prod-P0 / Sec-P1 — fix-before-promote (unattended & Trust marketing)

| ID | Sev | Title | Lenses | Evidence [inspected] | Fix sketch |
|----|-----|-------|--------|----------------------|------------|
| **C1** | Prod-P0 / Sec-P1 | **Unattended dual-write cruise sticks across restart/TTL; grant does not** | Sec, Arch, Corr, UX | `message-router.ts` arm → `saveConfig` three flags; `unattended-grant.ts` process-memory; disarm cruise only if `clear_cruise===true`; TTL nulls grant only | (A) expire/disarm always restore pre-arm snapshot, or (B) stop dual-write; UI one-shot “桌面值守已失效，巡航仍开” |
| **C2** | Prod-P0 | **急停 ≠ 解除：docs require toast; UI missing** | UX, Docs | ADR-021 §5; design SoT; `SafetyStrip`/`CockpitApp` only `computer.task.abort` →「已急停…」 | Abort ack while armed → mandatory toast「任务已停 · **值守仍开** · 点解除」 |
| **C3** | Prod-P0 | **Confirm Center empty during 值守 = “safe idle”** | UX | Cockpit emptyGuide no unattended strings; reL2 silence in `executor.ts` | Permanent banner when `unattended.armed` |
| **C4** | Prod-P0 | **Matrix claims evaluate skip under default 值守; code still forceConfirms** | UX, Docs, Corr | `autopilot-tier.ts` row evaluate/导航 → unattended「跳过」; tests: evaluate forceConfirm unless **three-flag** | Split evaluate vs navigate in matrix; lock UI copy to three-flag algebra |
| **C5** | Sec-P1 / Prod-P0 | **Pack Trust `skip_l2` → three-flag cruise without Settings phrase** | UX, Sec, Docs | `pack-engine.ts` `applyUserPackTrust`; PacksPanel `window.confirm` only; unattended keys forbidden in YAML but Trust flags open | Phrase step-up on pack Trust; or forbid skip_l2 from writing allow_all_schemes; UI “≠ 无人值守武装” |
| **C6** | Sec-P1 | **Worker HARD_DENY spawn-only; `thread.update` can elevate whitelist** | Corr, Arch | `computeWorkerWhitelist` at spawn; `message-router` `thread.update` allows `tool_whitelist` with **no** agent_role re-filter; `isToolAllowed` no HARD_DENY re-check; `mcp__*` always allowed | Re-apply HARD_DENY in `isToolAllowed` for workers; reject elevating `thread.update` for `agent_role=worker` |

### P1 — correctness / protocol / SoT

| ID | Sev | Title | Lenses | Evidence | Fix sketch |
|----|-----|-------|--------|----------|------------|
| **C7** | P1 | shell_exec: bind cwd ≠ execute cwd; L2 preview is command-only | Sec, Corr | `bindingPayloadFor` cwd\|\|working_directory; execute `params.cwd \|\| workspace_root \|\| process.cwd()` | Normalize absolute effective cwd **before** issueToken + preview |
| **C8** | P1 | netsec: bind ports `[]` then execute expands COMMON_PORTS | Corr | `security-policy` ports=[]; execute fallback COMMON_PORTS | Normalize ports before bind; show in L2 preview |
| **C9** | P1 | WS dual tables + test fail-open default → production “Companion dead” class | Arch, Corr | validators in `server.ts` ~5.5k–6.4k; router switch; SW cases; `NODE_ENV=test` unknown types pass | Registry SoT + CI `router ⊆ validators`; test default fail-closed |
| **C10** | Struct-P0 | `server.ts` (~7.4k) + `message-router.ts` (~3.7k) god-files | Arch | Multi BC: auth, L2 algebra, tool dispatch, MCP, CU | Split ingress / admission / dispatch; freeze new cases |
| **C11** | P1 | Surface UI tool class tables miss shell/netsec/browser tools | Arch | `mode-controller.ts` COMPUTER_CLASS_TOOLS incomplete | Single `SURFACE_BY_TOOL` shared table |
| **C12** | P1 | security-gates false-green: `force_confirm \|\| Array.isArray(critical_apis)` | Corr | wire has `critical_apis` not `force_confirm` | Assert `risk_level` / `auto_confirm_eligible` / critical list only |
| **C13** | P1 | Stale SoT: Aug-02 unattended/Trust IA “re-L2 still confirm” vs ADR-021 silence | Docs, UX, Arch | design LOCKED for M1; ADR-021 2026-08-09 revision | SUPERSEDED banners; impl plan acceptance rewrite |
| **C14** | P1 | `docs/mcp.md` trains `require_grant=false` + ws_secret; code default **true** | Docs, Sec | `config.ts` default true; mcp.md ~249 | Fix user guide + GOAL already correct |
| **C15** | P1 | CU enable path docs “config only / 只读镜像”; AppsPanel toggles `computer.set_enabled` | Docs, UX | AppsPanel; ADR-017 D2/D9; CU guide §3 0.3.0 | Update ADR-017 + guides + architecture §9 |
| **C16** | P1 | Unattended re-L2 full silence incl. danger; windowLevel hard → silent approve | Sec, Corr | `executor.ts` armed short-circuit; hard-deny only region payment / credential type | Document residual; optional keep forceInteractive for danger_detected; tests |

### P2 — selected nits

- Token `threadId` default `"default"` at issue/validate  
- eTLD multi-tenant wildcards residual (`*.azurewebsites.net`)  
- page-sanitizer ~11 literal patterns (not a hard boundary)  
- Whisper pins: darwin-arm64 + win-x64 only; linux/darwin-x64 fail-closed  
- CHANGELOG frozen at 0.5.0-08-08; omits #160/#161 tip ships  
- Memory tip lag (`57bad96` vs `5c64604`)  
- AGENTS.md dead `session-lifecycle.md` / wrong skills path  
- Packaging: esbuild spawn via node (local uncommitted fix)  
- Outbound MCP skip pack whitelist intentional but cognitive load  
- privacy_ack_v2 wire-only (local trust model OK)

### No Sec-P0

Unauthenticated loopback control plane: WS handshake fail-closed, AUTH_TIMEOUT, pre-auth message gate, Origin + HMAC — **[inspected]** across Security lane + prior #159/#160 work.  
Armed unattended danger silence is **product-accepted residual** (ADR-021), not an accidental hole — honesty gap remains Prod-P0.

---

## What landed well (keep)

| Area | Strength |
|------|----------|
| Topology | Extension = CDP/Surface; Companion = LLM/state/security (ADR-001) |
| L2 algebra core | evaluate/osascript forceConfirm unless three-flag; cookie ≠ cruise domain |
| Token SoT | `bindingPayloadFor` unified issue/validate; LLM-supplied tokens stripped |
| #160 | Unattended initial + re-L2 silence matches revised ADR-021; hard deny still throws |
| #161 | shell/netsec `validateTokenFor` matches issue binding shape |
| WS prod | Unknown types fail-closed outside test/dev |
| Outbound default | `require_grant: true` in code (docs lag only) |
| Pack | Unattended arm keys forbidden in pack YAML |
| Voice | privacy_ack_v2 on wire; whisper unpinned fail-closed; SEA sidecar discipline |
| Stream isolation | `shouldApplyStreamEvent` fail-closed; upload_error clears mapBusy |

---

## Lane digests (abbrev)

### Security (B−, REQUEST_CHANGES)
- Strong: auth fail-closed, L2 forceConfirm core, token binding, confirm response injection guards, path sandboxes, outbound grant default.  
- Weak: dual-write cruise, re-L2 residual under arm, shell cwd preview, osascript no-token residual, thin page sanitizer.

### Architecture (C+, REQUEST_CHANGES)
- ADR-020 model is A-grade on paper; implementation is multi-table mudball.  
- Highest leverage: WS registry+CI lockstep, unattended/cruise lifecycle contract, then split server admission.

### Correctness (C+, REQUEST_CHANGES)
- Highest new: worker whitelist elevation via `thread.update`; shell/netsec pre-normalize; false-green forceConfirm OR; dual-write.

### Product-UX (D+, REQUEST_CHANGES)
- Settings arm copy is among the **best** honesty surfaces.  
- Matrix/docs/empty-cockpit/estop actively **under-surface residual risk**.  
- Pack Trust is a silent alternate god-mode path.

### Docs-Compat (D+, REQUEST_CHANGES)
- Highest ops harm: mcp.md inverted require_grant; CU config-only cluster; Aug-02 re-L2 still-confirm LOCKED design; architecture conflates auto_approve with 无人值守.

---

## Orchestrator spot-checks [executed reads]

| Claim | Result |
|-------|--------|
| Dual-write on arm | **Confirmed** — `message-router` unattended.arm `saveConfig` flags |
| `thread.update` allows `tool_whitelist` without HARD_DENY | **Confirmed** — `message-router.ts` ~1763–1787; `isToolAllowed` no deny set |
| Pack `skip_l2` → three flags | **Confirmed** — `applyUserPackTrust` lines 164–182 |
| Matrix evaluate skip vs three-flag | **Confirmed** — `autopilot-tier.ts` + security-gates test |
| forceConfirm OR false-green | **Confirmed** — `security-gates.test.ts` ~771 |
| mcp.md require_grant=false | **Confirmed** — `docs/mcp.md` ~249 |
| Estop toast missing | **Confirmed** — SafetyStrip/Cockpit abort only |
| God-file sizes | **Confirmed** — server 7421 / router 3773 LOC |

---

## Recommended next work (priority)

### Wave 0 — honesty (1–2 days, no algebra change)

1. 急停 toast + Cockpit/emptyGuide 值守 banner  
2. Fix `autopilot-tier` evaluate vs navigate; Settings browser hint  
3. SUPERSEDED banners on Aug-02 unattended + Trust IA re-L2 rows  
4. Fix `docs/mcp.md` require_grant default; CU guide + ADR-017 Apps toggle  
5. PacksPanel Trust copy: phrase parity or explicit “≠ 无人值守 / 会写三旗”

### Wave 1 — security residuals (3–5 days)

6. Worker: re-HARD_DENY in `isToolAllowed` + block elevating `thread.update`  
7. Unattended: default clear_cruise on disarm **or** snapshot restore on TTL/restart  
8. shell_exec / netsec: normalize bind payload = execute payload before L2  
9. Kill security-gates `force_confirm \|\| Array.isArray` false-green  
10. Executor unattended reL2 silence unit tests

### Wave 2 — structure (multi-PR)

11. WS message registry + CI lockstep (router ⊆ validators ⊆ SW)  
12. Extract `decideToolAdmission` pure matrix from `createToolExecutor`  
13. Split server/message-router by family (freeze growth first)  
14. `SURFACE_BY_TOOL` single table for UI + catalog  
15. CHANGELOG Unreleased for #160/#161; whisper multi-arch pins when ready

### Ship checklist (personal reinstall — residual)

- [x] main tip `5c64604`  
- [ ] Operator: arm 值守 with eyes open; estop; confirm grant still on; disarm clear_cruise  
- [ ] Operator: god-mode alone still prompts evaluate / host_computer  
- [ ] Operator: pack Trust skip_l2 awareness  
- [ ] Commit packaging esbuild fix if intentional  
- [ ] Dual-review before any Wave 1 merge to main (instinct multi-adversarial-then-dual)

---

## Grades by product axis (orthogonal to lanes)

| Axis | Grade | Note |
|------|-------|------|
| Surface L0–L1 browser agent | **B+** | Core loop mature; dual-table drift is main tax |
| Surface L2 host/CU/shell | **B−** | Algebra strong; honesty + dual-clock weak |
| Composition Pack/MCP/skills | **B** | Pack Trust step-up gap; outbound code > docs |
| Autonomy multi-agent/board | **C+** | Spawn HARD_DENY good; runtime re-enforce missing |
| Voice/meeting 0.5.0 | **B** | Pins incomplete multi-arch; privacy gates solid |
| Docs / agent-facing SoT | **D+** | Multiple live contradictions train wrong fixes |
| Test / CI as safety net | **C** | Partial coverage; known false-green; WS not lockstep |
| Packaging (Mac/Win) | **B−** | Ships; esbuild spawn bug local; Linux not first-class |

---

## Final verdict

```
VERDICT: REQUEST_CHANGES
SHIP_PERSONAL_MAC_WIN: CONDITIONAL_YES
SHIP_UNATTENDED_MARKETING: NO
SHIP_ENTERPRISE_CLAIMS: NO until C1,C5,C6,C7,C8 closed or re-spec'd
SECURITY_P0_REMOTE: NONE
```

*Generated from five parallel independent adversarial explore agents (Security / Architecture / Correctness / Product-UX / Docs-Compat) + orchestrator [inspected] spot-checks. No live armed-desktop e2e this pass. Evidence tags per lane digests above.*
