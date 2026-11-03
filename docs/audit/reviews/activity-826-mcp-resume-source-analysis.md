# #826 resumed Windows MCP startup: independent source analysis

Baseline: `c5776f1d54a7d4b920e6c5bfde45691496b947f8`; working tree clean when inspected. This is a scoped, read-only review of the startup-to-controller-entry chain, using existing local source and actual archived Windows logs. No other reviewer's findings were read. No source/config edits, network/API calls, new probes, native launches, CI reruns or dispatches were performed.

## Result

**VERDICT: NO CONFIRMED SOURCE DEFECT; no concrete startup fix approved by this analysis.**

I found no supported wrong-apartment, missing-message-pump, prematurely destroyed Desktop/environment, or provably broken callback-registration path. The observed failure is real, but the retained snapshot identifies a missing controller callback at one sample, rather than a demonstrated cause. There are **zero new causal hypotheses strong enough to justify a source change** from this review alone. Parent synthesis may use independent evidence; that evidence must supply a causal reproduction before a minimal fix.

## Actual supported source chain

1. `companion/src/desktop/native/DesktopHost.cpp:440–460`: `wWinMain` initializes the main thread as `winrt::apartment_type::single_threaded` before bootstrap or WebView creation. The only explicit infinite process wait is in a detached parent watcher, not on the UI thread. `Desktop app(...)` lives on the main stack throughout `app.run(...)`.
2. `DesktopHost.cpp:432–438`: the owned top-level HWND stores `this` during `WM_NCCREATE`. After successful window creation, `start_network()` starts a detached network thread; the main thread continuously uses `GetMessageW(&msg,nullptr,0,0)`, `TranslateMessage`, and `DispatchMessageW`. The `nullptr` filter does not restrict the loop to this HWND. No initial nested modal loop, message filtering, synchronous completion wait, or early main-stack destruction was found.
3. `DesktopHost.cpp:236–250`: the network thread initializes MTA, performs WinHTTP traffic, and posts frames to the UI thread. It does not create or use the WebView COM environment/controller. Connection cleanup takes the same send mutex, but the observed stable sample does not show the last diagnostic send blocked in that mutex or WinHTTP.
4. `DesktopHost.cpp:321–328`: an authenticated `desktop.ready` in phase `proof` sets ready and enters `build_webview()` from the native frame dispatch. `desktop.window` is a separate admitted frame and only calls the existing `show()` path. The second ready does not match the initial proof transition. Reconnect could re-enter a new WebView build while `web` is still null, but the retained failure logs have only ordinal 1 for the environment/controller API sites; they do not support reconnect/duplicate creation as this failure's trigger.
5. `DesktopHost.cpp:407–410,426–428`: every build creates an exclusively owned random UDF directory. Environment completion first validates `hr/env`, then assigns `environment=env` to a member `ComPtr`, then calls `env->CreateCoreWebView2Controller(window, Callback<...>([this]... ).Get())`. It checks the immediate HRESULT. The controller's first statement is the test phase marker (with an even earlier snapshot entry marker in the unshipped variant). The host's member `environment` remains held while the controller is pending. No local owning pointer is detached/reset before completion.
6. `DesktopHost.cpp:410–426`: settings, resource handlers, navigation, renderer and the acceptance form are downstream of controller completion. A bad renderer/form/resource handler therefore cannot explain a sample with no controller entry. This does not certify their full behavior; they are outside the causal interval under review.
7. `DesktopHost.cpp:253`: `show()` resizes, shows and requests foreground for the same owned HWND; its pre-controller branch does not dereference a nonexistent controller. `WM_SIZE` invokes controller bounds only if `controller` is non-null. There is no source-supported UI wait in that pre-controller branch. The snapshot does not identify what the UI was doing at the sample, so a generic Windows API stall was not promoted into a defect.

### Real generated-source and consumer path

