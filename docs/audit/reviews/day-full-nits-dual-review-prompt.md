# Dual external review — day-full nits closeout only

## Scope
Commit `ee80f72` on `fix/c10-godfile-split-a` (after day-full both_ok).

### Fixes
1. **image-fetch originWs** — `securityConfirmations.request(..., { originWs: ws })` in image-fetch-admission.ts
2. **tabUrlCache colocation** — `ws/tab-url-cache.ts`; lifecycle uses it directly; tool-forward/companion-dispatch bind to shared getters
3. **C9 lockstep** — brace-scoped extractValidatorKeys + anti-false-positive test
4. **static import** shell/netsec normalize in createToolExecutor
5. **unit tests** god-mode / cookie-trust do not skip IMAGE_FETCH; originWs bound on deny path

## Verify
- originWs on image confirm matches L2/URL/MCP pattern
- No circular imports tab-url-cache ↔ server
- security-gates still green for M4 image
- lockstep still finds all CORE_REQUIRED

Prefer VERDICT: APPROVE if clean.

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
