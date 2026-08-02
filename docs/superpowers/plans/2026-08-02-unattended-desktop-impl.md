# Implementation Plan — 无人值守 · 桌面值守

| Field | Value |
|-------|--------|
| Date | 2026-08-02 |
| Status | **COMPLETE M0–M3** — final dual APPROVE_WITH_NITS (`unattended-desktop-m3-verdict-20260802-161147`); WeChat device checklist optional for operator |
| Design SoT | [../specs/2026-08-02-unattended-desktop-design.md](../specs/2026-08-02-unattended-desktop-design.md) |
| Adversary | [../../audit/reviews/unattended-desktop-adversary-synthesis-20260802.md](../../audit/reviews/unattended-desktop-adversary-synthesis-20260802.md) |
| Parent | Trust IA S34 (运行自主度) |
| Workflow | M0 dual → M1 Pi → M2 Pi → M3 dual |

---

## Capability declaration

```text
Surface:      L2
L2-classes:   host_computer
Compose:      none
Autonomy:     single
Trust:        unattended session grant (new) + autopilot flag packaging
Channel:      community | enterprise
```

---

## Frozen product parameters (pre-M1)

| Param | Value |
|-------|--------|
| Initial L2 after arm | **Skip** (Option B) |
| Scope | Companion **process memory** |
| App filter | `coordinateAllowed` every task |
| Corpus | **open_within_app** for unattended only |
| Hard TTL | **8 hours** wall clock |
| Idle clear unattended | **No** (G1 idle unchanged) |
| PROMPT_ALWAYS | Unchanged force interactive |
| Dual-write on arm | full cruise bools (dangerous+enterprise; protocol optional) |
| Disarm default | clear grant only; optional clear all cruise |

---

## M0 — Docs / ADR (no code)

### Tasks

1. Draft `docs/adr/021-unattended-desktop-session.md`  
2. Patch ADR-017 D3/D4, ADR-020 Axis A rule 2, Trust IA D4 matrix footnote, ADR-010 reaffirm  
3. Patch `computer-use-user-guide.md` §5 (G1 vs 值守)  
4. Dual-review **this plan + design SoT** (this batch)

### Exit

Pi+Claude **APPROVE / APPROVE_WITH_NITS**. Freeze any remaining OQs in ADR-021.

### Pi/Claude gate command

```bash
scripts/dual-external-review.sh unattended-desktop \
  docs/audit/reviews/unattended-desktop-dual-review-prompt-20260802.md
```

---

## M1 — Companion grant algebra

### Files

| Path | Action |
|------|--------|
| `companion/src/computer/unattended-grant.ts` | **New**: arm/disarm/status, TTL, pure `unattendedInitialSkipEligible` |
| `companion/src/server.ts` | Compose `hostComputerTrustSkip = g1 \|\| unattended`; audit reason |
| `companion/src/message-router.ts` | `security.unattended.{arm,disarm,status}` |
| `companion/src/packs/types.ts` | Forbid any future key if needed |
| `companion/tests/computer-unattended-grant.test.ts` | Units T1-* |

### Predicate (normative)

```ts
function unattendedInitialSkipEligible(a: {
  armed: boolean
  coordinateAllowed: boolean
  experimental: boolean
  modelEnabled: boolean
  credentialLatched: boolean
  budget: number
  actionCount: number
  maxBudgetCap: number
  maxActionsCap: number
  now: number
  expiresAt: number
}): boolean {
  if (!a.armed) return false
  if (a.now >= a.expiresAt) return false
  if (a.coordinateAllowed !== true) return false
  if (a.experimental) return false
  if (a.modelEnabled === true) return false
  if (a.credentialLatched) return false
  if (!(a.budget > 0 && a.budget <= a.maxBudgetCap)) return false
  if (!(a.actionCount >= 0 && a.actionCount <= a.maxActionsCap)) return false
  return true
}
```

### Arm RPC

```text
security.unattended.arm
  confirmation_phrase: "我了解风险"  // required
  include_protocol?: boolean       // default false → allow_all_schemes
  // dual-write cruise via existing config.set paths or single handler

security.unattended.disarm
security.unattended.status → { armed, armed_at, expires_at }
```

Phrase check: reuse `SECURITY_ARM_CONFIRM_PHRASE` constant; **do not** add to persistent `SECURITY_ARM_FLAGS` for grant (not config SoT).

### M1 Exit / Pi review

```bash
# After code: write milestone prompt, then
scripts/dual-external-review.sh unattended-desktop-m1 <m1-prompt>
# or pi-only if tooling prefers single: document Pi path
```

User asked **Pi at each important node** — M1/M2 use Pi-focused review; if dual script always runs both, both OK if Pi APPROVE*.

Acceptance:

- [ ] Unarmed → no skip  
- [ ] Armed + coord app → initial L2 skipped  
- [ ] !coord → no skip / fail policy  
- [ ] experimental / modelEnabled / latch → no skip  
- [ ] Restart clears  
- [ ] Bad phrase rejects  
- [ ] Audit reason `unattended_session_grant`  
- [ ] G1 path regression green  
- [ ] god/auto_approve alone still no CU skip  

---

## M2 — Extension UX

### Files

| Path | Action |
|------|--------|
| `autopilot-tier.ts` | Tier `unattended`; matrix column; chip `值守中 · 桌面` |
| `SettingsSlideout.tsx` | Radio + dual checkbox + phrase → arm RPC + dual-write flags |
| `StatusRail.tsx` / `SafetyStrip.tsx` | Chip hydrate from status; disarm |
| `useWebSocket.ts` | status push if any |

### M2 Exit / Pi review

- [ ] 无人值守 radio + matrix red line visible  
- [ ] Arm requires both checkboxes + phrase  
- [ ] Chip shows when armed; disarm works  
- [ ] Switching to 网页巡航 clears unattended grant  
- [ ] 协议解锁 copy still says 不含桌面  

---

## M3 — Integration + docs + manual

### Tasks

1. Integration test: mock/sim first host_computer under arm → no confirmation request  
2. Tests: PROMPT_ALWAYS still prompts  
3. Docs lockstep user guides  
4. Manual checklist (WeChat):

| Step | Expect |
|------|--------|
| Arm 无人值守 | Chip 值守中 |
| host_computer type to WeChat | No initial L2 |
| Steal foreground | Still prompt |
| Disarm | Next task L2 returns |
| Restart companion | Must re-arm |

### M3 Exit

**Pi + Claude dual-review** on full diff. Both APPROVE* → merge / ship claim.

```bash
scripts/dual-external-review.sh unattended-desktop-m3 <final-prompt>
```

---

## Rejection gates (any PR)

| # | Gate |
|---|------|
| R1 | allow_all_schemes alone sets hostComputerTrustSkip |
| R2 | PROMPT_ALWAYS silenced |
| R3 | Pack can arm |
| R4 | Grant persists across restart without ADR |
| R5 | Non-coordinateAllowed app skips |
| R6 | Estop weakened |
| R7 | Matrix lies about CU |

---

## Rollback

1. Disarm + restart  
2. Revert `unattended-grant` composition to g1-only  
3. ADR-021 → Superseded  

---

## Open questions frozen by this plan (for dual-review challenge only)

| OQ | Frozen value |
|----|----------------|
| Scope | Process memory arm |
| Corpus | open_within_app |
| TTL | 8h hard |
| Hourly rate tighten | Keep 30/60s v1 (nit if reviewers demand lower) |
| Channel | community may arm CU unattended (shell still enterprise) |

---

## VERDICT (author)

Plan ready for **M0 dual-review**. **No M1 code until APPROVE\***.
