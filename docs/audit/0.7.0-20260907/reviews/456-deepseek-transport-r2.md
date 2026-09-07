# Actual model: deepseek-v4-pro

Test claims spot-checked: session isolation (`sessions === 1` on origin denial, `=== 2` after expiry recovery), no automatic retry, evidence capture isolated to the active scope, zero-profile default-only fix, and the mock-clock mid-metadata-expiry block all trace to the shipped code. Test-harness-only mocks (`releaseTabLease`, skill fixtures) are correctly confined behind the harness.

## VERDICT

**PASS — approve lane.** No BLOCK, no MAJOR in the transport bounded lane of frozen R2. Authentication, grant/session binding, pre/post-async revocation checks, HITL liveness, exfil ordering, and no-retry semantics are enforced at the correct boundary and covered by executing tests; no cross-module escalation or egress path found. Fix NITs 1–3 in a future lane as audit-fidelity and TOCTOU hardening; they do not gate this lane. This is a source-only T3 lane verdict — no real pilot/release approval claimed. END REVIEW.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 29773,
    "outputTokens": 32298,
    "cacheReadInputTokens": 28288,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.9704590000000001,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
