# Cross-platform summon shell (C-thin)

> **日期**: 2026-08-24  
> **状态**: Implementing P0 slice  
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

## P0 this slice (code now)

1. `file.upload` gets the same occupied/lease/conductor gates as `chat.create`. Occupied → `run_active`, **no supersede**.
2. Do **not** add `file.upload` to `SUMMONER_ALLOW` until a summoner-stamped client exists (next slice).
3. systray2 / readline `openSummoner` must not be silent: notify/print that Win/Linux use Chrome Side Panel for talk+attachments; native shell is the follow-up.
4. Freeze further AppKit-only features.

## Next slices (not this commit)

- Local HTML overlay + OS webview (WKWebView / WebView2 / GTK or visible degrade)
- Then ACL `file.upload` + overlay file input (bytes on WS, ignore hostname)
- Menu 「打开召唤器」 on systray2 opens the shell

## Non-goals

Electron, overlay confirm/Trust-B, Linux CU parity, NSOpenPanel-only attach.
