# Windows observation quality and passive capture
GitHub: #723. Finite implementation scope approved 2026-10-20; whole issue remains PARTIAL.

Windows helper observations use capture_method=printwindow|bitblt, observation_quality=ok|occluded|partial and at most16 occluders, each with positive HWND, physical rect (existing8192 edge bound), class name at most256 characters. At most256 preceding Z-order handles are sampled; cycle, native error, target PID/TID/rect change, changed ordered samples or unknown DPI context makes BitBlt unavailable. No title authorizes any observation. Two samples do not prove an atomic compositor interval: positive intersection is occluded; sampled-empty BitBlt remains partial. Usable PrintWindow is ok only for render-source completeness and needs no new foreground/DPI precondition.

Closed parsers reject coercion, accessors, malformed shapes and unsupported source combinations. Partial/occluded OCR is used privately for credential blackout and omitted from target-page text. A fixed quality prefix precedes capped OCR and result JSON; metadata follows actual result/event, reducer/capped timeline, confirmation-only preview and sealed action records. Existing history database redaction is retained, not relaxed to persist screen text.

Internal passive mode is selected only for executor screenshot/describe and pre-consent preview; no restore/foreground calls, no new tool field, grant, timer or rate authority. All existing admission, owner/app checks, confirmation, action grammar, deadlines, dialog channels, thresholds and raw cleanup remain. Mac capture remains unchanged; absent historical metadata means unknown.

Not implemented here: authenticated cockpit HWND identity, two-frame mask, action-aware readonly admission. The existing thread-first 30-minute ComputerSessionTrust is an injection G1/mid-task store across socket reconnect, not same-connection readonly consent. Do not repurpose it as a new readonly grant. Future authority needs a finite owner decision. No source/CPU evidence is Windows acceptance or whole issue completion.


## D1 remote Windows acceptance increment — GitHub #723

Root explicitly admitted this increment after reading D1 source21/R2 machine and native-validation-gap.md. Parent tree 0e230741a2849bcf859f2f8c45a1f813707bde6f is immutable. This is test/CI/docs only, no D2 mask/identity registration or D3 admission changes.

Five Windows/GHA-only native callbacks each own a fresh retained WPF fixture and an original 45,000ms total deadline. Actual default PsScreenCapturer runs real PS5.1/Add-Type/PrintWindow and strict metadata. Passive minimized refuses, passive nonforeground forcedfallback refuses, actual foreground BitBlt empty overlap is partial, actual owned NOACTIVATE overlay overlap is occluded. Verify actual foreground/minimized state through one fixed owned fixture verification request, not by initial metadata alone. Before every capture at least full original15,000ms helper ceiling must remain; otherwise fail, never extend. Retained child handles remain through actual close and surface lease settlement; output and fixture directories bind identity. No foreign window input/lookup, no images/raw/sensitive metadata emitted.

Only allowed unshipped variant: execute original PrintWindow first, then set its observed printed=false via one exact anchor, preserving every other PS byte (LF/CRLF independently). Never fake BitBlt/DPI/foreground/occlusion results, change production switch, or call this natural PrintWindow failure. Variant source is created only in the exclusive test-owned directory.

Each generated target contains only a black/white geometric fixed pattern. Own initial window activation establishes test setup; overlay has explicit WS_EX_NOACTIVATE and never requests activation. No sleep, action retry, polling, timeout extension, skip/COE on Windows or new permissions. Conditional non-Windows skip accurately avoids Windows API. Existing Windows canonical CI automatically discovers the compiled *.test.js module once; no workflow/runner/explicit #572 list change.

Falsifiable preconditions: exact live owned child+HWND; fixture DesktopPS5.1; foreground target (or owned sibling for refusal); expected iconic state; overlay distinct owned HWND for occluded; variant inverse; actual finite quality/rect/parser; no foreground/restore side effect after passive run. Missing ready/ACK, unexpected source quality/occluder, API/compile failure, cold budget exhaustion, signal/lease loss or cleanup error is hard FAIL. Generic foreground rescue/retry is forbidden.

Local CPU tests exercise actual shared helpers/variant/lifecycle/error paths with inert boundaries, not Windows APIs, C# compilation or native acceptance. True new-head remote Windows remains NOT_RUN until CI runs. Source approval is reserved for two genuine nonauthors.

CPU/VM source checks do not establish PS5.1, C# or native results. All five remote cases and the exact new head Windows job remain NOT_RUN until delivery. No new local-browser or hosted-Chrome gate is added.
