# Multi-Adversarial Code Review — main S46 pull (#125 · skill_install home · MCP cruise · user-scene Trust B)

**Date**: 2026-08-06  
**Range**: `474df7e..6d2cdcf` (after `git pull --ff-only origin main`)  
**Base**: `474df7e` (docs: S44 handoff — prior multi-lane tip)  
**Tip**: `6d2cdcf` (`docs(memory): S46 handoff — skill_install home, MCP cruise, scene Trust B`)  
**Method**: 4 independent adversarial lanes in parallel (Security / Correctness / Architecture / Compat)  
**Orchestrator**: Grok Build · post-ship multi-lane pattern (`memory/project-knowledge.md`)  
**Diff artifacts**:
- [`s46-main-pull-diff-20260806.patch`](s46-main-pull-diff-20260806.patch)
- [`s46-main-pull-diff-stat-20260806.txt`](s46-main-pull-diff-stat-20260806.txt)

**Lane reports**:
- [`s46-lane-security-20260806.md`](s46-lane-security-20260806.md)
- [`s46-lane-correctness-20260806.md`](s46-lane-correctness-20260806.md)
- [`s46-lane-architecture-20260806.md`](s46-lane-architecture-20260806.md)
- [`s46-lane-compat-20260806.md`](s46-lane-compat-20260806.md)

**Prior reviews in range** (re-verified, not re-litigated when tip holds):
- S45 multi-lane REQUEST_CHANGES → PR #125 upload isolation + scoped fleet stop — **LIVE tip holds** `[inspected]`
- Dual external for user-scene tools design / MCP cruise+scroll — product intent documented; this review is **post-ship code**

---

## Lane verdicts

| Lane | Status | Recommendation |
|------|--------|----------------|
| Security | WATCH | **REQUEST_CHANGES** |
| Correctness | WATCH | **REQUEST_CHANGES** |
| Architecture | WATCH | **REQUEST_CHANGES** |
| Compat/Platform | WATCH | **REQUEST_CHANGES** |

---

## Final synthesis

| Field | Value |
|-------|--------|
| **Architectural status** | WATCH |
| **Internal multi-lane** | **REQUEST_CHANGES** |
| **Merge-ready (code already on main)?** | **YES for** #125 P0 floors, skill_install `user_home`+L2, MCP three-flag cruise waive, user-scene tools.mode + MCP orthogonal, AI generate/optimize (candidate-only) |
| | **NO for treating Trust B as complete** — restore lifecycle incomplete; install can spoof `origin:user`+`trust`; spawn_worker can apply Trust without dedicated consent |
| **Product ship / default-on?** | Trust B is on main for `origin=user` packs — **must fix restore/spawn/install gates** before marketing as safe “exit scene restores config” |
| **Bake-off note** | Pair extension↔companion for pack Trust fields + list UI that surfaces Trust risk |

### Deterministic merge gate

- Architect ≠ CLEAR (REQUEST_CHANGES)  
- Security HIGH (sticky cruise after uninstall/switch; install spoof) **CONFIRMED** → multi-lane **REQUEST_CHANGES**  
- Correctness HIGH (apply failure / switch rollback) **CONFIRMED**  
- Compat HIGH (crash mid-apply / uninstall drop cookie) same root class  
- Non-Trust themes (MCP algebra, skill_install home, S45 upload, fleet stop, versions 0.4.0) do **not** block on their own

### Evidence levels

- Lanes: primarily `[inspected]` patch + live tip  
- Orchestrator re-check (this session):
  - `restoreSnapshot` nulls `mission_pack_trust_snapshot` **without** `restoreTrustSnapshot` — **CONFIRMED** `[inspected]` `pack-engine.ts:904-918`
  - `uninstallPack` only `restoreSnapshot` — **CONFIRMED** `[inspected]` `pack-engine.ts:1160-1197`
  - `unapplyPack` restores trust — **CONFIRMED** `[inspected]` `pack-engine.ts:1121-1141`
  - Switch trust→non-trust: `trustSnap` stays null → patch writes `mission_pack_trust_snapshot: null` while globals stay — **CONFIRMED** `[inspected]` `pack-engine.ts:950-1084`
  - Trust applied **before** `installAssetsFromValidated`; asset fail returns without restore — **CONFIRMED** `[inspected]` `pack-engine.ts:972-1037`
  - `installPackFromDirectory` does not force `origin=installed` or strip `trust` — **CONFIRMED** `[inspected]` `pack-engine.ts:749-784`; validator allows trust when `origin===user` `validator.ts:256-275`
  - `spawn_worker` → `applyPack` with comment “never elevates … modules” — **FALSE under Trust B** `[inspected]` `server.ts:3193-3202`
  - UI: high-risk tool toggle still says “场景不能跳过确认”; save+apply has Trust confirm, but product copy conflicts when `trust.skip_l2` — **CONFIRMED** `[inspected]` `PacksPanel.tsx:522-524`, `610-613`
  - MCP cruise waive three-flag only — **CONFIRMED** `[inspected]` `server.ts:4687-4703`
  - S45 upload: mapBusy always clear + chrome gated — **CONFIRMED** `[inspected]` `useWebSocket.ts:1180-1185`
  - Versions 0.4.0 aligned (plasmo + both packages) — **CONFIRMED** `[inspected]`
  - Targeted tests: skill-install + packs-engine + file-parser-safe-name — **28 pass / 0 fail** `[executed]`
  - Note: packs-engine tests cover **unapply** Trust restore happy path only; **no** uninstall/switch/mid-apply-fail polarity

