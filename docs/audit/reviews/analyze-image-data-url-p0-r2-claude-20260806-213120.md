I've completed a hostile re-check. Here are the findings.

## Verification results [executed]

- **Production chrome-extension `npx tsc --noEmit`**: exit 0 (clean) under `plasmo/templates/tsconfig.base` `strict: false` — R1 REJECT reason resolved.
- **Discriminant narrowing sweep**: all 3 production callsites of `decodeDataUrlImage` use `=== true` / `=== false`:
  - `chrome-extension/src/background/browser-bridge.ts:563,581,583-585`
  - `chrome-extension/src/background/image-extract-utils.ts:181-182`
  - `companion/src/server.ts:2473` (then accesses `decoded.base64` post-narrow at 2501 — typechecks)
- **No remaining truthiness-only narrowing** (`!decoded.ok` etc.) on this discriminant.
- **chrome-extension tests**: 474/474 pass; image-extract-utils 18/18 (8 new).
- **companion security-gates** (`npx tsx --test tests/integration/security-gates.test.ts`): 61/61 pass; the 4 new data: residual tests pass:
  - `data:image/png → local decode success, NO confirmation, NO phase2`
  - `data:text/html → IMAGE_MIME_REJECTED short error, NO phase2`
  - `data: oversize → IMAGE_TOO_LARGE short error, NO phase2`
  - `file: still hard-blocked` (invariant)
- Other companion failures (`computer-uia-watch` / `computer-executor` / `computer-model-states`) are pre-existing and unrelated (different feature area; not touched by this diff).

## Security invariants — preserved

- **No phase2 for data:** extension returns `type:"canvas"` directly (browser-bridge.ts:559-588); companion residual decodes locally and returns `type:"canvas"` (server.ts:2468-2512). Neither dispatches `analyze_image_fetch`.
- **No schemeOk expansion to data:** server.ts:2519 still `scheme === "http:" || "https:"`. data: only reaches the early-return residual block.
- **No L2 for data:** the L2 `securityConfirmations.request` block (server.ts:2555) is unreachable for data: due to the early return at 2473/2491.
- **No payload dump:** `rawMimeShort` 64-char cap (image-extract-utils.ts:122; image-data-url.ts:105); `url` is a short placeholder; tests assert `error.length < 300` and `!error.includes("A".repeat(100))`.
- **MIME allowlist** excludes `image/svg+xml` (XSS vector), `text/html`, `text/plain`.
- **6 MiB decoded-payload cap** applied twice (estimate pre-decode + authoritative post-decode).
- **god-mode / auto_approve_dangerous** still do not bypass IMAGE_FETCH http(s) confirm (untouched).
- **file:/ftp:/javascript:** still hard-blocked.

## ADR-020 capability checklist

Implementer prompt lacks explicit Surface/Compose/Autonomy/Trust/Channel declaration. However the diff is a P0 security-hardening fix on an existing tool (analyze_image) plus a TypeScript narrowing bug fix — it adds no new tool, gate, or primary UI entry point. Per the checklist rule, missing declaration is a nit at most here (not blocking).

## Non-blocking nits

1. **`browser-bridge.ts:569-570`** — `width: data.width, height: data.height` come from the canvas-extract-failure envelope; for a `data:` image that never drew to canvas these may be unreliable. Vision consumes the base64 directly, so this is metadata-only; non-blocking.
2. **Test coverage gap** — no direct unit test for the `browser-bridge.ts` data:-promotion branch (only the underlying `decodeDataUrlImage` primitive is unit-tested). The companion residual path IS integration-tested. Non-blocking since the primitive is well covered.

VERDICT: APPROVE_WITH_NITS
