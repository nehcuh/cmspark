# Dual review: analyze_image data: URL false Security Block (P0)

## Context

User opened L2 + `auto_approve_dangerous` + `allow_all_schemes` + domain whitelist, still got:

`Security Block: analyze_image cannot read data: URL (data:image/png;base64,...)`

Root cause: IMAGE_FETCH_GATE path B only allows `http(s)`; extension canvas-catch returned `fetch_required` with full `data:` src (assumption "data: never taints canvas" was false). Thread #i0iqwl captcha GIF / split frames.

## Locked design (adversarial GO_WITH_AMENDMENTS — do not reopen without evidence)

1. **Extension primary**: after CDP, if `fetchSrc` is `data:` → `decodeDataUrlImage` (mime allowlist + 6 MiB) → `type:canvas`. **Never** `fetch_required` for `data:`. `blob:` → clear error, not fetch_required.
2. **Companion residual** (old extension skew): if phase1 still returns `fetch_required` + `data:`, decode **locally** before host/L2 → return canvas. **No L2, no phase2, no `schemeOk |= data:`**.
3. Mime allowlist: `image/png|jpeg|jpg→jpeg|webp|gif`. Reject `svg+xml`, `text/html`, etc.
4. Size cap: **6 MiB decoded** (WS is 10MB; not vision 20MB).
5. Error/log hygiene: never dump full data: base64 in Security Block / image_fetch logs.
6. **Invariants**: file:/metadata hard-block; untrusted https still L2; god-mode / auto_approve_dangerous still do **not** skip http(s) IMAGE_FETCH confirm; `analyze_image_fetch` internal-only.
7. **No** new config flag for data:.

## Capability declaration (ADR-020)

- **Surface**: L1 browser observe (`analyze_image` path) — no new tool surface
- **Composition**: no new pack/module
- **Autonomy**: data: is **not** a trust escalation; path-B http(s) L2 unchanged (trust monotonicity preserved)
- **Channel**: Companion gate residual + Extension resolve; no new WS types

## Files in scope (only these — ignore unrelated dirty tree / audit patches)

```
chrome-extension/src/background/image-extract-utils.ts
chrome-extension/src/background/browser-bridge.ts
chrome-extension/tests/image-extract-utils.test.ts
companion/src/image-data-url.ts          # NEW (may be intent-added)
companion/src/server.ts                  # analyze_image IMAGE_FETCH branch only
companion/tests/integration/security-gates.test.ts  # M4 additions
docs/security-design-tiered-gates-2026-07-11.md     # §6.1 data: row only
```

**Read the full files** with tools, not only the patch summary. Untracked `companion/src/image-data-url.ts` must be inspected if present.

## Tests claimed

- `chrome-extension` image-extract-utils: 18 pass (mime/size/svg/html/no-network)
- `companion` security-gates: 61 pass including M4 data: residual success / html reject / oversize / file: still blocked / god-mode still confirms untrusted https

You may re-run targeted tests if helpful; do not require full monorepo green.

## Review focus (hostile)

1. Can `data:` still force path B network fetch or L2 spuriously?
2. Does companion residual expand `schemeOk` or dispatch `analyze_image_fetch` for data: (should not)?
3. Empty-host / `new URL(data:)` fallthrough into trusted-domain or L2 with `relevant_domains:['']`?
4. Error/log still embed multi-KB base64?
5. Mime/size gates bypassable (header spoof, percent-decode bomb)?
6. Regression: file:/metadata/god-mode/untrusted https?
7. Extension CDP expression still unsafe to edit? Decode only post-CDP?
8. Missing tests for claimed invariants?
9. Duplicated decode logic extension vs companion — divergence risk?

## Out of scope (nits only if mentioned)

- vision-pipeline always prefixes `image/jpeg`
- blob: CDP screenshot fallback
- Settings UI copy
- Full monorepo test suite

## Output

Findings with file:line, then **exactly one final line**:

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`