---

## Scope (production themes in range)

| Theme | Commits / notes |
|-------|-----------------|
| #125 S45 P0 | `93b64ce` / `7c8ec53` — upload thread isolation + scoped `fleet.stop_all` |
| skill_install home | `a054121` — `user_home` tier + L2; system paths denied |
| MCP cruise + scroll | `1b294fe` — three-flag waive MCP critical; ChatView stick |
| User-scene tools / AI | `9e7c02b` — tools.mode allowlist; AI generate/optimize; MCP ⊥ whitelist |
| Trust B | `b247fcf` — `skip_l2` / modules / auto_approve on user pack apply + snapshot |
| Docs/memory | S45/S46 handoffs; prior dual-review artifacts |

---

## P0 — must address (HIGH, multi-lane agreement)

### 1. Trust restore incomplete on uninstall / delete / pack-switch → sticky full-autonomy cruise

- **Status**: **OPEN** `[inspected]`  
- **Lanes**: Security F1 · Correctness F2 · Architecture F1 · Compat F2/F3  
- **Where**:
  - `restoreSnapshot` clears cookie without restore (`pack-engine.ts:904-918`)
  - `uninstallPack` / `deleteUserPack` never call `restoreTrustSnapshot` (`:1160-1197`, `:713-732`)
  - A→B switch when B has no trust: patch sets `mission_pack_trust_snapshot: null` while globals from A remain (`:950-1084`)
- **Impact**: User applies origin=user scene with `skip_l2` → three-flag cruise ON. Leave via **删除场景** / **切换无 trust 场景** (not explicit “退出场景”) → cruise **stays on**. Waives shell / skill_install / critical MCP / evaluate forceConfirm. Product claim “退出场景会尽量恢复” is **false** on those paths.
- **Fix**:
  1. Before nulling `mission_pack_trust_snapshot`, always `restoreTrustSnapshot` when present.
  2. `uninstallPack`: for each thread on pack, restore trust (or process-level refcount — see residual).
  3. On switch: restore departing pack’s snap **before** applying B (or only overwrite snap after restore).
  4. Tests: apply trust → uninstall; apply A(trust) → apply B(no trust); assert flags restored.

### 2. Mid-apply failure after Trust write leaves cruise without cookie

- **Status**: **OPEN** `[inspected]`  
- **Lanes**: Correctness F1 · Compat F1  
- **Where**: `applyUserPackTrust` at `:972` then `installAssetsFromValidated` catch returns at `:1035-1037` **without** restore; crash between saveConfig and `applyPackPatch` leaves no `mission_pack_trust_snapshot`  
- **Impact**: Failed apply can leave three-flag cruise with **no** unapply handle.  
- **Fix**: On any post-trust failure path call `restoreTrustSnapshot`; consider write-ahead journal / boot reconcile for orphan cruise; or apply trust **only after** assets succeed (and still gate modules first via staged enable).

### 3. Install path honors self-declared `origin:user` + `trust` (spoof)

- **Status**: **OPEN** `[inspected]`  
- **Lanes**: Security F2  
- **Where**: `installPackFromDirectory` / zip (`:749-784`); `validator` allows trust when `origin===user` (`validator.ts:256-275`); `resolvePackOrigin` trusts manifest  
- **Impact**: Third-party zip/dir can plant “user scene” that on apply writes full cruise + enables shell/netsec. `saveUserPack` correctly hardcodes origin server-side; install does not.  
- **Fix**: On install: force `origin: "installed"` (or strip origin) and **strip `trust`** before write; only `saveUserPack` may persist trust. Reject install of packs declaring trust keys.

### 4. `spawn_worker` + `applyPack` elevates Trust without dedicated Trust consent

