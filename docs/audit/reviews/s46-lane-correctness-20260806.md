# Lane: Correctness — S46 main pull multi-adversarial

**Date:** 2026-08-06  
**Range:** `474df7e..6d2cdcf` (S46)  
**Tip SHA:** `6d2cdcf` (claimed; LIVE sources under workspace tip)  
**Diff artifact:** [`docs/audit/reviews/s46-main-pull-diff-20260806.patch`](./s46-main-pull-diff-20260806.patch)  
**Evidence mode:** patch + LIVE tip sources `[inspected]`. Targeted suites **not re-executed** in this reviewer runtime. Test *existence* and polarity inferred from source + test files only `[inspected]`.

**Themes reviewed:**
1. #125 upload thread isolation + fleet stop scope (S45 REQUEST_CHANGES / P0 F1)
2. skill_install user_home L2
3. MCP cruise confirm waive + ChatView scroll stick
4. user-scene tools.mode allowlist + AI generate/optimize + MCP orthogonal
5. Trust B apply/unapply snapshot

---

## Verdict: REQUEST_CHANGES

**S45 P0 upload isolation and fleet stop stamps are FIXED at tip** and hold under adversarial re-read. MCP cruise three-flag waive, ChatView stick-to-bottom, pack native allowlist + MCP orthogonality, skill_install home tier, and happy-path Trust B apply/unapply all **hold**.

**Blocking residual (Trust B failure / transition state machine):** global Trust can remain elevated after a **failed** apply (asset install throws with no rollback), and switching from a trust-writing pack to a **non-trust** pack **drops** `mission_pack_trust_snapshot` while leaving process-global cruise/modules on — unapply of the new pack cannot restore. These violate the product claim that Trust writes are paired with restore / failure rollback.

Everything else is MEDIUM residual / LOW-NIT debt.

---

## Claim matrix

| # | Theme | Product claim | Status at LIVE tip | Evidence |
|---|--------|---------------|--------------------|----------|
| 1a | #125 upload isolation | `file.upload_error` always clears **upload** mapBusy; panel chrome gated by `shouldApplyStreamEvent` | **HOLDS** | `useWebSocket.ts:1179–1205`; `App.tsx:224–227,603–623`; SW stamp `background/index.ts:582–595` |
| 1b | #125 upload isolation | Oversized / invalid upload → stamped `file.upload_error` | **HOLDS** | `server.ts:6096–6193` |
| 1c | #125 fleet stop | Run scope stamps `orchestrator_run_id`; companion filters by run | **HOLDS** | `thread-busy.ts:178–209`; `FleetStrip.tsx:109–125`; `FleetWorkerList.tsx:71–88`; `message-router.ts:1814–1839` |
| 1d | #125 fleet stop | Parent scope stamps `parent_thread_id` (not process-wide) | **HOLDS** | same + companion parent filter |
| 2 | skill_install home | `~/…` is `user_home` (allowed); L2 still required; outside home denied | **HOLDS** | `skill-install.ts:100–135`; pre-L2 deny `server.ts:1065–1103`; `capabilityForceConfirm` includes `skill_install` `server.ts:1522–1529` |
| 3a | MCP cruise | Three-flag cruise waives MCP critical/manual confirm; partial flags still confirm | **HOLDS** | `server.ts:4687–4713`; tests in `mcp-capability-gate.test.ts` (partial / three-flag) |
| 3b | ChatView scroll | Sticky bottom only when pinned; no yank when user scrolled up; thread switch re-pins | **HOLDS** (nits) | `ChatView.tsx:87–252,1305–1314` |
| 4a | tools.mode | allowlist/intersect/unchanged; unknown tools rejected; empty allowlist rejected | **HOLDS** | `pack-engine.ts:52–84`; validator; packs tests |
| 4b | MCP orthogonal | Pack whitelist filters **native** tools only; MCP meta/namespaced not stripped; `isToolAllowed` permits `mcp__*` | **HOLDS** | `adapter.ts:489–496`; `thread-manager.ts:569–585` |
| 4c | AI generate/optimize | Filter ids to candidates; no silent corrupt pack (UI confirm+save); optimize keeps skills empty | **HOLDS** | `suggest-scene.ts:142–183,230–378` |
| 5a | Trust B happy path | User pack `skip_l2` / modules / auto_approve → global config; unapply restores snapshot | **HOLDS** (happy path) | `pack-engine.ts:149–225,1111–1154`; test `packs-engine.test.ts:111–169` |
| 5b | Trust B failure rollback | Trust apply fail / post-trust apply fail rolls back global Trust | **PARTIAL / FAIL** | blocked+thread-patch rollback exist; **installAssets catch has no restore** (`pack-engine.ts:1035–1037`) |
| 5c | Trust B switch | Leaving a trust-writing scene restores / retains restore handle | **FAIL residual** | Switch A(trust)→B(no trust) clears `mission_pack_trust_snapshot` without restoring globals |

