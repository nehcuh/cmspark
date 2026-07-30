# P1-1 Security Batch Report — god-mode companion step-up

| Field | Value |
|-------|--------|
| Date | 2026-07-29 |
| Branch | `fix/diagnosis-P1-1` |
| Inventory | [p1-security-open-items-2026-07-29.md](../p1-security-open-items-2026-07-29.md) |
| Status | **FIXED** (shipped on branch; dual-review: internal adversarial pass; external: Claude substantive APPROVE_WITH_NITS once, later 429 infra; Pi APPROVE / APPROVE_WITH_NITS) |

## Design A

Companion `config.set` requires top-level `confirmation_phrase` matching `SECURITY_ARM_CONFIRM_PHRASE` (`我了解风险`) for **false→true** on:

- `security.allow_all_schemes`
- `security.auto_approve_dangerous`
- `security.auto_approve_enterprise_tools`

Disarm and already-true resend need no phrase. Settings + background forward phrase.

## Files

- `companion/src/security-arm.ts` (new)
- `companion/src/message-router.ts`
- `companion/tests/message-router-config-security.test.ts`
- `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`
- `chrome-extension/src/background/index.ts`
- `docs/adr/010-tiered-privilege-godmode.md`
- inventory update

## Tests

`node --test .test-dist/tests/message-router-config-security.test.js` — **21 pass** (includes full P1-1 arm/disarm matrix).

## Dual-review notes

- Substantive Claude: `P1-1-claude-20260729-172911.md` → APPROVE_WITH_NITS
- Pi: APPROVE / APPROVE_WITH_NITS on later rounds
- Final rounds: Claude API 429 (quota) — not a code reject
