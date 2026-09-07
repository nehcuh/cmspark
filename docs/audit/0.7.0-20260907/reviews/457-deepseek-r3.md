# Actual model: deepseek-v4-pro

# Code Review — #457 R3 : rehearsal script + honest evidence ledger

**Scope** (one line): This packet adds `rehearse-enterprise-roundtrip.mjs` (synthetic create→0.6.6-old→new re-read, temp-dir only), a machine-evidence ledger, and the audit tables that keep the release blocked.

*Disclosure: read-only review; roundtrip-result.json is reported execution evidence, not something I reran [inspected].* The gate's own boundary — "approve only the rehearsal script + honest ledger, not core/MCP functionality or enterprise/release readiness" — is respected below.

## BLOCK

None.

The strongest risk class here would be dishonest evidence, and the packet is consistently honest. I checked every `verified` claim in `roundtrip-result.json` against an actual assertion in the script: citation/draft survival (verify asserts revision 2 + citation observation_id after old init), idempotent replay (deepEqual create/update in restarted verify process), old-writer field survival (pre-write `beforeContext` row looked up first, deepEqual after a proven old `issueOutboundGrant` persisted a byte change, then new code verifies the old-issued token), old-version denial of the context profile (false in old process, true in new, with an ordinary-token pass in the same old process as a working-code control), knowledge bytes (byte-equality asserted in both later phases), unknown schema (bytes intact after old init; `/EVIDENCE_SCHEMA_UNSUPPORTED/` throw in new). Each `verified[]` string maps to code. The `not_verified[]` list underclaims nothing and explicitly excludes historical deps, OS sandbox, installer, other OSes, and real enterprise scenarios — these also appear verbatim in the script's own output fields rather than only in prose.

Release-approval tone is correctly absent: the ledger says version stays 0.6.6, both real scenarios mandatory, and the blocking-evidence table names concrete missing records. `machine-evidence.json` states "independent review did not rerun these" and provides reproduction commands, digests, and local log paths — evidence-by-reference, but framed as exactly that. Summaries are internally consistent (4975+23+0=4998; 48/48; 11/11; 124/124; 20/20).

## MAJOR

None.

Points I considered and cleared:

- **Child/parent completion coupling** (the R3 "each child emits completion only after all assertions" claim): the marker `phase-complete:<phase>` is `process.stdout.write`n as the last statement of the try-path only; any failed assert rejects the IIFE → `process.exitCode = 1` → `execFileSync` throws before the result JSON prints, and the parent additionally asserts `output.trimEnd().endsWith(marker)` plus exit 0. A PASS implies all three phases completed all assertions. Solid.
- **Old-vs-new directory assertion** (`fs.existsSync(dist/business-evidence) === false`): proves only the compiled baseline lacks the module — but the supporting claim (old initialization doesn't touch new data files) is proven separately by byte-equality of both evidence files asserted *after* `config.js.initDataDir()` runs in the old process. Ordering is correct.
- **Path/environment safety**: data dir is `mkdtempSync`-generated under tmp, child re-asserts `CMSPARK_DATA_DIR` and the workspace prefix; all execs use structured argv (no shell); `finally { rmSync(workspace, recursive, force) }` is bounded to the generated path; synthetic tokens live only in the temp meta file (mode 0o600) and are not echoed into any result JSON. No secrets or injection surface.
- **Source-hash integrity**: `sourceHash` is computed over the *same* copied tree that is compiled (copy precedes compile and hash), covers src + tsconfig.json + package.json as the output promises, and the exclusions (fixture, script) are separately hashed (`fixture_sha256`, `procedure_sha256`). No race with repo edits.
- **Future-version fixture**: parse → set `schema_version = 999` → `JSON.stringify` re-serialization; the ledger already validates the operation and disowns byte-patch reading, so this is not a misrepresentation.
- **Atomic claims**: every row in the ledger's evidence column is a summary-level claim backed by a listed artifact, and rows that are not machine-verified sit in the blocking table, not the evidence table.

## NIT

1. **Reproducibility gap on working-tree evidence** — `roundtrip-result.json` records `candidate_uses_working_tree: true` + `candidate_head` + a source SHA-256 of the working-tree snapshot, but nothing records `git status --porcelain`/`git diff HEAD` state at run time. If the tree was dirty, the exact compiled bytes are not reconstructible from the recorded commit; if it was clean, that fact is unstated. One extra field (or a `gitworktree_dirty: bool` / `git_diff_sha256`) would make the evidence checkable, not merely plausible.
2. **Misleading code comment** — the create-phase comment "Actual producer bytes with only the future-version discriminator changed" overstates: `JSON.parse`/`stringify` also normalizes formatting/whitespace/number rendering. The prose ledger says it correctly ("重新序列化", not a byte-patch claim) — make the code comment match the ledger.
3. **Old-denial proof is behavioral, not causal** — `verifyOutboundGrantToken(m.context.token).ok === false` in the old process would also pass if old code failed to parse *anything*. The ordinary-token success in the same process is a reasonable control, but asserting the specific failure/denial reason (if the old API exposes one) would make "old version denies the new profile" airtight rather than well-supported.
4. **app-module availability granularity** — the future-schema test checks `EvidenceStore.read()` on the future scope only; there's no separate assertion that non-future records are still readable in the same store instance. Minor.

## VERDICT

**pass (scoped)**: the rehearsal script and the honest ledger merit approval for what they claim; internal consistency checks out and all claims are back-mapped to assertions. This is not and must not be read as release/enterprise approval — the packet itself keeps the release blocked and the fix list (`#450`–`#456`) open. For the gate being reviewed: no BLOCKs, no MAJORs; 4 benign NITs.

```json
{
  "deepseek-v4-pro": {
    "inputTokens": 13662,
    "outputTokens": 26960,
    "cacheReadInputTokens": 13568,
    "cacheCreationInputTokens": 0,
    "webSearchRequests": 0,
    "costUSD": 0.7490939999999999,
    "contextWindow": 200000,
    "maxOutputTokens": 32000
  }
}
```