---

## S45 P0 re-verification (must be FIXED)

### F1 (S45) — `file.upload_error` + SW fail thread gate — **FIXED** `[inspected]`

**S45 REQUEST_CHANGES root:** foreign `file.upload_error` always cleared active `isProcessing` and `ADD_MESSAGE` into the wrong transcript.

**LIVE tip:**

```1179:1205:chrome-extension/src/sidepanel/hooks/useWebSocket.ts
        case "file.upload_error": {
          const uploadErrTid =
            (typeof msg.thread_id === "string" && msg.thread_id) || activeThreadRef.current || ""
          if (uploadErrTid) {
            dispatch({ type: "SET_THREAD_BUSY", threadId: uploadErrTid, busy: false })
          }
          if (!shouldApplyStreamEvent(uploadErrTid, activeThreadRef.current)) break
          // … chrome + ADD_MESSAGE only after gate
```

Same pattern on `file.uploaded` (`:1212–1224`) and SW-fail in `App.tsx` with `activeThreadIdRef` (`:224–227`, `:603–623`).

Companion stamps oversized / invalid paths (`server.ts:6116–6190`). Message-router persists parse failures to the upload thread (`message-router` patch `uploadError` helper) so switch-back can still show history — good isolation UX.

**Residual (LOW, accepted):** unstamped `file.upload_error` / bare `error` still fall back to active thread (`shouldApplyStreamEvent("", active) === true`). Primary stamped paths are correct.

### Fleet stop stamp — **FIXED** `[inspected]`

| Scope | Payload | Companion |
|-------|---------|-----------|
| `run` | `orchestrator_run_id: runId` | `listWorkers(tm, runId)` |
| `parent` | `parent_thread_id: parentId` | filter workers by parent |
| `none` | neither (process-wide) | all workers; honest copy |

UI uses `buildFleetStopAllMessage`; empty scope disables button with non-claiming title on strip.

**Tests present:** `stream-thread-gate.test.ts` upload-style foreign gate; `thread-busy.test.ts` run/parent/none payloads. `[inspected]`

---

## Findings (new / residual)

### F1 — HIGH — Trust apply: asset install failure leaves global Trust elevated

**Where:** `companion/src/packs/pack-engine.ts:948–983` (trust write) then `:1025–1037` (assets)

**Issue:** Product B applies Trust **before** thread mutation so module gates pass. On `installAssetsFromValidated` / `skillEngine.refresh()` throw:

```1025:1037:companion/src/packs/pack-engine.ts
  try {
    skillIds = installAssetsFromValidated(/* … */)
    skillEngine.refresh()
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
```

There is **no** `restoreTrustSnapshot(trustSnap, …)`. Contrast:

- trust apply fail → restore if new snap (`:973–981`)
- `computeApplyBlocked` → restore (`:988–994`)
- `applyPackPatch` throw → restore (`:1094–1101`)

**Effect:** UI reports apply **failed**, but process-global `auto_approve_*` / `allow_all_schemes` / enabled modules from `skip_l2` may remain **ON**. No `mission_pack_id` / no trust snapshot on thread → **unapply cannot undo**. Sticky full-autonomy cruise after a failed apply is a correctness + safety state-machine break.

**Evidence:** `[inspected]` control-flow only; no test covers this path (`packs-engine.test.ts` has happy-path trust only).

**Fix sketch:** In the catch, if `trustSnap`, call `restoreTrustSnapshot(trustSnap, \`pack.apply_assets_fail:${packId}\`)` (same as patch failure). Optionally reverse only modules enabled in this attempt.

---

### F2 — HIGH — Switch trust-writing pack → non-trust pack drops restore handle, keeps cruise

**Where:** `pack-engine.ts:948–985`, `:1082–1084`, `unapplyPack:1138–1144`

**Issue:**

1. Apply pack A with `trust.skip_l2` → globals elevated; `mission_pack_trust_snapshot` = pre-A.
2. Apply pack B **without** `trust` → `trustSnap` stays `null`; patch sets `mission_pack_trust_snapshot: null`.
3. Globals from A **remain** elevated (no restore on switch-out of A).
4. Unapply B restores thread tools/skills only; **does not** restore Trust (no snap).

