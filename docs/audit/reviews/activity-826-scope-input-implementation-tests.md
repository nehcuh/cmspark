# Scope825 owned-input implementation: machine checks and consumer handoff

Base/head: `67c5e209d239995b930fe1dfcc54f444005e44f8`. This agent changed only the assigned test/reader paths below. Root owns the C# implementation. No staging, commits, live configuration, CI dispatch, or native Windows execution was performed here.

## Result

Official isolated runner: **12 PASS, 0 FAIL, 0 SKIP**. Targeted strict TypeScript check: **PASS**. Diff whitespace check: **PASS**. Source manifest: `/tmp/cmspark-826-scope-input-source-manifest.json` (four files, including root's current C# fixture). These machine facts are ready for B's independent source review and GLM source gate; they are not a self-review approval or a Windows native result.

Changed assigned paths:

- `companion/tests/activity-scope825-readiness.test.ts`: preserve the old eight cases' behavioral meaning and add four source-derived setup/ABI/geometry/success-fence cases.
- `companion/tests/helpers/activity-scope825-observation.cjs`: replace ACTIVATE_TRUE/FALSE and FOCUS_TRUE/FALSE with only INPUT_COMPLETE/INPUT_REFUSED. No historical compatibility branch. Real producer feeds the reader, with old phases now explicitly rejected.
- New `companion/tests/helpers/activity-scope825-input-control.cjs`: uniquely extract the complete actual SetupOwnedClick C# body and apply checked, finite language/SDK-port adapters. Parse actual sequential field declarations for both native pointer widths. No test registration or alternate invented setup implementation.

Root's C# input setup/fence source was read and tested, not edited by this agent.

## Coverage and important correction

The earlier independent 22-case design prototype did not establish that a short SendInput result could not be followed by a queued successful receipt. Root correctly identified that gap: requested/rendered alone would not fence later qualified callbacks. Do not reuse its 22 PASS as evidence of this property.

The current test executes the actual `setupComplete` callsite fence from the implemented C# source. For inserted counts0/1/2, it schedules Activated/GotKeyboardFocus inside the SendInput port and flushes before return; after refusal it also makes every original IsReady predicate true, verifies actual IsReady returns true, and dispatches/flushes both events, CheckCurrentReceipt, and another render. No ready/ack is written and no second input is sent. The same late-event control covers pre-send covering-window/ABI failures. A throwing failure-file write still causes Shutdown(2) and cannot enable ready. This is the specific newly required regression, now covered against real source.

Other preserved/new checks:

- Original historical false-ready body/hash counterexample retained.
- Original receipt/event ordering, stale-window protection, popup ack, real resize UpdateLayout and zero extra input retained. Setup is one batch per new main/independent window; old-window callbacks cannot click or publish a new receipt.
- Original128 IsReady qualification combinations and native-query counts match recorded baseline, including throwing diagnostic writer. No guard was weakened.
- Complete actual setup body:35 zero-input rejections including unrendered, stale current/receipt/pending, visibility/enabled/minimized/layout, absent/wrong presentation HWND, invalid numeric geometry, rounded point outside textbox, failed/out-of-client mapping, invalid/out-of-virtual desktop, ABI mismatch, absent/covering native root, foreign PID/failed query. Whole-window WPF hit rejects a sibling over the textbox under the same HWND.
- Positive rounded-point/negative-virtual-origin control verifies actual PointToScreen→floor→PointFromScreen/window.InputHitTest chain and exactly three initialized mouse-only records. Flags are MOVE|ABSOLUTE|VIRTUALDESK, LEFTDOWN, LEFTUP; correct normalized coordinates, all unused fields zero. Successful insertion alone remains insufficient for ready.
- Actual source-declared INPUT/MOUSEINPUT layouts: x64 offsets/sizes40/32, x86 28/24. Both runtime ABI success paths and mismatch pre-send refusal execute. P/Invoke signatures and NativePoint/NativeRect field contracts are pinned. This is layout/source evidence; actual Windows Marshal.SizeOf and SendInput remain in the native fixture.
- Derived LF/CRLF fixture forms give the same complete helper body/layout. An initial derived-CRLF control exposed a trailing carriage return in the test extractor; the consumer now excludes the entire closing-line EOL with `\r?\n`. No production/generated/native evidence is normalized.
- Original once-only/initial-only observer behavior, actual producer-to-closed-reader payload, malformed/foreign/pending data rejection, false sameSta retention, and finally child-close→projection→cleanup→lease ordering remain covered.

## Exact commands and evidence

All Node commands ran after `source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null`, in the `companion` directory.

Only this test was transpiled into the existing isolated output; no shared output directory was removed:

```sh
node - <<'NODE'
const fs=require('fs'),ts=require('typescript');const file='tests/activity-scope825-readiness.test.ts';const value=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:file});fs.writeFileSync('.test-dist/tests/activity-scope825-readiness.test.js',value.outputText)
NODE
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js > /tmp/cmspark-826-scope-input-tests.log 2>&1
node node_modules/typescript/bin/tsc --noEmit --strict --esModuleInterop --module commonjs --target ES2022 --types node --skipLibCheck tests/activity-scope825-readiness.test.ts > /tmp/cmspark-826-scope-input-types.log 2>&1
```

The final official runner was invoked separately after the consumer EOL fix, exited0 and reported12/12. Strict TypeScript exited0; its log is empty on success. `git diff --check -- companion/tests/activity-scope825-readiness.test.ts companion/tests/helpers/activity-scope825-observation.cjs` exited0 from repository root.

Consumer discovery used `rg` over companion/tests, companion/scripts, scripts, and .github for the fixture/reader/setup/old-phase identifiers. The real native finally consumes the source reader directly; no second legacy phase allowlist was found requiring migration. Native helper/compiler, product recorder, service, protocol, original10s/180s budgets and native business assertions were not edited by this agent.

## Remaining acceptance

This machine is macOS. SDK/Win32 leaves in CPU controls are explicit ports; they do not establish that Windows selected the actual fixture, that input was delivered, or that native OCR/crop/business passed. After B and GLM source gates, the real unchanged native case must pass with its existing foreground/keyboard-focus guard and complete business assertions. Input setup is test-only synthetic selection, not human consent, and hit-check→SendInput is not an atomic HWND-bound transaction.

STATUS: MACHINE PASS; READY FOR INDEPENDENT SOURCE REVIEW.
