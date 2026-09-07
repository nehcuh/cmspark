# #452 extraction R2 review disposition

Independent judges: grok-4.6 and deepseek-v4-pro, both APPROVE_WITH_NITS. This pair is explicitly authorized by the user; Claude Code is a transport CLI, not the judging model. Frozen source hashes are in reviews/452-manifest.json.

Machine checks: extension 1,277/1,277 pass, production build exit 0. Synthetic Chrome wire fixtures are producer recordings, not enterprise acceptance.

- Grok N1: verified production safeEvaluate sends Runtime.evaluate returnByValue:true (browser-bridge.ts), so object snapshots are serialized. The omitted unchanged context exists; no fix required.
- Grok N2: accepted limitation: DOM.getDocument/documentURL and DOM.getOuterHTML are separate calls. Node identity binding reduces but is not claimed to eliminate a navigation race. channel=dom remains visible; no business completeness follows from extraction eligibility.
- Grok N3: not reproduced as stated: prefix slicing can only remove a URL suffix; it cannot leave a later token while removing its earlier https prefix. DeepSeek independently checked this boundary. Scheme-relative/bare-domain strings remain untrusted page text, outside the http(s) redaction guarantee.
- Grok N4: eligible is extraction attribution only. Top frame follows API injection defaults; no iframe traversal or completeness is claimed.
- Grok N5: invalid-HTML fallback is production code but lacks a dedicated regression; existing malformed-text and all four HTML channel/scope tests cover the primary contracts. Synthetic fixture limitation is explicit.
- DeepSeek N1/N2/N5: title is a diagnostic before-sample and is not atomic with content. Scheme-relative strings, arbitrary page text and URL path slugs are not generally scrubbed. #453 does not persist title. These are explicitly bounded privacy claims.
- DeepSeek N3/N6: redundant same-tab check and local htmlRead variable name are harmless; defer cosmetic-only edits.
- DeepSeek N4: malformed/non-string text now fails PAGE_READ_INVALID_RESULT rather than inventing empty success; consumers are notified here and in the issue.
- DeepSeek N7: target rejection coverage is not exhaustive; target helper is unchanged from reviewed #451.

This delivers the generic extraction code portion. #452 remains open for pilot adapters/real page acceptance coordinated with #450/#457. No release, version bump, or installation is authorized by this milestone.
