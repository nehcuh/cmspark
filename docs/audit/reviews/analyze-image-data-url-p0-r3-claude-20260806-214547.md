All tests green. Let me finalize the verdict by mapping each R2 nit to live evidence.

## R3 Review — analyze_image data: P0 nits closeout

### R2 nits — verification against live code + executed tests

**Pi R2 #1 — whitespace in returned `image_base64`** — FIXED
- Extension: `chrome-extension/src/background/image-extract-utils.ts:104` strips in `decodeDataUrl`, `:166` returns the stripped payload.
- Companion: `companion/src/image-data-url.ts:134` strips before computing `byte_len`, `:152` returns same variable.
- New tests assert `!/\s/.test(r.base64)` (extension `tests/image-extract-utils.test.ts:267`, companion `tests/image-data-url.test.ts:27`). [executed: both pass]

**Pi R2 #2 — duplicated decoder drift risk** — FIXED
- Both sides now export `ALLOWED_IMAGE_MIMES_LIST` (extension `image-extract-utils.ts:27-32`; companion `image-data-url.ts:11-16`) with identical sorted contents.
- Cross-package pin tests assert exact list + size cap on both sides (`chrome-extension/tests/image-extract-utils.test.ts:304-313`, `companion/tests/image-data-url.test.ts:49-58`). [executed: 22/22 ext + 5/5 comp pass]

**Pi R2 #3 — residual path `Number(...) || 0`** — FIXED
- `server.ts:2499-2500,2506-2507` uses `Number.isFinite(v) && v > 0 ? Math.floor(v) : 0`.
- Extension path uses extracted `sanitizeImageDim` (`image-extract-utils.ts:177-180`) at `browser-bridge.ts:559-560`.

**Claude R2 #1 — unreliable canvas-failure dims for data:** — FIXED
- Extension now routes through `sanitizeImageDim` (returns 0 for NaN/<=0/non-finite); server.ts:2497-2498 comment documents that vision consumes base64, not these metadata fields.

**Claude R2 #2 — no unit test for browser-bridge data: promotion** — FIXED
- `promoteFetchSrc` extracted to pure helper (`image-extract-utils.ts:199-228`) and unit-tested for all three branches (data→canvas, data:text/html→IMAGE_MIME_REJECTED, blob→BLOB_URL_UNSUPPORTED, https→fetch_required) at `chrome-extension/tests/image-extract-utils.test.ts:271-292`. [executed: passes]

**R1 residual — `strict:false` narrowing** — still FIXED
- `image-extract-utils.ts:204` (`decoded.ok === true`), `browser-bridge.ts:561` (`promoted.kind === "canvas"`), `image-extract-utils.ts:242` (`r.ok === true`) all use explicit discriminant comparison. ✓

**R1 residual — rawMime flood** — still FIXED
- `image-extract-utils.ts:129` and `image-data-url.ts:110` cap `rawMimeShort` at 64 chars. ✓

### Security invariants [executed: M4 battery 61/61 pass]
- No phase2 for data: — `M4: fetch_required data:image/png → … NO phase2` / `data:text/html → … NO phase2` / `oversize → IMAGE_TOO_LARGE short error, NO phase2` all green.
- No schemeOk expansion — phase2 scheme gate untouched by this diff.
- No base64 dump — `summarizeCandidateUrl` test (`companion/tests/image-data-url.test.ts:41-47`) asserts summary < 200 chars and no 100-char run of payload.
- `M4: file: still hard-blocked after data: residual (invariant)` green; god-mode/auto-approve bypass tests still green.

### ADR-020 capability declaration
Diff is a security hardening of an existing tool's data: handling (no new Surface / Compose / Autonomy / Channel / Trust gate). Pure docs/test/refactor exemption does not strictly apply (touches production code in 3 files), but no new tools/gates/primary UI are introduced, so missing declaration is non-blocking.

### Non-blocking nits
1. `companion/src/server.ts:2499-2507` inlines `Number.isFinite(v) && v > 0 ? Math.floor(v) : 0` rather than reusing a shared `sanitizeImageDim` from `companion/src/image-data-url.ts`. The helper lives only in the extension; mirroring it into the companion module (already the designated mirror file) would close the DRY gap and let both sides import from their own package. Cosmetic — predicate semantics are identical.
2. `browser-bridge.ts:612-613` (canvas-success Path A, unchanged by this commit) still surfaces raw `data.width`/`data.height` without `sanitizeImageDim`. Pre-existing; canvas-success envelope has authoritative dims, so not a regression — flagging only for symmetry.

Both nits are non-blocking and the second is out of this commit's scope.

VERDICT: APPROVE_WITH_NITS
