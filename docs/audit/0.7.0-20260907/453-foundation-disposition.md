# #453 foundation milestone disposition

Grok 4.6 and actual DeepSeek V4 Pro independently APPROVE_WITH_NITS. User explicitly authorized this pair. Immutable packet source hashes are in reviews/453-foundation-manifest.json. Machine checks: 16/16 foundation tests; Companion 4,934 pass / 23 skip / 0 fail plus settings 20/20; production build passed.

This batch provides only internal normalization, scope-isolated append-only evidence storage, strict pilot configuration and insert-time coverage. It does not expose a public capture or draft tool and does not finish #453. Follow-on draft repository/checker/render work is separately reviewed.

- Derived relation asymmetry (both judges): intentional. criteria_cases requires configured cross-platform source namespaces for standard/case correspondence. story_requirement is a local creative draft derivation and reuses requirement-source fields, with no remote story identity.
- Grok N2: Zod parse returns a cloned object; origin normalization mutates that parsed clone, not the persisted input. No read-time rewrite occurs.
- Grok N3: empty selector remains ordinary persisted provenance and cannot satisfy a nonempty registered selector. Consumer coverage must compare exact scope.
- Grok N4: WHATWG dot-path normalization resolves to the same exact origin; accepted canonical URL policy. No prefix/wildcard matching.
- Grok N5 / DeepSeek N1: generic locked-pilot parse errors remain fail-closed; additional loader/digest negative tests and public error mapping belong to service integration. No file replacement on failure.
- Grok N6: criterion ID is constructed and compared as an opaque full string, never split at #.
- DeepSeek N2: consumer must validate contract digest, adapter, exact scope, coverage flags and provenance; metadata alone is not a completeness proof. Persisted input is owned by this process, not an authenticated hostile-writer store.
- DeepSeek N4: canonical -0/0 equivalence is consistent with JSON numeric equality; positive revisions/windows exclude -0.
- DeepSeek N5: empty bindings deliberately allows an incomplete draft; it cannot verify facts.
- DeepSeek N6: unsupported external concurrent writer remains outside single-process ownership; post-read bytes are also checked.
- DeepSeek N7: first reached capacity applies, not a promise of 64 full-size observations. No eviction.
- DeepSeek N8: a corrupt/pre-over-capacity store may throw instead of returning a skip. Authenticated capture integration must preserve the original browser result while reporting local capture failure; it must not clear or repair the store silently.

No new public endpoint, version bump, release or app replacement.
