Review complete. Findings:

**Verification executed:**
- `git show 5b16c8a` confirms the diff file is faithful (5 files, +643/−178).
- `image-fetch-admission.ts` is a byte-for-byte move of the existing gate from `server.ts` (lines 1001–1175 of parent commit → lines 42–231 of new module).
- Stale imports removed: `isAutoApprovedDomain`, `isCloudMetadataIp`, `isPrivateOrLoopbackIp`, `decodeDataUrlImage`, `summarizeCandidateUrl` no longer appear in `server.ts`.
- Admission order in `server.ts`: multi-agent (722) → cookie (913) → browser_download (925) → L2 (963) → URL (990) → **IMAGE_FETCH (1005)** → companion dispatch — matches the spec.
- `dispatchToExtension` is a hoisted function declaration (server.ts:1297), so its use at line 1013 before its definition is valid.
- New unit tests: **7 pass** (`node --test .test-dist/tests/image-fetch-admission.test.js`).
- Integration tests: **63 pass** (`node --test .test-dist/tests/integration/security-gates.test.js`).

**Critical invariants preserved (verified by reading image-fetch-admission.ts):**
1. No `auto_approve_dangerous` / `allow_all_schemes` short-circuit anywhere in the gate (image-fetch-admission.ts:174–221).
2. Only `isAutoApprovedDomain(host)` gates auto-approval — `trusted_domains` is *not* consulted (explicit comment at line 174).
3. `isCloudMetadataIp(host)` hard-blocks before scheme check (line 156, 161).
4. `data:` URL is locally decoded via `decodeDataUrlImage`, no phase2, no schemeOk expansion (lines 102–150).
5. Phase2 synthetic id is exactly `` `${toolCallId}__image_fetch` `` (line 224).
6. Direct `analyze_image_fetch` returns blocked result with the same error string + warn key (lines 61–69).
7. Confirm request parameters (`toolName`, `dangerousApis`, `code`, `relevantDomains`, `defenseLayer`, `riskLevel`) match the parent exactly (lines 195–202).

**ADR-020 capability declaration:** The implementer prompt omits the Surface/Compose/Autonomy/Trust/Channel block, but the checklist explicitly says this is fine for pure refactors — and this commit adds no new tools, gates, or UI entry points. Not a nit per the rule.

**Observations (not blocking):**
- The new `ToolResult` type is re-declared locally (line 18) rather than imported from a shared types module — but this matches the existing convention in `l2-admission.ts` and `url-cookie-admission.ts`. Consistent with prior phases.

No incomplete fixes, no security regressions, no missing tests, no wrong file:line references, no over-claiming. Pure mechanical move.

VERDICT: APPROVE
