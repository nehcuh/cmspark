# Dual review R3: confirm dual-review nits closed (analyze_image data: P0)

## Prior rounds

| Round | Claude | Pi | both_ok |
|-------|--------|-----|---------|
| R1 | APPROVE_WITH_NITS | **REJECT** (strict:false narrowing) | false |
| R2 | APPROVE_WITH_NITS | APPROVE_WITH_NITS | true |
| **R3** | confirm nits from R2 are fixed in commits after R2 | | |

## Commits since R2 approval

1. `274a021` — P0 fix (reviewed in R2)
2. `082365e` — **nits cleanup** (this review focus):
   - Strip whitespace from returned base64 (extension + companion)
   - `promoteFetchSrc` extracted + unit tests (data → canvas, blob → error, https → fetch_required)
   - `sanitizeImageDim` / residual path dims only positive finite
   - `ALLOWED_IMAGE_MIMES_LIST` exported both sides + cross-package pin tests
   - New `companion/tests/image-data-url.test.ts`

## R2 nits checklist — mark each FIXED / STILL OPEN with file:line evidence

### Pi R2
1. Returned `image_base64` still had whitespace while `byte_len` used stripped payload
2. Duplicated decoder drift risk (extension vs companion)
3. Residual path width/height cosmetic `Number(...) \|\| 0`

### Claude R2
1. width/height from canvas-failure envelope unreliable for data:
2. No direct unit test for browser-bridge data: promotion branch

### R1 residual (only if still in nits scope)
- Production `strict:false` discriminant narrowing — claimed fixed in R2
- rawMime flood — claimed fixed in R2

## Scope files (read live, not only patch)

```
chrome-extension/src/background/image-extract-utils.ts
chrome-extension/src/background/browser-bridge.ts
chrome-extension/tests/image-extract-utils.test.ts
companion/src/image-data-url.ts
companion/src/server.ts
companion/tests/image-data-url.test.ts
companion/tests/integration/security-gates.test.ts  # M4 data: residual still green
```

## Hostile re-check

1. For each R2 nit: FIXED with evidence, or STILL OPEN with what remains.
2. Re-run or spot-check targeted tests if tools allow.
3. Confirm security invariants still hold (no phase2 for data:, no schemeOk expansion, no base64 dump, god-mode/file/metadata).
4. Do **not** expand scope to originWs / vision jpeg prefix / blob CDP screenshot unless they block shipping.

## Verdict rules

- **APPROVE** — all R2 nits FIXED, no new blockers
- **APPROVE_WITH_NITS** — all R2 nits FIXED but new minor nits found
- **REJECT** — any R2 nit still open OR new security regression

End with exactly one line:
`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
