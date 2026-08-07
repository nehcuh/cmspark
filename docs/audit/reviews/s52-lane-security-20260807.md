# Security Lane — S52 post-ship multi-adv
**Range**: 14e1b28..d34bac2
**Recommendation**: PASS_WITH_NITS
**Status**: CLEAR

## Findings

### F1 — Severity: HIGH (was S51 P0-1)
- File: `companion/src/packs/pack-engine.ts:398-445`; callers `companion/src/message-router.ts:1190-1194`, `1258-1259`, `1352-1356`, `1385-1405`
- Status: CONFIRMED_FIXED
- Description: Soft-delete used to restore Trust globals from `mission_pack_trust_snapshot` but left the cookie; hard-delete-from-trash re-fired the same cookie (silent cruise re-enable after Settings flip, or clobber of a later Trust scene B). At tip, `releaseTrustBeforeThreadGone` restores once when not already trashed, then **persists** `mission_pack_trust_snapshot: null` via `threadManager.update`; second call is idempotent (early return when cookie null). Already-trashed rows with a leftover pre-S51 cookie take the clear-only branch (`alreadyTrashed`) and never re-restore. Production delete/batch_delete/cleanup_empty all pass `threadManager`.
- Evidence: [inspected] `pack-engine.ts:409-444` (restore gated on `!alreadyTrashed`, then clear); [inspected] `message-router.ts:1193`, `1259`, `1355` (TM arg); [inspected] tests `packs-engine.test.ts:481-547` (trash→Settings OFF→hard no re-restore), `:550-621` (migration clear-only), `:623-680` (A trash / B apply / hard A does not clobber B).
- Attack/user path: Trust scene → 移入回收站 → Settings 关三旗 → 永久删除 → cruise must stay OFF. **Closed** at tip for post-S51 soft→hard lifecycle; migration leftovers closed by `alreadyTrashed` clear-only (stronger than soft-clear alone).

### F2 — Severity: LOW
- File: `companion/src/packs/pack-engine.ts:451-472`; `companion/src/message-router.ts:1385-1405`
- Status: RESIDUAL
- Description: `clearTrustCookieWithoutRestore` on `thread.list` correctly drops leftover trash cookies without re-restore before TTL purge, but does **not** clear the trust journal. Production soft-delete already calls `releaseTrustJournalIfMatch`, so journal is gone before list. Only a pathological trash-without-release path would leave held journal + cookie; list clear would then drop cookie while journal lingers until boot `reconcilePackTrustOnBoot` orphan_held (which restores pre-apply and de-elevates — fail-safe, not elevate). No automated router-level test for the list clear path.
- Evidence: [inspected] `pack-engine.ts:451-472` (no journal touch); [inspected] `pack-engine.ts:340-356` (orphan_held restores pre-apply snap); [inspected] production release still journals-match on soft path `415-416`.
- Attack/user path: Not a user-reachable re-elevate after #132; verification/nit only.

### F3 — Severity: LOW
- File: `companion/src/threads/thread-manager.ts:378-386`; soft-delete flow `message-router.ts:1198-1204`
- Status: RESIDUAL
- Description: Soft-delete still leaves pack **composition** (`mission_pack_id`, whitelist, append, message files) after Trust cookie is cleared. This is the prior P2-pack-split product residual, **not** a second Trust elevation. Restore-from-trash reintroduces a composition-only scene without re-writing cruise; re-elevation requires a new `pack.apply` with `user_gesture` + `allowTrust:true`.
- Evidence: [inspected] `trash()` only sets `trashed_at`; [inspected] release nulls cookie only, not `mission_pack_id`; [inspected] `pack.apply` still requires `user_gesture` (`message-router.ts:2421-2436`).
- Attack/user path: User may think “deleted scene = full leave”; security surface is honesty/composition stickiness, not silent `auto_approve_*` rewrite after Settings flip.

### F4 — Severity: LOW (out of privilege scope)
- File: `companion/src/llm/adapter.ts:570-583`
- Status: CONFIRMED_FIXED (correctness; security non-issue)
- Description: mid_loop M1 re-attaches prior M2 `rolling_summary` into request messages and sets mode `m2`. Does not expand tools, trust, or network surface. Dual-truth UI vs model was a correctness P0, not privilege.
- Evidence: [inspected] `adapter.ts:571-582`; [inspected] `attachRollingSummaryToMessages` in-place replace `context-budget.ts:328-343`; [inspected] `shouldRunM2(..., "mid_loop")` still false `context-budget-m2.ts:88`.
- Attack/user path: N/A for Trust/privilege.

