# S46 COMPAT / PLATFORM Review — main pull `474df7e..6d2cdcf`

| Field | Value |
|---|---|
| **Lane** | COMPAT / PLATFORM (adversarial) |
| **Range** | `474df7e..6d2cdcf` (S46 main) |
| **Tip** | `6d2cdcf` |
| **Diff** | [`docs/audit/reviews/s46-main-pull-diff-20260806.patch`](./s46-main-pull-diff-20260806.patch) |
| **Date** | 2026-08-06 |
| **Method** | LIVE tip sources + patch; package/plasmo versions; skill-install path equals; thread manager metadata; pack-engine trust apply/restore; fleet.stop_all wire; ChatView stick; MCP cruise waive |
| **Evidence tags** | `[inspected]` static; no full e2e matrix on Windows hardware this pass |

---

## Scope (compat focus)

1. Extension ↔ Companion protocol skew (pack tools/trust, MCP waive, `file.upload_error` stamps)
2. plasmo.config / package version alignment (S45 0.3.0 vs 0.4.0)
3. Cross-platform: `skill_install` home path (Windows drive letters / case / USERPROFILE vs macOS)
4. Pack Trust B restore if companion crashes mid-apply
5. ChatView scroll stick across browsers
6. Fleet `stop_all`: old extension without `orchestrator_run_id` vs new companion
7. AI-generated pack schema forward/backward compatibility
8. Config schema migration for new pack/trust fields
9. Test portability assumptions

---

## Executive summary

S46 ships four product surfaces that all touch the extension↔companion contract: **user-scene tools + Trust B**, **skill_install user_home**, **MCP full-autonomy cruise waive**, and **S45 leftovers** (scoped fleet stop, upload thread isolation, ChatView stick).

**Version alignment is fixed** (extension package + plasmo + companion all `0.4.0`). Most wire changes are additive and fail-closed or fail-safe when fields are omitted.

**Trust B restore is not crash- or lifecycle-safe.** Global security flags are written to disk *before* the thread-bound restore snapshot is committed; several exit paths clear `mission_pack_trust_snapshot` without calling `restoreTrustSnapshot`. That is a cross-session sticky-cruise hazard and blocks APPROVE for this lane.

---

## Checklist matrix

| Area | Result | Notes |
|---|---|---|
| package / plasmo versions | **PASS** | `chrome-extension/package.json` 0.4.0, `plasmo.config.ts` 0.4.0, `companion/package.json` 0.4.0 — S45 skew fixed |
| Explicit protocol_version | **N/A** | No wire protocol version field; versioning is implicit via message fields |
| `file.upload_error` stamps | **PASS** | SW + companion stamp `thread_id`; Side Panel always clears mapBusy, gates chrome via `shouldApplyStreamEvent` |
| Fleet stop scope | **PASS w/ skew note** | New ext sends `orchestrator_run_id` \| `parent_thread_id`; new companion precedence run > parent > process-wide |
| Old ext × new companion stop | **ACCEPTABLE** | Bare `fleet.stop_all` → process-wide (legacy behavior) |
| New ext × old companion stop | **NIT / RISK** | `parent_thread_id`-only payload ignored → process-wide (wider than UI copy) |
| skill_install Windows paths | **PASS w/ nits** | `pathEqualsOrUnder` lowercases on win32; `%VAR%` expand; realpath home containment |
| Pack tools / trust wire | **PASS additively** | Optional fields; omit preserves on update |
| Trust B unapply (happy path) | **PASS** | Tested: apply skip_l2 → unapply restores flags |
| Trust B crash / uninstall / switch | **FAIL** | Sticky global cruise — see F1–F3 |
| MCP tools vs pack allowlist | **INTENTIONAL BREAK** | Native whitelist only; MCP orthogonal (D8) |
| MCP cruise waive algebra | **PASS** | Three-flag &&; audit `mcp.confirm.waived` |
| ChatView stick | **PASS w/ nits** | stickKey + RO + ignoreScroll; Chrome Side Panel OK |
| Config migration | **PASS** | No new CompanionConfig keys; reuses `security.*` + thread JSON additive field |
| Pack schema_version | **NIT** | Still `schema_version: 1` with new `trust` semantics |
| Test portability | **NIT** | skill_install win32 branches only exercise when `process.platform === "win32"` |

---

## Findings

### F1 — CRITICAL / HIGH: Trust apply writes durable global config before thread snapshot commit (crash mid-apply)

**Where:** [`companion/src/packs/pack-engine.ts`](../../companion/src/packs/pack-engine.ts) `applyPack` ~L948–1085; `applyUserPackTrust` ~L149–198  
**Evidence:** `[inspected]`