- `companion/scripts/build-desktop-windows.mjs:235–244` reads this production source, the actual `desktop-476/native-acceptance.cpp`, and `native-form.js`. It applies `desktopMcpFixture`, then only for the MCP family `desktopMcpBootstrapObservationFixture773(..., mcp-snapshot-825.h)`, checks each inverse, writes a separate generated `.cpp`, builds that exact source with `/DCMSPARK_DESKTOP_TEST_PHASES`, and publishes the private acceptance executable.
- `companion/scripts/desktop-mcp-fixture.mjs:1–26` inserts the acceptance declarations/business hooks and requires a full byte inverse. Its base MCP transform does not replace `wWinMain`, the environment/controller calls, or the outer message loop.
- `companion/scripts/desktop-bootstrap-observation-fixture.mjs:24–61,85–143` wraps each complete original API expression in `obApi773`, retaining original argument/callback expressions and immediate result type. It emits bounded synchronous diagnostic rows before/after calls and callback entries. The environment callback calls the controller API inside the original environment completion handler; this nesting exists in the original production source.
- `companion/scripts/desktop-mcp-snapshot-fixture-825.mjs:1–26` adds the one-shot worker, callback scopes, API-return/wrapper/outer-dispatch flags and send checkpoints. It has no replacement callback or asynchronous retry path. The snapshot worker is detached and does not wait on the UI.
- `companion/tests/desktop-native-mcp-476.test.ts:19–49` retains the original `timeout:20000`, computes the one snapshot deadline before `withSurface650`, creates the real authenticated channel, requests workspace on authentication, clones the current private MCP executable/assets through `prepareMcpSnapshot825`, launches the actual native binding, and races real receipts against exit/abort. Full success requires all three confirmation windows, two approvals/one denial, actual persisted config, child exit and cleanup.
- `companion/tests/helpers/mcp-snapshot-825.ts` clones the existing executable and canonical assets; it does not generate a different startup program. Its sample result has exact identity/bytes/commit/stability/clock checks, otherwise UNKNOWN.
- `companion/tests/fixtures/native-surface-650.ts:172–180` acquires ownership before invoking the callback and substitutes the lease signal; it does not add a COM/native UI loop. `companion/scripts/run-tests.mjs:144` forces Windows `--test-concurrency=1`. These facts reject a claim that this current official entry simply runs multiple native test files concurrently; they do not exclude unrelated OS/SDK scheduling.

## Existing actual logs, not expectations

| Actual execution | MCP result | Earliest relevant BOOT sequence / controller entry |
|---|---|---|
| `273c1aff`, directed Windows native | PASS, 8662.858 ms; all eight phases, three windows, done, exited | environment entry bucket 2; controller API returns bucket 3; environment API returns bucket 3; controller callback bucket 27 |
| `273c1aff`, Windows census bootstrap | FAIL, 20008.0087 ms, original `testTimeoutFailure` | environment entry bucket 12; controller API/environment API return bucket 15; no controller callback receipt; OBSERVED sample below |
| `d94d5db5`, directed Windows native | PASS, 9469.267 ms; all eight phases, done, exited | environment entry bucket 5; both API returns bucket 5; controller callback bucket 25 |
| `d94d5db5`, Windows census bootstrap | PASS, 12417.8066 ms; all eight phases, done, exited | environment entry bucket 3; API returns bucket 4; controller callback bucket 40 |
| `f3edcae6`, directed Windows native | FAIL, 20004.0878 ms | environment entry bucket 9; API returns bucket 11; same OBSERVED flags751/stage6, offset2 |

BOOT buckets are 250 ms intervals relative to the first native hook, not exact operation durations. In **both successful and failed** executions the observed initial order is `5 entry → 6 callback entry → 7 entry → 7 return → 5 return`. Consequently, the environment callback occurring before the outer environment API wrapper returns is not by itself a discriminator or proof of invalid reentrancy. The successful logs reach controller entry later and satisfy real business assertions; their snapshot UNKNOWN is expected when the process completes before the scheduled sample, not negative evidence.

Sources read: `/tmp/cmspark-826-windows-native-273c1aff.log`, `/tmp/cmspark-826-windows-census-273c1aff.log`, `/tmp/cmspark-826-windows-native-d94d5db5.log`, `/tmp/cmspark-826-windows-census-d94d5db5.log`, `/tmp/cmspark-826-windows-native-f3edcae6.log`. No new CI metadata was fetched.

