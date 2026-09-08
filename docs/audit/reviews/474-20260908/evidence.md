# #474 icon and tray status gate

Issue: https://github.com/nehcuh/cmspark/issues/474. T2 visual/state expression. No process handler, permission, authorization, default job or config changes. No installation replacement. #473 thread-management scope has a separate gate.

## Implementation and evidence

Shared JS 24-unit connection geometry exports extension PNG/SVG, app iconset and compatibility PNG/ICO. Swift NSImage drawing handler uses target backing resolution and matching geometry. No blur/noise/glow. Static brand icons do not indicate process health. Tray: green filled running, red hollow stopped, amber unknown. Empty adjacent title, removed duplicate menu header, retained tooltip/accessibility label/status details. Existing three-state input has no separate probing enum; unknown says 状态未知 rather than falsely 已停止 or indefinitely 检测中.

- Extension production build exit0; companion build exit0, suite5022 total/4999 pass/23 skip plus20 pass; zero failures. #473 extension tests1285 pass before icon-only generator changes.
- Swift native compilation exit0 (arm64 Mach-O). Binary not launched or installed.
- `test-brand-rendering.py` extracts the actual production Swift function and invokes it offscreen, compares to actual shared JS output:18 combinations, minimum silhouette IoU0.894 >=0.85. Native anti-aliasing tolerance for the tiny hollow center alpha<=32; solid node colors within2 RGB levels, dimensions and transparent corners verified.
- Exported extension PNG dimensions and every ICO embedded image size/offset validated with Node assertions (exit0).
- Actual SysTray2Adapter menu test asserts empty title, semantic tooltip, state icon, enabled start/stop and seqMap start/stop/restart after header removal. Existing native menu copy regression updated to validate retained textual detail, not obsolete duplicate header.
- `screenshots/brand-preview.png`: fixture contact sheet of actual generated assets and Swift offscreen PNGs. Implementer inspected 16/18/22/32 on light/dark and Retina. This is not a screenshot of the installed running tray. No arbitrary-wallpaper contrast claim.

## Design review disposition

Independent Grok4.6 + DeepSeekV4Pro; packet/report/model metadata archived. Both had APPROVE_WITH_NITS labels but all P1/MAJOR were explicitly handled, not waived by headline verdict.

- Small-icon geometry pinned (stroke2.3, radius2.3), native resolution exports and light/dark preview inspected. Fixed geometry coordinate contract in plan.
- Red/green color-only concern: stopped adds hollow center, running filled. Retained text channels and explicit Swift AX label.
- JS/Swift drift concern: real cross-render test and frozen colors/coordinates.
- Template/contrast: isTemplate=false; deep amber #b67c18, sRGB colors pinned; previews reviewed. A blanket guarantee on all wallpapers/added outline is not claimed; restrained silhouette preserved.
- Unknown/probing concern: no probing state invented; existing unknown rendered 状态未知 consistently. Existing process detector lifecycle unchanged; timeout redesign is outside visual scope.
- Static extension vs live tray explicitly documented. Start/stop enabled states and menu mapping tested; first item is named 启动 Companion.
- Compatibility PNG32 provides backing resolution; ICO16/32/48 retained. 22px rendering verified in cross-render tests, no assumption that tray uses a particular Linux scale.

Final implementation verdicts and latest-head CI determine release readiness; recorded separately when available.

## Trace case

1. Added a hollow stop-state center and compared native CoreGraphics to supersampled JS.
2. A zero-alpha-at-center assertion failed at16px (native antialias alpha21); silhouettes matched. Gate revised to explicit alpha<=32 tolerance and opaque-node RGB comparison; minimum IoU0.894 passed.
3. Attribution: over-strict cross-render test assumption, not runtime transparency failure.
4. Protects visible hollow-state distinction without requiring byte-identical rasterizers.

Native artifact follow-through: rebuilding changes the integrity fingerprint. Updated `SWIFT_TRAY_SHA256` to e184528cf908e639cca2ec63c596471a6fae2992f4e7e1dca400107810c14fbb, computed from the actual arm64 `build-tray.sh` output. Actual compiled `checkIntegrity(companion/dist/cmspark-tray).ok` returned true. Check/enforcement logic unchanged; not a bypass. This additive pin update is covered by the final supplement after implementation freeze. Compilation on a different toolchain/architecture requires that build's existing pin-update workflow; no cross-machine deterministic binary claim.

Built extension manifest verified: all five icon references resolve to PNGs matching their declared16/32/48/64/128 dimensions. Existing create-dmg.sh consumes the regenerated iconset through iconutil; no DMG was generated in this task.

## External transport retry

DeepSeek implementation and first final invocation each returned an API socket-close error without a valid verdict (exit1). Both are INVALID and do not count as approval. A compact retry includes all changed code while removing duplicated unchanged context; output budget8192 and same verified deepseek-v4-pro model. Source remains frozen. No report from another judge is supplied.

Transport diagnostics: compact DeepSeek CLI retry also failed socket-close; non-stream Anthropic transport returned IncompleteRead. No credential values were printed or committed. Final recovery tries the same configured DeepSeek host/model through its chat-compatible transport and supplies Grok the frozen code inline to avoid additional remote tool turns. Pending recovery means this PR remains gated; process exit alone is never approval.

## Final gate status

#474 NOT RELEASE-READY. Grok implementation timed out after900s with a truncated report/no final verdict; full final Grok attempt exited1 after network errors. Inline retry produced no report amid repeated network errors and was stopped (SIGTERM exit-15). DeepSeek CLI retries and both configured-host non-stream transports failed without valid verdict. None count as approval. Draft PR475 keeps this gate open and Issues473/474 open; #473 itself has valid dual approval. No merge or installation.

After review freeze only a redundant final blank line was removed from brand-icon.mjs for git diff --check; executable content unchanged. Updated final-source-manifest records exact committed source.
