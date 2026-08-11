# Dual external review — C10 Phase D (IMAGE_FETCH_GATE)

## Scope
Commit `5b16c8a` on `fix/c10-godfile-split-a`.

### Extract
`analyze_image` two-phase IMAGE_FETCH gate + direct `analyze_image_fetch` reject
→ `companion/src/tool/image-fetch-admission.ts` (`runImageFetchAdmission`)

`dispatchToExtension` stays in server.ts (injected).

### Order
multi-agent → cookie → browser_download → L2 → URL → **IMAGE_FETCH** → companion/MCP/extension dispatch

## Critical invariants (must hold)
1. god-mode / auto_approve_dangerous do NOT skip IMAGE_FETCH http(s) confirm
2. Cookie trusted_domains do NOT auto-approve image fetch (only auto_approved_domains)
3. Cloud metadata IP hard-block
4. data: local decode, no phase2
5. phase2 id `${toolCallId}__image_fetch`
6. direct analyze_image_fetch rejected
7. security-gates M4 image tests still green (63 total)

Zero intentional algebra change. Prefer APPROVE if pure move.

Final line:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