### Exact meaning of the retained failure snapshot

`companion/tests/fixtures/desktop-476/mcp-snapshot-825.h:6–43` defines the flags. `751 = EnvApi(1) + EnvLeave(2) + ControllerApi(4) + WrapperLeave(8) + OuterDispatch(32) + Armed(64) + EnvEntry(128) + SendReturned(512)`.

For the 273 census sample (`sampleOffsetMs:1`, stable `version:108`, `envHr:0`, `controllerHr:0`, `sendKind:2`, `sendSite:5`, `sendEdge:1`, `sendStage:6`, `sendResult:0`):

- Both original environment/controller creation APIs returned successful immediate HRESULTs.
- The environment handler had entered and left, the outer environment API wrapper had returned, and at least one real outer run-loop dispatch had returned after controller creation was armed.
- The most recent observed send was the environment-API-return BOOT row; that send returned successfully and its observation scope ended.
- The controller callback entry bit was still absent at this one valid sample, near original deadline−1500 ms. Its stored `callbackHr:0` and `callbackPresent:0` are untouched defaults, **not** a failed callback reporting null.
- This sample does not prove a continuously idle/pumping UI thereafter, delivery status at the 20 s deadline, an SDK internal deadlock, controller callback cancellation, or the unique cause of timeout.

## Candidate explanations checked and disposition

| Candidate | Supported path check / cheapest source-derived falsification | Disposition |
|---|---|---|
| UI initialized MTA or no Windows message pump | Read actual `wWinMain` and complete outer loop; observed EnvEntry/EnvLeave/OuterDispatch in the actual failing binary | Rejected as a description of this source/run. No patch. |
| Environment/Desktop goes out of scope before controller completion | Trace `Desktop app` through `run`, member `ComPtr environment=env`, and all startup return/exit/reset paths; failing process is still live | No supported lifetime defect. Manually storing another handler/environment pointer is not an established fix. |
| API-return diagnostics keep the environment callback/wrapper blocked | Actual stable sample has EnvLeave/WrapperLeave plus site5 stage6/SendReturned; existing successful schedule has the same nested entry order | Rejected at the sample. Generic removal/async delivery of diagnostics would change behavior without a demonstrated cause; no such patch recommended. |
| Reconnect/second build overwrites pending environment | Existing ordinal rows would show another site5/site7 attempt; neither reviewed failure has one | Not supported for these failures. |
| Renderer/MCP form/config failure prevents first controller callback | Actual call ordering puts these behind controller entry | Causally downstream; no reason to modify these paths for this timeout. |
| First-use/profile timing alone, or “20 seconds is too short” | Source already creates a fresh owned UDF for every launch; same source has both real <20 s completion and timeout. The retired 60 s measurement completed within 20 s and does not distinguish late completion | Not established. No budget change or unchanged CI rerun justified. |

## Decision and remaining evidence gap

The narrowed observation is **successful initiation without an observed controller callback by one late sample**. The reviewed application-level ownership, apartment and outer-loop structure do not furnish a corresponding defect trigger. No line-level candidate from this independent pass has a supported causal reproduction to falsify or repair. A synthetic COM leaf that arbitrarily withholds its callback could reproduce the timeout signature, but would only encode the observed absence; it would not demonstrate the application's cause and is not recommended as a new test framework or diagnostic expansion.

Use the independent reviews already commissioned for synthesis. If synthesis yields a concrete source candidate, the cheapest useful next verification must bind that candidate to the exact existing startup body and demonstrate the predicted before/after behavior without changing the original 20 s business contract, permissions or cleanup. If it does not, retain “cause unproven” rather than patching callback ownership or adding a second message loop on speculation. This report is analysis completion, not Windows acceptance or release clearance.

Relevant project constraints read: `docs/windows-development.md` (convergence/three-round structural rethink, actual platform/consumer evidence, no timeout/skip/retry/permission bypass), and user pragmatism agreements. Existing reviewed inputs/results were reused; no broad audit was reopened.
