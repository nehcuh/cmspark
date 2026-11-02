# Independent design/experiment review —826 CPU compile leaf and error priority

VERDICT: APPROVE to implement the two bounded test-only changes, then review the actual source increment. This is not evidence that MSVC timeout is fixed or that the historical compiler/linker cause is known.

Source has not been changed. Reviewed /tmp/cmspark-826-cpu-slim-probe.mjs and /tmp/cmspark-826-primary-mask-probe.mjs against the actual scripts/tests/desktop-mcp-snapshot-825.test.mjs consumer and current Windows first-failure transcripts. Independently reran both probes in distinct /tmp paths. No CI run, cancellation, live configuration or source mutation.

## CPU leaf simplification

The proposed exact replacements remove only four CPU harness helper includes: fstream/filesystem/iostream/map. The Json leaf retains the id consumed by its original Stringify; the former map's other type field was never serialized by this CPU leaf. Seed loading remains a binary128-byte read, now fread/fclose; short-seed setup still truncates the same file to127 bytes through _chsize_s on Windows or ftruncate on POSIX, with checked result. Wire output remains the same exact id bytes plus newline through fwrite/fputs. Actual native worker/header, record/flush/two emits, Desktop send/test_note, SDK/network scheduling and Node reader/copier are not replaced. All current positive/negative controls remain, including full-width identities before readSync.

The derived baseline and slim tests both actually pass2/2, with no skips. Their same-wire schedule, file/publication, identity, drift and UNKNOWN assertions all execute. Original30-second CPU test,20-second compiler call and6-second executable invocation bounds remain. No retry, compiler permission change, skip, new lifecycle layer or native20-second change.

Independent single-pair local clang compile readings: baseline408ms, slim400ms (about2%). Author's separate pair was428→348ms (about19%). These are individual macOS measurements, not a stable speedup estimate or Windows/MSVC evidence. The supported rationale is fewer unnecessary CPU-only header/leaf dependencies with preserved controls; actual Windows effect remains for the approved next run.

Independent logs: /tmp/cmspark-826-independent-cpu-baseline.log and /tmp/cmspark-826-independent-cpu-slim.log. Launcher /tmp/cmspark-826-independent-cpu-slim-probe.mjs and summary /tmp/cmspark-826-independent-cpu-design.log.

## Primary failure versus cleanup failure

The actual snapshot CPU test callback is extracted through its TypeScript AST. A controlled spawn result supplies ETIMEDOUT, while its real local finally cleanup port executes and then throws EBUSY. Unmodified callback reports only EBUSY, reproducing the reachable error-priority defect seen in the native Windows lane. The derived minimal catch records/rethrows the original body error; finally still attempts removal, and suppresses cleanup replacement only when a primary error already exists. With no primary error, cleanup failure must continue to fail the test.

Independent replay agrees with the author's result: old reported EBUSY; repaired reported ERR_ASSERTION with actual.code ETIMEDOUT, cleanup port executed. This proves primary error preservation and attempted cleanup, not successful deletion under real Windows EBUSY. It does not identify a directory-lock owner or excuse a cleanup failure.

Evidence: /tmp/cmspark-826-independent-primary-mask-probe.mjs and same stem.log. No broader failure framework is required; keep the correction local to this CPU test.

## Next gate

Apply the exact bounded changes, retain existing business/native deadlines and every current control, then independently inspect and run the affected source increment. GLM source gate and actual Windows CI remain necessary. The current failed run never executed native MCP/snapshot/Activity9; it cannot be counted as their acceptance.