Order of operations:

1. `captureTrustSnapshot()` (in memory only)
2. `applyUserPackTrust` → **`saveConfig`** persists `auto_approve_*` / `allow_all_schemes` / profile + `setModuleEnabled` (disk)
3. Asset install, whitelist compute, …
4. **Only then** `applyPackPatch(..., mission_pack_trust_snapshot: trustSnap)`

If companion dies (kill, crash, power) between (2) and (4):

- Global cruise / modules are **on disk**
- Thread has **no** `mission_pack_trust_snapshot`
- On restart, unapply/exit scene **cannot** restore; Settings still show full autonomy until a human flips flags

Product copy claims “退出场景会尽量恢复应用前的配置”. Crash mid-apply is the exact scenario called out for this review lane — currently **not** recoverable.

**Ask:** Write-ahead or two-phase commit, e.g.:

1. Persist pending trust restore intent (`~/.cmspark-agent/…` or thread index) **before** mutating security flags, **or**
2. Apply trust only after thread patch succeeds with snap already stored, and use a short “pending_trust” journal for the module-enable gate path, **or**
3. On companion boot, reconcile: if any thread has applied trust pack without snap / or a pending journal exists → force restore to last known-safe snapshot / community defaults + audit.

---

### F2 — HIGH: `uninstallPack` / `deleteUserPack` clears trust snapshot without restoring global Trust

**Where:** `uninstallPack` ~L1160–1197; `restoreSnapshot` ~L905–918  
**Evidence:** `[inspected]`

`unapplyPack` correctly:

1. Reads `trustSnap` from thread
2. Restores pack fields
3. Calls `restoreTrustSnapshot(trustSnap)`

`uninstallPack` (used by `deleteUserPack`) instead:

```ts
if (t.mission_pack_snapshot) {
  restoreSnapshot(...)  // sets mission_pack_trust_snapshot: null — does NOT restore Trust
}
// no restoreTrustSnapshot
```

User path: apply Trust-B scene → delete「我的」场景 while still applied → thread pack fields cleared, **global cruise remains**.

Happy-path test only covers `unapplyPack`, not uninstall/delete.

**Ask:** For each thread with this pack id, capture `mission_pack_trust_snapshot` **before** `restoreSnapshot`, then `restoreTrustSnapshot` (with multi-thread policy — see F4). Add regression test.

---

### F3 — HIGH: Switch Trust pack A → non-trust pack B drops restore handle and leaves cruise on

**Where:** `applyPack` trust block only runs when `packTrust && origin === "user"`; final patch:

```ts
mission_pack_trust_snapshot: trustSnap ? clone(trustSnap) : null
```

**Evidence:** `[inspected]`

Scenario:

1. Apply user pack A with `trust.skip_l2` → snap stored, cruise ON
2. Apply builtin / user pack B **without** `trust` on same thread
3. Trust branch skipped → `trustSnap = null` → patch writes `mission_pack_trust_snapshot: null`
4. Global flags from A **stay ON**; no handle for later restore

Also: switch A(trust) → B(trust) reuses `prior` snap (good for unapply target), but never restores A’s intermediate module set if B is weaker — B’s absolute flag write overwrites; modules only enabled, never disabled on apply.

**Ask:** On pack switch, if prior thread had `mission_pack_trust_snapshot`, either:

- restore prior snap before applying B’s trust (or non-trust), then capture fresh snap for B, **or**
- keep the original pre-trust snap across non-trust B and re-apply restore when leaving B.

---

### F4 — MEDIUM: Multi-thread Trust is process-global; unapply is last-writer / first-unapply races

**Where:** `applyUserPackTrust` / `restoreTrustSnapshot` mutate process-wide `getConfig()`  
**Evidence:** `[inspected]`

Thread A and Thread B can both apply Trust packs:

| Event | Global state | Snap on A | Snap on B |
|---|---|---|---|
| A apply | cruise | pre-A | — |
| B apply | cruise′ (B policy) | pre-A | **current (post-A)** |
| A unapply | restore pre-A → may **strip B’s cruise** | null | post-A (stale vs world) |
| B unapply after A | restore post-A snap → may leave cruise | — | null |

No refcount / “trust holders” set. Product B as implemented is **single active Trust scene per Companion process**, not per-thread.

**Ask:** Document as product constraint in UI (“全局 Trust 同时只能有一个场景生效”), or implement holder set: only restore when last trust-holding thread unapplies; re-apply remaining holders’ policies.

---

### F5 — MEDIUM: Mixed-version fleet `stop_all` with `parent_thread_id` only

