# #825 Windows native independent acceptance — ec9edbd4

- Run: 41484765709
- Exact head: ec9edbd417a7889c5a436ac64b158b547e95d565
- Target job: 125412045946 (`smoke (windows-native)`)
- The previous workflow-contract prerequisite passed in this run.
- The actual passive activity step ran from 16:52:13Z to 16:53:04Z.
- Step totals: **7 PASS / 1 FAIL / 0 SKIP / 0 CANCELLED**.

## Actual native capabilities executed and passed

| Case | Actual evidence | Result |
|---|---|---|
| Apps825 visible/minimized/hidden/no-window identity | `ok 6`, 11.761 seconds; `ACTIVITY825_NATIVE` receipt confirms stable identity, unchanged foreground and removal after process exit | PASS, not skipped |
| Original #758 foreground/passive pixels/local OCR | `ok 7`, 9.946 seconds; owned PID, unchanged foreground, local OCR and minimized-target refusal receipt; close-phase observation present | PASS, not skipped |
| Scope825 main + independent chat | `ok 8`, 28.091 seconds; all scope native receipt booleans below true | PASS, not skipped |

The Scope825 receipt reports:

```json
{"capability":"scope825","windowsNative":true,"mainAndIndependent":true,"sidebarDecoyRefused":true,"localOcrAndCrop":true,"modelSidebarAbsent":true,"embeddedImagePreserved":true,"resizeRefused":true,"pendingCleaned":true}
```

The native case executes the actual Windows screenshot, System.Drawing crop and WinRT OCR path. The outbound model seam inspects the actual scoped image; it is not a real cloud model or a claim about all versions of the named commercial chat apps.

The final `ok` is emitted only after each case's async finally and shared native surface lease release return successfully. Thus the successful results cover the asserted temporary PNG cleanup, owned child close/join and lease settlement, rather than relying solely on a receipt printed before cleanup.

## Sole first failure

`#825 Windows PowerShell Apps producer keeps 201/4096 identities, excludes foreign/protected paths and refuses 4097` failed as `not ok 5`, after 6.6 ms.

The first assertion is `assert.ok(start >= 0 && end > start)` in the test's source-extraction setup. It occurs before the controlled PowerShell script is executed. The affected source anchors contain literal LF line breaks.

Independent source-derived check of the exact production PS text:

- LF variant: start and end anchors found.
- CRLF variant: both anchors absent.

This confirms a reachable line-ending-sensitive test harness defect. The failure is not an observed Apps discovery, Scope capture, OCR, crop or cleanup failure. Root independently reproduced the same LF/CRLF distinction and is preparing the limited harness correction while preserving production PS bytes, original producer assertions and its timeout.

## Disposition

The new Apps and Scope **actual native capability cases have passed** on this head. The complete Windows activity step is still red because the separate source-derived producer control did not start. A corrected-head run must pass that control and all required checks before merge/release.

The reviewer changed no source, reran no CI and posted no external comment. Logs remain local in `/tmp/cmspark-825-windows-ec9-job.log`; this report includes only fixed case names, public CI identifiers, finite receipts and the relevant failure.

VERDICT: NATIVE CAPABILITIES PASS; CI STEP BLOCKED BY SOURCE-EXTRACTION CONTROL
