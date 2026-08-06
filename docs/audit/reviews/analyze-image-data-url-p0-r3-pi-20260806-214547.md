All checks complete. Summary of findings:

## R2 nit verification (live files + running tests)

**Pi R2 nits**
1. **base64 whitespace vs `byte_len` mismatch** — FIXED. Extension `decodeDataUrl` strips `\s` (`image-extract-utils.ts:108`), `decodeDataUrlImage` returns the cleaned `payload` (`:172`) and derives `byte_len` from it (`:165-168`). Companion mirrors it (`image-data-url.ts:137,143-147`). Both new unit tests assert `!/\s/.test(base64)` — passed.
2. **Decoder drift risk** — FIXED (scoped): `ALLOWED_IMAGE_MIMES_LIST` + `IMAGE_DATA_URL_MAX_DECODED_BYTES` exported on both sides (`image-extract-utils.ts:28-33`, `image-data-url.ts:15-20`), with cross-package pin tests in **both** test suites asserting identical lists/cap. Residual body duplication is deliberate ("do not import extension") and now drift-guarded.
3. **Residual `Number(...) || 0`** — FIXED: `sanitizeImageDim` (`image-extract-utils.ts:181-183`, positive-finite + floor) and inline finite-gate in `server.ts:2503-2510`. Test passed.

**Claude R2 nits**
1. **Canvas-failure dims unreliable for data:** — FIXED: dims now coerced via sanitize/finite-gate in both paths, with a documenting comment (`server.ts:2504`).
2. **No unit test for data: promotion branch** — FIXED: `promoteFetchSrc` extracted as a pure CDP-free helper and tested for data→canvas, `data:text/html`→IMAGE_MIME_REJECTED, blob→BLOB_URL_UNSUPPORTED, https→fetch_required. Test passed.

**R1 residuals** — `strict:false` narrowing kept as explicit `=== true/=== false` in `promoteFetchSrc` (`:214-224`) and `server.ts:2516`; `rawMimeShort` 64-char cap retained both sides.

## Tests executed
- `chrome-extension` image-extract-utils: **22/22 pass** (incl. 4 new nit tests)
- `companion` image-data-url: **5/5 pass**
- `companion` security-gates M4 suite: all pass — data: residual decode w/ **no phase2** (`pendingToolCalls.size === 0`), no base64 dump (errors <300 chars), god-mode/auto_approve do NOT bypass, file:/metadata hard-blocked, `file:` invariant after data: residual.
- `computer-uia-watch` failures are in a file untouched by this diff — pre-existing, unrelated.

## Security invariants
No phase2 for data: (early return after local decode), no schemeOk expansion (`server.ts:2543` comment), placeholder `data:${mime};base64,…` URL only, no new `securityConfirmations.request` (originWs n/a — out of scope per prompt). ADR-020: pure refactor/test diff, no new tools/gates/UI; trust monotonicity holds (god-mode tests green).

No material new nits found; all R2 nits closed with test evidence.

VERDICT: APPROVE
