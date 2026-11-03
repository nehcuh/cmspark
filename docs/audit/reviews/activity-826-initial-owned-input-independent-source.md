# Independent source gate — initial owned input + first-dialog attempts

**VERDICT: APPROVE** the frozen six-source unit on baseline0805bca0. No supported source blocker remains. This approves the implementation/source gate; it is not actual Windows compilation/input success, canonical all-green, merge or release approval.

## Exact reviewed source

Final manifest `/tmp/cmspark-826-initial-owned-input-manifest.json`, final patch `/tmp/cmspark-826-initial-owned-input.diff` SHA256 `eef76efb79b3fa6c3add1af90e48b1d79b346f23368c2ebf5695c0358ba48bd6`.

| File below companion/ | SHA256 |
|---|---|
|scripts/desktop-mcp-fixture.mjs|f13933841f04160cc90ce868cb1f2a4f196ef8400882c565dfe9d46c0715263e|
|scripts/desktop-terminal-fixture.mjs|b47fbcf511cde13a2072dc345bba95379ef50a8cad14d9f570554b50c378ca1e|
|scripts/tests/observation-826-inverse.cjs|0a1c3f19c1ddaa58df071bb1c8cbd3c69e9b9aef1abab884d1719b95817909dc|
|scripts/tests/observation-788-inverse.mjs|df6cb7cbb27cefcfd65bcdcfcc430719c121e74e1af391afa7d2d23268174a26|
|tests/desktop-native-thread-metadata-476.test.ts|9e80020deed6f46ede58481ecbd2e631c796b0cc653995ad1f6bdbfa9d2cbabe|
|tests/desktop-owned-initial-input-826.test.ts|5e920d8e4f785d8c7701ddab4563b7e01fa21b6d5d0daa30d0af2b2fbfbb583b|

All six final hashes/byte lengths and patch hash were independently checked. The final mcp-generator edit corrected only an outdated comment. Replacing that exact comment reconstructs the previously machine-tested source hash21882488…; executing code and the other five files are unchanged, so the150 passing checks were reused after this comment correction. The root's documentation changes are outside this source unit.

## Unit A — actual emitted Windows input and startup

Reviewed the complete generator deltas, actual full three-family generated C++ consumed by the focused tests, the shared SDK helper, existing Windows host includes/libraries, unchanged raw controllers and current Node admission callsites.

- Setup exists only in generated cpp LOCAL/ARCHIVE/TERMINAL test-fixture binaries. It does not modify the product host, launcher, Mac generators' output, keyboard controllers, capability protocol, CI/Release commands or action/confirmation/PTY/close functions.
- The helper enters a temporary per-monitor-v2 thread-DPI context before geometry/hit testing and restores the returned original context on all ordinary lambda exits. Enter or restore failure refuses setup. Existing windows.h, cstdint and user32 linkage support the APIs/types used; actual MSVC SDK compilation remains a real platform gate.
- Captured owner/window/document/epoch/web/controller qualification precedes selection. The helper refuses invalid, hidden, minimized, disabled or foreign-PID windows, invalid rect/client top band, virtual-screen bounds and noncaption/occluded/foreign-root/foreign-PID hits. Coordinates are int64 intermediates; signed16 limits precede LPARAM packing. Geometry, client conversion, hit tests and absolute virtual-desktop normalization occur within the same physical DPI context. No scanning/re-aim/fallback was added.
- SDK `INPUT batch[3]{}` with `sizeof(INPUT)` sends exactly move+leftdown+leftup in one call. The inert test's size40 is not represented as native ABI proof. SendInput's full return is insertion qualification, not proof of delivery or foreground.
- Visibility wait does not consume the one attempt. Attempted is set before calling the helper, complete only after full3 plus DPI restoration. A reentrant activation cannot start the original form while selection is incomplete. Partial0/1/2 or other setup refusal terminally fails, even if reentry/later foreground appears qualified; it never retries. The post-selection capture/epoch/controller/window/closing guards are rechecked, then the original actual foreground join must still pass.
- The two Windows-only Node calls use existing pure `hostedTerminalHost705()` before directory/config work and native launch. No environment pruning/admission broadening or child environment inheritance was added. The stricter existing TERMINAL admission remains. The launcher still gives the child only its original OS environment; CI admission is deliberately on the parent Node side.

