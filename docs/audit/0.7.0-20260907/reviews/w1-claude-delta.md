I reviewed the file at `/private/tmp/cmspark-w1-review-snapshot/w1-final-delta.md` in full. This is a read-only static review; all findings are `[inspected]` (no execution performed).

## Review: W1 Final Delta

### Preamble claims vs. evidence shown

- **Historical migration claim** — Verified against the shown code: `matchesSiteExperience(doc, site, legacyRead)` requires `site-op-memory` always, `auto` only for v1; the legacy id path is the only route that accepts the pre-`auto` marker. The "Original producer history" snippet shows `createExperienceSkill(skillName, "site_knowledge", host, ["site-op-memory"], entry)` with `skillName = host.replace(/\./g, "-")` and `doc.site = host` — consistent with `legacyId` naming and host-match on read. Commit hashes (63aa4c63 / 6e6bd20d) are not verifiable from this artifact but are internally consistent with the code shown. ✓
- **Test arithmetic** — "16/16 (includes 4 W2)" reconciles with the shown W1 files: 4 (identity) + 2 (test-data-dir) + 6 (auto-persist) = 12 W1 + 4 W2 = 16 ✓. "4927 = 4904 pass + 23 skip" ✓.
- **Claims not evidenced in this delta** — companion-dispatch `runComputerTask` calls, html/:root selector semantics, window-capture disclosure checks. These rest on prior whole-W1 reviews; unverifiable from this file alone (informational, not a defect).

### Code correctness checks (traced by hand)

- `siteExperienceIdentity` — protocol gate, hostname normalization (`www.` strip, lowercase), sha256 v1 id, and dot→hyphen legacy id all check out. The collision alias (a.b-c vs a-b.c share legacyId, distinct v1 ids) is handled and deliberately tested. `matchesSiteExperience` wildcard/comma guards fire before identity resolution; try/catch covers unparseable input. ✓
- `readSiteExperienceEntries` — iterates `[v1, legacy]` and content-keyed dedupe preserves v1-wins precedence including staleness, matching test 3 exactly. Legacy read of the collision partner correctly returns `[]` (host mismatch on `doc.site`). ✓
- I hand-verified every assertion in `site-experience-identity.test.ts`: all four tests produce the asserted results against the shown implementation. ✓
- `run-tests.mjs` — realpath normalization, requested-file validation against discovered set, settings-web last/serial, Node-major gating, temp-run-dir cleanup in `finally` before `process.exit`. Logic consistent with both fixture tests in `test-data-dir.test.ts` (worker isolation, failure propagation, cleanup-on-failure, targeted-run skip). ✓
- `site-op-auto-persist.test.ts` — the dedup test's cross-test disk persistence is handled correctly (the `continue` guard absorbs the doc seeded by the prior test). The 4-failure test's fragment assertions match the seeded content format in the hydrate test. Occupied-identity and collision tests verify no-append semantics correctly. ✓

### Nits (non-blocking)

1. **Legacy read tag permissiveness** — `matchesSiteExperience` accepts any legacy `site_knowledge` doc carrying `site-op-memory`, even one also tagged e.g. `["manual"]`. The preamble claim "arbitrary manual/unknown origin documents remain excluded" holds for writes and for docs lacking the marker, but a hypothetical mixed-tag legacy doc would be read. Likely fine in practice (the historical producer wrote exactly `["site-op-memory"]`), but a negative tag check or a comment documenting the assumption would close it.
2. **Inconsistent error surface** — `siteExperienceIdentity` throws a custom error for non-HTTP(S) protocols but a raw `TypeError` for unparseable input (empty string, malformed URL). Direct callers get two error shapes.
3. **run-tests.mjs comment ambiguity** — lines 200–204 ("Node 22 rejects it; 22 and 24 accept the experimental name") leave Node 23's behavior unstated. Also, the shown fixture tests never exercise `settingsWebIsolationArgs` (no settings-web fixture), so that branch's cross-version claim is untested by the included suite.
4. **Dedup test strength depends on an assumption** — "No hostname → no hydration" gates whether the four calls reach `recordSiteOpFailure`. If hydration were ever keyed off the tab cache instead of the explicit `hostname` param, the test would still pass vacuously (banned calls record no failures → no persist event → same assertions). A probe asserting the failure path actually ran would lock in the dedup coverage.
5. **run-tests.mjs argv parsing** — `process.argv.slice(2)` treats node CLI flags placed before the script as requested test paths (edge misuse; standard pattern, noting only).
6. **Cosmetic** — the "Original producer history" snippet has inconsistent leading indentation (first line at column 0).

### Summary

The delta is coherent: implementation, tests, and historical evidence are mutually consistent, and I found no concrete functional defects — no wrong-path reads, no mutation of historical docs, no arithmetic or assertion errors in the shown tests. The remaining issues are documentation/assumption-level nits.

**VERDICT: APPROVE_WITH_NITS**
