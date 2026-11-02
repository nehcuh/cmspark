# #826 Windows path harness — independent exact reproduction

Finding: **confirmed test-harness defect**, not a receipt/finally/product defect. Minimal correction is supported; no shared source was edited, no native input/probe or CI action performed.

Bound to immutable actual failed head `8aa98dbb2b65041b92c9d847c95dd616efaa3d8d`, not a concurrently edited worktree. Script/log `/tmp/cmspark-826-path-harness-independent-repro.mjs` and `.log`.

## Trigger → supported path → impact

1. `companion/tests/activity-failure-observation-826.test.ts:35,49,61,79–81`: the harness injects host `node:path`, but `start` and file-map fixtures use POSIX literals such as `/owned/ready.json` and `/owned/failure.json`. On Windows, the actual extracted receipt checks `path.join(path.dirname(file),'failure.json')`, producing `\\owned\\failure.json`. Its map has only `/owned/failure.json`, so the failure file is not found. The unchanged literal ready key is found and the promise resolves. The original failure-before-ready assertion at source80 therefore correctly fails with Missing expected rejection. This matches actual compiled Windows case10 at line92.
2. Same test source134–140: the actual finally correctly joins fixed GUI/headless folders with host `path`, while its expected trace hardcodes `project:/owned/gui` and `/headless`. Windows returns `project:\\owned\\gui` and `\\headless`, so deep equality fails. This matches actual Windows case12. The order and original primary error are not wrong.

The tests pass with POSIX path because the literal and generated representations happen to coincide. The recent local19PASS did not establish Windows semantic consistency.

## Exact source/consumer experiment

AST-extracted the actual two failing test callbacks, actual parts/receiptHarness helpers and their actual transpilation/one-boundary helpers. Their `apps` source is the actual8aa Apps controller. It still extracts the complete actual receipt function and complete actual finally. Controlled leaves are the same inert Map/EventEmitter/timer ports already in those tests; only the host path port is chosen explicitly.

Results, **8/8 expected outcomes**:

| Source | path port | Receipt-priority consumer | Finally consumer |
| --- | --- | --- | --- |
| Actual8aa |win32 |RED/ERR_ASSERTION |RED/ERR_ASSERTION |
| Actual8aa |posix |GREEN |GREEN |
| Derived test path fix |win32 |GREEN |GREEN |
| Derived test path fix |posix |GREEN |GREEN |

The derived test-only change replaces `/owned/ready.json` and `/owned/failure.json` map/request literals with `path.join('/owned',<leaf>)`, and replaces the two `project:/owned/<mode>` expectations with `'project:'+path.join('/owned',<mode>)`. No actual receipt/finally/controller code, assertion predicate, failure priority, timer duration, expected ordering or original error identity changes. The raw data/configuration/API assertions were not disabled or converted to success.

## Minimal shared-source recommendation

Use one synthetic owned root and construct **all** its request paths, Map keys and expected folder strings via the same path port. Keeping actual host path as the default and explicitly exercising both path.posix and path.win32 would prevent recurrence without native UI. Preserve the real receipt/finally source consumers and all current positive/negative assertions. Do not change production/controller behavior or normalize away its actual Windows output.

This report confirms the causal path and supports the stated one-test-file bugfix. Formal source approval follows the actual frozen patch and its machine checks; it is not granted to an as-yet-unseen patch. The canonical8aa job remains failed. Its original nine business cases nevertheless actually passed, including all four Windows native cases, full scope crop/title/image/independent-window/layout/pending cleanup, Apps GUI six positive history points and headless MAIN_ENTER. Those facts belong to the separate8aa acceptance report, not proof that the source controls or overall job passed.