### F5 — Severity: LOW (packaging)
- File: `scripts/build-windows-exe.ps1`, `scripts/create-dmg.sh`, `scripts/macos/Info.plist`, `AGENTS.md` version stamps
- Status: CLEAR
- Description: Version SoT moves hard-coded `0.2.0`/`0.4.0` stamps to `companion/package.json` + placeholder. No security feature claims, capability matrices, or trust defaults are altered by packaging. Reduces risk of shipping a binary labeled with a stale product version (support/CVE mapping hygiene only).
- Evidence: [inspected] patch packaging hunks; [inspected] `companion/package.json` version `0.4.0`.
- Attack/user path: None for Trust/privilege.

## P0-1 re-verify (from S51)
- Verdict: **FIXED**
- Evidence:
  1. **Clear after restore**: `releaseTrustBeforeThreadGone` → `restoreTrustFromThreadCookie` (if `!trashed_at`) → `releaseTrustJournalIfMatch` → `threadManager.update(..., { mission_pack_trust_snapshot: null })` with in-place fallback. [inspected] `pack-engine.ts:413-434`
  2. **Idempotent second call**: null cookie → early `return false`. [inspected] `409`; test `packs-engine.test.ts:471-473`
  3. **Hard-delete-from-trash**: `alreadyTrashed` skips restore even if pre-S51 cookie still present; clears only. [inspected] `413-419`; test `:550-621`
  4. **Callers pass TM**: `thread.delete`, `thread.batch_delete`, `thread.cleanup_empty`. [inspected] `message-router.ts:1193`, `1259`, `1355`
  5. **User path trash → Settings OFF → hard-delete**: cruise stays false. [inspected] test `:481-547`
  6. **A trash → B Trust → hard A**: B elevation not clobbered. [inspected] test `:623-680`
  7. **trash() does not re-seed cookie**: only `trashed_at`/`updated_at`. [inspected] `thread-manager.ts:378-386`

## Holds checked
| HOLD (S51 multi-lane) | Tip status | Evidence |
|---|---|---|
| #126 unapply / uninstall / switch restore | **HOLD** | [inspected] `unapplyPack` `pack-engine.ts:1520-1544`; `uninstallPack` `1570-1590`; switch-away `1295-1300` |
| #126 install strip origin/trust | **HOLD** | [inspected] `sanitizeManifestForInstall` `480-498`; install path still strips (grep install sanitize ~1082+) |
| #126 spawn `allowTrust:false` | **HOLD** | [inspected] `server.ts:3281-3292` hard-codes `allowTrust: false` |
| #126 journal + single-holder (active) | **HOLD** | [inspected] `findOtherTrustHolders` uses `list()` excl. trash `301-312`; boot reconcile `319-356`; soft-delete still `releaseTrustJournalIfMatch` |
| #128 shell abort + process tree | **HOLD** | Not modified in range `14e1b28..d34bac2` (patch themes: Trust trash, mid_loop M2, packaging, voice copy) |
| #130 data: local decode / no schemeOk | **HOLD** | Not modified in this range |
| #127 trash list_scope / batch busy | **HOLD** | Busy reject still on delete/batch; list still echoes scope `message-router.ts:1181-1187`, `1249-1251`, `1409-1424` |
| #129 voice no auto-send / busy gate | **HOLD** | Range only OS permission copy string in `voice-permission.tsx` — no STT→send path change |
| Sticky cruise primary leave paths | **HOLD** | unapply/uninstall/switch still restore; soft-delete now restore+clear (was the hole) |

### Residual double-restore / spoof / sticky probes (adversarial)
| Probe | Result |
|---|---|
| Soft → hard double-restore | **Closed** — cookie cleared on first release |
| Pre-S51 trash cookie + hard-delete | **Closed** — `alreadyTrashed` clear-only (no restore) |
| Pre-S51 cookie + list TTL | **Closed** — `clearTrustCookieWithoutRestore` before `purgeExpiredTrash` |
| Install origin=user + trust spoof | **HOLD** — sanitize still strips |
| spawn pack.apply Trust | **HOLD** — `allowTrust: false` |
| Direct hard-delete (no trash) | Restores once + clears + deletes — correct leave |
| Restore-from-trash | Cookie already null; no re-elevate without gesture apply |
| `allowTrust` production true sites | Only UI `pack.apply` / save+apply with `user_gesture` [inspected] `message-router.ts:2432-2436` |

## Summary
S51 P0-1 (Trust soft-delete cookie double-restore) is **FIXED** at tip: production release paths restore once, persist cookie null, and refuse re-restore on already-trashed / null-cookie second calls, with regression tests covering Settings flip and A/B clobber. Prior Trust HOLDs (install strip, spawn allowTrust, leave restore, journal/single-holder) remain intact; #132 introduces no new privilege elevation surface. Residual nits are soft-delete pack composition honesty, untested list-clear router path, and packaging version hygiene only — none re-enable cruise after a deliberate Settings de-escalate.
