All checks complete. Summary of verification (all live, not claimed):

**Hostile re-check results**

1. **Prod typecheck** — `chrome-extension npx tsc --noEmit` → exit 0; `companion npx tsc --noEmit` (strict) → exit 0. The Pi R1 REJECT (plasmo `strict:false` not narrowing `!r.ok`) is fixed.
2. **No remaining truthiness narrowing on `DecodeDataUrlImageResult`** in production paths — only `ok === true`/`ok === false` at `browser-bridge.ts:563,581,583-585`, `image-extract-utils.ts:181-182`, `server.ts:2473`. Test code uses `if (r.ok)` but compiles under `strict:true`.
3. **Security invariants hold** — data: never emitted as `fetch_required` (extension decodes post-CDP at `browser-bridge.ts:565-586`); companion residual decodes locally *before* host/L2 at `server.ts:2466-2502` with no phase2 and no confirmation (verified by new tests `noPhase2`/`noConfirmation`); no base64 dump (mime truncated to 64 chars, `summarizeCandidateUrl` truncation, tests assert short errors <200 chars); `file://`/metadata hard-block unchanged; god-mode/`auto_approve_dangerous` http(s) L2 confirm untouched (`server.ts:2543` comment; `M4: auto_approve_dangerous ON does NOT bypass the image gate` still passes). Ungated `decodeDataUrl` has no external callers left (grep confirms only `decodeDataUrlImage` internal use).
4. **Tests** — extension 474/474 (8 new), companion security-gates 61/61 (4 new). Verified by executing, not just reading.
5. **ADR-020** — capability declaration present in R1 prompt (Surface L1 browser observe; no new Composition/Autonomy; Channel no new WS types), carried as locked-design in R2. No new tools/gates/primary UI entry points (the diff *narrows* the gate surface); no new confirmation family; no `securityConfirmations.request`/originWs change; trust monotonicity preserved and tested; no 中层-Agent/Pack misuse.

Non-blocking nits:
- `browser-bridge.ts:569` — `image_base64: decoded.base64` returns the raw base64 payload verbatim (whitespace included), slightly inconsistent with the whitespace-stripped `byte_len` accounting in `image-extract-utils.ts:129-133`. Harmless (vision base64 decode tolerates whitespace); pre-existing `decodeDataUrl` behavior.
- Intentional duplication of the decoder in `companion/src/image-data-url.ts` vs `image-extract-utils.ts` (documented in file header) — future drift risk if the allowlist/size cap changes in one place only.
- `server.ts:2487-2488` — residual path defaults missing width/height to 0 (`Number(p1.width) || 0`); cosmetic.

VERDICT: APPROVE_WITH_NITS