**Effect:** User “left” the red-team / Trust scene by applying another scene; cruise stays on forever until manual Settings. Claim “unapply restore” is incomplete for the common **switch** path.

**Evidence:** `[inspected]`  
**Fix sketch:** Before clearing prior pack’s trust handle, if outgoing thread had `mission_pack_trust_snapshot` and incoming pack has no trust (or weaker policy), `restoreTrustSnapshot(prior)` (or re-capture semantics documented as absolute pack-defined Trust with explicit restore-on-leave).

---

### F3 — MEDIUM — Re-apply trust failure with `prior` skips restore

**Where:** `pack-engine.ts:973–981`

```typescript
if (!tr.ok) {
  if (!prior) {
    restoreTrustSnapshot(trustSnap, …)
  }
  return { ok: false, … }
}
```

On re-apply, `applyUserPackTrust` can partially mutate (security flags saved, then `setModuleEnabled` fails mid-loop). With `prior` set, **no** restore runs — flags may stick mid-flight while apply returns failure.

**Evidence:** `[inspected]`  
**Fix:** Always restore to `trustSnap` (the frozen pre-first-apply snap) on any trust-path failure, or make `applyUserPackTrust` transactional.

---

### F4 — MEDIUM — Global Trust is process-wide; multi-thread unapply thrash

**Where:** `applyUserPackTrust` / `restoreTrustSnapshot` use `getConfig`/`saveConfig` (process singleton).

**Issue:** Thread A applies Trust pack; Thread B applies another Trust pack; A unapplies → restores **A’s** pre-snap, possibly demoting B’s intended cruise. By design of Product B global write, but not multi-thread safe. Document or last-writer / refcount if product multi-scene concurrent.

**Evidence:** `[inspected]` design residual.

---

### F5 — LOW — Unstamped upload / bare `error` still legacy-apply to active

**Where:** `useWebSocket.ts:1180–1181`, `:1227+` `error` case uses `activeThreadRef` for mapBusy.

**Issue:** Same residual as S45 follow-up adversarial. Stamped paths fixed; edge paths (peek fail, non-upload oversized) still bare `error`.

**Evidence:** `[inspected]`

---

### F6 — LOW — ChatView programmatic scroll can mask user unpin for ~2 frames

**Where:** `ChatView.tsx:87–104` (`ignoreScrollRef` cleared after double `rAF`)

**Issue:** User scroll-up during those frames is ignored → delayed unpin. Acceptable; not a stuck-pin forever.

**Evidence:** `[inspected]`

---

### F7 — NIT — `stickKey` deps update even when unpinned

**Where:** `ChatView.tsx:209–219`

When unpinned, effect still advances `lastStickKeyRef` before early return — harmless; re-pin near bottom relies on user proximity + ResizeObserver/next growth.

**Evidence:** `[inspected]` (matches prior cruise/scroll review nits)

---

### F8 — NIT — AI generate does not hard-reject “security override” language in prompt draft

**Where:** `suggest-scene.ts` system prompts forbid auto-approve language; `parseSceneSuggestion` only caps length — no content filter.

**Issue:** Model could still draft “跳过确认” text into `system_prompt_append`; user must save. Not silent pack corruption (save is separate; no auto-apply). Residual content hygiene only.

**Evidence:** `[inspected]`

---

## Theme deep-dives (non-blocking holds)

### 2 — skill_install user_home L2 `[inspected]`

| Path | Behavior |
|------|----------|
| Downloads / 下载 / tmp / `~/.cmspark-agent` | tier `default` |
| under `os.homedir()` (realpath both sides) | tier `user_home` |
| elsewhere (e.g. `/etc/hosts`) | `denied` before L2 |
| L2 | `skill_install` in `L2_GATE_TOOLS` + `capabilityForceConfirm`; waived only three-flag cruise |
| Token | executor requires `security_token` |

Tests: `skill-install.test.ts` tier + home-shaped path. Cruise still allows install without dialog (product residual risk, intentional, audited via `security.critical_api_waived`).

### 3 — MCP cruise + ChatView `[inspected]`

MCP:

```4687:4713:companion/src/server.ts
  const userFullAutonomyCruise =
    securityConfigEarly?.auto_approve_dangerous === true &&
    securityConfigEarly?.auto_approve_enterprise_tools === true &&
    securityConfigEarly?.allow_all_schemes === true
  if ((needsConfirm || forceMcpConfirm) && userFullAutonomyCruise) {
    logger.info("mcp.confirm.waived", { …, reason: "full_autonomy_cruise" })
  } else if (needsConfirm || forceMcpConfirm) {
    // request confirm
```

