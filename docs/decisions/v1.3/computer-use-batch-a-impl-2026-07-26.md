# Batch A 实现记录（G1–G3）— 2026-07-26

## Scope (grill-locked)

| ID | 内容 | 状态 |
|----|------|------|
| G1 | `posted`/`verified` on steps + task result; `TYPE_NO_EFFECT` + 1 re-focus | done |
| G2 | L2 勾选「本会话自动同意」; `explicit_opt_in` gate on initial skip | done |
| G3 | Trust key `thread:<id>` preferred; `ws:` no initial skip | done |

## Files

- `companion/src/computer/session-trust.ts` — resolveComputerTrustKey, explicitOptIn, maxActionsSeen
- `companion/src/security-confirmation.ts` — decision.addToSessionTrust
- `companion/src/server.ts` — skip gate, grant opt-in, relevantApps for host_computer
- `companion/src/computer/executor.ts` — posted/verified, TYPE_NO_EFFECT
- `companion/src/computer/types.ts` — error codes
- `companion/src/llm/adapter.ts` — inject `__thread_id`
- `companion/src/bridge/tool-definitions.ts` — single-task aggregate prompt
- `chrome-extension/.../App.tsx` + apps-utils + payload — checkbox UX

## Verify

- `computer-session-trust-g1.test.ts` 5/5
- `computer-session-trust*.test` 10/10
- `computer-executor.test.js` 102/102

## Residual honesty (documented for dual review)

- Coordinate `type` after successful inject: `posted:true, verified:false` — **does not** OCR-readback the field.
- Task may still `success:true` with unverified types; LLM must read `verified_steps` / step flags (prompt guidance, not hard enforcement).
- Full semantic verify is **Batch B** (Notes/Mail host_write re-read).

## Review cycle

| Stage | Result |
|-------|--------|
| Adversary | APPROVE_WITH_NITS (composition tests, honesty residual) |
| Claude dual | APPROVE_WITH_NITS |
| Pi dual | APPROVE_WITH_NITS |

Nits addressed: composition tests for G1 skip gate; grant/skip thread_id fallback aligned.

## Next

Batch B: Notes host_write + verify; Mail read; G6 prompt polish.