Actual model: deepseek-v4-pro; invoked through Claude Code CLI.

# Code Review — #452 R2 Extraction Layer (page-read provenance)

**Scope (one line):** Refactor production `get_page_text`/`get_page_html` reads in BrowserBridge onto a shared `pageReadSnapshot` that samples content + `location.href` in one synchronous task, with boundary provenance (`readWithProvenance`), URL privacy handling, and additive `provenance` output — no new public tool, no evidence IDs, no MCP export.

**Method:** Static read of the packet only; no execution, per read-only mandate. Machine claims (1277/1277 tests, build exit0) are packet-asserted, not independently re-run `[assumed]`. All code below was read end-to-end `[inspected]`.

## Correctness pass

- **Attribution logic is sound.** `readWithProvenance` requires `before`/`after` tab samples to equal the `observedTarget` derived from `payload.rawUrl` in origin + HMAC navigation_key (browser-bridge.ts:232–243 of packet / provenance file). The A→B→A tab-sampling race and execution-context lag (snapshot actually from B) are both caught by the observed-sample equality; tests at page-read-provenance.test.ts:514–523 and browser-html-scope.test.ts:358–391 cover exactly these. [inspected]
- **Single-task sampling correct.** `pageReadSnapshot` (page-read-snapshot.ts:338–341) returns `{content, url: location.href}` synchronously; serialized via `toString()` + `JSON.stringify(request)`, which is injection-safe (tested with `[data-name="a\\\"b"]`). Function is self-contained (only `document`/`location` globals), valid for both CDP Runtime.evaluate and chrome.scripting serialization.
- **Fallback chain preserved.** safeEvaluate → scriptingExecute(ISOLATED→MAIN) → DOM fallback, with channel reporting at each success point; legacy `source` mapping `dom → "dom"`, everything else `"runtime"` retained (page-read-tools.ts:323). Missing selector yields empty-string success in all four channels, not a fallback trigger — matches tests (browser-html-scope.test.ts:447).
- **Truncation/limit semantics unchanged** (500000, raw-length `>=` check), `threats_removed`/`text`/`html`/`truncated`/`length` all retained.

## Security & privacy pass

- **No raw URL escapes.** `payload` returned to callers strips `rawUrl` (page-read-provenance.ts:245); `browserSiteTarget` emits only origin/pathname/hostname/path + HMAC hex; userinfo is cleared before hashing and origin excludes userinfo by spec; query/fragment never appear in any output field. Tests assert no `secret`/`private`/`version=` in serialized results. [inspected]
- **HMAC fingerprint non-exportable** (`extractable: false`), ephemeral per worker, never persisted (browser-site-target.ts:634–646). Restart invalidation is conservative, as stated.
- **Title redaction** reduces reflected URLs to origin+pathname, and parse-failure → `[URL omitted]`; truncation-before-redaction boundary (1024-char slice) was checked and cannot leak userinfo/query (partial URLs either parse to origin+pathname or get omitted). [inspected]
- **Honest coverage vocabulary:** `complete_for_scope: false` always, `coverage: partial|unknown`, `pagination/virtualization: unknown`, `iframe_coverage: not_traversed`, `capture_status: TARGET_UNAVAILABLE|TARGET_CHANGED|eligible`. No completion or evidence-completeness claim anywhere. Content is preserved for ordinary use even when unattributable — consistent with the stated extraction-layer boundary.

## Compatibility pass

- Output is strictly additive (`provenance` key); legacy `data.source` runtime|dom, `text`, `html`, `truncated`, `length`, `threats_removed` all unchanged. Same tools, same executor/queue/gates — no new public surface. [inspected]
- `observation_id` asserted `undefined` in tests — evidence boundary respected; #453 separation holds.

## Coverage pass

Tests in packet (9) cover: nav-change during read (both tools), A→B→A rejection, channel matrix × 4 channels × 4 selector cases incl. escaping and missing, DOM fallback clipping, malformed-result error propagation, title redaction, target-unavailable, error propagation. The full-suite claim is the packet's own; not independently executed here.

## Findings

**P0:** none.

**P1:** none.

**P2 (nits, non-blocking):**
1. page-read-provenance.ts:213 — `redactTitleUrls` matches only scheme-qualified `https?://`; protocol-relative (`//host/path?token`) or bare-domain reflections pass through. Disclosed under page-content policy, but the residual class deserves an explicit comment or a widened regex.
2. page-read-provenance.ts:249 — title is taken from the `before` sample only; `after.title` is discarded, so a title updated mid-read could describe pre-read state. Attribution keys on URL, so risk is cosmetic; consider using `after.title` for symmetric sampling.
3. page-read-provenance.ts:238 — `before.target.tab_id !== after.target.tab_id` is dead code: all three samples share the same `tabId` argument, so this branch can never fire (harmless defense-in-depth; keep or drop, either fine).
4. page-read-tools.ts:287 — intentional behavior change: absent/non-string text result now fails with `PAGE_READ_INVALID_RESULT` instead of the legacy empty-string success. Correct per "no invented empty success," but downstream consumers of `get_page_text` should be told.
5. browser-site-target.ts:650 — `path`/`pathname` in `target` may contain PII slugs (e.g., `/users/jdoe`); disclosed as page-context text, but worth an explicit sign-off for the #453 evidence layer.
6. browser-bridge.ts:147 — wrapper param still named `htmlRead` though it now carries a `PageReadRequest`; cosmetic.
7. No dedicated unit tests for `browserSiteTarget` rejection branches (non-http protocol, invalid tabId, URL parse failure) — only exercised indirectly via bridge tests.

## Verdict

**APPROVE_WITH_NITS**

The extraction layer is correctly attributed, privacy-bounded (no raw URL/userinfo/query/fragment leaves the boundary), compatibility-additive, and honestly scoped — no invented completeness, no evidence claims, no MCP/observation_id leakage. The R2 strengthening (shared synchronous snapshot + triple-sample equality) closes both the A→B→A sampling race and execution-context lag, and the tests prove it. Remaining items are documentation/consumer-notification nits, none blocking.