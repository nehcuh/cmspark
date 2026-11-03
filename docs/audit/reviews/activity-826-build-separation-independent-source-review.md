# #826 Windows CPU build/runtime separation — independent source review

VERDICT: **APPROVE**. No reachable blocker found in the frozen Windows unit. This is source approval for the approved structural correction; it is not a claim that the new Windows build or runtime has already passed CI.

Reviewed on 2026-11-03, base `0666fc8d066ec6a0941c5edec865063a30692cf9`, against `/tmp/cmspark-826-build-separation-source-manifest.json`. I did not author or modify these product/test sources, stage, commit, push, rerun CI, or access live configuration. The root's concurrent Mac observation implementation and the known local host-integrity pin are excluded.

## Scope and frozen bytes

All 12 manifest paths were read and their byte lengths/SHA256 independently matched. The unit consists of the shared driver/artifact/runtime modules, early CPU tests plus their captured 0666 producer fixture and build controls, explicit compiled runtime entry, the Windows test-fixture builder call, CI operand, and the 750/760 consumers and negative controls. No historical sealed workflow fixture or hash was changed.

The author handoff is `/tmp/cmspark-826-build-separation-implementation.md`. I reused the previously approved design and root's recorded boundary decision; no new scope or exception is inferred here.

## Actual implementation and preserved behavior

- The pure driver imports only its real source generators and assertion support, registers no tests or compiler and imports no live configuration. Its output is produced from fixed actual inputs. The builder invokes it exactly once inside `testFixtures`; normal production builds do not invoke the CPU compiler.
- The builder uses the original `checked` implementation. No timeout override is passed: its build boundary is 120000 ms, and either `error` or nonzero `status` rejects. Owned `/Fo`, `/Fd`, and `/OUT` paths are explicit, cwd is stable repository root, compiler streams use owned `wx+` file descriptors, failure diagnostics read at most 64 KiB per stream, all opened descriptors are attempted in `finally`, and diagnostic/close failures cannot replace an existing compiler failure. A close-only failure still fails. The old manifest/binary is invalidated before compilation; a failed invocation cannot publish a valid manifest.
- The fixed artifact has no manifest-supplied executable path. Schema, exact target (`win32`, `x64`, pinned Node), current generated source, all fixed generation inputs and actual binary digest must match. Fixed source/manifest/binary reads require bounded regular non-link single-link files and BigInt identity/size/time stability across named/opened/final checks. Hashing and the private runtime copy use the same opened binary bytes. Directories are identity checked. Missing, corrupt, partial, stale-source, target-mismatched, hardlinked or redirected files reject before runtime.
- Windows runtime consumes this artifact before executing the original real C++ schedules; there is no runtime compilation fallback. The new TS entry explicitly registers the same named real case on Windows with 30000 ms and no skip. Canonical census discovery uses the ordinary compiled `*.test.js` route. Both Windows lanes also explicitly execute that operand after fixture build and TS compilation.
- Mac/Linux keep their original compiler call at 20000 ms inside the 30000 ms case. Each real probe invocation remains 6000 ms. The original MCP 20000 ms and its authority, business assertions and cleanup are outside this structural change and unchanged.
- I extracted the actual `method` and `cppDriver` declarations from `git show 0666:...desktop-mcp-snapshot-825.test.mjs` using the TypeScript AST and independently compared them to the new sealed fixture: both are exact. Thus the fixture is the captured actual producer, not an invented return shape. I also AST-bound the old callback and new runtime function and compared everything from `// Run on Windows too:` through the complete outer runtime `finally`: **9258 bytes are identical**. This preserves the live child/whole-directory removal/late-write control, all nine schedules, same-wire comparisons, nested dispatch, UNKNOWN/publication controls, actual reader/BigInt checks, assets and cleanup assertions. The shared producer's eight source-EOL profiles are additionally covered by the actual new test.

## CI and historical contract consumers

The only CI mutation appends `.test-dist/tests/desktop-mcp-snapshot-cpu-825.test.js` to the existing bootstrap/process command. Build → TS compilation → that full command → interaction acceptance remain consecutive with the original conditions. Both Windows matrix lanes satisfy those conditions.

`collapseNativeStages760` compares the complete new step object and exact command before synthesizing the old projection. It does not loosely strip arbitrary text. The original three operands and their order remain fixed; the reviewed new operand must appear exactly once. Current 750/760 negative controls reject missing, duplicate, substituted, wrong-lane operands, missing fixture flag, and prior ordering/failure changes. Existing historical pins are preserved.

## Independent machine evidence

Node **v22.23.4**, switched with `nvm use 22.23.4` before execution, macOS host:

1. `node --test scripts/tests/desktop-mcp-snapshot-cpu-build-826.test.mjs` (from companion): **4 PASS, 0 FAIL, 0 SKIP**, 6551 ms. Log: `/tmp/cmspark-826-build-separation-independent-target.log`.
   - Actual pure generator equals the captured real 0666 producer under eight EOL combinations; builder guard is source/AST checked.
   - Actual artifact producer and consumer execute with the actual `checked` function and a real locally compiled shared C++ executable. Source/target/schema/digest/partial/missing/hardlink controls fail. Equal identities above 2^53 accept; distinct full-width binary identities reject before binary `readSync`.
   - The real Windows runtime branch is executed with that real local executable leaf and an explicitly forbidden compiler port. All original runtime assertions execute; a missing artifact propagates ENOENT without a compiler fallback.
   - Actual builder failure controls cover first/second open, spawn, nonzero status, error with status zero, diagnostic read failure, close plus primary error, and close-only error. Actual entry registration is executed through its transpiled callback port, not merely checked by a string match.
2. `node --test scripts/tests/windows-ci-feedback-750.test.mjs scripts/tests/native-ci-stages-760.test.mjs`: **119 PASS, 0 FAIL, 0 SKIP**, 398 ms. Log: `/tmp/cmspark-826-build-separation-independent-workflow.log`.
3. Separate actual-source AST/byte comparison returned `{freezeFilesMatched:12,sealedFixtureFromActual0666:true,entireRuntimeTailByteExact:true,tailBytes:9258}`.
4. Scoped `git diff --check`: PASS.

Author results reused where no related source changed: original 480 entry **182 PASS** (`/tmp/cmspark-826-build-separation-480-final.log`), new entry isolated strict noEmit type check PASS (`/tmp/cmspark-826-build-separation-entry-types.log`). Root is coordinating one combined full Companion TypeScript check after the concurrent Mac unit freezes; I have not claimed that pending check as done or rerun unrelated suites.

## Boundary and final acceptance

The Windows compilation measurement changes **20000 ms in-test compilation → existing 120000 ms build compilation**, and the 30000 ms case becomes **runtime-only**. The previous total/end-to-end boundary is enlarged. This is stated in the approved coordinator decision and implementation handoff, and this approval does not disguise it as an unchanged budget. Product MCP 20000 ms, per-executable 6000 ms, runtime case 30000 ms, business coverage, permissions and cleanup remain unchanged.

The Windows early handoff test deliberately uses a controlled compiler leaf there; it does not itself prove MSVC compilation. The actual Windows build must compile the shared TU, and the explicit runtime consumer plus full census must execute without skip on the next purpose-directed CI run. The local real C++/actual Windows-branch control supports proceeding through the actual GLM source gate to that Windows verification. It does not explain the historical MSVC timeout's internal cause. A failed new build remains a failed build; no retry, fallback or further timeout change is approved by this review.
