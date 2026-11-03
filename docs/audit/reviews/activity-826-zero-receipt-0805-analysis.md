# Independent zero-receipt source analysis — 0805bca0

Verdict: **Terminal startup foreground refusal is supported; LOCAL and ARCHIVE physical causes remain UNKNOWN. No production defect or common OS/SDK cause is established.** A reachable passive-start precondition gap exists in the unshipped fixture setup and is the smallest useful next design decision.

## Bound evidence

- Exact source/head: `0805bca0cecfa28f9056bd2a0c9863a4a93cbc89`; working tree was clean during this analysis.
- Failed canonical Windows job `125714652955`, CI `41574465949`; terminal log `/tmp/cmspark-826-shipping-0805bca0-job-125714652955.log`.
- Same-head successful Windows-native job `125714653079` is a comparison, not a substitute for the failed job.
- No source edits, native execution, UI actions, probe, rerun, dispatch, new observation fields, permission change or timeout change were made.

## What this failure actually establishes

LOCAL timed out at the original45s with receipt0, no protocol starts, no renderer data, no ACP starts/attempts, R/W/M all null, no focus/activation result and no failure observation. ARCHIVE timed out at20s with receipt0, sets0, no archive/restore/lostACK and firstFailure null. Both had authenticated connection and a window request. Neither proves form execution, first key request, or entry into its native key handler.

TERMINAL timed out at45s with receipt0, spawns0, openAttempts0, confirmationRequests0, readiness0, observation788 `{seenMask:3,firstSkip:"OTHER_PROCESS"}`. `terminal-acceptance.cpp:52–64,167–179`, `desktop-terminal-fixture.mjs:20` and `native-observation-788.ts` bind this to:

1. Initial document hook and a noninactive activation hook were observed (T1/T2).
2. At one observed `begin_form` refusal, the target window was visible, its sampled foreground HWND differed, that HWND still equalled the second foreground sample, and its process ID differed from this fixture's process ID.
3. The actual gate returned before setting `form_requested` and before the ExecuteScript submission boundary. There is no T3/T4 or renderer T5–T10 in the receipt.

This is a historical positive foreground refusal. It does not identify the other program, prove the foreground at the final deadline, establish why activation was not owned, or establish the same cause for LOCAL/ARCHIVE.

Each failed role independently acquired its Surface788 lease, entered the callback, then executed cleanup/action-settled/release and reported RELEASED. There was no ACQUIRE_REFUSED for these roles. Workspace between the failures passed with receipt1023, actual picker/read/list/cancel/reopen and childexit0. A lease cascade or globally broken desktop cannot be inferred.

## Actual generated startup path, including the easy-to-miss wrapper

The Windows build calls the real `desktopLocalFixture` and `desktopArchiveFixture` (`build-desktop-windows.mjs:239`). Both apply `desktopInitialActivation788` (`desktop-mcp-fixture.mjs:178–218`). That wrapper captures the owned document/window/WebView/controller and starts only after all identity/readiness checks and `IsWindowVisible(window) && GetForegroundWindow()==window`. A visibility/foreground mismatch returns silently. The underlying LOCAL `document` and ARCHIVE `arm`/base `document` are below this gate.

Thus zero R/W/M, focus fields and archive firstFailure are compatible with the forms not having been installed at all. They cannot be used to localize LOCAL to its MoveFocus/key handler. The wrapper has only documentReady and noninactive WM_ACTIVATE entry points; it adds no timer or retry. Production `DesktopHost.cpp:253` shows the window and calls SetForegroundWindow, without establishing an accepted success receipt for this fixture's later join. This proves the fixture assumes an owned foreground event; it does not prove a Windows event-ordering defect.

After the form has actually been installed, LOCAL and ARCHIVE both have a thread.list path plus a connected-state fallback. LOCAL's native key failure paths would emit W7/W8/W9, activation/focus data where applicable, and FAIL (`local-acceptance.cpp:74–88`). ARCHIVE likewise has qualification, MoveFocus, foreground and GUI-thread failures (`archive-acceptance.cpp:21–43`). Those observations are absent. Their ExecuteScript callbacks also do not positively prove JS installation merely from absent HRESULT failure; no actual exception is established here.

## Source-derived controls actually run

Node22.23.4, macOS, inert OS/DOM leaves only:

- `/tmp/cmspark-826-zero-receipt-source-controls.cjs` and `.log`: **10 PASS**.
- Six controls execute the unchanged full real LOCAL/ARCHIVE JS IIFEs under install-before-list, install-after-list and desktop-document-before-list orderings. Each produces its first real key request exactly once, without FAIL/DONE fabrication. The obvious lost-list ordering hypothesis was not reproduced.
- Two controls execute the actual terminal gate prefix through the script-submission boundary, with its actual native relation classifier and finite serializer. Stable foreign foreground reproduces T1/T2 + SKIP_4 with zero script boundary calls; an owned-foreground call passes once. These are gate controls, not real Win32 scheduling evidence.
- Two controls use the real complete LOCAL/ARCHIVE generators and actual host/controllers/forms; inverse equals the full actual host. Their generated `begin` bodies, with only OS/identity leaves controlled, start zero forms under foreign foreground and exactly one after an owned-foreground callback.
- Official isolated runner: `node scripts/run-tests.mjs .test-dist/tests/desktop-native-observation-788.test.js`: **14 PASS,0FAIL,0SKIP**, `/tmp/cmspark-826-zero-receipt-source-tests.log`. Existing actual classifier/serializer/consumer/activation-hook controls pass.

The first private harness attempt failed because an extracted trailing C++ line comment consumed the following generated JS definition. Adding a newline in `/tmp` corrected that harness construction; no repository source changed, and the final10 controls all execute.

## Minimum next decision

Decide explicitly whether these native acceptance fixtures must establish initial owned input readiness, rather than passively await externally granted foreground. A later fixture-only proposal could reuse the already reviewed scope owned-window input setup contract, preserving owned HWND/PID/hit target, one attempt, all current action/confirmation gates, original20/45s budgets and cleanup. That is an input-contract design change and requires its own independent experiment/design+GLM gate before implementation. No bypass, repeated focus, automatic retry or production fix is justified by the present evidence.

If that contract is not changed, LOCAL/ARCHIVE remain UNKNOWN and the canonical timeout remains a release blocker. Adding more phase fields would not repair the passive input precondition. The separate FIRST DIALOG stream failure is outside this scoped analysis and is not assigned the same cause.
