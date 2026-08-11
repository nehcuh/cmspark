# Dual external review — C10 Phase C (cookie + URL admission)

## Scope
Commit `078780a` on `fix/c10-godfile-split-a` (after C10-A/B).

### Extract
- Cookie trust gate → `runCookieTrustAdmission` in `tool/url-cookie-admission.ts`
- URL navigate gate → `runUrlNavigateAdmission` (same file)
- Reuses `isFullAutonomyCruise` from l2-admission (no three-flag re-inline)

### Order (must hold)
multi-agent → **cookie** → browser_download → **L2** → **URL** → image → dispatch

### Not moved
IMAGE_FETCH_GATE, browser_download, companion dispatch

## Verify
1. ADR-007: cookie uses trusted_domains; URL uses auto_approved_domains only (not cookie trust)
2. three-flag cruise waives cookie block only
3. non-http(s) hard-block unless allow_all_schemes; godmode audit log
4. outbound navigate fan-out + unbound origin preserved
5. security-gates 63 still green
6. Zero intentional algebra change

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