Partial flags still confirm (integration tests assert). OriginWs binding preserved on confirm path (prior dual-review).

ChatView:

- `stickKey` fingerprints length + last msg id/content/tool results + stream + processing label  
- `ResizeObserver` on `contentRef` for late layout (mermaid/tools)  
- `pinnedRef` + 120px threshold; thread switch resets pin  
- container `overflowAnchor: "none"` — stick via JS not CSS yank  

### 4 — tools.mode + AI + MCP orthogonal `[inspected]`

- `resolveUserPackTools`: mode validation, known native tools only, auto-inject `use_skill` when skills present, non-empty allowlist for mode=allowlist  
- `computeWhitelist`: allowlist / intersect (null→allowlist) / unchanged  
- **Adapter:** whitelist filters `nativeTools` only; MCP + meta always appended  
- **Execution:** `isToolAllowed` returns true for `mcp__*` and MCP meta tools under allowlist scenes (D8)  
- AI: `parseSceneSuggestion` intersects candidate sets; generate/optimize modes; never writes pack without UI save  

### 5 — Trust B happy path `[inspected]`

- `skip_l2` → three flags true + enterprise profile when modules/shell/netsec  
- snapshot frozen across re-apply (`prior`)  
- unapply restores flags + modules from snap  
- Test: `saveUserPack trust skip_l2 + enable shell applies global Trust and unapply restores`  

---

## Test coverage map (claim → tests)

| Claim | Tests (present?) |
|-------|------------------|
| `shouldApplyStreamEvent` upload foreign | `chrome-extension/tests/stream-thread-gate.test.ts` ✓ |
| `buildFleetStopAllMessage` run/parent/none | `chrome-extension/tests/thread-busy.test.ts` ✓ |
| skill_install tiers / home | `companion/tests/skill-install.test.ts` ✓ |
| MCP three-flag waive / partial confirm | `companion/tests/integration/mcp-capability-gate.test.ts` ✓ |
| Trust apply + unapply restore | `companion/tests/packs-engine.test.ts` ✓ happy path |
| Trust installAssets fail rollback | **Missing** |
| Trust switch A→B non-trust | **Missing** |
| MCP orthogonal under allowlist (`isToolAllowed` + adapter) | **No dedicated unit** (logic inspected) |
| ChatView scroll pin/unpin | **No unit** (UI inspection only) |
| AI suggest filter / generate | `companion/tests/packs-suggest-scene.test.ts` (exists in tree) |

---

## What is *not* REQUEST_CHANGES material

- S45 F1 upload isolation and fleet stop — **fixed and adequate** for ship of those claims.  
- MCP cruise algebra — consistent with shell/skill_install three-flag pattern; tests back polarity.  
- ChatView stick — correct by inspection; residual nits only.  
- AI scene draft — cannot silently corrupt installed packs.  
- skill_install home — product intent (“confirm, don’t hard-deny”) matches code.

---

## Required before APPROVE (Trust B)

1. **P0:** On `installAssetsFromValidated` / refresh failure after Trust write, always `restoreTrustSnapshot` when `trustSnap` is set (F1).  
2. **P0 or explicit product doc + UX:** On apply of pack **without** trust while previous thread pack held a trust snapshot, restore prior Trust (or warn + clear with user consent) so cruise does not stick after “leaving” the Trust scene (F2).  
3. **P1:** Make re-apply trust failure restore when `prior` is set / make `applyUserPackTrust` transactional (F3).  
4. **P1 tests:** asset-fail rollback; switch trust→non-trust restore behavior.

Until (1)–(2) land or product explicitly accepts “failed apply / switch may leave cruise on”, **do not claim Trust B failure paths complete**.

---

## Summary scores (adversarial)

| Area | Score | Note |
|------|-------|------|
| Upload / fleet (S45 P0) | **Pass** | Isolation + scope stamps hold |
| skill_install home | **Pass** | Tier + L2 algebra hold |
| MCP cruise / ChatView | **Pass** | Waive only when intended; stick when pinned |
| tools / AI / MCP ortho | **Pass** | Allowlist does not kill MCP |
| Trust B | **Fail residual** | Happy path OK; fail/switch state machine incomplete |

---

*Lane: Correctness · S46 main pull · 2026-08-06 · evidence primarily `[inspected]` LIVE tip + patch; suites not re-run in this pass.*

VERDICT: REQUEST_CHANGES
