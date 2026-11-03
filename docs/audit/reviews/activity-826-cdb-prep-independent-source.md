# #826 CDB preparation simplification — independent incremental source review

**VERDICT: APPROVE the final two frozen files for the actual GLM source gate.** No supported blocker remains. One stale test payload was found and corrected during review; actual identity-negative coverage is now restored. This is source approval of diagnostic preparation, not Windows/CDB qualification, a physical MCP attempt, dispatch or release acceptance.

Baseline `8fa080c2c8e105139eb5adbb7c751c172af1adce`. Reviewed the complete two-file delta, `/tmp/cmspark-826-cdb-prep-implementation.md`, frozen diff and actual affected tests. Final hashes:

- `companion/scripts/mcp-stack-capture-826.cjs`: `df816ec27221d76f741a007302ce88bead25f4555cce9f130a6f531b9bd661b7`.
- `companion/scripts/tests/mcp-stack-capture-826.test.cjs`: `9af97f384816e97c5ae6e502979c72b84f2fe078eb9b4218bf16dad7aef1bac9`.

Independently verified these hashes and scoped diff-check. Runner, existing MJS consumer, normal/probe Release workflow, canonical CI, actual MCP case, native host and launcher are byte-unchanged from8fa. Reused their prior valid source/actual results. No shared source/config edit, API/model call, CDB/Windows/native UI launch or CI dispatch/retry was performed by this reviewer.

## Source conclusion

The final helper matches the approved narrow rethink:

- CDB remains the fixed managed Windows SDK x64 regular non-symlink file, with Windows/x64 input guards. Manual PE reads and live Authenticode prerequisites are removed, with no PATH fallback, download or arbitrary command/tool path.
- Actual qualification has **zero pre-dummy PowerShell/CIM calls**. It retains the same owned CPU child, ready signal, fixed native `-pv`/`kc`/`qd` invocation, actual clean-output parser, actual pong and mandatory real tool/dummy close. Mere tool existence is not success.
- The post-timeout query retains3s configured work and exact native/bounded direct-browser facts/ownership. It now emits and accepts **exactly `{rows}`**, with no fabricated signed flag or compatibility branch. Tool path is no longer passed in the query binding. Canonical image/path, parent, creation time, live/unique selection, native-pv/browser-pvr policy and all raw/JSON/env limits are unchanged.
- Qualification exposes only nine literal `stoppedAt` values: INPUT, TOOL, WORKSPACE, DUMMY_READY, CDB, PARSER, DETACH, CLOSE, COMPLETE. No raw error, PID, path or numeric diagnostic field was added. Operations set their stage before execution; prior failed stage remains through finally.

### CLOSE adjudication

**The otherwise-positive workspace-close throw returning UNKNOWN/CLOSE complies with the design.** CDB, parser and pong have already succeeded, so the first unsuccessful qualification operation is final cleanup. `cleanupComplete` becomes true only after `work.close()` returns; OBSERVED/COMPLETE requires it plus all original positive booleans. A thrown workspace cleanup cannot yield COMPLETE merely because the dummy exited.

Conversely, an earlier CDB/PARSER/DETACH failure retains that stage when dummy/workspace cleanup executes or throws. Finally does not assign CLOSE blindly. Dummy/tool kill requests are not treated as closure; their original actual-close fences remain. The code introduces no new deadline/retry to manufacture a CLOSE return while a process is still alive. Configured work and required teardown still do not promise a hard15s wall-time ceiling.

## Concrete review finding resolved

The original proposed test diff changed the pure query response to `{rows}`, but its first four collector identity-negative cases still supplied `{signed:true,rows}`. The actual query-shape guard rejected those payloads before identity selection, giving a misleading passing result for tests named for ambiguity/live/path behavior.

A changed fixture must follow the real producer. Author removed only that loop's obsolete signed field. Deliberate legacy signed/extra/malformed-shape negatives remain in the next loop.

Independent actual-source instrumentation confirms the correction:

- Actual old loop: four cases pass UNKNOWN but **zero calls** reach the real collector's `selectOwnedTargets826`.
- Actual current loop: **four calls** reach that same selector, with row counts0,2,1,1 (empty, duplicate native, dead native, wrong image); each refuses without a debugger call.

The control loads the actual full collector with a call-count wrapper around its actual selector, and AST-extracts the actual old/current test loop. It does not replace the decision or invent an identity result. Evidence: `/tmp/cmspark-826-cdb-prep-selector-independent.cjs` and `.log`. This was a bounded consumer regression, not a new production defect or reason for broader review.

## Independent machine evidence

Node22.23.4 through nvm.

1. Final full affected CJS suite:
   `node --test companion/scripts/tests/mcp-stack-capture-826.test.cjs`
   **14 PASS /0 FAIL /0 CANCEL /0 SKIP**,3.189s. `/tmp/cmspark-826-cdb-prep-b-fixed-tests.log`.
   This executes actual fixed-tool resolver with controlled filesystem, no PE reads, zero qualification pre-query, exact pure-row producer/binding and malformed-shape refusals, all nine stages, otherwise-positive CLOSE failure, earlier CDB failure plus throwing cleanup, DETACH refusal, actual held tool/dummy close (including3100ms former-race case), identity/path canonicalization, projection/privacy and unchanged hybrid argv/env/work limits.
2. Actual selector-path old→current counter-control above passes; original identity-negative route is not masked by an invalid schema anymore.
3. Prior12 private design-flow controls are reused as source context, not mislabeled current Windows evidence. The current affected CJS suite now verifies their actual implementation, including the implemented stoppedAt branches not present in that prototype.
4. Existing six MJS tests/real Node original20000ms timeout classifier are unchanged. Author's current combined20PASS and prior independently verified MJS results are reused; no unnecessary additional20s timeout test was run. They remain test-harness checks, not actual MCP acceptance.
5. Final two hashes and scoped diff-check pass; explicit baseline diff of the seven critical unchanged runner/workflow/native inputs is empty.

## Remaining actual gate

**APPROVE** for one actual GLM incremental source review. Only after that gate may the parent separately authorize the purposeful changed-helper Windows invocation. It must still qualify the actual installed CDB and real vendor output/qd/dummy closure before the original MCP20 is allowed to run. Local grammar/OS ports are not a substitute.

No conclusion that signature/PE caused8fa UNKNOWN is made. The old safe all-false qualification remains unexplained; its receipt and the two earlier NOT_RUN runs remain intact. A future stoppedAt narrows a qualification operation only, not SDK cause. Original MCP20, product/ownedPID/privacy boundaries, historical round limits, required canonical/main all-green and final fresh three-platform Release preview remain unchanged.
