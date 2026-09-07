# #453 wiring / #454–#455 Packs / #450 template — R2 disposition

Grok 4.6: APPROVE_WITH_NITS; actual DeepSeek V4 Pro: APPROVE for merge, 0 BLOCK/MAJOR. User explicitly authorized this pair. Frozen source hashes: reviews/453-wiring-manifest.json. Scope excludes draft core, MCP and true enterprise acceptance.

Machine: wiring 23/23 + production build; broad current-source Companion 4973 pass /23 skip /0 fail, settings20/20. Some broader tests cover later MCP work and do not expand this review scope.

R1 blocker: Grok flagged loss of fifth invocation metadata. R2 wrapper preserves invokeOpts and overwrites only authenticated chat evidenceScope; production WS composition test proves trusted siteContextTabId survives. Existing #451 resolver still uses the original executor separately. Both judges verified this correction. Dispatch-start AND completion plan policy/thread existence now guards capture; plan→default and deleted-thread mid-read regressions pass.

R2 NIT dispositions (no material defect left unacknowledged):

- Grok1–3 / DeepSeek4: combined capture+trusted-tab, HTML midflight and every read/create plan permutation are additional test opportunities. Present WS test proves composition independently, both text/HTML use one capture branch with unit negatives, and plan allowlist adds only read/render. Fixture is actual BrowserBridge output with `channel: isolated` (not DOM), so midflight tests exercise policy/deletion. No misleading assertion that it is CDP.
- Grok4–5 / DeepSeek3: store receives producer result but constructs an explicit Observation whitelist and server UUID; caller IDs are never persistence authority. Forged ID cannot cite an absent Observation. Failed results remain ordinary failed tool data and cannot become evidence. Successful text/HTML return paths strip caller IDs even without scope. Further failed-result cleanup is defense in depth.
- Grok6 / DeepSeek1,5: public execution gates establish plan/thread authorization before synchronous draft mutation; there is no await between final local dispatch and write. Capture additionally spans an async browser read, so it has both-end checks. Future direct callers must supply validated scope; executor is not an authentication API.
- Grok7: allowlist mode denies every unlisted MCP write; actual PackEngine test confirms it. Duplicating all MCP names into deny is unnecessary and cannot enumerate future servers.
- DeepSeek2: test imports `_security-gates-setup` first and uses the isolated test runner. No production pilot is written. Test isolation is config-data isolation, not an OS filesystem sandbox.
- DeepSeek6: fifth-option comment anticipates a server-owned outbound scope; this Chat executor deliberately drops it for trustedOutbound. #456 instead captures after HTTP grant revalidation. No outbound grant may create a Chat scope.
- DeepSeek7: message routes resolve session/thread through the existing authenticated local WS path; trustedOutbound drops Chat scope and cannot select arbitrary thread IDs as evidence authority. Local session switching remains the existing application capability.
- DeepSeek8: ordinary Chat successful page reads produce bounded durable evidence, explicitly documented. This is not limited to Mission runs; plan/deleted/aborted/DOM paths do not capture.
- DeepSeek9: community is the existing builtin distribution channel, not a security boundary or proof of enterprise approval. Mission requires no host/ACP/worker authority.
- DeepSeek10–11: service invariants have their separate #453 core tests/review. Unknown schemas fail in repository before schema lookup. Historical mutation_result exclusion is exercised in core; criteria_catalog comes from supported requirement facts. Cosmetic EOF and extra unapply assertions do not alter behavior.

Both Packs remain subject to two real enterprise pilots. No version bump, release, installation or claim that external platform records were created.
