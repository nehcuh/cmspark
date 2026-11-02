# Apps825 / Scope825 actual d94d failures: finite diagnostic design

Independent read-only design validation. Current shared source was not edited; no CI dispatch/retry, input, screenshot, wait-budget change, or production change was performed.

## Evidence to address

`/tmp/cmspark-826-windows-native-d94d5db5.log:3860–3873`: actual Apps native case fails `OWNED_APPS_FIXTURE_NOT_READY`, elapsed11715.153ms. `receipt825` has one10-second timer shared by GUI ready, headless ready and all response waits. The asynchronous timer stack does not identify its callsite. Current evidence cannot distinguish the waiting stage.

Same log3881–3895: actual scope native case fails in1123.3156ms with `failure.json {"type":"OWNED_SCOPE825_INPUT_SETUP_FAILED"}`. Positive history reaches SOURCE_INITIALIZED/LOADED/CONTENT_RENDERED/INPUT_REFUSED. This is immediate setup refusal, not a ten-second receipt timeout. The source catch merges every explicit setup error and native/managed exception into that same type. It does not identify the guard or prove whether SendInput ran. No exact cause should be inferred.

## A. Scope: add only exact closed failure reason

Change only the original setup catch to `catch(Exception error)` and add a `reason` field to the existing failure payload. Match exact `error.Message` equality against the actual explicit throw constants in SetupOwnedClick. There are **12** constants, excluding the catch's aggregate SETUP_FAILED type:

`PRECONDITION`, `WINDOW`, `LAYOUT`, `POINT`, `INTERIOR`, `TEXTBOX`, `CLIENT`, `SCREEN`, `ABI`, `HIT`, `OWNER`, `SHORT`, each matching the complete source string `OWNED_SCOPE825_INPUT_<name>`.

The reason may be those compact suffixes; every other value maps to UNKNOWN. Do not project arbitrary message text, stack, HWND, PID, coordinates, HRESULT or native last error. No fuzzy/prefix/substring match. Keep existing aggregate type, INPUT_REFUSED observation, success fence, best-effort failure write, Shutdown(2), and return exactly as before. The mapper adds no native API and cannot make readiness succeed.

Decision value: any pre-SendInput guard class versus SHORT (SendInput returned a non-three count) becomes distinguishable. UNKNOWN means no supported classification; no P/Invoke failure identity is inferred from it. Compound PRECONDITION/WINDOW/CLIENT remain grouped reasons; this proposal does not claim to identify the individual boolean within such a predicate. Do not automatically add more state to solve hypothetical future ambiguity.

## B. Apps: timeout stage from actual callsite

Add one fixed stage parameter to the existing private receipt825 function. The existing launch call passes `gui-ready` or `headless-ready` from its already bounded mode. The existing control response call passes its already fixed command, with the closed accepted labels `snapshot`, `minimize`, `hide`, `quit`. Any unrecognized stage used by a direct/control test maps to UNKNOWN; no arbitrary string is reflected.

Only the original NOT_READY timeout error gains the closed stage suffix. The original timer remains10000ms, including its final check. Ready, failure-file priority/format, child-close behavior, abort propagation, watch/unwatch, timer clearing and event listener cleanup remain unchanged. Do not introduce another wait, poll, retry, receipt type or fallback.

Decision value: a GUI-render startup failure is no longer confused with a no-window startup or an existing control/response failure. The four control labels identify the command but intentionally do not identify before/after snapshot sequence or expose arbitrary sequence IDs. If further distinction is actually necessary after a result, evaluate that observed gap then.

## C. Apps GUI: at most six positive first-once points

Reuse the existing owned758 pattern: a fixed-name HashSet and best-effort Record serialization of `{phase,sameSta}` to fixed owned files. Record attempt once per point. Disk/write/serialization observation errors are swallowed and cannot skip or replace the original operation. MainThread is captured before observing. No new worker, timer, clock, native API, network output, input or watcher is required.

Fixed points:

