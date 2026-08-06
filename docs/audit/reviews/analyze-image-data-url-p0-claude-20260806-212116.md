I've completed my review. Here are my findings.

## Findings

### Verification summary
- **Tests (executed)**: chrome-extension `image-extract-utils` → 18/18 pass; companion `security-gates` → 61/61 pass (incl. all 4 new M4 residual tests + existing god-mode / auto_approve / file: / metadata / untrusted-https invariants).
- **Diff ↔ repo consistency**: Working-tree diff matches the patch file; `companion/src/image-data-url.ts` exists and matches the diff.

### Review focus (1–9) — all addressed
1. **Can `data:` still force path B network fetch or L2 spuriously?** No. Extension intercepts post-CDP in `browser-bridge.ts:559-585`; companion intercepts pre-L2 in `server.ts:2468-2510` and returns early.
2. **Does companion residual expand `schemeOk` or dispatch `analyze_image_fetch` for data:?** No. Early-return at `server.ts:2468`; `schemeOk` only set for `http:`/`https:` at line 2517; phase-2 `dispatchToExtension` at line 2584 is unreachable for data:.
3. **Empty-host / `new URL(data:)` fallthrough?** No. `startsWith("data:")` short-circuits before `new URL()` is constructed (line 2512).
4. **Multi-KB base64 in errors/logs?** No. Logger emits only `mime`/`byte_len`/`reason`/`error_code` (`server.ts:2472-2478`); errors are templated strings (`decoded.error`, never the payload); `url` placeholder is `data:${mime};base64,…`. `summarizeCandidateUrl` truncates to 48-char prefix defensively.
5. **Mime/size gates bypassable?** Header parsing splits on `;` and lowercases — `image/png;X;base64` still resolves to `image/png`. Base64 size estimated via 4→3 with padding adjustment (`image-extract-utils.ts:60-63`, mirrored in `image-data-url.ts:43-46`). Re-checked post-decode at `image-extract-utils.ts:143-156` and `image-data-url.ts:131-144`. SVG/XML/HTML/text all rejected by allowlist.
6. **Regression on file:/metadata/god-mode/untrusted https?** None. Existing M4 tests for cloud-metadata, file:, god-mode, auto_approve_dangerous all still pass; new "file: still hard-blocked after data: residual" test confirms ordering.
7. **CDP expression safety?** Decode is post-CDP in `browser-bridge.ts`, never inside the page-side `Runtime.evaluate` expression. No `new Function`/eval changes; selector still JSON.stringify'd.
8. **Missing tests?** All claimed invariants have tests: png success, html reject, oversize, file: invariant, no-confirmation, no-phase2, no-network, plus existing god-mode/auto-approve/metadata/private-IP coverage.
9. **Duplicated decode divergence risk?** Acknowledged in file header ("Intentionally duplicated"). Logic is character-for-character equivalent for the shared primitives. Real but accepted tradeoff.

### ADR-020 capability checks
- **Surface/Compose/Autonomy/Trust/Channel** declaration present in the prompt — data: is correctly framed as **not** a trust escalation (L1 path refinement, no new tool/pack/runtime/confirmation family). Trust monotonicity preserved: god-mode/auto_approve still gate http(s) (verified by tests).
- **P1 watchlist**: P1-1 (god-mode) — tests confirm no bypass; P1-2 (originWs) — no new `securityConfirmations.request` added (data: residual skips confirmation entirely by design); P1-3/P1-4 untouched.

### Nits (non-blocking)
- `companion/src/image-data-url.ts:73-85` — `summarizeCandidateUrl`'s data: branch is unreachable from `server.ts` (data: is short-circuited before this call). Defensive but slightly confusing; could trim or add a comment that it's a sentinel.
- `browser-bridge.ts:587` — `scheme5 === "blob:" || fetchSrc.toLowerCase().startsWith("blob:")` is redundant; the second clause never fires because `slice(0,5)` already covers `blob:`. Harmless.
- `server.ts:2470-2475` — `sum` is computed solely to backfill `mime`/`byte_len` on the `INVALID_DATA_URL` error path (the only path where `decoded.mime`/`decoded.byte_len` are both undefined). Could be inlined into that branch as a minor clarity improvement.
- The duplicated `ALLOWED_IMAGE_MIMES` / `decodeDataUrlImage` / `estimateDataUrlPayloadBytes` between extension and companion will drift silently if one side is edited. A cross-property corpus test (e.g. golden vectors) would catch divergence; not required given the file-header warning.
- `image-extract-utils.test.ts:384-396` — the "data: path does not call fetch/network" test patches `globalThis.fetch` but `decodeDataUrlImage` is synchronous and never touched fetch; the assertion holds vacuously. Still a useful regression guard if the implementation ever becomes async.

VERDICT: APPROVE_WITH_NITS
