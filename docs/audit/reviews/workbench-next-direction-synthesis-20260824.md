# Next direction synthesis — workbench reflection

**Date**: 2026-08-24  
**Lanes**: product APPROVE_WITH_NITS · platform APPROVE_WITH_NITS · trust APPROVE_WITH_NITS  
**Split**: Product **D** (freeze overlay, Side Panel is the workbench) vs Platform+Trust **C** (cross-platform L0 shell + `file.upload`).

## What all three agree

- Owner map to ADR-020 is right: one tool-loop; L0 talk+compose / L1 browser / L2 CU. Not three Agents.
- Overlay today: no file attach; “attach” = Chrome; Win/Linux summoner window is a documented no-op (`systray2-bridge.ts`).
- **Kill B** (more Swift / NSOpenPanel). Mac-only theater.
- Overlay must not become Allow/Deny, `mcp.add`, or Trust-B writer.
- Linux L2 must stay honest (ADR-018). Do not fake CU parity.

## The split

| | Product D | C (platform+trust) |
|--|-----------|---------------------|
| P0 | Side Panel on all OS; freeze Swift capture; drop #219 PR2 rail | Local HTML summon shell on Mac/Win/Linux + `file.upload` |
| Overlay attachments | **No** — ADR-020 L0 附件 is Side Panel | **Yes** — bytes on WS, same caps as panel |
| Risk Product names | C = third sitting window / Electron creep (S18) | D ignores owner “窗也要附件” and leaves Win tray unable to talk without Chrome |

## Decision (implementer, after lanes)

**DIRECTION: C-thin** (not Product D, not Electron).

Owner asked for overlay attachments **and** cross-platform. D satisfies neither. C is 2/3 lanes.

**C-thin constraints (absorb Product + Trust nits):**

- Not Electron. Local HTML + OS webview: WKWebView (existing tray process), WebView2 (Windows), WebKitGTK or **visible** “本平台暂无召唤窗，请用 Chrome 侧栏”.
- Not a browser: no tabs, no CDP, no remote URL. `file:` or companion-served `http://127.0.0.1` loopback with CSP.
- Overlay stays **L0 capture**: chat, attach, steer/nextRun, read-only MCP, overlay-eligible pack.apply (`allowTrust` forced false).
- Side Panel remains L1 home and confirm surface.
- **Freeze AppKit feature add.** Swift either hosts WKWebView or stays capture-only until HTML lands. Do not grow `SummonerOverlay.swift` further (rail is last AppKit add).
- #219: keep **PR1** (panel steer/nextRun + `run_active`). Overlay rail is Mac-only; do not block panel merge on rail polish. Drain stamp already folded.

**file.upload on summoner (Trust order is load-bearing):**

1. Lease + conductor gates (missing on upload today — must add if overlay can upload).
2. Occupied → `run_active`, never supersede.
3. Then ACL allow `file.upload`.
4. Bytes in the frame (`name,type,content`), never `host_read` / workspace path.

**T2.** T3 if overlay becomes originWs, writes Trust, or uses Host-Use for files.

## Explicit non-goals (P0)

- Electron / second Chromium
- Overlay Allow/Deny, Cockpit, CU HUD
- `mcp.add`, `pack.save_user`, `allowTrust:true`, `pack.unapply` from overlay
- Linux Computer Use parity
- More Swift-only chrome (settings, meeting workbench clone)

## P0 implementation order (if dual APPROVE*)

1. Spec: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` (short).
2. Companion static overlay HTML (composer + attach + busy steer/queue). Protocol: existing summoner WS.
3. `file.upload` overlay path: lease/conductor/`run_active` + ACL.
4. Host: Mac WKWebView **or** keep Swift composer until webview wired; **Windows WebView2 or honest tray copy + menu「打开召唤器」**; Linux honest string if GTK not in this slice.
5. Tests: ACL, occupied upload, no host_read; systray2 `openSummoner` is not a silent no-op (opens shell or shows copy).

DIRECTION: C-thin
VERDICT: APPROVE_WITH_NITS
