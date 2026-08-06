# Dual external review — S46 Trust B restore lifecycle + residuals

**Branch**: `fix/s46-trust-b-restore-lifecycle` (uncommitted working tree vs `origin/main` / `6d2cdcf`)  
**Origin**: post-ship multi-adversarial on main S46 (`474df7e..6d2cdcf`) → **REQUEST_CHANGES**  
**Report**: `docs/audit/reviews/multi-adversarial-review-20260806-main-s46.md`  
**Lane reports**: `s46-lane-{security,correctness,architecture,compat}-20260806.md`

## Scope (this batch only)

Fix Trust B lifecycle holes found by multi-lane review. **Do not re-litigate** MCP cruise three-flag algebra, skill_install user_home product intent, or #125 upload/fleet (already on main).

### P0 (must hold at tip)

1. **Restore on leave** — `unapply` / `uninstall` / `deleteUserPack` / switch A→B restore global Trust from cookie; no sticky three-flag cruise after user leaves scene.
2. **Post-trust failure paths** — assets fail / blocked / patch fail after `applyUserPackTrust` must `restoreTrustSnapshot` + clear journal.
3. **Install strip** — `installPackFromDirectory` / zip must force strip `origin:user` + `trust` (only `saveUserPack` may persist).
4. **spawn `allowTrust:false`** — `applyPack` default deny Trust write; UI `pack.apply` / save+apply pass `allowTrust:true`; `spawn_worker` never elevates Trust B.

### Residuals (also in this batch)

5. **Single holder** — second thread Trust apply → `trust_holder_conflict` until first unapplies.
6. **Crash journal** — `mission-pack-trust-journal.json` applying→held; `reconcilePackTrustOnBoot` restores orphan applying/held.
7. **skill_install Downloads** — no bare path-segment `Downloads` trust; only `~/Downloads` · `~/下载` · tmp · data dir.
8. **UI honesty** — list `has_trust` / Trust modal; high-risk tool copy no longer claims “场景不能跳过确认” unconditionally.
9. **Docs** — ADR-020 exception, architecture §7.5, mission-pack-usage §2c/§10, design SoT D4 revision.

## Files to inspect (LIVE tip / working tree)

- `companion/src/packs/pack-engine.ts` (restore, journal, holder, sanitize install, applyPack allowTrust)
- `companion/src/packs/types.ts` (`has_trust`, `trust_skip_l2`)
- `companion/src/message-router.ts` (`allowTrust: true` on UI paths)
- `companion/src/server.ts` (spawn `allowTrust: false`, `reconcilePackTrustOnBoot`)
- `companion/src/skills/skill-install.ts` (Downloads classification)
- `chrome-extension/src/sidepanel/components/PacksPanel.tsx`
- `companion/tests/packs-engine.test.ts`, `companion/tests/skill-install.test.ts`
- docs: ADR-020, architecture.md, mission-pack-usage.md, user-scene spec

## Acceptance

- Apply trust pack → uninstall/delete/switch-to-non-trust → three-flag flags OFF.
- Mid-apply failure after Trust write does not leave sticky cruise without cookie.
- Malicious install yaml `origin:user` + `trust.skip_l2` cannot survive install.
- Spawn path applyPack cannot write global Trust.
- Two threads cannot both hold Trust; boot recovers applying journal.
- Tests cover the above; `npx tsx --test tests/packs-engine.test.ts tests/skill-install.test.ts` was green in implementer session (32 pass).

## ADR-020 declaration (implementer)

```
Surface:      n/a (no new L0/L1/L2 tool surface)
Compose:      pack (user-scene trust lifecycle)
Autonomy:     single (single Trust holder)
Trust:        Trust B write only allowTrust+user_gesture; restore on leave/fail; journal reconcile
Channel:      community|enterprise unchanged by install path
```

## Out of scope

- Multi-thread flag refcount (single holder is the chosen policy)
- MCP ⊥ pack allowlist redesign (D8 intentional)
- Mixed-version fleet parent_thread_id bake-off
- S45 unstamped upload_error fallback

## Verdict rules

Inspect real code (not only the multi-lane report). Final line exactly one of:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  
