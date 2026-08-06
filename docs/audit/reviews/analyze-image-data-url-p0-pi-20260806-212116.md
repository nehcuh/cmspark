# Dual Review — analyze_image data: URL P0

## Verification performed

- Read full patch + all in-scope files (extension `image-extract-utils.ts`, `browser-bridge.ts`, new `companion/src/image-data-url.ts`, `server.ts` IMAGE_FETCH branch, both test files, doc)
- Ran tests: **chrome-extension 18/18 pass**, **companion security-gates 61/61 pass** (incl. new M4 data: residual/html/oversize/file + pre-existing god-mode & auto_approve_dangerous-still-confirm invariants at tests lines 1487/1517)
- Ran `tsc --noEmit` on both packages under their **production** tsconfigs
- Minimal TS repro of the narrowing behavior under `strict: true` vs `strict: false`

## Design invariants — verified (no findings)

- `data:` can no longer force path B: extension decodes post-CDP → `type:canvas`, never `fetch_required` (browser-bridge.ts:556-588); companion residual decodes locally before `new URL()`/L2/phase2 (server.ts:2474-2514)
- `schemeOk` remains `http:`/`https:` only; `analyze_image_fetch` direct call still rejected (server.ts:2457); no `relevant_domains:['']` fallthrough (data: handled pre-parse)
- CDP expression **unchanged**; decode strictly after `Runtime.evaluate` returns
- Size gate: estimate + authoritative post-decode re-check; percent-decode bounded (≤ src length); whitespace-stripping undercount caught by re-check
- blob: → clear error (extension) / hard-block (companion); file:/metadata unchanged
- No new config flag; ADR-020 declaration present (Surface L1 / no compose / no autonomy change / channel) and consistent with the diff

## BLOCKING — extension production build is broken by this diff

`npm run build` (→ `tsc --noEmit`) fails with 3 TS errors, all in new code:

- `chrome-extension/src/background/image-extract-utils.ts:177` — `if (!r.ok) throw new Error(r.error)`
- `chrome-extension/src/background/browser-bridge.ts:564` — `error: decoded.error`
- `chrome-extension/src/background/browser-bridge.ts:566` — `error_code: decoded.error_code`

Root cause: plasmo's `tsconfig.base` sets **`strict: false`**, and with `strictNullChecks` off, truthiness checks (`!r.ok` / `r.ok`) do **not** narrow the `ok: true | ok: false` discriminated union (verified via repro: only explicit `r.ok === false`/`=== true` narrows). The test suite passed because `tsconfig.test.json` uses `strict: true` — and it does **not even include `browser-bridge.ts`** — so the compile break was invisible to the green test run. Fix: use explicit discriminant comparisons (`if (decoded.ok === false)`) in the three sites.

## Nits (non-blocking)

1. **MIME_REJECTED hygiene gap**: error/log embeds `rawMime` unboundedly (`image-extract-utils.ts:115`, `image-data-url.ts:106`) — a pathological header (`data:<100KB garbage>;base64,...`) echoes into the tool error and companion `security.image_fetch_blocked` log `mime` field (server.ts:2481). The base64 payload is never echoed (good), but "errors stay short" is only asserted for IMAGE_TOO_LARGE. Truncate `rawMime`.
2. **Returned base64 keeps embedded whitespace** from the data: payload in both decoders — the decoded-bytes gate doesn't bound actual WS wire size (whitespace inflation). Downstream decoders tolerate it; strip `\s` for hygiene.
3. **`browser-bridge.ts` missing from `tsconfig.test.json` include** — add it so future browser-bridge changes are type-checked by tests (this is why the blocker went unnoticed).
4. **Duplicated decode logic** (extension vs companion) — currently in sync, intentional, divergence risk documented; add a cross-reference test pinning the shared allowlist/limits.
5. Pre-existing, not a regression: the `analyze_image_fetch` confirm request (server.ts) still doesn't bind `{ originWs: ws }`; this diff only altered its `code:` payload string. Per ADR-020 checklist item 5, worth binding while the line is touched.

VERDICT: REJECT
