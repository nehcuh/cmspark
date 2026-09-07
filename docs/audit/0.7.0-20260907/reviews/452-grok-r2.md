I'll read only the specified extraction document and review #452 against the requested axes.# Independent code review: #452 R2 extraction layer

Judge: grok-4.6. Packet-only; no other files, commands, or reports. Capability T2 only (existing `get_page_text` / `get_page_html`). Base #451 HMAC/site-target treated as given.

This is provenance attribution for a top-document read, not business evidence, pagination completeness, all-frames coverage, or an Observation.

---

## What R2 gets right

The core model is sound and matches the stated contract.

**Synchronous sample (JS channels).** `pageReadSnapshot` returns `{ content, url: location.href }` in one function with no closure. CDP uses `pageReadExpression` (`fn.toString()` + `JSON.stringify(request)`); isolated/main inject the same function. That is the right way to bind sampled bytes to a sampled URL, and it removes the old exact-string `document.body?.innerText || ''` special case for these two tools.

**Three-way attribution.** `readWithProvenance` fingerprints (1) `tabs.get` before, (2) snapshot `rawUrl`, (3) `tabs.get` after, then **drops `rawUrl`**. Equality is origin + HMAC `navigation_key` (query/fragment-sensitive, userinfo already stripped in #451). That catches:

- in-read query/fragment/host change (`TARGET_CHANGED`, content still returned)
- A→B→A tab samples with snapshot from B (unit-tested)
- missing snapshot URL (`TARGET_UNAVAILABLE`, content kept)

**DOM fallback is weaker and labeled as such.** `getOuterHTMLViaDom` now returns `{ content, url: root.documentURL }`. Missing node → `{ content: "", url }` (empty success, not a fallback trigger). Absent `documentURL` → ordinary content, evidence-ineligible. Legacy `data.source` remains `runtime|dom`; real path is additive `provenance.channel`.

**Coverage is conservative.** `complete_for_scope: false` always; non-truncated `coverage` is `unknown` not complete; pagination/virtualization `unknown`; `iframe_coverage: not_traversed`; `frame: "top"`; `stop_reason` is `CONTENT_LIMIT` | `SINGLE_READ`. No `observation_id`. Sanitizer and text/html payloads retained.

**Privacy of forwarded fields (for the claims made).** Tool JSON is tested not to contain `secret` / query tokens. Title `https?:` reflections collapse to origin+pathname. HMAC key remains non-extractable/ephemeral; only the hex fingerprint is forwarded on eligible targets.

**Compatibility surface.** Same tools, same `getTabId` → existing executor/queue. Other `safeEvaluate`/`scriptingExecute` callers keep 2-arg behavior. Invalid non-string HTML throws into a real DOM read rather than inventing empty success. Invalid text is `PAGE_READ_INVALID_RESULT`, not a successful empty read.

---

## Findings

### N1 — CDP object snapshot vs `returnByValue` (verify; would be P0 if absent)

[inspected] The production expression now returns an **object**. Chrome `Runtime.evaluate` only puts that object in `result.value` when `returnByValue: true`. The diff does **not** change the evaluate parameter block; ~7 omitted lines sit between `expression,` and the exception-message concat.

[assumed] Those lines very likely already contain `returnByValue: true` (the helper already consumed `result.value`, and the line budget fits). If they do not:

- `get_page_text`: CDP “succeeds”, `reportChannel("cdp")` fires, `content` is missing → `PAGE_READ_INVALID_RESULT` with **no** scripting fallback
- `get_page_html`: same throw is caught → silent **DOM** fallback, i.e. the weaker non-atomic path, while tests still look green because mocks always wrap `vm` results in `.value`

Runtime-mode tests never exercise real CDP serialization. Confirm the omitted params include `returnByValue: true`. If not, that is a reject, not a nit.

### N2 — DOM channel still has an A→B→A content/URL race

[inspected] JS channels sample content and `location.href` in one turn. DOM does `DOM.getDocument` (URL) then later `DOM.getOuterHTML` (bytes). Packet correctly does not claim atomicity here.

Residual: getDocument=A, navigate B then back to A, outerHTML from B, pre/post `tabs.get` both A, observed URL A → **`eligible` with B’s bytes**. NodeIds often die on navigation (throw → combined error), so this is narrow. Acceptable as documented fallback residue; do not treat `channel: "dom"` as the same attribution strength as `cdp|isolated|main`.

### N3 — Title redaction can miss a 1024-boundary split

[inspected] `tab.title?.slice(0, 1024)` then `https?:\/\/[^\s<>"']+`. A URL that starts near the cut can leave a non-matching remainder such as `//host/?token=…`, which the regex will not redact.

[inspected] Packet already says titles are page text and non-URL secrets are out of scope. This is a small hole **inside** the URL-shaped claim. Eligible-only, and title is emptied on change/unavailable.

### N4 — `capture_status: "eligible"` and `frame: "top"` are easy to over-read

[inspected] `eligible` means “stable browser target for this read,” not Observation/evidence-ready. `frame: "top"` is asserted from injection defaults, not from a frameId/execution-context check. Fields around them (`complete_for_scope: false`, `coverage: unknown|partial`) are honest. Naming is the risk, not the boolean behavior.

### N5 — Test gaps (do not contradict implemented logic)

[inspected]

- Invalid **HTML** (non-string CDP value → real DOM read bound to `documentURL`) is claimed and visible in `readPageHtml`, but not unit-tested (only invalid **text** is).
- Production bridge test proves query change via `TARGET_CHANGED`; `!JSON.includes("version=")` would also pass for an eligible origin+pathname target.
- Fixture recorder is a synthetic wire capture, as labeled; not pilot proof.

---

## Axis checks

| Axis | Result |
|------|--------|
| Sampled content + URL | JS: one task, three-way fingerprint, `rawUrl` stripped. DOM: bound to `documentURL`, not atomic with bytes. |
| DOM fallback | Selector preserved; missing selector is empty success; no invented empty on invalid non-string; `source` legacy mapping kept. |
| Compatibility | Existing tools/payloads/sanitizer/`runtime\|dom`; provenance additive; other evaluate callers unchanged at arity 2. |
| Privacy | No raw query/userinfo/fragment/rawUrl in the returned payload; title http(s) redacted; HMAC key not exported. Path and page body remain page text (stated). |
| Truthful coverage | No completeness claim; truncation is `partial`; otherwise `unknown`; iframes not traversed; `captured_at` is end-of-read diagnostic. |

No scope expansion: no new public tool, no Observation ID, no #450 pilot/adapter completion claim.

---

VERDICT: APPROVE_WITH_NITS
