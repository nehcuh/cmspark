# Adversary review (Platform / Cross-OS) — workbench next direction

**Date**: 2026-08-24  
**Role**: independent PLATFORM/CROSS-OS lane (did **not** implement; did **not** design #219)  
**Prompt**: `docs/audit/reviews/_prompts/workbench-next-direction-adversary-20260824.md`  
**Stance**: hostile to Swift-only features that silently no-op on Windows / Linux (and on non-Swift macOS).  
**This is not a code review.** No diff. Pick / kill a direction.

```text
Surface:      L0 overlay capture (proposed P0) · L1 stays Chrome extension · L2 unchanged
L2-classes:   none — overlay still never Allow/Deny
Compose:      file.upload on summoner (bytes, not paths); pack.apply stays allowTrust=false if already landed
Autonomy:     single
Trust:        monotonic; overlay cannot write Trust B; no new confirm dialect
Channel:      community
Blast:        T2 (ACL + window host + native picker). Path-based upload or Electron runtime → T3, refuse.
```

Evidence tags: `[inspected]` unless marked `[assumed]`.

---

## 0. Verdict in one paragraph

The owner reflection is **true**. Companion + extension + daemon/NSIS already treat Windows as a first-class install target and Linux as a real daemon. The summoner **window** does not. Overlay open, hotkey, rail, Shift+Enter, confirm HUD, and pairing window are Swift stdin. `systray2` / `readline` implement `sendSummoner` / `openSummoner` / `hydrateSummoner` as **documented no-ops**. `file.upload` is not on the summoner ACL; overlay “attach” launches Chrome. Finishing #219’s Swift rail, or adding `NSOpenPanel` on Mac, makes the lie louder. The only P0 that matches “enterprise workbench” + “do not over-focus macOS” + “attachments without Chrome” is **C**, and only as a **thin OS-webview shell**, not a browser.

---

## 1. What is actually shipped per OS `[inspected]`

| Capability | darwin arm64 + Swift tray | darwin x86 / no Swift bin | Windows (NSIS official) | Linux (systemd --user) |
|---|---|---|---|---|
| Companion WS + Side Panel | yes | yes | yes | yes |
| Tray menu (start/stop/threads) | Swift NSStatusBar | systray2 | systray2 | systray2 **or** readline (Wayland hint) |
| Overlay window | `SummonerOverlay.swift` (~1441 lines AppKit) | **no-op** | **no-op** | **no-op** |
| Global hotkey | Carbon `RegisterEventHotKey` in `Tray.swift` | none | none | none (Wayland: no Carbon analogue) |
| Overlay attach | `summoner.attach_chrome` → open Chrome | n/a | n/a | n/a |
| File attach in overlay | **absent** | n/a | n/a | n/a |
| `file.upload` | Side Panel only (ACL deny on summoner) | Side Panel | Side Panel | Side Panel |
| Native L2 confirm | Swift dialog | never-resolving Promise → Side Panel | **same; code already admits the Win/Linux lie was fixed** | same |
| Host Use (ADR-018) | darwin adapter | darwin | win adapter | **`NotImplementedOnPlatform`** |
| Computer Use (ADR-017) | darwin-adapters | darwin | win-adapters | **not first-class**; no `computer/linux*` |
| Official package | DMG + Swift tray | — | **`CMspark-Setup-v*.exe` (NSIS)** | zip + `make install-linux` |

Sources:

- Backend pick: `companion/src/tray/tray-adapter.ts` — Swift **only** if `darwin && arm64 && isSwiftTrayAvailable()`; else `systray2`.
- No-ops: `systray2-bridge.ts:176-179`, `readline-tray.ts:94-97` — comments say “Summoner overlay is Swift-only (Task 9). No-op here so Node can still stream.”
- Overlay open: Node `menu-bar-agent.ts` always constructs `summonerClient` (`surface: "summoner"`) then `trayInstance?.sendSummoner?.(cmd)`. Optional chaining **discards** the stream when the backend has no window. Hotkey arm: `armSummonerHotkeyOnTrayStart()` → same no-op.
- Swift window: `Tray.swift` `case "summoner.open"` → `summonerController.open`; hotkey `handleSummonerHotKeyPressed()` → `openFromHotKey()`. There is **no** systray2 menu item “打开召唤器”.
- ACL: `companion/src/ws/summoner-acl.ts` — `file.upload` not in `SUMMONER_ALLOW`.
- Attach: `SummonerOverlay.swift` `attachClicked` emits `summoner.attach_chrome`; `summoner/client.ts` `attachChromeOnly` “Honest attach: never openSidePanel.”
- Win confirm honesty already exists: `l2-admission.ts:1136-1138` — “marking them trayEligible lied on Windows/Linux”. Overlay has not learned this lesson.
- ADR-018 header: “macOS / Windows 主路径；Linux 部分 pending”. `host-use/linux/index.ts` throws `NotImplementedOnPlatform`. User guide: “Linux：Phase 1 读路径多为 pending.”
- ADR-017 / computer-use-user-guide §6: Linux coordinate **非**一等；code map is `darwin-adapters` / `win-adapters` only.
- Windows product: `scripts/installer.nsi` official Setup.exe; finish page is **Chrome extension load-unpacked**. No overlay, no WebView2, no hotkey.
- Linux product: `make install-linux` → `scripts/install-daemon.sh` systemd user unit. Tray is a **second** process (`npm run menu-bar`). Overlay is not in the unit.

**Intel Mac is in the same bucket as Windows.** “macOS overlay” in marketing is **Apple Silicon + hashed Swift binary**. That is not “the Mac product.”

---

## 2. Kill A — Finish #219 overlay then stop

#219 is `feat/steer-nextrun-overlay-hub`: panel steer/nextRun (cross-OS Side Panel) **plus** Swift overlay rail / Shift+Enter. The overlay half is invisible on every non-Swift backend. The #219 design spec already lists as **non-goals**: “WKWebView 跨平台壳；Windows/Linux overlay 工作台”. That was correct for a Mac spike. It is **incorrect** as the next *product* slice after the owner said do not over-focus macOS.

A as P0 = ship more AppKit, then freeze a 1-OS summoner while NSIS users get “load the Chrome extension.” That contradicts the workbench framing (quick summon as L0). Panel steer/nextRun may land on its own; it is not the workbench direction.

**Kill A as the workbench P0.** Do not block the Side Panel half; do not let overlay rail count as “cross-platform.”

---

## 3. Kill B — More Swift (NSOpenPanel, richer rail)

B is the failure mode this lane exists to veto.

- Attachments via `NSOpenPanel` would work on darwin-arm64 Swift tray only.
- Win/Linux still no window, so still no files.
- Doubles AppKit surface area (`SummonerOverlay.swift` is already a second UI toolkit vs the HTML lock at `docs/design/os-summoner-p0-chosen.html`).
- Repeats the HUD/confirm pattern: Swift implements, UnifiedTray optional-chains, other OS silently drop.

Owner constraint “do not over-focus macOS” is not a preference. Windows is an **official** release artifact (`CMspark-Setup-v*.exe`, CI fails without `makensis`). A Mac-only file picker on the overlay is a product defect, not an MVP.

**Kill B.**

---

## 4. Endorse C — thinnest viable shell (not a browser)

### 4.1 What already exists (do not rebuild)

The **tool-loop is already cross-OS**. Overlay is a window problem, not a runtime problem.

- `menu-bar-agent.ts` already opens a second WS with `surface: "summoner"` on every platform.
- `companion/src/summoner/protocol.ts` is stdin JSON, OS-agnostic.
- Hydrate cap, `BROWSER_UNAVAILABLE`, L1 actuator split (`l1-actuator.ts` never `tool.execute` to tray/summoner) are Node.
- `file.upload` wire shape already exists: `{ thread_id, files: [{ name, type, content }] }` base64; size/MIME/WS_SOFT_MAX gated in `validate.ts` + `lifecycle.ts`. **No filesystem path on the wire today.** Keep it that way.
- Visual lock already exists as HTML: `docs/design/os-summoner-p0-chosen.html`. Swift AppKit is a Mac *port* of that lock, not the source of truth.

Electron was **already rejected** for the menu-bar (2026-07 archive: TCB ~Chromium+Node, `electron-updater` trust, Linux AT-SPI `electron-dbus-deadlock` in host-use RUNBOOK). OS-agent-shell P0 spike also listed Electron as a non-goal. Do not reverse that to “get Windows overlay.”

### 4.2 The shell (this is the whole P0 window)

**One local HTML overlay + three OS-provided webview hosts speaking the existing summoner stdin JSON.**

| Piece | P0 | Not P0 |
|---|---|---|
| UI | One HTML/CSS/JS bundle (chosen.html → real overlay). `file://` or custom scheme `cmspark-overlay://`. **No network navigation. No Chrome. No Chromium embed.** | Side Panel clone, bubbles, Cockpit, mission board, settings |
| macOS host | WKWebView **inside the existing hashed Swift tray binary** (same stdin pipe). AppKit overlay **frozen** (adapter or dead). New widgets go to HTML only. | More AppKit rails, `NSOpenPanel` as the attach story |
| Windows host | **WebView2** HWND (Evergreen runtime already on Win10/11). Spawned by `menu-bar-agent` / tiny native helper. Same JSON protocol. | Electron, CEF, “open overlay in Edge/Chrome tab”, WinForms chat app |
| Linux host | **WebKitGTK** window if present. If missing: **visible** tray copy “召唤器需要 WebKitGTK”，never drop the stream on the floor. | Pretend global hotkey on Wayland; silent no-op; Electron |
| Open paths | (1) global hotkey where the OS actually has one (2) **systray2 / readline menu item 「打开召唤器」** on every backend | Overlay that can only be opened by Carbon hotkey |
| Hotkey | Mac: keep Carbon allowlist. Win: `RegisterHotKey` in the WebView2 host. Linux: X11 best-effort; **Wayland = menu only**, documented. Stolen chords stay banned. | Fake “same hotkey everywhere” |
| File attach | OS file picker (HTML `input type=file` **or** host `IFileOpenDialog` / GtkFileChooser / WKOpenPanel) → host reads **bytes** → summoner WS `file.upload`. Chrome may be quit. Omit `hostname`/`url`. | Path string on the wire; LLM-chosen path; `host_read` from overlay; drag-from-Finder that becomes a path tool |
| Chat | Existing `chat.create` / hydrate ≤20 lines / `BROWSER_UNAVAILABLE` when L1 needed | Overlay Allow/Deny; overlay `mcp.add`; overlay Trust write |
| Tray | systray2 `openSummoner` **must stop being a no-op** (opens the HTML host or shows the unavailable string) | Keep no-op “so Node can still stream” |

That is a **shell**, not a browser: no tabs, no CDP, no address bar, no remote URLs, no extension APIs. The host is a rectangle + file dialog + hotkey + stdin. Companion remains the only tool-loop (ADR-020).

### 4.3 File attach without Chrome (required, in this slice)

1. Add `file.upload` to `SUMMONER_ALLOW`. Still deny `security.confirmation.response`, `config.set`, `mcp.add`, `pack.install`.
2. Overlay host performs the user-gesture picker. Companion never sees a path.
3. Reuse existing parse/vision/size gates. Occupied `file.upload` supersede behavior is **out of this slice** (leave as today’s Side Panel rules unless #219 panel half already changed it).
4. Map `file.upload_status` / `file.uploaded` / `file.upload_error` through `mapChatMessageToSummonerCmd` (today mapper is chat/steer-centric). `sendToExtension` in `lifecycle.ts` already echoes to the **originating** socket, so summoner WS can receive status without Chrome **if** the mapper paints it.
5. Caps: same as panel (count / bytes / WS_SOFT_MAX). Do not raise them “because overlay.”
6. Failure copy when Chrome is quit: attach **files** still works; L1 tools still `BROWSER_UNAVAILABLE`. Do not invent a fake “we opened the Side Panel.”

### 4.4 Linux / Windows CU honesty (do not contaminate C)

C is **L0 + file bytes**. It does **not** deliver L2 on Linux.

- Windows CU is a main path (UIA). Overlay still **must not** become Allow/Deny. Win L2 confirm already correctly falls through to Side Panel (`l2-admission.ts` trayEligible = Swift only). Keep that. “Talk + attach without Chrome” ≠ “approve host_computer without Chrome.”
- Linux host-use stays `NotImplementedOnPlatform`. Overlay docs must not say “enterprise workbench L2 on Linux.” ADR-018 Decision 6 + ADR-020 rule 3 already forbid fake parity.
- Do not put Cockpit/HUD in the HTML overlay in P0. HUD is another Swift-only window (`openHud?` optional). Porting HUD is a different slice.

### 4.5 Blast

**T2** if: webview loads only the bundled overlay; `file.upload` remains name/type/content; ACL allowlist; no new confirm writer.

**T3 / refuse** if: overlay navigates to arbitrary http(s); overlay eval’s remote JS; path-based upload; Electron third runtime; overlay can answer L2 confirms; `allowTrust` true on summoner.

WKWebView/WebView2/WebKitGTK are OS components, not a new Agent runtime. That is the ADR-020 “not three runtimes” test. Electron fails it.

---

## 5. Why not D

Possible D’s that look responsible and are wrong as P0:

| D-name | Why not P0 |
|---|---|
| Honest capability matrix + freeze overlay | Truthful docs without a window. Owner asked for attachments and summon. Matrix is a **nit inside C**, not the slice. |
| Land panel #219 only | Good hygiene; does not create Win/Linux summon; does not attach files without Chrome. |
| systray2 “attach file to last thread” with no window | File-only, no talk. Not a summoner. Still useful as a **degrade** on WebKitGTK-missing Linux, not the product. |
| Full companion HTML workbench (panel clone) | Second Side Panel. Violates “do not design a full browser” and ADR-020 pack-first / one tool-loop UX. |

No D beats C-thin.

---

## 6. Explicit non-goals (P0)

- Electron / CEF / `electron-updater` / Raycast plugin.
- Porting Side Panel, Cockpit, Mermaid, Mission Board, Apps, settings.
- Overlay Allow/Deny / nonce / Win Hello / Touch ID.
- Overlay `mcp.add`, `config.set`, Trust B, `pack.install`.
- NSOpenPanel-only Mac attachments.
- Linux AT-SPI / host_read / `host_computer` parity.
- Global hotkey on Wayland as a ship gate.
- Rewriting Swift tray menus, pairing window, HUD.
- Changing NSIS finish page to claim overlay if WebView2 is missing (honest degrade).
- Dual-maintaining AppKit widgets **and** HTML features.

#219 **panel** steer/nextRun is orthogonal: not a non-goal of the *repo*, a non-goal of **this** overlay slice.

---

## 7. Nits (must be in the C spec or C becomes another silent no-op)

**N1 — systray2 menu item is the real P0, not the hotkey.**  
If C ships WebView2 but leaves `openSummoner` as a no-op, Windows NSIS users still cannot discover the overlay. Menu item first; hotkey second.

**N2 — Intel Mac.**  
`detectTrayBackend()` will not host WKWebView unless Swift tray exists. Either (a) Swift tray + WKWebView on all darwin, or (b) the same WebView2-style helper is wrong on Mac — use WKWebView from a tiny helper when Swift bin is absent. Silent no-op on darwin-x86 is still a no-op.

**N3 — WebView2 / WebKitGTK missing.**  
Visible error string in tray. Do not crash the daemon. Do not pretend the overlay opened.

**N4 — Wayland.**  
`readline-tray.ts` already prints a Wayland hint for the tray itself. Overlay P0 copy must say: no global hotkey; use the menu. Anything else is Mac muscle memory.

**N5 — `file.upload` mapper.**  
ACL without mapper = overlay attaches into a black hole. Status/errors must round-trip on the summoner socket.

**N6 — Do not raise WS frame budget** for overlay files. Existing SW/companion refuse path is the safety rail.

**N7 — Packaging.**  
Windows official SoT is NSIS staging (`node.exe` + `cmspark-agent.js` + extension). A WebView2 host binary must be in **that** staging or C is a developer-only toy. Linux zip similarly. Do not hide the host only inside the macOS `.app`.

**N8 — Freeze AppKit immediately.**  
If Mac keeps shipping AppKit rails while HTML is written, C never converges. #219 overlay rail is the last AppKit feature or it is already too late.

---

## 8. Reflection check (owner / implementer)

| Claim | Platform fact |
|---|---|
| Overlay cannot attach files | True. Attach = Chrome. `file.upload` ACL-denied on summoner. |
| Workbench = summon L0 / panel L1 / CU L2, one runtime | True as ADR-020 mapping. False as shipped UX on Win/Linux (summon window missing). |
| Companion + extension work on three OS | True. |
| Summoner UI Swift-only; systray2 no-op | True, including comments. |
| Do not over-focus macOS | Currently violated by overlay + #219 overlay half. Official Windows installer exists; overlay does not. |
| Honest Linux CU | Docs are honest. Overlay P0 must stay L0 so it does not **un**-honest them. |

Reflection is **not** wrong. Slice C-thin is **not** unsafe if N1–N8 hold. Therefore not REJECT.

---

DIRECTION: C

VERDICT: APPROVE_WITH_NITS
