# Pi re-review — Trust holder conflict UX: one-click unlock + apply

**Batch**: `trust-holder-force-takeover`  
**PR**: **none** (working tree on `main`; do not open or assume a PR)  
**Base**: `HEAD` (uncommitted local changes only)

## Product intent

User hit: applying a Trust user-scene failed with  
`Trust 已被其他对话占用（thread=lxwksx, pack=user-scene-netsafety）…`

Root cause (by design): Trust B is **process-global single-holder**. A historical thread still had `mission_pack_trust_snapshot` + journal `held` even after the user considered the chat “done” (chat end ≠ unapply).

**Product ask**: when lock is detected, Side Panel should **modal-prompt** with holder identity and offer **one-click unlock + apply to current thread**.

## Scope (this batch only)

1. **Structured conflict** — `trust_holder_conflict` returns `holders: [{ id, pack_id, alias }]` and human labels (not only raw thread id).
2. **Force takeover** — `pack.apply` + `force_takeover: true` (UI-only, still requires `user_gesture`) calls `unapplyPack` on other holders then continues apply with `allowTrust`.
3. **save+apply path** — same `holders` / optional `force_takeover` on `pack.save_user` apply branch.
4. **UI** — `PacksPanel` opens conflict modal; primary CTA “解锁并用于本对话” re-sends apply with `force_takeover: true`.
5. **Audit** — `pack.trust_takeover` on each released holder.
6. **Tests** — extend S46 residual second-thread test: conflict returns holders; forceTakeover succeeds and clears holder cookie/pack.
7. **Docs** — mission-pack-usage + architecture one-liners.

## Files

- `companion/src/packs/pack-engine.ts`
- `companion/src/message-router.ts`
- `companion/src/server.ts` (validator allowlist for `force_takeover`)
- `companion/tests/packs-engine.test.ts`
- `chrome-extension/src/sidepanel/components/PacksPanel.tsx`
- `docs/mission-pack-usage.md`, `docs/architecture.md`

## Floors (must hold)

1. **No Trust write without `allowTrust` + UI `user_gesture`** — spawn / LLM must not elevate or force_takeover.
2. **`force_takeover` only meaningful with allowTrust path** — must not bypass user_gesture.
3. **Takeover unapplies holder scene** (restore cookie) before applying to target — no dual-cookie / dual-cruise.
4. **Single holder still default** without force flag.
5. **No PR / no merge claims** — review the working tree only.

## ADR-020 declaration (implementer)

```
Surface:      n/a (no new L0/L1/L2 tool)
L2-classes:   (none)
Compose:      pack (Trust B lifecycle UX)
Autonomy:     single (single Trust holder + explicit takeover)
Trust:        write only allowTrust+user_gesture; force_takeover unapply holders first; audit pack.trust_takeover
Channel:      n/a
```

## Acceptance checklist for reviewer

- [ ] Conflict path without force still fails with `trust_holder_conflict` + `holders`.
- [ ] `forceTakeoverTrust: true` unapplies other holder then applies; holder cookie/pack cleared.
- [ ] Router only passes `force_takeover` from UI `user_gesture` path; not available as LLM tool.
- [ ] UI modal shows alias; CTA sends `force_takeover: true`.
- [ ] Tests green for conflict + takeover (`npx tsx --test tests/packs-engine.test.ts`).
- [ ] No security regression: force cannot be used without user_gesture validator.

## Out of scope

- Auto-release Trust on chat.done / idle TTL
- Multi-holder refcount redesign
- Sticky pre-apply elevated baseline (nested Trust history)

## Verdict rules

Inspect **real code** (Read/Bash), not only the patch file.  
Final line exactly one of:

VERDICT: APPROVE  
VERDICT: APPROVE_WITH_NITS  
VERDICT: REJECT  