- **Status**: **OPEN** `[inspected]`  
- **Lanes**: Architecture F6  
- **Where**: `server.ts:3193-3202` — comment “never elevates capability_profile / modules” is **false** under Trust B  
- **Impact**: Spawn L2 ≠ “write global auto_approve”. Worker pack_id can silently raise process-wide cruise.  
- **Fix**: `applyPack(..., { allowTrust: false })` default for spawn/tool paths; `allowTrust: true` only on UI `pack.apply` with `user_gesture`. Or refuse Trust-writing packs on spawn.

---

## P1 — strong (same micro-PR preferred)

### 5. Control-plane honesty / list-apply Trust disclosure

- **Status**: OPEN  
- **Lanes**: Security F3 · Architecture F3  
- High-risk tool toggle: “场景不能跳过确认” while Trust B can skip L2 for those tools under three-flag.  
- List-apply path: no Trust risk in modal; `PackListItem` has no trust summary field. Save+apply has `window.confirm` — good but incomplete.  
- **Fix**: Honest copy; list badge “会写全局安全配置”; list-apply confirm when pack has trust.

### 6. ADR / architecture.md drift

- **Status**: OPEN  
- **Lanes**: Architecture F2  
- ADR-020 / architecture still absolute-forbid Pack auto_approve; only ADR-014 footnote + usage docs describe Trust B.  
- **Fix**: Amend ADR-020 rule with `origin=user` exception + restore lifecycle; update architecture.md §0/§10.

### 7. Multi-thread shared global Trust (refcount missing)

- **Status**: OPEN residual  
- **Lanes**: Architecture F4 · Compat  
- Two threads with different trust packs / one unapply restores to pre-A while B still “owns” elevation.  
- **Fix**: Process-level holder refcount or “last writer” policy with explicit UI; document single-holder constraint short-term.

---

## Holds (positives — do not re-break)

| Theme | Status | Evidence |
|-------|--------|----------|
| #125 upload isolation | **FIXED / HOLDS** | mapBusy always clear by upload tid; chrome + ADD_MESSAGE gated (`useWebSocket.ts:1180+`); SW/App paths stamp tid |
| #125 fleet stop scope | **FIXED / HOLDS** | `buildFleetStopAllMessage` run/parent stamps; companion filters |
| MCP cruise waive | **HOLDS** | three-flag only; god-mode/enterprise alone still confirm (`server.ts:4687-4703`) |
| skill_install user_home | **HOLDS** | realpath home; L2+forceConfirm; system denied; tests pass |
| tools.mode + MCP orthogonal | **HOLDS** | adapter filters native only; `mcp__*` not fenced by pack allowlist |
| AI generate/optimize | **HOLDS** | candidate/suggest only; no silent pack write without save |
| Trust B **happy path** unapply | **HOLDS** | test + `unapplyPack` restore |
| Version 0.4.0 alignment | **HOLDS** | plasmo + extension + companion |
| safeUploadBasename | **HOLDS** | tests pass |

---

## Recommended follow-up batch (minimal ship gate)

**Branch suggestion**: `fix/s46-trust-b-restore-lifecycle`

1. **P0-1** restore on uninstall / delete / switch  
2. **P0-2** restore on all post-trust apply failure paths  
3. **P0-3** install strip origin/trust  
4. **P0-4** spawn `allowTrust: false`  
5. **P1-5** UI honesty + list Trust badge/confirm  
6. Regression tests for 1–4  
7. ADR-020 / architecture amendment (can trail code by hours, not days)

Out of scope for micro-PR: full multi-thread Trust refcount redesign (document + single-holder OK short-term).

---

## Commits in range

```
6d2cdcf docs(memory): S46 handoff — skill_install home, MCP cruise, scene Trust B
b247fcf feat(packs): user-scene Trust B — skip L2, enable modules, write auto_approve
9e7c02b feat(packs): user-scene tool policy, AI create/optimize, MCP whitelist orthogonal
1b294fe fix(mcp,ux): cruise waives MCP critical confirm; stick chat scroll
a054121 fix(skill_install): allow user-home sources with L2 consent
cbd143f docs(memory): S45 handoff — multi-lane P0 #125 merged
7c8ec53 Merge pull request #125 from nehcuh/fix/s45-p0-multi-lane-followup
93b64ce fix(ux,security): S45 multi-lane P0 — upload thread isolation + scoped fleet stop
```

---

## Orchestrator final line

**VERDICT: REQUEST_CHANGES**

Trust B happy-path apply/unapply works; **lifecycle exits and non-UI apply surfaces do not**. Non-Trust S46 work (#125, skill_install home, MCP cruise, scene tools/AI) is solid at tip and should not be rolled back for this verdict.
