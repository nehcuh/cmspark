# Windows census independent acceptance — 2c8eb4ec

VERDICT: PASS for actual Windows Apps PowerShell producer and full census. NOT_EXECUTED for #825 GUI native cases on this head's directed native lane.

## Exact run identity

- Workflow 41487318837, attempt 1; census job 125420971110: completed SUCCESS.
- Public artifact 13163008863: windows-census-26df239c40b7233f2372719fd4f793cb3d963ea8-1.
- Its identity is win32/x64; head 26df239c40b7233f2372719fd4f793cb3d963ea8, tree 8a3880773eb8bbd34907f93f2fdcc58fb36223a9. GitHub commit API confirms PR merge-checkout parents are 945860ee20c425eed6bf5e3492f53a49254bf810 and requested source head 2c8eb4ec6306483bc69a4467eade2a02992841b8.
- Public result PASS, complete=true; accounting execution_complete=true, tests_exit=0. Three canonical batch totals: 9,527 tests PASS, 67 SKIP, 0 FAIL/CANCEL. The exported cases list also contains suite rows: 9,684 PASS + 67 SKIP over 9,751 rows (157 additional suite rows).

## Actual producer evidence

The exact test title hash a5ca2fc17548937ecf9d1ea584addac8cac220743a7de67f69c186951b48f0d5 identifies:

`#825 Windows PowerShell Apps producer keeps 201/4096 identities, excludes foreign/protected paths and refuses 4097`

The actual public accounting row is PASS, duration 6413.0481 ms, registration .test-dist/tests/activity-apps-825.test.js:73:25, testNumber447. It is not SKIP. This test invokes the real source-derived PS identity/name/Apps producer with controlled process/native leaves, passes genuine returned JSON through the actual decoder, checks 201/4096 exact identities/order/no-window states, foreign/protected/unresolved filtering and duplicate handling, refuses 4097 with APP_LIST_LIMIT_EXCEEDED, and removes its owned directory in finally. Test PASS follows this original finally, so a thrown removal failure would fail the case. It does not exercise real GUI enumeration.

The newly added real-source LF/CRLF extraction control is also PASS, 1.0356ms, exact title hash f8f77628678a9da2e82e2e50e523f52af89a3fd0cd2332e45c9865306b17a4bd, registration same file:63:25. All five CPU cases in that file passed.

## GUI native boundary

Census accounting explicitly SKIPs:

- Apps real visible/minimized/hidden/no-window/foreground case, hash 9bc43bf3dd0ccdb97414d40860c544285fc9e5e051edf08e08f0f91729fa8cad.
- scope825 real Windows two-column title/crop/embedded-image/independent-window case, hash 44a362c260da1dd6eb32cf3cdf62811e566da33513b1bb33949a503518259827.

These cases require CMSPARK_ACTIVITY_NATIVE_758=1 and belong to the dedicated Windows native lane. On this same head that job125420971172 failed in prior #480 MCP bootstrap; the Actual passive activity capture and local OCR (#758) step is explicitly skipped. No claim of new-head GUI native execution or cleanup can be made. Prior ec9 had real Apps/scope native PASS, recorded separately; it does not replace this exact-head obligation.

Only public JSON metadata was inspected from /tmp/cmspark-825-census-2c8-public.zip. No sealed/encrypted payload was decrypted or read. No CI rerun, source mutation, external comment, or config access was performed.
