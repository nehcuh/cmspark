# Dual review: Enterprise Session Trust (A) + Global Enterprise Auto-Approve (B) — Plan

Review this **plan** (not implementation code) as an independent senior security + product reviewer.

**Primary:** `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-2026-07-27.md`

**Against (must open and cross-check with tools):**

1. `companion/src/server.ts` — `capabilityForceConfirm` / forceConfirm / skipConfirmation (~980–1050, netsec_port_scan handler)
2. `companion/src/computer/session-trust.ts` — pattern for A (do not blindly copy unsafe bits)
3. `companion/src/capability/modules.ts` + `netsec/scope.ts` — allowlist / task auth
4. `companion/src/config.ts` — security defaults, auto_approve_dangerous, allow_all_schemes
5. `docs/mission-pack-usage.md` §5, `docs/confirm-center-user-guide.md` §5
6. `docs/adr/010-tiered-privilege-godmode.md`, `docs/adr/014-mission-pack-enterprise-modules.md`

## Review axes (cover each)

1. **Does A actually solve pentest UX** without breaking three-layer security story?
2. **Scope ∩** — can auto-approve ever fire for out-of-allowlist targets? (must be no)
3. **B vs existing god-mode / auto_approve_dangerous** — naming, confusion, privilege escalation?
4. **forceConfirm interaction** — clean gate rewrite vs footguns with spawn_worker / host_computer / critical evaluate?
5. **Grant forgery** — can LLM/WS inject session trust without human checkbox?
6. **Thread keying** — multi-agent workers, missing threadId, WS reconnect?
7. **Idle 30m + hard 8h** — sensible? fail-closed?
8. **Shell + netsec same grant** — too broad for v1?
9. **Tests T1–T10** — complete? missing cases?
10. **UI friction for B** — phrase gate enough?
11. **Q1–Q5 defaults** — agree LOCK or AMEND each.

## Output format

- Blocking issues (if any) with plan section refs
- Non-blocking nits
- Explicit table: Q1–Q5 → LOCK | AMEND | OPEN with one-line reason
- One paragraph: safe to implement Phase 1 after this review?
- Final line MUST be exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
