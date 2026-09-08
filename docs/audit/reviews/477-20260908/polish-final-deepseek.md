## Verdict: APPROVE

### Scope understanding
This is a final UI-only gate for the summoner web workspace slice (#477). I evaluated only this slice: HTML/CSS/layout, browser-status semantics, MCP read projection, existing attachment controls, existing `chat.abort`, sidebar/focus behavior. I did not require #476 desktop management/terminal/native host completion, nor native screenshot/runtime acceptance.

### Security
- **Token handling**: query-string token is rejected; cookie/header token uses `crypto.timingSafeEqual` with length check. Host and Origin gating remain intact. CSP nonce per document, `X-Frame-Options: DENY`, no-referrer. Good.
- **Dispatch allowlist**: unchanged from prior gate; `mcp.toggle` remains hard-404, `mcp.list` is projected. No ACL expansion.
- **MCP DTO projection**: `projectSummonerMcpList` retains only `name` and `connection.status`. The new test explicitly confirms `config`, `TOKEN`, `Authorization`, `tools` are absent. Error paths discard extra fields. This satisfies the requirement.
- **Browser-status**: endpoint is behind token/auth gate and follows the real `activeHasExtensionPeer` predicate (tested with `false/true/false`). Malformed/error handling in the UI treats non-boolean as an error; the test checks `d.error||d.type==="error"||typeof d.connected!=="boolean"`. This satisfies the requirement.
- **SSE**: `EventSource` fan-out allowlist still excludes confirm/trust/config; `shell.close` is not in allowlist but is sent directly via `requestSummonerWebClose`—no security issue.
- **Close/last-SSE idempotence**: generation counter, SSE-size checks, fallback timers persist. No backpressure/DoS concern: `MAX_SSE_CLIENTS=4`, body-size caps unchanged, STT chunk cap unchanged.

### Correctness
- **`/api/browser-status` route**: is inside the token-gated branch (`isDoc` false for the path, so the token check applies). Test asserts 403 without token and correct payload with token.
- **MCP projection edge cases**: non-object/error/server-array-empty return correct shapes; `flatMap` filters non-objects and missing names.
- **Fixture test additions**: the test now stubs `/api/mcp` and `/api/browser-status`, so the playable fixture is not hitting real routes; assertions target the UI logic (search filter, empty MCP note, browser CTA, attach POST). These are valid—they validate the slice, not the server.
- **Focus/Escape**: `closeNavigation` focus target is width-dependent (`>=760px` → `#newChat`, otherwise `#historyOpen`), and test verifies `#text/#sendGo/#stopGo` hit-testing. No defect found.
- **Busy/abort**: uses `chat.abort`. Test verifies stop button visibility and abort POST.

### Layout / CSS
- **Sidebar full height**: `.list` is `display:flex; width:220px; flex:none; background:var(--rail-bg)` and the `.hud` remains flex-column with `.body` as flex-row; `.body` has `min-height:0`, so no overflow. CSS media queries (`>=760px`, `<=759px`, `<=380px`) retain consistent vertical layout.
- **Padding axis**: `.log` and `.composer` use calc-based padding (`calc((100vw - 1000px)/2)` at large width, `padding-left`/`right` set), with `.composer` following `.log` axis—effective.
- **`#477` CSS block**: `.rail` now aligned as column list of labels with `gap:10px` and full width; existing collision with prior `.rail` definition resolved by cascade order. `#historyClose` display toggles at breakpoint.
- One nit: `.rail` at `<760px` uses `flex-wrap:wrap` and shrinks `.rail-btn`; this is expected for narrow viewport but should be confirmed in real Chrome. Test coverage (320/360/390/760/1000/1440 plus short 420/480) shows no page-level overflow (`scrollWidth<=innerWidth` assertion) and hit-tests of visible controls pass—acceptable for a UI-only gate.

### Test quality
Owning tests (`+71` after polish) include real HTML Playwright across widths, search, MCP empty, browser-status attach, `chat.abort`, Escape focus, and `projectSummonerMcpList` with production broadcast serializer input. This is sufficient.

### Defects
No concrete defects found in the final source for this slice.