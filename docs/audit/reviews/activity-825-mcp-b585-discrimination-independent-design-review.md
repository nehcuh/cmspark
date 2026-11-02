# Independent design review —MCP b585 discrimination snapshot

VERDICT: APPROVE for the proposed minimal test-only snapshot design. No implementation or CI run is authorized by this review alone; GLM/root gates remain.

Reviewed /tmp/cmspark-825-mcp-b585-discrimination-design.md and the actual Desktop::send, test_note, bootstrap recorder/formatter, MCP controller and existing owned directory/assets/receipt paths. The current implementation's shared WS observation cannot distinguish the proposed states; a separate finite observation is justified by an actual reproduced path rather than a hypothetical edge.

## Independent experimental confirmation

Recompiled the real-source C++ experiment with clang++. It contains actual generated record/flush/two emit bodies plus actual Desktop::send mutex/WinHTTP call body and test_note; only Json/SDK/network/clock leaves and callback delivery are controlled. Independently added a full ordered equality assertion against all eight peer-visible wire strings (not merely6 BOOT+2 phase counts). Three rounds of all three schedules passed:

- SDK and wrapper returned, callback not entered.
- SDK returned, wrapper not returned because last BOOT send remains in progress after peer acceptance.
- Wrapper returned and callback entered, but callback's first phase send has not reached peer.

All three produce identical peer strings. Independent atomic state distinguishes them. This proves the observation gap and feasibility of lock-free independent checkpoint discrimination; it does not establish which schedule occurred on Windows main or validate unimplemented file publication.

Evidence: /tmp/cmspark-825-mcp-send-discrimination-independent-exact.cpp and same stem executable/log. The script's original unmodified experiment also independently passed before the stronger wire assertion.

## Fields and decision value

| Bounded checkpoint | Decision it supports |
| --- | --- |
| Callback entry before existing phase send, hr/presence | Separates not-yet-entered from entered-but-hidden-by-first-send; preserves original failure guard context. |
| API7 return/env callback leave/API5 wrapper leave | Separates underlying SDK return from incomplete observation wrapper/callback stack unwinding. |
| Fixed diagnostic kind/site/edge and before-lock/acquired/before-WinHTTP/returned/emit-left | Locates whether this diagnostic is awaiting the mutex, inside its send call, or beyond that call; no arbitrary message inspection. |
| One existing outer-DispatchMessage return marker after arm | Establishes that this specific outer dispatch returned once, without adding UI work or mistaking nested COM pumping for outer return. |
| Stable version/schema/publication and bounded target/actual sample delta | Controls whether the one sample is usable; incomplete, late, unstable or foreign identity remains UNKNOWN. |

The existing owned clone plus regular/non-link/single-link/fixed-size receipt and identity rereads provide a concrete narrow transport without new bootstrap fields, PID privileges or generic observer framework. The worker reads only process-lifetime primitive checkpoint state and writes its own finite receipt. UI checkpointing never acquires worker/file/network locks or waits for the observer. The original20-second Node business cutoff and existing child-close/directory/lease cleanup remain authoritative; finally does not wait for diagnostics.

## Two implementation/interpretation constraints

1. Each checkpoint's own versioned update must finish before entering the original potentially blocked send/API/dispatch. Do not leave the sample's version odd across the operation being measured. Otherwise the most relevant blocked states all become inconsistent/UNKNOWN. Sampling must perform one bounded stable read, not a retry loop; actual publisher/reader controls must test this.
2. A stable one-shot sample proves only its actual sampling instant. `send left + outer dispatch returned + callback not entered` excludes only this recorded diagnostic-send wait at that instant. It does not prove current overall pump health, exclude other UI waits, describe Node deadline state or attribute a WebView runtime root cause. Missing/late/partial publication cannot support a negative conclusion.

These clarify the stated design rather than add fields or a new framework. No blocker remains if implementation preserves them and the proposed actual-source three-schedule/file-identity/UNKNOWN/cleanup controls pass.

Official context was independently checked: [WebView2 threading model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model) documents STA UI callback/message-pump dependence; [WinHTTP concurrency](https://learn.microsoft.com/en-us/windows/win32/winhttp/concurrency-in-winhttp) permits concurrent socket send/receive. These support the candidate mechanism and rejection of a speculative concurrency violation; they do not identify the historical failure.
