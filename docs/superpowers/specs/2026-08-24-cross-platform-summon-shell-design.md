# Cross-platform summon shell (C-thin)

> **日期**: 2026-08-24  
> **状态**: Implementing P3 Chromium app-window host  
> **方向**: 三路对抗 + Claude/Kimi dual **C-thin APPROVE_WITH_NITS**  
> **相关**: ADR-020 · #219 · systray2 summoner no-op  

```text
Surface:      L0 overlay (chat, attachments, steer/queue)
L2-classes:   none — overlay never Allow/Deny
Compose:      overlay-eligible pack.apply allowTrust=false (already)
Autonomy:     same tool-loop
Trust:        monotonic; file.upload bytes only
Channel:      summoner WS; file.upload ACL only after lease+conductor+run_active
```

## Decision

Enterprise workbench = **one loop**, three **surfaces**:
- L0 summon (quick talk + files + compose)
- L1 Chrome Side Panel (complex browser work)
- L2 Cockpit / CU (non-web; Mac/Win honest; Linux not faked)

P0 is **C-thin**, not more Swift, not Electron.

## P0 this slice (landed)

1. `file.upload` gets the same occupied/lease/conductor gates as `chat.create`. Occupied → `run_active`, **no supersede**.
2. systray2 / readline `openSummoner` must not be silent.
3. Freeze further AppKit-only features.

## P1 this slice (code now)

- Local HTML overlay at loopback + token (`summoner-web.ts`, settings-web pattern). Page **never** talks companion WS — Origin allowlist unchanged.
- Tray `surface:summoner` client dispatches allowlisted methods (chat / pack / mcp.list / file.upload / lease).
- ACL `file.upload` now that a summoner-stamped client exists. Overlay file input sends bytes; **hostname ignored**.
- systray2 / readline menu 「召唤器（实验）…」 opens the HTML shell in the system browser (honest degrade of WKWebView/WebView2). macOS Swift NSPanel stays; no further AppKit growth.

## P2 this slice (code now)

- Loopback SSE `/api/events` fans companion pushes to the HTML shell.
- Allowlist drops confirm / Trust chrome (`security.confirmation.request` never forwarded).
- `accepted` is not painted as 已发送; HTML waits for `chat.user` / `error` (run_active).
- Lease claim failure surfaces 「侧栏占用了输入」.

## P3 this slice (code now)

- Same HTML, dedicated Chromium/Edge `--app=` window when a browser binary is found (no Electron, no new Swift overlay).
- Only `http://127.0.0.1|localhost` URLs with a token may open.
- No binary → honest degrade to `open` / `xdg-open` / `cmd start` (system tab).
- Native WKWebView / WebView2 / GTK wrapping the same HTML remains a later host.

## Next slices

- Native WKWebView / WebView2 / GTK host for the same HTML (optional; app-window is the cross-platform wrap).

## Non-goals

Electron, overlay confirm/Trust-B, Linux CU parity, NSOpenPanel-only attach.
