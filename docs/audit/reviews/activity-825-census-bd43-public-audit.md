# Independent Windows census audit — bd43d8ac

VERDICT: FAIL. One new test-only MCP recorder VM consumer has a reproduced CRLF extraction defect.

Workflow41492744055 attempt1; Windows census job125439676449 completed FAILURE in Complete Windows Companion census (#650). Public artifact13166343091, windows-census-8116c9e0673eb18cab23f13cd940a46605abedc3-1, identity win32/x64. Public identity head8116c9e0673eb18cab23f13cd940a46605abedc3, tree7f5a0890f4fe3fc9250611dc7163f1d4feb59329; GitHub commit API parents include bd43d8ac3a39991065ea78ab8b59da5ee5afaebc (plus the expected base).

Public accounting: execution_complete=true, complete=false, tests_exit1; resultFAIL/CENSUS_STAGE_FAILED. Canonical main batches have9505 PASS/67 SKIP/1 FAIL; settings stage was not reached after main failure. Exported case rows include155 passing suites, giving9660 PASS/67 SKIP/1 FAIL.

The unique failed case is `825 actual MCP 773 recorder and both emit bodies feed only authenticated bounded pong observations`, exact title SHA256056df7bd4b17147381ac57ca170309cb13b1a40e2c13e007ae2642eef7572e78, desktop-acceptance-diagnostics.test.js:292:25, testNumber3086,12.1968ms. Closed failure projection is testCodeFailure/ERR_TEST_FAILURE. Public artifact contains no plaintext exception/stack for this case; no sealed payload was read or decrypted.

## Independent actual-source reproduction

Used the actual TypeScript AST to execute actualBootstrapProducer773 and the real MCP variant + bootstrap generators, varying only production host and original native-acceptance.cpp fixture EOL. All four source combinations preserve their original generated source/inverse contract:

| Host EOL | Fixture EOL | Actual recorder/emit VM consumer |
| --- | --- | --- |
| LF | LF | PASS |
| CRLF | LF | PASS |
| LF | CRLF | SyntaxError |
| CRLF | CRLF | SyntaxError |

The definite defect is in the test's wchar emit body extraction: `emitSource.indexOf('}\n',ra)` skips the actual `}\r\n` boundary and includes following C++ functions, including D476Acceptance::document, in rawEmit. The actual consumer then feeds those C++ functions to the JS VM. The same matrix reproduced identically in three independent runs. This is a test-consumer CRLF bug, not a demonstrated production MCP/native failure. The directed native MCP on this head passed, documented separately.

Probe /tmp/cmspark-825-mcp-crlf-consumer-probe.cjs; logs ...-probe.log, ...-probe-2.log, ...-probe-3.log. Public archive /tmp/cmspark-825-census-bd43-public.zip. No product/test source mutation, rerun or external comment performed. The prior MCP test-unit approval is superseded by this concrete Windows consumer counterexample; its production/source-preservation findings remain true.