**Where:**  
- New ext: `buildFleetStopAllMessage` → may send only `parent_thread_id`  
- New companion: run > parent > process-wide  
- Pre-S45 companion: only `orchestrator_run_id` or process-wide  

**Evidence:** `[inspected]`

| Pairing | Behavior |
|---|---|
| Old ext + new companion | Bare `fleet.stop_all` → **all workers** (legacy) |
| New ext + new companion | Scoped (correct) |
| New ext + **old** companion | `parent_thread_id` ignored → **all workers** while UI confirms “本会话” |

If users ever run rebuilt Side Panel against older packaged Companion (common during partial upgrades), stop is **wider than confirmed**.

**Ask (nit if ship-locked pairs):** Prefer always stamping `orchestrator_run_id` when known; companion could echo capability in `auth.ok` / `hello` so UI disables scoped stop or falls back to honest “进程内全部” copy. Optional: reject unknown-scope stop without ids when `fleet.scope_required` capability is set.

Background SW forwards the full `message` object for `fleet.stop_all` — no field stripping. `[inspected]`

---

### F6 — MEDIUM (product/compat): Pack allowlist no longer filters MCP tools

**Where:** [`companion/src/llm/adapter.ts`](../../companion/src/llm/adapter.ts) — native tools filtered; MCP/meta always appended  
**Evidence:** `[inspected]`

Intentional D8 (“MCP 与工具白名单正交”). Compat impact:

- Older pack authors / mental models that used `tools.allow` as a total surface fence now **still expose MCP** when servers are selected on the thread.
- Scene editor copy updated (“与工具白名单正交”) — good.
- Cross-version: old companion still filtered MCP via whitelist if that code path existed; new companion does not → behavior change on upgrade even for old pack yaml.

Not a wire break; document in mission-pack usage / release notes.

---

### F7 — LOW / MEDIUM: `skill_install` source tier — “Downloads” segment heuristic is not root-bounded

**Where:** `classifySkillInstallSource` in [`companion/src/skills/skill-install.ts`](../../companion/src/skills/skill-install.ts) L100–129  
**Evidence:** `[inspected]`

```ts
if (segments.includes("downloads") || segments.includes("下载")) return "default"
```

Any path whose realpath has a `Downloads` / `下载` path segment is **default-allowed**, including e.g. `D:\not-home\Downloads\…` or another user’s profile Downloads on multi-user Windows, **before** home containment is checked.

Home zone correctly uses realpath + case-folding `pathEqualsOrUnder` on win32 — good. Expand handles `%USERPROFILE%` / `%TEMP%` case-insensitively — good.

**Ask:** Prefer `isWithinRoot(cand, getUserDownloadsDir())` (and optional localized names) over bare segment match; keep segment match only as secondary for `~/下载`.

---

### F8 — LOW: Pack `schema_version` remains 1 with new `trust` semantics; unknown tools fail-closed

**Where:** `validator.ts` `schema_version !== 1` reject; tool names must exist in `getAllToolDefinitions()`  
**Evidence:** `[inspected]`

- **Backward:** Old companion without Trust: `scanForbidden` rejects security keys / trust block → user packs with Trust fail validation (fail-closed — good). Packs without trust still load.
- **Forward:** New tools added to companion later: old saved allowlists still valid; new UI tools unknown to older companion → `unknown tool in tools` on save (fail-closed).
- Staying on `schema_version: 1` while adding security-relevant `trust` makes “what does v1 mean?” ambiguous for external pack authors.

**Ask:** Bump to `schema_version: 2` for packs that include `trust`, accept 1 without trust; or document trust as optional v1 extension with strict origin=user.

AI suggest modes (`recommend|generate|optimize`): unknown mode coerced to `recommend` on companion — good forward-compat. Old extension without `mode` → recommend. Old companion ignores `mode` if not wired — UI may show generate UX without backend (if mixed); current ship pairs both sides.

---

### F9 — LOW: ChatView stick — browser surface is Chrome Side Panel only

**Where:** [`chrome-extension/src/sidepanel/components/ChatView.tsx`](../../chrome-extension/src/sidepanel/components/ChatView.tsx)  
**Evidence:** `[inspected]` + prior dual-review

- `ResizeObserver` guarded with `typeof ResizeObserver === "undefined"` — fine for MV3 Chrome.
- `overflowAnchor: "none"` + JS stick — correct approach for Chromium.
- `ignoreScrollRef` held across 2 rAF frames — low risk of ignoring a real user scroll during layout thrash.
- Threshold 120px — looser than 60; OK for high-DPI side panel.
- Prior nit: dead `bottomRef` / inert anchor comment may still exist outside this patch’s focus — non-blocking.