- MAIN_ENTER after original Root assignment, before original branch work.
- RUN_ENTER immediately before original app.Run(Window).
- SOURCE_INITIALIZED and LOADED in passive WPF handlers.
- CONTENT_RENDERED at entry to the existing handler.
- READY_WRITTEN only after the original ready Record returns.

Do not alter Activate/Focus, window setup, Record, controls, dispatcher error handling, or native qualification in this observation-only unit. Do not add readiness from these points. Headless behavior stays unchanged apart from the shared Main entry history; its real ready receipt remains the authority.

In the original Node finally, after child close and before remove/lease settlement, project only these fixed file names and exact two-field JSON values, with boolean sameSta and matching phase. Missing/malformed/foreign/partial files remain UNKNOWN/absent. Projection failure is swallowed. Preserve primary error, child kill/close order, removal and lease settlement. Reuse the scope/758 closed-reader pattern rather than creating a general event framework.

Decision value: distinguishes never entering observed main/run, run reached without render, rendered without completion of existing setup/ready write, and ready write having returned. Missing points are not proof that the event never occurred (observation can fail). READY_WRITTEN is historical, not proof the file still exists or that the controller consumed it. Lifecycle positives cannot prove continuous foreground, physical OS cause, or elapsed duration. This is enough to choose the next relevant path without collecting broader desktop state.

## Independent executable model

`/tmp/cmspark-826-activity-failure-observation-design-probe.cjs` reads the real current scope catch/setup, Apps receipt function/launch-control callsites/full finally, Apps C# exact lifecycle sites, and original758 Observe body. It derives only proposed changes and executes source-derived bodies with controlled leaves. The proposal is explicitly a design model, not an already implemented helper or Windows result.

Command, Node22.23.4:

`source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null && node /tmp/cmspark-826-activity-failure-observation-design-probe.cjs > /tmp/cmspark-826-activity-failure-observation-design-probe.log 2>&1`

Result **34 PASS**, process0:

- Twelve actual exact source messages map to the expected closed reasons; suffix/private/case-changed/empty/null/undefined values yield UNKNOWN.
- Actual old versus derived scope catch have identical Observe/write-type/Shutdown/return effects for every reason and UNKNOWN, including throwing failure writer. Private unknown text never enters the derived payload. Full-source catch replacement has a byte-exact inverse.
- Actual Apps receipt derives only signature and timeout message. Full-source launch/control/receipt derivative has an exact inverse and retains precisely one10000ms timer.
- All six fixed timeout stages and unknown direct input exercise the real timer callback, reject with the expected closed suffix, and clear timer/watch/close listener.
- Real original ready/failure-file/child-close paths are equal before/after derivation.
- Real Apps finally with the one proposed projection preserves child-close-before-project-before-remove/settle; throwing projection still preserves primary failure and cleanup.
- Actual758 Observe source proves once-only attempts with swallowed Record failures at six points.
- Proposed exact Apps C# lifecycle insertion sites have an exact full-source inverse; all original executable statements remain.

One initial local model extraction expected a semicolon after actual `child.kill()` even though this TypeScript source omits it; the source extraction pattern was corrected and final34 PASS rerun. This was a model-consumer correction, not a product/native failure. No fake SDK payload was presented as native evidence.

## Implementation acceptance, after design approval

Implementation tests must consume the actual mapper/catch, receipt function and callsites, producer/reader, and finally. Preserve all prior source-derived input/fence controls and the original10s/90s/180s budgets, guards, original business assertions and surface lease. Test unknown/error-write/projection failures so added diagnostics cannot replace primary failure, authorize input, emit ready or suppress cleanup. Include LF/CRLF source-consumer controls where extraction depends on method boundaries. No unchanged CI rerun or separate diagnostic probe is proposed; the next purposeful approved changed source run supplies native evidence.

VERDICT: APPROVE finite observation design. Historical cause remains unknown; actual source implementation and Windows acceptance remain future gates.
