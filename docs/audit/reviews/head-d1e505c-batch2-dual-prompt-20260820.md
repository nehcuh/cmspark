# Dual review: d1e505c batch2 (residuals nits + fzbcro osascript)

## Context

Working tree on `fix/head-d1e505c-adversary-residuals` vs base `d1e505c`. Uncommitted. Two product cuts in one tree:

1. Close P2/test holes from independent HEAD review (XLAT / GCP FQDN / DNS fail-closed + distinct copy / request-path DNS / unkeyed `detected` / voice test fakes).
2. fzbcro: `osascript_eval` with `fetch` — L2 **approved**, then dispatch `checkHighRiskExecution` hard-blocked and chat said 「若你已拒绝弹窗」.

**Independent 3-lane adversary already ran.** Read the full reports, not this summary:

- Synthesis: `docs/audit/reviews/head-d1e505c-batch2-independent-adversary-synthesis-20260820.md`
- A: `docs/audit/reviews/head-d1e505c-batch2-lane-a-ssrf-20260820.md`
- B: `docs/audit/reviews/head-d1e505c-batch2-lane-b-voice-20260820.md`
- C: `docs/audit/reviews/head-d1e505c-batch2-lane-c-l2-20260820.md`
- Patch: `docs/audit/reviews/head-d1e505c-batch2-diff-20260820.patch`

Your job: **confirm or reject** the adversary synthesis. Missed P0/P1 → REJECT. Over-strict nits may be downgraded. Do not rubber-stamp lane VERDICT lines.

**Do not run full `npm test`** (hangs). Targeted suites + live `tsx` probes only if you need to re-check a claim.

## Capability declaration (ADR-020) — verify

```text
Surface:      L1 LLM endpoint (tighter); existing L2 osascript — no new Surface
L2-classes:   none new (osascript stays in L2_GATE_TOOLS)
Compose:      none
Autonomy:     single
Trust:        LLM/IMDS monotonic tighter; osascript still HITL — only removes post-approve regex veto
Channel:      community
```

## Claims (verify, don't trust)

**SSRF / DNS**

1. S-XLAT: `[::ffff:0:a9fe:a9fe]` blocked; `64:ff9b::808:808` and `::1` allowed.
2. S-GCPDOT: `metadata.google.internal.` blocked.
3. N1: NXDOMAIN copy is `LLM_ENDPOINT_DNS_ERROR`, not IMDS.
4. N2: `localhost.` hits settings-web allowlist via `canonicalizeLlmHostname`.
5. N3: `throwIfLlmEndpointBlocked` / `assertLlmEndpointAllowedAsync` before OpenAI/Anthropic stream+complete, vision analyze, lifecycle vision probe, `probeLlmConnection`, `config.test` / `config.testVision`.
6. C1: `resolveNativeVision` ignores unkeyed `detected`.

**Voice tests only (no production adapter change)**

7. B1: continuous fake is start-conflict; reverting sid-swap fails the test.
8. B2: `stop(); await 40ms; stop()` with 80ms drain hits `stopChainInFlight`.

**L2 osascript (T3)**

9. After valid token, dispatch does **not** return `contains high-risk APIs (fetch)`. Token still required. Invalid token still fails.
10. Tokenless handleMessage no longer spoofs “requires confirmation”.
11. L2 still forceConfirms all osascript_eval (god-mode alone does not skip).
12. 「若你已拒绝弹窗」 only on actual `User denied`.

## Hostile focus

1. Is `/api/testVision` allowlist-then-fetch (Lane A P2-A1) actually P1 (HTTP IMDS) or correctly P2?
2. Post-approve osascript: can a forged token execute fetch JS?
3. Trust monotonicity: is removing the regex veto a confirm skip? (Adversary says no.)
4. Would restoring `if (safety.blocked) return safety.error` in dispatch stay green on Linux CI? (Lane C N1)
5. Did voice production code change? (Adversary says tests-only.)

## Machine already claimed (re-check only if you distrust)

Implementer session: companion full suite 3063 pass / 0 fail / 23 skip + settings-web 19.  
Lanes ran their own targeted suites (A 73, B 15, C 157+4). Prefer lane [executed] over implementer numbers.

## Output

Findings with file:line. Then exactly one final line:

VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
