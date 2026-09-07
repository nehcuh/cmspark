I'll review only that packet and judge the assertions it actually makes.# #457 R2 independent review

Scope: this packet only. No re-hash, re-run, or other artifacts.

## BLOCK

None on the synthetic roundtrip claims.

## MAJOR

None on those claims. The R2 narrowing is real in the script and in `roundtrip-result.json`.

Do **not** treat this as approval of Companion 4973/settings/build, Extension 1277, MCP 11/11 or “MCP48/48”, package gates 124, draft/chat/pack batches, #456 export, real pilot, installer/mixed-version, or 0.7.0 release. Those ledger rows have no logs/hashes here. The ledger itself still says **未达到发布条件**.

## What the packet actually proves

**Old source / current deps.** `git archive` of `63b449d9ff77c2c37af54579fbff3b628df286c1` `companion`, `package.json` == `0.6.6`, then current `companion/node_modules` symlinked into old, current tree, and workspace; current `tsc` compiles both. PASS `dependencies` and `not_verified: historical dependency versions` match the code. This is not a 0.6.6 install/lockfile rehearsal.

**No old evidence reader.** Old dist is only checked for missing `business-evidence/service.js`. Old phase never loads that API. It `initDataDir`s, verifies grants, and issues a grant. Evidence/knowledge survival is `readFileSync` byte equality, not an old reader. Unknown schema is refused only in the final **current** `EvidenceStore.read()`. `not_verified: old evidence reader` is accurate.

**Isolation ≠ OS sandbox.** Phases get `cwd=workspace`, `CMSPARK_DATA_DIR=data`, `TMP*=workspace`, plus `PATH`/`SystemRoot`. Phase asserts the env and temp dirname. `HOME` is unset, but Node `os.homedir()` still resolves the real home. PASS `isolation` and ledger wording match: app data/cwd isolation, not a filesystem sandbox, no homedir intercept.

**Old writer + raw context + new reader.** Old phase reads `outbound-grants.json` bytes, snapshots the context **row**, calls old `issueOutboundGrant`, then:

- persisted bytes change
- `old_writer.id` exists in the file
- context row `deepEqual`s the pre-write JSON (bypasses new-parser defaults)
- old process authenticates `old_writer.token`

Meta stores that return value. Current process authenticates the same token and `lookupContextGrant`s export/knowledge/origins. Ordinary token is checked on old only; context token is denied on old and accepted on current. That matches `verified[]`.

**Hashes / freeze.** Current `src`+`tsconfig.json`+`package.json` → `candidate_source_sha256`; copied fixture hashed separately; running script → `procedure_sha256`. PASS also has `baseline`, `candidate_head`, `candidate_uses_working_tree: true`. Fixture is copied then hashed (no compile race with later edits). Create asserts one evidence file, fixture contains `REL-1`, citation `start/end` via `Array.from` (ASCII here). Future doc is parse → `schema_version=999` → stringify under another scope name; original producer bytes stay in `m.bytes`. Tokens are not in PASS; workspace is `rmSync`’d.

Ledger roundtrip paragraph, isolation paragraph, and blocking table row (“演练已过；完整安装/混版未验”) match the script. Architecture excerpt does not claim the gaps are closed.

## NIT

- Old raw-context `deepEqual` should `assert.ok(beforeContext)` first; `deepEqual(undefined, undefined)` would pass.
- Assert text “current code reads the actual old-writer record” is stronger than PASS `verified[]` (“verifies old-written token”). This packet has no grant implementation, so token verify vs file-row read is not shown.
- Comment/ledger “only the version field changed” is parse-mutate-`JSON.stringify`, not a one-field byte patch.
- Old “no evidence API” is one missing `service.js`, not an absent `business-evidence/` tree.
- Phase worker is a floating async IIFE; event-loop keep-alive is assumed (PASS implies it finished).
- Procedure/source/fixture hex values are not recomputed here; they are pins for replay, not in-packet proofs.

## VERDICT

**PASS** for kind `synthetic-source-data-roundtrip` only: old 0.6.6 source + **current** deps, no old evidence reader, temp cwd/`CMSPARK_DATA_DIR` isolation **without** OS sandbox/`os.homedir` intercept, real old grant persist + raw context row + current verify of that token, hashes as recorded.

**Not approved:** core product, MCP client/SDK/48, real enterprise pilot, installer/mixed-version/OS matrix, production model, historical lockfile, or 0.7.0 release.
