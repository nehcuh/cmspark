# Mission Pack P0 — Adversarial Review

Branch `feat/mission-pack-p0` @ `a170023`. Could not independently run tests (`npm test` gated behind approval in this session) — audited by inspection against spec §10 P0 + §17 must-fixes, accepted the "1863 / 239 pass" claim as a hypothesis, not ground truth.

## Spec coverage — §10 P0 checklist

| Item | Status | Evidence |
|---|---|---|
| `pack.yaml` schema + validator (blocklist / unknown tools / zip slip) | ✅ | `companion/src/packs/validator.ts` — `FORBIDDEN_PACK_KEYS`, `knownToolNames()`, `resolveContained()` realpath containment |
| `system_prompt_append` ALLOWED + adapter merge | ✅ | `thread-manager.ts:51` + `adapter.ts:343-361` (base→skills→append→safety guard order) |
| Copy-style pack skill/knowledge load (no multi-root) | ✅ | `pack-engine.ts:124-148` `installAssetsFromValidated` |
| Atomic `pack.apply` + `mission_pack_snapshot` | ⚠️ **partial** | see Bug #1 — switching packs mutates thread before commit |
| `pack.uninstall` rollback snapshot | ✅ | `pack-engine.ts:462-498` with dirty-data fallback |
| WS list / install / apply / uninstall | ✅ | `message-router.ts:1361-1426` |
| Built-in `appsec-prd-review` | ✅ | `companion/src/packs/builtin/appsec-prd-review/` |
| `capability-audit.jsonl` contract | ⚠️ minor | `audit-log.ts` — append/rotate/size OK; **file created world-readable then chmod'd** |
| `modules.appsec` default false + apply gate | ✅ | `config.ts:208-215`, `computeApplyBlocked` |
| No Shell PTY, no NetSec | ✅ | none in diff |

## Findings

### Bug #1 — `applyPack` is not atomic when switching packs (S8 violation)
`companion/src/packs/pack-engine.ts:389-392` — when switching packs (A→B), `restoreSnapshot(A)` runs **before** pack B is validated or built. If pack B's `applyPackPatch` then throws validation (e.g. snapshot has bad shape, system_prompt_append > 16 KB, etc.), pack A's snapshot has **already been restored and cleared** (`mission_pack_id = null`, `mission_pack_snapshot = null`). The thread ends up in a "no pack" state, even though the user requested switching TO B FROM A. S8 says "on any error before step 3: thread unchanged" — this is broken for the switch case.

Fix: build the entire B-patch in memory first (incl. capturing snapshot from the post-A-restore state virtually), then make exactly **one** `applyPackPatch` call.

### Bug #2 — re-applying the same pack corrupts the snapshot
`pack-engine.ts:394-396` — `snap = snapshotFromThread(fresh)` is captured from the **post-pack** state when `mission_pack_id === packId`. The new `snap` is then written back as `mission_pack_snapshot` via `applyPackPatch`, overwriting the original pre-pack snapshot. After a single re-apply, `uninstall` restores to the post-pack state (still has the restricted whitelist, pack-namespaced skills) rather than the genuine pre-pack state.

Repro: apply(A) → snap₁=pre-A; apply(A) → snap₂=post-A (overwrites snap₁); uninstall(A) → restores snap₂, thread stays restricted.

### Bug #3 — `userAppendBase` 6-way nested ternary is broken for re-apply
`pack-engine.ts:419-432` is incomprehensible. Tracing the re-apply same-pack case where the user has manually set `config_override.system_prompt_append = "user rules"` between applies:

- `fresh.mission_pack_id === packId && snap.system_prompt_append !== null` → `userAppendBase = null`
- `systemPromptAppend = mergeSystemPromptAppend(null, packAppend)` = pack block only

**The user's manual `system_prompt_append` is silently dropped on re-apply.** This contradicts §6.5 ("if thread already has user system_prompt_append: new = pack block + user portion"). The snapshot was supposed to preserve the user portion but Bug #2 already clobbered it.

