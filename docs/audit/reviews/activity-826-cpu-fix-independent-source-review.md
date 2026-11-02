# Independent source increment review —826 CPU leaf and error priority

VERDICT: APPROVE. No reachable blocker found in this bounded increment. Ready for the actual GLM source gate; Windows timeout resolution remains unverified.

## Frozen source

Base fc4a2546a09f96c5afb6de3192e3388659a65118. Only source reviewed: companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs. Its actual SHA256 is56f480a14e259d512c8c4338711e7a728b9939e9101e071d4395d4fefbbf2b7d, matching /tmp/cmspark-826-cpu-fix-source-manifest.json. Read the complete real delta and author's implementation handoff. Excluded root's audit documents and known unrelated host-integrity pin. No edits/commit/push/CI by reviewer.

## Verified delta

The implemented change matches the independently approved design. Only CPU helper fstream/filesystem/iostream/map includes are removed; cstdio and Windows io.h support the replacement leaves. Json still serializes the exact id consumed by the controlled WinHTTP wire. Seed remains an exact binary128-byte read; the same127-byte short-seed negative uses checked _chsize_s/ftruncate. fwrite/fputs preserves id bytes and line separation. The actual native header/worker/record/flush/emits/send/test_note, actual Node reader/copier, wire assertions and UNKNOWN/BigInt controls remain unchanged.

The CPU test's local catch records and rethrows its original body error. Finally still attempts the original rmSync; cleanup error can replace the result only when no body error exists. The new test extracts the real callback through AST, injects compiler ETIMEDOUT plus cleanup EBUSY, and confirms ERR_ASSERTION retains the identical timeout object while cleanup is attempted. It separately executes the real finally with no primary error and requires the identical cleanup error to propagate. Cleanup success under real EBUSY is not claimed.

Actual source retains CPU30000ms, compiler20000ms, executable6000ms and native MCP20000ms constraints. No retry, skip, weaker assertions, added budget/permissions, lifecycle abstraction or product behavior change. Earlier source/header/reader proofs and unrelated platform results are reused without reopening review.

## Independent verification

Node22.23.4, companion directory:

`node --test scripts/tests/desktop-mcp-snapshot-825.test.mjs`

Result3 PASS/0 FAIL/0 SKIP, including the actual C++ worker/file reader controls, same-wire schedules, full-width before-read identity checks and new real-callback error-priority regression. Log /tmp/cmspark-826-cpu-fix-independent-source-tests.log.

The unchanged-in-input broader integration result178 PASS in /tmp/cmspark-826-cpu-compile-cleanup-integration.log is reused; no unrelated suite or TS build was repeated. Prior independent baseline/slim experiments and old/new masking reproduction remain in /tmp/cmspark-826-cpu-fix-independent-design-review.md.

Both local variants had passed controls; independent single-pair clang timings408→400ms and author's428→348ms do not establish an MSVC speedup, historical cause or a fixed Windows20-second compiler gate. The next approved actual Windows run must retain its real failure if that gate still rejects. No further speculative review was added.