No Safari/Firefox requirement for Side Panel product.

---

### F10 — LOW: Config schema migration

**Evidence:** `[inspected]`

- Trust B reuses existing `security.auto_approve_dangerous`, `auto_approve_enterprise_tools`, `allow_all_schemes`, `capability_profile`, `modules.*.enabled` — **no new config.json keys**.
- `mission_pack_trust_snapshot` is additive on thread index JSON; older companions ignore unknown thread fields on load; newer companions treat missing as null.
- No migration function required; **boot-time reconciliation for orphan cruise (F1)** is still recommended as operational safety, not schema migration.

---

### F11 — LOW: Test portability assumptions

| Test area | Portability |
|---|---|
| `skill-install.test.ts` | Uses real `os.homedir()`; outside-home path branches on `win32` vs POSIX; **does not unit-test** `pathEqualsOrUnder` drive-letter case / `C:` vs `c:` / junction without running on Windows |
| `thread-busy.test.ts` fleet stop builder | Pure — portable |
| `stream-thread-gate.test.ts` upload gate | Pure — portable |
| `packs-engine.test.ts` Trust unapply | Uses live config dir — assumes single-process test isolation; no crash-injection / uninstall-trust test |
| ChatView | No automated scroll tests in this range |

**Ask:** Add pure unit tests for `pathEqualsOrUnder` with injected platform=`win32` paths (`C:\\Users\\A\\x` vs `c:\\users\\a\\x`); add uninstall + switch-pack Trust restore tests (F2/F3).

---

## Positive notes (compat-friendly work)

1. **Version triple aligned at 0.4.0** — closes S45 plasmo 0.3.0 skew.  
2. **`file.upload_error` + `shouldApplyStreamEvent`** — mid-upload thread switch no longer pollutes foreign chrome; companion persists assistant error on owning thread when gated.  
3. **Fleet stop message builder** pure + tested; companion parent scope is a clean additive field.  
4. **Pack save omit-semantics** for tools/trust preserve-on-update — good for older Side Panels that only send name/prompt/skills.  
5. **Trust only on `origin=user`** + validator forbidden-key scan — builtins cannot smuggle auto_approve.  
6. **MCP cruise waive** uses same three-flag algebra as shell critical path; partial flags do not waive MCP.  
7. **skill_install** home zone + win32 case fold + `%ENV%` expand — solid product fix for “install from ~/Projects”.  
8. **Background SW** stamps `file.upload_error` with thread_id when companion disconnected mid-upload.

---

## Severity rollup

| ID | Severity | Title |
|---|---|---|
| F1 | **CRITICAL/HIGH** | Trust durable write before snapshot commit (crash → sticky cruise) |
| F2 | **HIGH** | uninstall/delete clears snap without restoreTrust |
| F3 | **HIGH** | Switch to non-trust pack nulls snap, leaves cruise |
| F4 | **MEDIUM** | Multi-thread Trust races (process-global) |
| F5 | **MEDIUM** | New ext + old companion: parent-scoped stop → process-wide |
| F6 | **MEDIUM** | MCP no longer fenced by pack allowlist (intentional) |
| F7 | **LOW–MED** | Downloads segment heuristic over-allows paths |
| F8 | **LOW** | schema_version stays 1; unknown tools fail-closed |
| F9 | **LOW** | ChatView stick nits |
| F10 | **LOW** | Config migration N/A (ok) |
| F11 | **LOW** | Test portability gaps |

---

## Verdict rationale

Compat wire hygiene for S45 leftovers and most S46 surfaces is solid (versions, upload stamps, fleet additive fields, optional pack tools, MCP cruise algebra).  

Trust B is a **new global security control plane** gated by pack apply. Its restore story is incomplete for:

- crash mid-apply (explicit review focus),
- uninstall/delete,
- pack switch off Trust,

which can leave `auto_approve_dangerous` + `auto_approve_enterprise_tools` + `allow_all_schemes` sticky across restarts. That is not a nit — it is a cross-session security/compat defect.

---

## VERDICT: REQUEST_CHANGES

**Minimum to re-review → APPROVE_WITH_NITS:**

1. Fix F2 (uninstall/delete restore Trust).  
2. Fix F3 (switch away from Trust pack restores or retains snap correctly).  
3. Mitigate F1 (write-ahead journal **or** boot reconcile for orphan cruise after trust write without snap).  
4. Tests for F2/F3 (+ ideally crash/journal path).

F4–F7 can ship as documented nits if product accepts single-holder Trust + paired extension/companion upgrades.

---

*Lane: COMPAT/PLATFORM · Adversarial · S46 main · 2026-08-06*
