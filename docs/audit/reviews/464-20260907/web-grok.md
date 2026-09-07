I'll read only the specified review packet and follow its independent-review instructions.**MAJOR — parse `input.diff.excerpt` — CLOSE** [inspected]

`snapshot` now slices the gated observation and parses that, not the model excerpt:

```
const diffText = input.diff && observation
  ? Array.from(observation.content).slice(input.diff.start, input.diff.end).join("") : null
const files = diffText !== null ? parseUnifiedDiff(diffText) : []
```

The NFC/NFD+CRLF test asserts `files` and `diff_hash` match the ordinary create.

`citationSchema` already runs `excerpt` through `normalizeEvidenceText`, so a Zod-parsed `ReviewCreate` already had NFC/LF `diff.excerpt`. The stated CRLF-header and NFD-vs-`NFC_LF` stamp failures did not apply on that path. Parsing the observation span is still the right authenticity bound.

Residual NIT: `exactExcerpt` indexes `Array.from(normalizeEvidenceText(content))`; this slice uses raw `observation.content`. Those coincide only if captures are stored NFC/LF. Use the same `points` as the gate.

**NIT — `save` 0o600 — CLOSE** [inspected]

Included `atomicWriteJSON` defaults to `0o600` (write + chmod). Packet also claims an explicit argument.

**NIT — executor mapping — RETAIN** [inspected]

`canonicalRepository` still throws `INVALID_REPOSITORY_URL`. Executor and `load()` are not in this packet, so wrap-to-`INVALID_CODE_REVIEW_REQUEST_OR_STORE` is unverified. Terminal/report is out of scope.

VERDICT: APPROVE
