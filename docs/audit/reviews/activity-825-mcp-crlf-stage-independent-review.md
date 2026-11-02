# Independent review — MCP CRLF consumer fix and Scope receipt stage labels

VERDICT: APPROVE for both test-only units.

Reviewed current diff in desktop-acceptance-diagnostics.test.ts, activity-scope825-native.test.ts and helpers/activity-scope825-native.ts. No source mutation/commit/push/CI rerun by reviewer.

## MCP actual C++ consumer

The two D476 emit bodies now start at their unique actual signatures and end at the paired closing brace. The scan skips strings/characters, escapes, line/block comments, and nested braces; it rejects missing or ambiguous signatures and a missing close. It does not normalize producer source or modify original #480 extraction/recorder/formatter behavior. The new controls call the actual consumer using real generated host/fixture LF/CRLF combinations and verify the four exact wire rows, original invalid/duplicate-row bounds, missing/ambiguous methods and no retry on send failure.

Independently loaded actual old helper from git HEAD and new helper from their TypeScript ASTs, with the real MCP fixture and bootstrap generator. Repeated all four host×fixture EOL combinations in three rounds: old fixture CRLF produces6 SyntaxError failures, while all12 new combinations pass and emit the exact expected entry/callback wire values. Source-derived old LF combinations remain passing. This directly resolves the earlier observed Windows census consumer counterexample; native production behavior is not changed.

## Scope bounded stage metadata

The new internal required union is initial|resize|popup. The initial receipt passes initial; existing control(command) narrows to resize|popup and forwards the unchanged command. Only timeout error text appends the uppercase closed stage. Removing those exact metadata/type deltas restores both entire files byte-for-byte to HEAD. Thus original10-second timer, filesystem/watcher/child/abort calls and order, controller behavior,180-second case, identity/business assertions and finally cleanup are preserved.

Executed the actual source-derived scope825Receipt function with controlled filesystem/timer leaves for each of the three stages. All use10000ms, reject with exactly the closed-stage timeout text, close the original watch and remove the original child-close listener. No added operation, wait, foreground manipulation, retry or readiness behavior.

## Validation

- Official isolated runner, four files (desktop-acceptance-diagnostics, native-phases-480, native-receipts-476, scope825-readiness):27 PASS /0 FAIL /0 SKIP.
- Independent actual-source probe:3 rounds,6 old CRLF SyntaxError controls,12 new EOL successes,3 actual receipt-timer stage checks, exact original helper/controller restoration.
- Reused successful full tsconfig.test compile for these unchanged inputs; Windows runtime acceptance remains separate.

Probe /tmp/cmspark-825-mcp-crlf-and-stage-independent.cjs; log same stem.log. Official runner /tmp/cmspark-825-mcp-crlf-stage-independent-runner.log. No large additional suite was introduced. The labels can identify which receipt expired on the next actual run; they do not identify the missing foreground/render/focus precondition or explain the earlier unspecified timeout.
