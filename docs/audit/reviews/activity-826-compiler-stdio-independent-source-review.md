# Independent source increment review —826 compiler file-fd/stable-cwd

VERDICT: APPROVE. No reachable blocker found. Ready for actual GLM source review together with the separately approved scope unit; Windows compiler/cleanup success is not yet claimed.

## Frozen source

Only source reviewed: companion/scripts/tests/desktop-mcp-snapshot-825.test.mjs, base64dbdaafda240f06cac21955e2a4a8ee163c8740. Actual SHA2562984a8c1cd5487e26de9d30e519d991d61ed1e6da04854e62e7be7470c4911d6 matches the frozen handoff. Read the complete real delta and /tmp/cmspark-826-compiler-stdio-implementation.md. Scope's four paths were approved separately; unrelated host pin/documents excluded. No source/config mutation, commit, push or CI by reviewer.

## Actual source paths verified

Compiler stdout/stderr are two fixed owned wx+0600 files. Numeric fds are passed as ignore/out/err with stable companion-root cwd. Windows Fo/Fd explicitly target the case-owned obj/PDB paths; source/exe and clang output remain owned absolute paths. No inherited outer-runner stream or compiler output pipe is added.

Original built.error and built.status assertions are preserved. Only failure reads each existing fd once, at position0, bounded64KiB; read errors cannot replace the actual compiler error. Local finally attempts every already-open fd on first/second-open, spawn, assertion and close failures. A primary error remains primary; close-only and outer cleanup-only errors still fail. Direct compiler status0 is not treated as descendant completion or substituted with binary existence.

The actual known-child control is event-driven inside the original30-second case. IPC ready confirms its handlers and initial writes; parent deletes the entire owned output directory before sending its late-write command, verifies removal and no reported child exit, then requires its written receipt and natural child close with status0/no signal. Retained fds must read exact READY/LATE stdout and stderr bytes. Failure handling terminates only the held owned ChildProcess, joins that actual object's close and attempts both fd closes. No process-tree scan, compiler-descendant wait, poll or new timer/budget is introduced. The actual same control has no Windows skip and therefore becomes a platform gate on the next run.

Original compiler20000ms, CPU30000ms, executable6000ms and native MCP20000ms limits remain. Actual worker/header/reader, record/flush/emit/send bodies, wire/UNKNOWN/full-width identity controls and other business/permission paths are unchanged.

## Independent actual verification

Node22.23.4, companion directory:

`node --test scripts/tests/desktop-mcp-snapshot-825.test.mjs`

Result3 PASS/0 FAIL/0 SKIP. Log /tmp/cmspark-826-compiler-stdio-independent-source-tests.log. The real main case includes C++ compilation and worker/file controls plus IPC-ready/remove/late-write/natural-close checks. Its actual callback AST regression executes both current and Windows compiler branches over eight faults: first/second open, spawn, timeout, nonzero exit, diagnostic read, close with primary and close-only. It explicitly verifies compiler call reachability, cwd/fd/options/owned Fo/Fd, all closes, read bounds, error identity and cleanup attempts; an unrelated early TypeError cannot satisfy it. Cleanup-only still propagates its identical error.

Reuse the unchanged-in-input broader178 PASS integration log /tmp/cmspark-826-compiler-stdio-integration.log and prior worker/reader/source proofs. No unrelated platform suite, TS compilation or benchmark was repeated.

The independent design experiments remain applicable: inherited-pipe timeout can coexist with direct exit0; inherit shifts waiting to the outer node--test runner; file fds remove that EOF dependency. They do not prove historical cl/link/vctip causation or all-descendant reclamation. Current local live-file removal is not NTFS evidence; actual next Windows run must execute the control and retain failure if unsupported, without relaxing original guards or deadlines.
