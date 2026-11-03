# #826 collector implementation handoff

Owned files only:
- companion/scripts/mcp-stack-capture-826.cjs
- companion/scripts/tests/mcp-stack-capture-826.test.cjs

Stable exports: `collectMcpStacks826({binary,root,outputRoot,parentPid,createdAfterMs,createdBeforeMs})`, `qualifyCdb826({outputRoot})`. Both return bounded, finite safe JSON; raw process/debugger errors do not escape. Qualification supplies `status`, `parserPositive`, `actualDetached`, `dummyClosed`; only all three positive yields OBSERVED. Root integration requires OBSERVED before MCP.

Implementation uses one signed-tool/process OS query, narrow native-parent/name/creation candidates, native canonicalization of both owned clone and candidate image paths, exact normalized canonical-path comparison, unique live selection, and unique direct browser child. There is no path casefold identity substitute. Invalid or failed canonicalization refuses attachment. Only fixed x64 SDK CDB is accepted, with PE machine check and Microsoft Authenticode query. Debugger cwd/symbol root is fresh and owned, eliminating ambient ntsd.ini. Environment is explicitly reconstructed with local symbol roots and no inherited symbol/server/secret variables.

Native fixed argv is `-pv -p <internalPID> -c "~*kc 0n16;qd"`; browser fixed argv uses `-pvr`. Native failure/UNKNOWN skips browser. Raw combined streams are capped at512KiB in memory; finite projection has at most32 thread ordinals and16 frames/thread, admitted module/function tokens, and64KiB JSON cap. Header/noise/address/path/arguments are not frames; truncation becomes INCOMPLETE; empty/unresolved/overflow becomes UNKNOWN.

The Windows pre-MCP qualification feeds its actual CDB capture to the real parser, including actual-wire LF/CRLF, header-only, noise and overflow rejection controls. An owned CPU-only IPC dummy supplies ready/ping/pong and actual close. Local tests use explicitly labelled grammar/control leaves and **are not vendor output, Windows/CDB, native/UI or acceptance evidence**.

## Local machine evidence

Command, Node22.23.4 via nvm:

`node --test companion/scripts/tests/mcp-stack-capture-826.test.cjs`

Result **9 PASS**, no skips/failures. Log `/tmp/cmspark-826-mcp-stack-collector-tests.log`.

Controls execute actual DTO producer field extraction/selector, exact path-parent-time-live uniqueness, browser ambiguity, clean projection admission/rejection/bounds, fixed query/argv/env/tool budgets, supported short/long path canonicalization and refusal, collector error/ambiguity/native-failure skip, bounded child output/error/status/expiry, held actual-close fencing, qualifier real-parser wiring/IPC/actual-close through controlled leaves, and unsupported/absent-option zero-work paths.

## Lifecycle correction and honest limit

Timeout/overflow marks the tool invalid and sends one kill; collector waits for the child's actual `close` before returning, deleting workspace or proceeding. A controlled held-close child proves kill is not treated as closure. Spawn failure without an actual PID may finish immediately. Configured useful query/debugger timeouts remain3s/6s/6s (15s maximum configured work; native failure skips browser). Required actual child teardown may follow the termination deadline; **15s is not a guaranteed end-to-end wall-clock bound**. No extra fallback cleanup deadline/retry was introduced. Qualification is separate and cannot permit MCP while its debugger is still alive.

No production/native changes, actual debugger invocation, CI dispatch, staging/commit/push or live configuration changes were made by this unit. Actual Windows qualification and the one authorized experiment remain pending independent B/actual GLM source approval.

Frozen SHA256:
- collector d6072d3d8d607cb349fad9f50ae72de26aca6c39e6b4650a79ace25ee367bcb0
- tests 993e8d0dacc1afdcfedaea04fd93e6aba3482cbda8f5dd57d3fa67b0639a66bf

## B source-gate increment — actual dummy closure

B reproduced the qualifier's former three-second cleanup race. Removed that race: after kill, qualification now waits for actual dummy `close` before workspace removal or return. An `error` can resolve the closure promise only when there is no actual process PID; an actual PID still requires close. UNKNOWN remains fail-closed and cannot start MCP. No new timeout, retry or fallback was introduced; actual teardown remains separately required, without a hard wall-time guarantee.

Added focused controls for CDB failure + held dummy close, actual-process error without close, failed spawn without PID, and a real3100ms hold crossing the former3000ms race. Added only `winhttp` to symbol modules and a `winhttp!WinHttpWebSocketSend` clean-symbol grammar positive; it is explicitly controlled grammar, not vendor/Windows evidence.

Same Node22.23.4 command/log now **12 PASS** (approximately3.18s); no CDB/native/CI invocation.

Current frozen SHA256 supersedes the prior pair:
- collector f2c4508aadb57d08ba8cffab31cafac6e90d382e2f37a9b22587fca241fbaa9d
- tests a0a214091b1eeb118c47f0ed4942282a77044c003a79bbed347f6c01bd7df481
