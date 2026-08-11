I have completed a thorough review. Here are my findings:

## Review: C10 Phase C (cookie + URL admission extraction)

### Verification performed
- Read the full diff and the extracted `companion/src/tool/url-cookie-admission.ts` (285 lines)
- Confirmed gate order in `server.ts`: multi-agent (≤908) → **cookie** (910) → browser_download (922) → **L2** (960) → **URL** (987) → image (1006) → dispatch. Matches the prompt's required order.
- Ran tests: `url-cookie-admission.test.js` (12 pass), `security-gates.test.js` (63 pass), `l2-admission-pure.test.js` (5 pass) — all green.
- Verified FREEZE banner updated in `server.ts:622` and `l2-admission.ts:4-6`.

### Security invariants (all preserved)
1. **ADR-007 separation**: `runCookieTrustAdmission` uses `isTrustedDomain`; `runUrlNavigateAdmission`'s `skipUrlConfirmation = isAutoApprovedDomain(host) || auto_approve_dangerous || allow_all_schemes` — cookie trust is NOT consulted. ✓
2. **Three-flag cruise scope**: Cookie waive uses shared `isFullAutonomyCruise(getConfig().security)` (no re-inlined AND). URL gate does NOT call it — but URL skips on `allow_all_schemes` alone, which is one of the three flags; this matches the pre-extraction semantics exactly. ✓
3. **Non-http(s) hard-block + godmode audit**: `url-cookie-admission.ts:165-189` replicates the scheme block + `security.godmode_bypassed` warn (with `javascript:` flag). ✓
4. **Outbound navigate fan-out + unbound origin**: `url-cookie-admission.ts:216-249` — outbound fans out to all authenticated peers + executor-bound socket, and passes `{}` (unbound) for outbound vs `{ originWs: ws }` for non-outbound. ✓ (P1-2 originWs not regressed.)
5. **Zero algebra change**: Side-by-side comparison of the removed `server.ts` block against the new module shows identical control flow, log events, error payloads, and `cookieTrustBlockedPayload` usage. The type-narrower `success: false as const` is runtime-equivalent.

### ADR-020 capability checklist
Pure refactor (mechanical extraction, no new tools/gates/UI). Capability declaration not required. No new runtime, no Pack alternative needed, no new confirm dialect, trust monotonicity preserved.

### Nits (non-blocking)
- **N1**: `AdmissionEarlyResult.result.data?: any` could be tightened, but matches existing l2-admission style.
- **N2**: The new unit test suite does not directly exercise the **outbound MCP fan-out branch** (`url-cookie-admission.ts:219-243`). The integration `security-gates` test almost certainly covers it (the 63-pass count includes outbound navigate cases), but a focused unit test asserting `clients` receives the payload and `originWs` is omitted would close the loop defensively.
- **N3**: Module-level `export const COOKIE_TOOLS`/`URL_GATE_TOOLS` slightly widen the public surface vs the old in-function locals; intentional for test access, no consumer regression (only the new test + the FREEZE banner reference them).

The extraction is clean, behavior-preserving, well-tested, and consistent with the Phase A/B pattern.

VERDICT: APPROVE_WITH_NITS
