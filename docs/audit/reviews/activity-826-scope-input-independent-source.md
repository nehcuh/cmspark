# #826 scope owned-input setup — independent source review

VERDICT: **APPROVE** the frozen four-file unit. No reachable blocker found. This authorizes proceeding through the actual GLM source gate to the original Windows native acceptance, not claiming Windows input delivery or completed scope business on macOS.

Base: `67c5e209d239995b930fe1dfcc54f444005e44f8`. Root authored the C# fixture; A authored the tests/reader/adapter. I independently reviewed all four paths and actual callsites and ran their consumer controls. No source edit, commit, dispatch, native UI/input or live configuration access was performed.

Frozen manifest `/tmp/cmspark-826-scope-input-source-manifest.json`: all four SHA256 values independently matched. Paths are `companion/tests/fixtures/activity-scope825-windows.cs`, `companion/tests/activity-scope825-readiness.test.ts`, `companion/tests/helpers/activity-scope825-observation.cjs`, and `companion/tests/helpers/activity-scope825-input-control.cjs`.

## Actual setup and authority

The replacement is a single setup click in each new owned main/popup ContentRendered closure. The old Activate/Focus calls are removed, not retained as fallback. requested is set before calling setup, so reentrant or later events cannot repeat input. Resize uses the existing closure and readiness check; it does not create another setup request. Stale-window events return or fail original current-window guards.

The helper validates rendered/current/receipt/pending state, managed visibility/enabled/layout, native HWND visibility and exact presentation source, finite interior coordinates, client bounds, virtual desktop bounds, ABI size, whole-window WPF hit, native root hit and own PID before its one SendInput call. WPF hit testing is rooted at the actual Window, using that window's PointFromScreen of the same floored integer screen point used by the native hit test. A same-HWND sibling covering the TextBox therefore does not pass a subtree-only hit assumption.

The click batch is exactly three zero-initialized mouse-only entries: absolute virtual desktop move, left down, left up. Negative virtual origins are subtracted before normalization. Input count3 is required. This is synthetic owned fixture setup, not product capture activation or human consent. As stated in the source, hit-test and SendInput are not one atomic HWND-targeted transaction.

setupComplete is false before the helper and becomes true only after it returns from exactly three inserted inputs. The real check delegate returns while false, before calling IsReady. On short/rejected setup, the existing event handler writes the distinct input-setup failure category, requests Shutdown(2), and returns. Queued qualified events cannot publish ready after failure. Failure-file write refusal does not open this fence.

Original IsReady remains byte-identical to67c5. Successful insertion does not satisfy it: actual foreground HWND, keyboard focus and all original receipt/window/render guards are still required. The native business test/helper and production chat-scope/service files independently compare byte-identical to67c5. Original10000 ms receipt wait, 180000 ms case, OCR/title/crop/sidebar/model/image/resize/popup assertions, passive foreground assertions and cleanup remain unchanged.

## Adapter and observation consumers

The new adapter uniquely extracts the complete actual SetupOwnedClick body and requires exact individual language/SDK adaptation anchors. It does not replace the helper with another hand-written implementation. Removed integer casts are equivalent over this body's already checked coordinate bounds; layout arithmetic uses exact integer ranges representable by the JS ports. Math.Floor and the reachable nonnegative Math.Round mapping are explicit. ABI parsing consumes actual Sequential field declarations and rejects unrecognized layouts/types.

The closed reader now has only INPUT_COMPLETE/INPUT_REFUSED for the replaced requests. Legacy ACTIVATE_/FOCUS_ files are explicitly rejected, rather than silently providing compatibility evidence for calls that no longer exist. All remaining original points retain their closed two-field producer and positive-history meaning. A present point is not a deadline-state claim; missing/pending/malformed/foreign data remains unknown. Source search found no second current legacy phase allowlist requiring migration.

## Framework and ABI evidence reused

The prior independent precheck is `/tmp/cmspark-826-scope-input-csharp-precheck.md`, including actual compiler reference list and official Framework4 API references. InputHitTest/PointFromScreen/FromVisual/IsAncestorOf are available through the existing referenced WPF assemblies. Current P/Invoke widths and POINT-by-value signatures match the Windows APIs.

For the three type0 entries, Sequential Input with the largest Mouse member is layout-equivalent to the native union. The independent clang Windows x64/x86 static-assert control compared size and Mouse offset against a real native union:40/28, both PASS (`/tmp/cmspark-826-scope-input-abi-precheck.cpp`, `.log`). New source-derived tests also check actual fields/offsets for Mouse32/24 and Input40/28 and execute both source ABI branches plus mismatch refusal. This is source/native-layout evidence; actual CLR Marshal.SizeOf and real SendInput are still exercised only by the future Windows fixture run. No macOS control is represented as native Windows input.

## Independent machine verification

Node22.23.4 selected with nvm, Companion cwd, using current coordinated compiled output and the official isolated runner:

```
node scripts/run-tests.mjs .test-dist/tests/activity-scope825-readiness.test.js
```

**12 PASS / 0 FAIL / 0 SKIP**. Log: `/tmp/cmspark-826-scope-input-independent-tests.log`.

These include the original eight behavioral cases plus four new source-derived cases:

- Complete actual helper with35 zero-input refusals, including an unrendered direct call and managed/native ownership/layout/geometry/ABI/hit/PID failures. The positive helper control reaches the actual port with the expected exact batch, so undefined-port/TypeError failures cannot count as successful refusals.
- Rounded negative-origin screen/client/Window coordinates, whole-root WPF hit and exact three records, no ready merely because input was inserted.
- Original actual128 IsReady combinations and native query counts, including throwing observation writer, remain equal to the recorded original guard.
- Exact callsite fence for inserted0/1/2, covering-root and ABI rejection; queued Activated/GotKeyboardFocus callbacks are flushed inside SendInput before return, then all actual IsReady predicates become true and callbacks/render/current-check are dispatched again. There is no ready/ack and no second input. A throwing failure-file write still shuts down and stays fenced.
- Main/popup and resize/stale-window behavior; producer/reader current names and malformed/pending/foreign refusal; once/initial-only history; native child-close-before-projection followed by removal/lease cleanup with original primary preserved.

Additionally I executed the actual current compiled success-fence test callback twice with an inert filesystem source port: current callsite GREEN; only the real `if (!setupComplete) return;` removed from its C# source input makes that same consumer RED with an assertion failure. No repository file was changed. This confirms the regression control detects the precise previously identified late-ready defect. Evidence: `/tmp/cmspark-826-scope-input-fence-independent.cjs` and `.log`.

Independent freeze/IsReady/native-helper/product preservation evidence: `/tmp/cmspark-826-scope-input-independent-preservation.log`. Author's targeted strict TypeScript result remains valid: `/tmp/cmspark-826-scope-input-types.log`. No output tree deletion or unrelated test rerun was needed.

## Remaining gate

The source satisfies the approved setup replacement and short-insertion fence. It is not evidence that Windows actually clicked/foregrounded/focused the TextBox or completed OCR and business assertions. The next exact-head Windows case must execute its actual Framework compiler, Marshal/input/readiness and all original scope business/cleanup under the original10s/180s gates. Rejecting an occluded/unqualified setup is an actual failure, not a reason to add fallback input, relax qualification or repeat CI unchanged.

VERDICT: **APPROVE**.
