# Dual review R2: analyze_image data: URL P0 (post-Pi REJECT fix)

## Prior round (20260806-212116)

- **Claude**: `APPROVE_WITH_NITS`
- **Pi**: `REJECT` — production extension `tsc --noEmit` fails under plasmo `strict: false` because `!r.ok` / `!decoded.ok` do **not** narrow the discriminant union; test tsconfig uses `strict: true` so the break was invisible.

## Fix applied since R1

1. `browser-bridge.ts` / `image-extract-utils.ts` / `server.ts`: use **`ok === true` / `ok === false`** only for DecodeDataUrlImageResult narrowing.
2. Truncate `rawMime` to 64 chars on IMAGE_MIME_REJECTED (Pi nit #1).
3. Re-verified: `chrome-extension` `npx tsc --noEmit` clean; image-extract-utils 18/18; security-gates 61/61.

## Locked design (unchanged)

Same as R1 prompt (`analyze-image-data-url-p0-prompt.md`): extension data:→canvas post-CDP; companion residual local decode no phase2/L2; 6 MiB; mime allowlist; no schemeOk expansion; http(s) L2/god-mode invariants.

## Scope files

```
chrome-extension/src/background/image-extract-utils.ts
chrome-extension/src/background/browser-bridge.ts
chrome-extension/tests/image-extract-utils.test.ts
companion/src/image-data-url.ts
companion/src/server.ts
companion/tests/integration/security-gates.test.ts
docs/security-design-tiered-gates-2026-07-11.md
```

## Hostile re-check

1. Does production `chrome-extension` `tsc --noEmit` (or package build typecheck) still error on the new paths?
2. Any remaining truthiness-only narrowing on DecodeDataUrlImageResult?
3. Prior security invariants still hold (no phase2 for data:, no base64 dump, file/metadata/god-mode)?
4. Do not rubber-stamp — re-read the live files.

## Output

Findings with file:line if any, then exactly:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
