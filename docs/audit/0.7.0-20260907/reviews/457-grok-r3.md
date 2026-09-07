I'll read the full offloaded request first so the review is based on the complete packet, not the truncated excerpt.# #457 R3 focused acceptance review

**Scope of this gate:** rehearsal script + honesty of the attached ledger/evidence files. Not core/MCP behavior, not enterprise scenarios, not installer/release readiness. Product counts are treated as *reported* local runs. Roundtrip `PASS` is accepted as attached execution output, not as a rerun by this review.

## BLOCK
None.

## MAJOR
None.

## NIT
1. **Evidence-dir leftover is file-pair, not listing.** Old phase proves `dist/business-evidence` is absent and that two known files’ bytes are unchanged. It does not snapshot `readdir(business-evidence-v1)`. The assertion text (“leaves this new directory alone”) is slightly stronger than the check.
2. **Old-writer token is the API return value.** Raw pre-write row existence + parsed-row `deepEqual` + file-byte change are real. `verifyOutboundGrantToken(m.old_writer.token, …)` does not re-read the token from disk; the assertion message overstates “reads the actual old-writer record.” The `verified[]` wording is the accurate one.
3. **Machine freezes are not one commit.** Markdown table says package gates ran in a “HEAD 临时归档”; `machine-evidence.json` pins `0a80846d`; roundtrip records `candidate_head` `0c47480…` with `candidate_uses_working_tree: true`. Json scopes are honest; the table should cite those freeze IDs.
4. **Build rows are paraphrases** (“Process exited 0; compilation/bundling completed.”), not captured compiler lines. Test rows look like real summaries.
5. **Package-gate `command_after_nvm_use_22` is prose**, not a pasteable command (acceptable given fixture-moving, but weaker than the other rows).
6. **`procedure_sha256` / `fixture_sha256` / log digests** cannot be recomputed from this packet (fixture and raw logs are local-only). That matches the stated evidence model; it is not independent hash verification.

## R3 corrections (packet-only)

| Claimed fix | Packet |
| --- | --- |
| `machine-evidence.json` with summaries, log SHA-256, paths, repro commands | Present; ledger points at it and says it is an execution record, not a reviewer rerun |
| Raw pre-write context row | `assert.ok(beforeContext)` then `deepEqual` vs post-old-write row |
| Old `business-evidence` module absent | `existsSync(dist/business-evidence) === false` |
| Child completion after assertions; parent checks | `phase-complete:${phase}` is last on the success path; parent `endsWith`; failure goes to `exitCode=1` (execFileSync throws) |
| Source hash covers src / tsconfig / package | Matches script + result `source_hash_covers` |
| No historical-deps / OS-sandbox / old evidence-reader claim | In script `not_verified`, result, and ledger prose |
| Future fixture = semantic `schema_version` mutation + `JSON.stringify` | Not a byte-patch; ledger matches |
| Roundtrip PASS attached | Shape matches the script’s stdout contract |

Create → old → verify is three processes, current `node_modules` for both trees, temp data dir, tokens not in the PASS JSON, workspace removed in `finally`. Ledger status remains **未达到发布条件；版本保持 0.6.6**, and blocking enterprise items stay open. Architecture note does not smuggle a release claim.

## VERDICT
**APPROVE** — rehearsal script and honest ledger only.

Does **not** approve Companion/Extension/MCP correctness, historical 0.6.6 dependency fidelity, OS sandboxing, mixed installed versions, or 0.7.0 release.
