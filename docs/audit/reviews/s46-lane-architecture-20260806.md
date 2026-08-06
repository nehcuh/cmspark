# Lane: Architecture — S46 main pull multi-adversarial

| Field | Value |
|-------|--------|
| **Range** | `474df7e..6d2cdcf` (main / S46) |
| **Repo** | `/Users/huchen/Projects/cmspark` |
| **Diff artifact** | [`docs/audit/reviews/s46-main-pull-diff-20260806.patch`](./s46-main-pull-diff-20260806.patch) |
| **Tip** | `6d2cdcf` |
| **Lane** | Architecture (ADR-014/020 axes, Trust B layering, Pack vs Autonomy, MCP/whitelist seam, skill_install tiers, dual-write lifecycle, control-plane honesty, #125 stop scope) |
| **Evidence** | `[inspected]` patch + live tip sources (pack-engine, types, validator, message-router, PacksPanel, adapter, thread-manager, skill-install, ADRs, mission-pack-usage, mcp.md, architecture.md). No runtime bake-off in this lane. |
| **Themes** | user-scene tools/AI · Trust B (global auto_approve on user pack apply) · MCP full-autonomy cruise · skill_install user_home · ChatView stick · S45 #125 stop/upload carry |
| **Date** | 2026-08-06 |
| **Prior** | [s45-lane-architecture-20260805.md](./s45-lane-architecture-20260805.md) |

---

## Verdict

**REQUEST_CHANGES**

S46 ships two architecturally coherent Composition wins (user-scene **tools recipe** + **MCP ↔ native whitelist orthogonality**) and a deliberate product override (**Trust B**). Trust B *can* be bounded as “user-authored Trust packaging attached to Pack, applied only on `user_gesture` apply, restored on unapply” — analogous in spirit to ADR-021 unattended as Trust packaging, not a new Surface.

**It is not yet bounded honestly:**

1. **Restore lifecycle is incomplete** for the common non-`unapply` exits (switch pack, uninstall/delete). Product copy and §2c claim “退出场景会尽量恢复”; engine only restores on the explicit `unapplyPack` path. Switching A(trust)→B(no trust) **drops** `mission_pack_trust_snapshot` and **leaves global cruise elevated** — a control-plane lie, not a nit.
2. **Ontology docs still assert the pre-B invariant** (ADR-020 Composition rule 2; `architecture.md` §叠加纪律 / §7.5; `mission-pack-usage` Autonomy row + §10.1). ADR-014 was footnoted; the three-axis SoT was not. Reviewers and future packs will follow the wrong rule.
3. **Side Panel control plane is split-brained**: tool group / confirm strings still say “每次仍确认 / 场景不能跳过确认” while Trust checkboxes write three-flag cruise; list-apply modal does not warn that re-applying a saved trust scene mutates global security.

MCP selection vs whitelist, skill_install source tiers vs MCP filesystem roots, and #125 fleet stop scoping are **architecturally sound** and should not be blocked.

**Not REJECT** — Trust B is an intentional product decision with server authority, origin gate, audit events, and a happy-path unapply test. **Not APPROVE_WITH_NITS** — incomplete restore, **spawn path Trust elevation** (`server.ts:3193–3202`), and docs SoT contradiction are long-term architecture defects that will compound (multi-thread residual cruise, support “why is god still on”, next pack author re-opens auto_approve at root, LLM-chosen pack_id elevates globals).

**Minimum to re-verdict toward APPROVE_WITH_NITS:** F1 restore on switch + uninstall/delete; **F6 spawn must not apply Trust B**; F2 ADR-020 / architecture / usage §0·§10 rewrite for Trust B as Trust packaging; F3 apply-path honesty (modal + tool-group copy). F4 multi-thread residual may remain documented HIGH debt.

---

## Capability axes (ADR-020) — this range

| Piece | Surface | Composition | Autonomy | Trust | Channel | Fit |
|-------|---------|-------------|----------|-------|---------|-----|
| User-scene `tools` allowlist/unchanged | n/a (recipe) | Pack tools mode + `requires_modules` derive | — | module/profile gate at apply | community→enterprise when shell/netsec | **OK Composition** |
| Trust B `pack.trust` → global config | n/a | **Declares** recipe on origin=user pack | three-flag cruise elevates | **Mutates** profile/modules/auto_approve | enterprise forced | **Layering breach of rule 2** unless reclassified (see F2) |
| MCP whitelist orthogonality | — | native `tool_whitelist` ⊥ `mcp__*` | — | MCP confirm algebra separate | community | **OK clean seam** |
| MCP full-autonomy cruise waive | — | — | cruise = three flags | MCP critical L2 waived under cruise only | community | **OK Trust algebra extension** (docs in mcp.md) |
| skill_install `user_home` tier | durable skill write | skill library dest fixed | L2 unless cruise | source path tier (default/home/denied) | community | **OK separate gate from MCP roots** |
| ChatView stick-to-bottom | L0 presentation | — | — | — | community | **OK UX; not axis-bearing** |
| #125 stop/upload (carried) | dual-topology busy | — | scoped fleet stop | — | community | **OK — F1 from S45 closed** |

**Axis language check:** No new Agent type, no mid-layer runtime, no Board fork. Trust B is **not** Composition-only: it is Composition *carrier* + **global Trust mutation**. Calling it “just Pack” without ADR-020 amendment is dishonest ontology.

---

## Focus answers (task checklist)

### 1. Trust B as product override with restore?

**Intentional product override, incomplete restore.**  
Server path: `applyUserPackTrust` → `captureTrustSnapshot` / freeze prior → thread `mission_pack_trust_snapshot` → `restoreTrustSnapshot` on `unapplyPack` only (`pack-engine.ts:948–1154`).  
Origin gate: validator rejects `trust` unless `origin=user` (`validator.ts:256–276`); `FORBIDDEN_PACK_KEYS` allowed only under `pack.trust` for user (`validator.ts:61–84`).  
`user_gesture` required on apply/save (`message-router.ts:1946–2012`).  
Happy path tested (`packs-engine.test.ts:111–178`).  

**Gap:** restore is not a lifecycle property of “having applied trust”; it is a property of calling `unapplyPack`. Switch / uninstall / delete do not restore (F1). Multi-thread concurrent trust packs share one global SoT with per-thread cookies (F4).

### 2. Pack composition vs Trust autonomy — layering honesty

**Half-honest.**  
- Composition side (tools, skills, MCP ids, prompt, selection modes) remains thread-scoped snapshot — correct Pack model (ADR-014).  
- Trust B writes **process-global** `config.json` (profile, three flags, modules). That is Trust / Channel, not Composition.  
- Product docs §2c admit global write; ADR-020 rule 2 and architecture §7.5 still forbid it.  
**Ask:** document Trust B as **Trust packaging on user packs** (like ADR-021 exception language), not as “Pack may now write auto_approve.” Builtin/installed remain composition-only — good split.

### 3. MCP `selection_mode` vs pack `tool_whitelist` orthogonality

**Seam is clean.**  
- Adapter filters **native only**, then concatenates MCP tools (`adapter.ts:486–497`).  
- Execution gate: `isToolAllowed` returns true for `mcp__*` / meta tools when whitelist is a list (`thread-manager.ts:569–585`).  
- Server selection: `mcp_selection_mode` + `active_mcp_server_ids` via manager filter; pack apply sets manual + intersect configured servers (`pack-engine.ts:1051–1077`).  
D8 footgun fixed; no second whitelist dialect invented.

### 4. skill_install tiers vs MCP filesystem roots

**Architecture OK — separate gates.**  
| Concern | skill_install | MCP filesystem |
|---------|---------------|----------------|
| What is gated | **Source path** for durable skill import into `~/.cmspark-agent/skills` | **Server allow-dir / roots** for MCP tool FS ops |
| Authority | companion skill-install + L2 (or cruise) | MCP config + confirm / dynamic home expand |
| Home meaning | source tier `user_home` still needs L2 unless cruise | default inject `os.homedir()` into server args |

Do not merge these into one “home trust” abstraction without a new ADR — blast radii differ (skill library poison vs runtime FS).

### 5. Dual-write / `mission_pack_trust_snapshot` lifecycle

**Pattern correct in spirit, incomplete in practice.**  
- Pre-trust global snap frozen across re-apply of same pack (`prior` reuse) — good.  
- Rollback on trust apply fail / apply_blocked / patch fail — good.  
- Thread field cleared on unapply and when `mission_pack_id=null` in `applyPackPatch` — good for explicit exit.  
- Switch to non-trust pack writes `mission_pack_trust_snapshot: null` **without** restore — **bad**.  
- `uninstallPack` / `deleteUserPack` restore composition snapshot only — **no** `restoreTrustSnapshot` — **bad**.  
- Global config remains SoT for gates; thread holds restore cookie only — dual ownership requires complete exit matrix (F1, F4).

### 6. Control-plane honesty: UI vs server authority

Server is authority for mutation (good). UI is not authority but **misdescribes** effects (F3). List apply (`confirmApply`) never surfaces Trust risk; only editor save-and-apply does.

### 7. PacksPanel coupling

PacksPanel owns recipe construction (`enable_modules` heuristic from tools + skip_l2 → shell/netsec). That is acceptable **authorship** if server re-validates modules (`setModuleEnabled` availability/profile). Risk: client can save `trust.skip_l2` with empty tools and still enable shell/netsec via skip_l2 default — server honors disk recipe. Not a privilege bypass (user_gesture + origin=user) but **concentrates Trust product policy in UI** — prefer server-side normalize of `skip_l2 ⇒ enable_modules` defaults already partially done on apply (`pack-engine.ts:958–970`).

### 8. #125 stop/upload scoping completeness

**Architecturally complete for the S45 F1 ask.**  
- `buildFleetStopAllMessage` scopes run / parent / process-wide residual (`thread-busy.ts:171–208`).  
- FleetStrip / FleetWorkerList pass `orchestrator_run_id` / `parent_thread_id`.  
- Companion `fleet.stop_all` precedence run > parent > all (`message-router.ts:1814–1838`).  
Upload: SW stamps `file.upload_error` with thread_id; InputArea gates chrome clear with `shouldApplyStreamEvent`. Residual dual-write busy remains structural MEDIUM (S45 F2), not reopened by S46.

### 9. Docs/ADR drift

| Doc | State vs code |
|-----|----------------|
| ADR-014 rejected table | **Revised** for user trust block |
| ADR-020 Composition rule 2 | **Stale — still absolute forbid** |
| architecture.md 叠加纪律 / §7.5 | **Stale forbid** |
| mission-pack-usage §2c | **Updated** Trust B |
| mission-pack-usage §0 Autonomy / §10.1 Pack row | **Stale contradict §2c** |
| design SoT D4 / §7 non-goals | **Stale** (D4 forbids skip L2 / modules / auto_approve) |
| mcp.md cruise | **Aligned** with three-flag waive |

---

## Findings

### F1 — Trust restore lifecycle incomplete (switch / uninstall / delete)
**Severity:** **HIGH** (Trust dual-write; product restore claim false on common exits)  
**Where:**

- Apply writes snap only when pack has trust (`pack-engine.ts:948–1084`); non-trust apply sets `mission_pack_trust_snapshot: null` without restore.
- Unapply restores (`pack-engine.ts:1121–1144`).
- `restoreSnapshot` / uninstall path clear trust field, never call `restoreTrustSnapshot` (`pack-engine.ts:905–918`, `1160–1196`).
- `deleteUserPack` → `uninstallPack` only (`pack-engine.ts:713–733`).

**Architecture issue:** Thread-scoped cookie for **global** Trust requires every exit that drops the cookie to restore (or re-home) global state. Today:

| Exit | Composition restore | Trust restore |
|------|---------------------|---------------|
| `unapplyPack` | yes | yes |
| Switch A(trust)→B(no trust) | base snap from A | **no — cookie discarded, cruise stays** |
| Switch A(trust)→B(trust) | yes | reuses A’s pre-snap (OK if intentional) |
| uninstall / delete while applied | composition | **no** |
| Companion crash mid-apply | partial rollback tries | best-effort |

**Impact:** User “exits” by applying another scene or deleting the pack → global `auto_approve_*` / enterprise / modules remain elevated until manual Settings edit. Support surface + security residual.

**Ask (must fix before architecture APPROVE):**

1. On apply when **outgoing** thread held `mission_pack_trust_snapshot` and **incoming** pack does not apply trust: `restoreTrustSnapshot(prior)` then clear cookie (or capture new baseline only after restore).
2. On uninstall/delete for each restored thread: if that thread held a trust snap, restore (define multi-thread order — see F4).
3. Add tests: switch trust→non-trust; uninstall while applied with trust.

---

### F2 — ADR-020 / architecture SoT still forbid Pack Trust writes (ontology drift)
**Severity:** **HIGH** (long-term architecture / review anti-pattern)  
**Where:**

- ADR-020 Composition rule 2: “Pack **禁止**写入 `auto_approve_dangerous` / god-mode…” (`docs/adr/020-capability-model-three-axes.md:75`).
- Heart diagram caption: “Pack cannot relax globals” (`:121`).
- `docs/architecture.md:23`, `:615`.
- `docs/mission-pack-usage.md:13` (Autonomy: Pack cannot raise profile/modules); `:291` (Pack 不会抬 capability_profile).
- Design SoT D4 / non-goals (`docs/superpowers/specs/2026-08-06-user-scene-tools-and-ai-create.md:57`, `:161`).
- Only ADR-014 rejected-row footnote + usage §2c describe Trust B.

**Architecture issue:** Three-axis ontology is the review gate. Code + ADR-014 footnote diverge from ADR-020 without a formal exception. Next PR will either re-forbid Trust B as “ADR-020 violation” or copy the anti-pattern (“pack writes globals”) without origin/user_gesture/restore.

**Ask:**

1. Amend ADR-020 Composition rule 2 + Trust cross-cut: **builtin/installed packs** still forbid; **origin=user** may declare `trust` block applied only at `pack.apply` with `user_gesture`, restore on scene exit; never root-level FORBIDDEN keys.
2. Update architecture.md 叠加纪律 + §7.5 the same way.
3. Fix mission-pack-usage §0 / §10.1 to point at §2c instead of absolute forbid.
4. Amend design SoT D4 / §7 changelog: D4 superseded by Trust B for user origin.

---

### F3 — Control-plane dishonesty in PacksPanel (UI claims vs server effect)
**Severity:** **HIGH** (user model / dual-topology honesty)  
**Where:**

- High-risk group title: “每次仍确认” (`PacksPanel.tsx:59`).
- Tool toggle confirm: “每次调用需安全确认（**场景不能跳过确认**）” (`:523`).
- Trust block: skip_l2 / write auto_approve (`:1044–1114`).
- List apply modal (`:838–870`): suitable/unsuitable/tools only — **no** global Trust warning.
- Editor save-and-apply confirms Trust only when `andApply` (`:610–617`); re-apply from list of already-saved trust scene skips that confirm.

**Architecture issue:** Same panel teaches two opposite Trust models. Server will waive L2 under three-flag cruise (including MCP critical per mcp.md). Users checking only the tool path believe L2 remains; red-team path enables cruise without re-warning on list apply.

**Ask:**

1. When `confirmPack` has trust (from list item / pack.get flag), modal must state **global** profile/modules/auto_approve mutation + restore caveats.
2. Soften tool-group copy: “默认每次确认；若场景 Trust 开启巡航则可能跳过 L2（全局）.”
3. Prefer server to return `trust_will_apply: true` on pack.list/get so UI cannot desync from disk.

---

### F4 — Multi-thread global Trust dual-ownership (residual HIGH debt)
**Severity:** **HIGH** (even if product-approved single-thread) — residual  
**Where:** `mission_pack_trust_snapshot` per thread; `saveConfig` global (`pack-engine.ts:129–225`, `948–957`).

**Scenarios:**

1. T1 apply trust (snap S0) → T2 apply trust (snap S1 = post-T1 cruise) → unapply T1 restores S0 (kills T2’s intended cruise while T2 still “in scene”) → unapply T2 restores S1 (cruise returns).
2. Reverse unapply order leaves cruise on when last snap was post-first-apply.
3. Manual Settings change while pack applied: unapply overwrites user manual edits with stale snap.

**Architecture issue:** Global singleton cannot be correctly refcounted by independent thread cookies without a **process-level Trust stack or owner thread id**. Current design is single-thread LIFO only.

**Ask (document now; implement if multi-scene is product):**

- Short term: document “Trust B is process-global; only one trust scene recommended; last unapply wins.”
- Medium: process-level `trust_lease: { owner_thread_id, snap }` — second apply refuses or stacks; unapply only if owner matches.
- Audit: log owner_thread_id on trust_apply/restore.

**Product may ship single-thread; residual HIGH remains on the architecture books.**

---

### F5 — PacksPanel client-side Trust recipe policy
**Severity:** **MEDIUM** (policy drift / dual topology)  
**Where:** `PacksPanel.tsx:573–606` builds `enable_modules` / skip_l2 expansion; server `normalizeUserTrust` + apply merge (`pack-engine.ts:101–126`, `958–970`).

**Architecture issue:** Policy of “skip_l2 ⇒ shell+netsec modules” lives in UI; apply path also merges `requires_modules` and set_enterprise. A non-UI client (future CLI, WS inject with gesture forge) gets different enable_modules if only sending `skip_l2: true`. Server apply expands enterprise/modules partially but UI’s “no tools → enable shell+netsec” is UI-only at **save** time.

**Ask:** Move skip_l2 defaults into `normalizeUserTrust` / `applyUserPackTrust` so disk recipe and apply path share one policy. UI becomes pure binder.

---

### F6 — `spawn_worker` pack.apply can run Trust B without Trust-specific consent
**Severity:** **HIGH** (Autonomy path bypasses Side Panel Trust UX; comment/code lie)  
**Where:**

- `companion/src/server.ts:3193–3202` — after spawn L2 token, optional `applyPack(pack_id, worker.id, …)` **direct** (no `user_gesture`).
- Comment at `:3193`: “role template — **never elevates** capability_profile / modules” — **false** under Trust B (`applyUserPackTrust` runs first in `applyPack`).
- UI `pack.apply` still requires `user_gesture` (`message-router.ts:1946–1953`); spawn does not.

**Architecture issue:** Spawn L2 authorizes **worker creation + tool_allow**, not “write three-flag cruise + enable shell/netsec globally.” A user (or LLM-chosen) `pack_id` pointing at a Trust B scene elevates **process-global** security as a side effect of multi-agent Autonomy. That collapses the Trust packaging exception into an LLM-parameter channel once spawn is approved.

**Ask (must fix with F1 or before APPROVE):**

1. `applyPack(..., opts?: { allowTrust?: boolean })` — default **false** for spawn; only message-router UI path passes `allowTrust: true` with `user_gesture`.
2. Or refuse origin=user packs that contain `trust` when applied as worker templates.
3. Fix the stale comment at `server.ts:3193`.
4. Test: saveUserPack with `skip_l2` → spawn_worker with that pack_id → global auto_approve must remain false.

---

### F6b — mission-pack-usage internal contradiction (§2c vs §0/§10)
**Severity:** **MEDIUM** (user + contributor confusion)  
**Where:** `docs/mission-pack-usage.md:13`, `:87–94` vs `:291`.

**Ask:** Single narrative: Composition always; Trust B exceptional path for 我的场景 only via Side Panel apply; multi-agent Pack templates **must not** inherit Trust B (ties to F6).

---

### F7 — Design SoT still “ACCEPTED” with D4 forbidding Trust B
**Severity:** **MEDIUM** (process honesty)  
**Where:** design spec status line + D4 vs shipped Trust B + ADR-014 footnote.

**Ask:** Changelog entry “Trust B product override 2026-08-06 supersedes D4 for origin=user”; status remains ACCEPTED with amendment, not silent code diverge.

---

### F8 — MCP selection_mode ⊥ tool_whitelist (positive)
**Severity:** **INFO** (good)  
**Where:** `adapter.ts:486–497`, `thread-manager.ts:569–585`, design D8.

Seam is the right long-term split: native pack surface vs MCP server selection vs MCP server-internal roots. Do not collapse.

---

### F9 — skill_install home tier vs MCP roots (positive)
**Severity:** **INFO** (good)  
**Where:** `skill-install.ts:5–16`, `100–135`; `docs/mcp.md` filesystem section.

Separate axes: install-source consent vs MCP allow-dir. Keep L2 on install unless full cruise; denied outside home. No architecture merge required.

---

### F10 — #125 fleet stop + upload scoping (positive / closed)
**Severity:** **INFO**  
S45 architecture F1 closed in tree: scoped stop messages + companion parent/run filters; upload_error thread stamp. Residual dual-write busy (S45 F2) unchanged — out of S46 scope.

---

### F11 — ChatView stick-to-bottom
**Severity:** **LOW** (presentation; ResizeObserver + stickKey)  
Not axis-bearing. Watch for performance on huge transcripts (stickKey rebuild) — product nit only.

---

## Residual HIGH debt (even if product ships Trust B)

| ID | Debt | Owner axis |
|----|------|------------|
| F1 | Incomplete trust restore exits | Trust dual-write |
| F6 | spawn_worker `applyPack` runs Trust B | Autonomy × Trust |
| F2 | ADR-020 / architecture absolute forbid vs code | Ontology SoT |
| F3 | UI “cannot skip confirm” vs cruise | Control plane |
| F4 | Multi-thread global Trust refcount | Trust packaging |
| S45-F2 | Busy dual-write Extension+Companion | Dual topology |
| S45-F4 scatter | Three-flag cruise predicate still multi-site | Trust algebra |

---

## What is solid (do not regress)

1. **User tools recipe** as Composition: `resolveUserPackTools`, omit-preserve, `deriveRequiresModulesFromTools`, fail-closed apply without module/profile — matches ADR-014 Pack model.
2. **FORBIDDEN_PACK_KEYS** + origin-scoped trust block — correct shape for exception (keys never at pack root).
3. **user_gesture** on pack.apply / save_user / unapply — Side Panel path gated; **F6**: spawn still calls `applyPack` without Trust allow-flag (must close).
4. **MCP ⊥ whitelist** execution + schema filter.
5. **Audit** `pack.trust_apply` / `pack.trust_restore`.
6. **#125** stop scope completeness.

---

## Suggested fix order

1. **F6** spawn/non-gesture apply must skip or refuse Trust B (security/control plane).  
2. **F1** restore on switch + uninstall (correctness).  
3. **F3** apply modal + copy (honesty).  
4. **F2/F6b/F7** doc/ADR/design alignment (SoT).  
5. **F5** server normalize skip_l2.  
6. **F4** document or lease (multi-thread).

---

## Capability declaration (this review artifact)

```text
Surface:      n/a (review)
Compose:      pack | mcp-server | skill
Autonomy:     single (+ fleet stop scope from #125)
Trust:        Trust B product override — incomplete lifecycle
Channel:      community | enterprise (forced by Trust B)
```

---

VERDICT: REQUEST_CHANGES
