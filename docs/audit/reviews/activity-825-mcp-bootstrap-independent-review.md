# Independent MCP bootstrap observation review

VERDICT: APPROVE

Scope: the 10 staged test/build-fixture/documentation files on HEAD 2c8eb4ec6306483bc69a4467eade2a02992841b8. Excluded the existing unrelated local Darwin host-integrity pin. This is approval of the test-only observation unit, not a claim of Windows native acceptance or a diagnosis of the historical MCP timeout.

## Independent source and machine evidence

- Read the full changed generator, Windows builder selector, shared parser, coordinator call site, MCP test finally projection, AST/VM consumer adaptations and documentation. Production DesktopHost.cpp is byte-identical to HEAD. The builder enables the new transform only inside the test-fixtures branch for family=mcp. Local retains its existing confirmation transform; metadata/dialog/resource/workspace/archive remain unselected. Other original #480 build selectors are unchanged.
- Loaded the original generator directly from git HEAD and current generator as separate modules. For real production C++ + real #480 acceptance fixture, both LF and CRLF outputs are deep-identical across the complete source, inverse, and site array. The 30 original sites and fixed 192-row/eight-per-site limits are preserved.
- Extracted the original coordinator's actual parser from git HEAD and the new helper from the actual TypeScript AST. Executed 6,153 boundary inputs against both: exact row projections agree. Matrix includes point/ordinal/edge/bucket/HRESULT/presence limits, callback-only edges, malformed type and trailing newline controls. Repeated the complete source/parser probe three times with identical success.
- Removed only the three explicitly added MCP observation fragments (new collector declaration, observer argument and finally projection) from current #476 source. Result equals the entire original file byte-for-byte. This independently proves its original 20-second timeout, behavior assertions and cleanup body were not edited.
- The real recorder/formatter-body VM tests exercise both D476 emit overload bodies, the HMAC-owned channel, and the actual shared observer. Invalid/extra-key frames cannot become observations; original send failures remain the same error; formatter/send failures are consumed without retries; observations continue to their own bound after all eight old phases are full. The original coordinator tests keep foreign/retired/revoked channel rejection and no fabricated acceptance metadata.
- Existing actual-source finally VM tests execute LF and CRLF with successful and throwing diagnostic sinks. Primary failure and original retain/reject/terminate/join/socket-close/server-close/remove/settled ordering remain authoritative.

## Commands and results (Node 22.23.4)

1. `node --test scripts/tests/desktop-bootstrap-observation-773.test.mjs`: 6 PASS, 0 FAIL/SKIP.
2. Official isolated runner: desktop-acceptance-diagnostics + desktop-native-phases-480 + desktop-native-receipts-476: 19 PASS, 0 FAIL/SKIP.
3. Official isolated runner: desktop-native-navigation-480 + desktop-native-close-lifetime-480 + desktop-native-observation-788: 29 PASS, 0 FAIL/SKIP.
4. `/tmp/cmspark-825-mcp-independent-probe.mjs`, three runs: each 2 exact LF/CRLF old-output variants + 6,153 old/new parser comparisons + exact original MCP test restoration + unchanged production C++.

An additional selection accidentally included desktop-native-thread-metadata-476, which contains real native cases. Its five CPU cases passed; seven native setup gates refused missing prebuilt native hosts / workspace package / hosted-GHA requirement. No real native host was launched. These are explicit local setup refusals, not new-product or new-observation failures. The intended CPU consumers above were then run separately and all 29 passed. No source/test weakening was made.

Logs: `/tmp/cmspark-825-mcp-independent-scripts.log`, `...-cpu.log`, `...-consumers-cpu.log`, `...-probe.log`, `...-probe-2.log`, `...-probe-3.log`. Additional setup-refusal transcript: `/tmp/cmspark-825-mcp-independent-consumers.log`.

## Native boundary

This macOS review does not compile or execute the Windows C++ fixture. The next approved Windows run must still compile the exact new test host and satisfy the original MCP/native assertions and cleanup. Current head 2c8 native failure predates this unit and occurs in the MCP bootstrap step before #825 apps/scope; this observation unit does not establish its cause or resolve it. Census monitoring continues separately.