Suggested fix: extract user portion once via the `--- User ---` separator and never rely on the snapshot for that, plus freeze the snapshot on re-apply (Bug #2 fix).

### Bug #4 — non-atomic install under `force: true` (builtin packs every restart)
`pack-engine.ts:228-235` — `removeNamespacedAssets(id)` and `fs.rmSync(dest)` run **before** `fs.renameSync(tmp, dest)` and `installAssetsFromValidated`. If anything between `removeNamespacedAssets` and the final `skillEngine.refresh()` throws (disk full, permission flip, race with a concurrent uninstall), the user is left with:
- Namespaced skill files deleted
- Old installed dir gone
- New installed dir present but no namespaced skills copied
- A previously-applied pack that references now-missing skills

`ensureBuiltinPacksInstalled` runs with `force:true` on **every companion start** (`server.ts:359-365`), so the blast window opens daily. Atomic install = rename tmp→dest_new, then swap via single rename.

### Bug #5 — audit log file is briefly world-readable
`audit-log.ts:79-84` — `appendFileSync` creates the file with default mode (typically `0o644`) and **then** `chmod 0o600` runs. There's a brief window where the file is world-readable. For a single-user laptop this is mostly theoretical, but the existing audit H1 fix for `config.json` did it right (`writeFileSync(path, data, { mode: 0o600 })`). The test only asserts `mode & 0o022 == 0` (write bits) — it would pass for `0o644`, so the test doesn't catch it. Spec §8.2 explicitly requires `0o600`.

Fix: `fs.openSync(p, "a", 0o600)` or pre-create the file with `writeFileSync(p, "", { mode: 0o600 })` on first touch.

### Minor issues / observations

- **`pack.install` accepts arbitrary `dir` / `zip_path` from the WS.** This is by design (packs are user-trusted, validator does containment), but worth noting: an attacker who steals the WS secret can install packs from any path on disk. Document this in a threat model comment if not already.
- **`intersect` mode in `computeWhitelist` double-subtracts deny.** `allowClean = allow \ deny`, then `current.filter(t => allowClean.includes(t) && !denySet.has(t))`. Redundant but harmless.
- **Plan promised `test("apply is all-or-nothing when skill copy missing")`** — that test is absent from `packs-engine.test.ts`. Bug #1 would have been caught by it.
- **Uninstall dirty-data fallback** (`pack-engine.ts:475-483`) doesn't restore `skill_selection_mode` / `knowledge_selection_mode` / `mcp_selection_mode` — leaves them at the pack's `"manual"`. Spec §6.7 says "保守可恢复" so acceptable, but worth a comment.
- **`PacksPanel.tsx` calls `setTimeout(refresh, 300)` after `modules.set_enabled`** — race-prone; on slow WS the panel still shows disabled. Not blocking.
- **`contextBarTabsForLevel`** drops the `packs` tab in `computer` mode — reasonable for the redesign, but users in L2 can no longer apply packs from the side panel (Cockpit only). Acceptable per §9.2.
- **`ensureBuiltinPacksInstalled` uses `force:true`** — reinstalls the appsec pack on every companion restart, including re-running `removeNamespacedAssets`. If a user is in the middle of editing a namespaced skill file, their edits get wiped. Edge case but possible.

## What's solid

- **Validator** is tight: schema_version gate, `PACK_ID_RE`, `knownToolNames()` rejects unknown tools hard (no warn-and-strip), `scanForbidden` recurses into nested structures, `resolveContained` uses `realpathSync` on both root and target so symlink escapes fail. ✅
- **`computeWhitelist` S11 intersect-with-null degrade** is correct (`pack-engine.ts:50-52`). ✅
- **Thread `applyPackPatch`** validates everything (whitelist shape, modes, config_override) before mutating — single `saveIndex` commit. ✅
- **Adapter prompt ordering** matches §6.5: `overrideSystemPrompt || basePrompt → skillPrompt → systemPromptAppend → safetyGuardContent`. ✅
- **Audit log rotation** matches §8.2 (10 MB → `.1`, max 3 rotated). ✅
- **Module gate** (`computeApplyBlocked`) correctly returns `enterprise_profile_required`, `module_unavailable`, `module_disabled` codes for UI to dispatch on. ✅
- **Zip slip defense** is layered (pre-check + post-extract realpath walk). ✅

## Verdict

**APPROVE_WITH_CHANGES — Confidence 78%**

Three real correctness bugs (Bug #1 atomicity, Bug #2 snapshot corruption, Bug #3 user content loss) cluster around the same convoluted `applyPack` re-apply / switch logic and would benefit from a single rewrite that:
1. Builds the full patch in memory (incl. snapshot) before any thread mutation
2. Freezes the snapshot on re-apply (`mission_pack_id === packId` → reuse existing snapshot)
3. Replaces the 6-way ternary with a one-line split on `--- User ---`

Bug #4 (non-atomic force install) and Bug #5 (audit file mode window) are lower-severity but cheap to fix in the same PR.

None of these are P0 security blockers — the security invariants (validator containment, blocklist, unknown-tool rejection, module gate, zip slip, file contract size/rotation) are all enforced. The bugs are about **state coherence** under partial failure and re-apply, not about security bypasses.

Recommend: fix Bugs #1–#3 before merge (they're tractable in <100 LoC), add the missing "all-or-nothing on switch" test the plan promised, then ship.