This explicitly changes the three Windows fixtures' initial contract from zero input to at most one owned-caption selection. It does not establish a common cause of the0805 LOCAL/ARCHIVE timeouts or guarantee that every click obtains foreground. Original20/45s and all later authority/business/cleanup gates remain in force.

## Unit B — first-dialog observations

The three new fields are bounded wire-hook observations: terminalAttempted boolean, openReplyAttempts saturated at6 and authenticated sendRequests saturated at4. The actual outgoing attempt is counted before the existing send; that is not delivery. No new native observer, payload disclosure, await, timer or promise order was introduced.

Actual AST-extracted callbacks were executed by the focused test. Malformed handling and original forwarding retain their paths; the third user-event ACK is still dropped, terminates the socket once and does not call originalSend for that event. No new field changes completion qualifications. The phase projects only the three declared values alongside the previous receipt.

## Current behavior versus historical source authorities

The two hosted-admission calls have an explicit whole-current-hash-bound behavior inverse before OBS826. Only then is the updated observation-only current source stripped (nine exact blocks), preserving locked prior46d85252… unchanged. The terminal generator has its own exact current/import/block/call behavior inverse before the original788 lineage. Historical049f authority remains unchanged. This distinguishes changed setup from observational insertion rather than pretending historical behavior is unchanged.

Actual-source LF/CRLF controls reject mutated/missing/duplicated or drifting layers. Product-source inverses still recover the original host. Independently importing the actual0805 generator git blobs and comparing current full Mac outputs produced six exact byte-equal results (three families ×LF/CRLF), not merely normalized-source or label equality.

## Independent execution and evidence

Node22.23.4 selected through nvm; no native UI/Windows API/CDB, new VM, source edit, API/CI dispatch/rerun/cancel or model call.

1. Official isolated runner on eight affected suites: **108PASS,0FAIL,0CANCEL,0SKIP**, `/tmp/cmspark-826-initial-owned-input-b-related.log` (1036.230042ms). Includes the new seven focused actual-generated-source controls and unchanged consumers for788,826close,747,476MCP/archive/dialog/terminal input.
2. Actual generator/legacy consumer suite: **42PASS,0FAIL,0CANCEL,0SKIP**, `/tmp/cmspark-826-initial-owned-input-b-generators.log` (439.006458ms).
3. Independent conservation script `/tmp/cmspark-826-initial-owned-input-b-conservation.mjs` and `.log`: frozen six-source hashes at the execution freeze; unchanged product host cpp/swift, launcher, app.js, raw three cpp controllers, CI/Release bytes; six complete current-vs-actual0805 Mac producer comparisons. Owned temporary old-source files were removed afterward.
4. Final six-source/patch hash and exact comment-only equivalence: `/tmp/cmspark-826-initial-owned-input-b-final-freeze.log`.
5. Author's full strict TSC success is reused from `/tmp/cmspark-826-initial-owned-input-types.log`; no executable source changed afterward except the explicitly compiled focused consumer work recorded in the author report. Prior source18-baseline evidence is reused rather than rerunning unrelated checks.

The tests cover actual full emitted helper/guard bodies using inert OS leaves: invisible-before-attempt, negative virtual origin, physical normalization/DPI restoration, owned/foreign/noncaption refusal, partial0/1/2 with reentry, full3 reentry, stale postselection identity, original foreground wait, once-only form, pure hosted admission and exact behavior/observation lineage. These demonstrate source control flow; they are not a Windows physical-selection receipt.

Proceed to actual GLM source review and, if approved, a changed-head normal CI. Fresh actual Windows compilation and all original canonical/native business tests must pass; the previously red canonical job is not offset by these CPU controls or another VM's success.
