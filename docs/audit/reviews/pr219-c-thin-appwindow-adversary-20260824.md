# Independent adversary — PR #219 C-thin P3 Chromium `--app` window

> **Lane**: Outcome / Trajectory / Component (Trust + URL-open gate + overlay DoD)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `a10ea4c` (`feat(summoner): open HTML shell in Chromium --app window`)
> **Parent**: `679a403` (`docs(audit): C-thin SSE adversary r1 REJECT, r2+Pi APPROVE_WITH_NITS`)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Spec P3**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/refs/heads/feat/steer-nextrun-overlay-hub` → `a10ea4c4b4e94394eb3e300138535c7141bf30b6`. Reflog parent of HEAD is `679a4033a768ce4658f2061d8c62418bf4aecc77`. `.git/COMMIT_EDITMSG` matches the claimed subject. `[inspected]`

This reviewer has no in-tool shell. GitHub fetch of the public API was SSRF-blocked. `git show HEAD` / `git diff 679a403..HEAD` / `companion npm test` were **not executed**. Semantic diff below is reconstructed from HEAD refs, reflog, COMMIT_EDITMSG, and production files + tests at HEAD. Implementer-claimed `3434+20` / 0 fail is `[assumed]`.

This slice is Chromium/Edge `--app=` dedicated window, **not** WKWebView. Spec P3 says so. Not a reject reason.

REJECT triggers named in the prompt (checked):
- code claims WKWebView while shipping `--app` → **no**
- non-loopback URLs can open → **no**
- Electron added → **no**
- Swift overlay grew → **no evidence it did** (see DoD 5)

---

## Capability declaration (ADR-020) — copied, then checked against production

```text
Surface:      L0 HTML summon shell
L2-classes:   none
Compose:      unchanged
Autonomy:     same tool-loop
Trust:        monotonic
Channel:      loopback HTML + token; page never companion WS; open only 127.0.0.1|localhost token URLs
```

Axes fit `[inspected]`: this is **how** the existing L0 HTML surface is hosted (app-window vs system tab). Not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome, not a Trust write. `isAllowedWsOrigin` body is unchanged. HTML still `fetch` + EventSource; CSP still `connect-src 'self'`.

The planner is a **stricter** open gate than P1 `open <url>`: `openLoopbackPage` now refuses anything that is not `http://127.0.0.1|localhost` with a token, even if a Chrome binary exists. Trust is not loosened.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `a10ea4c` | yes | `.git/HEAD` / refs / reflog / COMMIT_EDITMSG `[inspected]` |
| Parent is `679a403` | yes | reflog `[inspected]` |
| companion `npm test` 3434+20 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| New tests exist and encode DoD 1–3 as planner unit tests | yes | `summoner-shell-open.test.ts` `[inspected]` |
| DoD 4 (`openLoopbackPage` uses planner) | yes in source; test is grep | `summoner-web.ts:226-243`; test `:89-93` `[inspected]` |
| DoD 5 Swift no WKWebView | yes | whole `*.swift` grep empty; overlay test `:95-97` `[inspected]` |
| DoD 6 no Electron | yes | `companion/package.json` deps; root `package.json` `[inspected]` |
| DoD 7 `isAllowedWsOrigin("http://127.0.0.1") === false` | yes | `lifecycle.ts:196-208`; `summoner-web.test.ts:434-437`; `ws-origin.test.ts:19` `[inspected]` |

Do not treat the planner suite as a spawn proof: `openLoopbackPage` is never executed; Chrome is never launched; Swift is grep-only.

---

## Diff (reconstructed `679a403..a10ea4c`) `[inspected]`

Touched production (confident):

- **new** `companion/src/summoner/shell-open.ts` — `isSummonerLoopbackUrl` / `planSummonerShellOpen` / `resolveSummonerBrowserPath`
- **edit** `companion/src/summoner-web.ts` — import planner; `openLoopbackPage` now plans then `spawn`s
- **edit** `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` — status “Implementing P3”; P3 “code now”; next = native WKWebView/WebView2/GTK

Touched test (confident):

- **new** `companion/tests/summoner-shell-open.test.ts`

Likely **untouched** this commit (bodies match prior PR219 reviews; SHA pin unchanged):

- `companion/src/ws/lifecycle.ts` `isAllowedWsOrigin`
- `companion/src/tray/SummonerOverlay.swift` / `Tray.swift`
- `companion/src/tray/swift-tray-bridge.ts` `SWIFT_TRAY_SHA256` = `77139e17…291f` (same pin as earlier #219 reviews)
- `companion/src/menu-bar-agent.ts` still `openLoopbackPage(summonerWebPageUrl(port, token))` (`:1228`)
- `companion/package.json` — no `electron`

`openLoopbackPage` at HEAD:

```226:243:companion/src/summoner-web.ts
export function openLoopbackPage(url: string): void {
  const plan = planSummonerShellOpen(url, {
    platform: process.platform,
    browserPath: resolveSummonerBrowserPath(process.platform),
  })
  if ("error" in plan) {
    console.error(`[summoner-web] ${plan.error}`)
    return
  }
  child_process
    .spawn(plan.command, plan.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      ...(plan.shell ? { shell: true } : {}),
    })
    .unref()
}
```

Planner SoT:

```27:67:companion/src/summoner/shell-open.ts
export function isSummonerLoopbackUrl(url: string): boolean {
  if (typeof url !== "string" || !url) return false
  try {
    const u = new URL(url)
    if (u.protocol !== "http:") return false
    const host = u.hostname.toLowerCase()
    if (host !== "127.0.0.1" && host !== "localhost") return false
    const token = u.searchParams.get("token") || ""
    if (token.length < TOKEN_LEN_MIN) return false
    return true
  } catch {
    return false
  }
}
// planSummonerShellOpen: predicate first, then --app= + --window-size, else
// darwin open / linux xdg-open / win32 cmd /c start "" url
```

Commit message is honest: “Dedicated 640x720 app window when Chrome/Edge exists. Only loopback token URLs. No binary → open/xdg-open/cmd start. No Electron, no new Swift overlay. Native WKWebView/WebView2/GTK remains later.” Does **not** claim WKWebView shipped.

---

## DoD vs production

| # | Observable | Verdict |
|---|------------|---------|
| 1 | `planSummonerShellOpen` uses `--app=` + window-size when `browserPath` set | **pass** `[inspected]` `:50-55`; test `:46-57` asserts `kind==="app-window"`, exact `` `--app=${LOOP}` ``, `--window-size=640…` |
| 2 | Rejects non-loopback / missing token / https / `file:` even if chrome exists | **pass** `[inspected]` predicate `:29-40` + planner returns `{error}` before spawn. Tests: long-token evil host / https / missing token / `file:` on the predicate (`:29-36`); planner+chrome-path on evil host (`:38-44`) |
| 3 | No `browserPath` → darwin `open` / linux `xdg-open` / win32 `cmd start` | **pass** `[inspected]` `:57-65`; test `:59-78`. Win32 production is `cmd` + `["/c","start","",url]` + `shell: true`. Test only asserts `command==="cmd"` (see N4) |
| 4 | `openLoopbackPage` uses the planner | **pass** `[inspected]` `:226-243`. Test is source-grep (`:89-93`), not a spawn |
| 5 | `SummonerOverlay.swift` has no WKWebView this slice | **pass** `[inspected]` zero `WKWebView` in `**/*.swift`; overlay is still NSPanel/AppKit. Test greps overlay (`:95-97`). `SWIFT_TRAY_SHA256` pin unchanged → binary not rebuilt for a WebView |
| 6 | No Electron | **pass** `[inspected]` no `electron` in companion/`package.json`. `electron-to-chromium` is a pre-existing browserslist transitive in the extension lockfile, not a runtime |
| 7 | `isAllowedWsOrigin` still rejects `http://127.0.0.1` | **pass** `[inspected]` `lifecycle.ts:207-208` `return false` unless `chrome-extension://…` or exact `cmspark-tray://local`. Tests still reject `:23401` and `:23403` |

No DoD item failed. Trust / WS Origin not weakened. Non-loopback cannot ride `--app=` just because Chrome exists.

---

## Attack results (must-falsify)

### 1. Non-loopback / https / file opened because Chrome exists?

**No.** `[inspected]` `planSummonerShellOpen` returns `{error}` before reading `browserPath` if `isSummonerLoopbackUrl` is false. `openLoopbackPage` does not spawn on error. Production caller is `summonerWebPageUrl` → `http://127.0.0.1:${port}/?token=${hex64}`.

Walked:

| URL | Predicate | Planner with chrome path |
|-----|-----------|--------------------------|
| `http://evil.example/?token=<64>` | false (host) | error |
| `https://127.0.0.1:23403/?token=<64>` | false (protocol) | error |
| `http://127.0.0.1:23403/` (no token) | false | error |
| `file:///tmp/x.html` | false | error |
| `http://[::1]/?token=<64>` | false (`hostname` is `::1`, not in `{127.0.0.1,localhost}`) | error |
| `http://127.0.0.1.evil.com/?token=<64>` | false | error |
| `http://127.0.0.1@evil.com/?token=<64>` | false (host `evil.com`) | error |
| `http://0.0.0.0/?token=<64>` | false | error |
| `javascript:…` / `data:` / `chrome://` | false | error |

`--app=${url}` is a **single argv**. Chrome will not see a second flag from the URL. `new URL` + `protocol === "http:"` + hostname allowlist is the SoT, not a string prefix.

Planner-with-chrome test uses `token=aa` (also fails `TOKEN_LEN_MIN`). That test **alone** would not catch a missing host check. The predicate test with a long token on `evil.example` would. Combined they cover DoD 2. See N3.

### 2. Does the code claim WKWebView while shipping `--app`?

**No.** `[inspected]` `shell-open.ts:1-6` and the commit body say the opposite: not Electron, not a new Swift overlay, native WKWebView/WebView2/GTK **later**. Spec P3 same. HTML/tray comments not rewritten as “WKWebView shipped”.

### 3. Electron added?

**No.** `[inspected]` companion runtime deps: still `systray2` / `ws` / `openai` / etc. No new Electron host, no `BrowserWindow`, no `electron` import under `companion/src`.

### 4. Swift overlay grew / WKWebView snuck in?

**No WKWebView.** `[inspected]` `SummonerOverlay.swift` is still the NSPanel capture overlay (`class SummonerController`, `NSPanel`, AppKit). Tray.swift still points at that file (`:1419`). SHA pin `77139e17…` unchanged from earlier #219 HTML/SSE reviews → the hashed tray binary was not rebuilt for a WebView host.

Cannot `git diff 679a403 -- companion/src/tray/SummonerOverlay.swift`. Absence of WKWebView + unchanged SHA is enough for DoD 5. A silent AppKit tweak without rebuild would not match “grew a WebView overlay”.

### 5. HTML `--app` window connecting companion WS with spoofed Origin?

**Page cannot.** `[inspected]` SUMMONER_HTML still has no `WebSocket`. CSP `connect-src 'self'`. DevTools `new WebSocket("ws://127.0.0.1:23401")` would present `Origin: http://127.0.0.1:23403`, which `isAllowedWsOrigin` rejects (`lifecycle.ts:196-208`). Browser cannot forge `cmspark-tray://local`. `--app` does not widen that allowlist.

### 6. `--app=` / Windows `start` command injection via token?

**Not on the production caller.** `[inspected]` Token from `crypto.randomBytes(32).toString("hex")` (`summoner-web.ts:257`). App-window spawn is **without** `shell`. Fallback Windows path still `shell: true` + `cmd /c start "" url` — same family as P1, still only reachable after the loopback+token predicate.

Planner does **not** charset-lock the token (only `length >= 16`). A future caller of `openLoopbackPage("http://127.0.0.1/?token=aaaaaaaaaaaaaaaa&calc.exe")` would pass the predicate and, on the no-chrome Windows path, hand `cmd` an `&`. Not reachable from tray today. See N2.

### 7. Confirm / Trust chrome via this slice?

**No.** `[inspected]` No HTML/SSE/ACL/router edits in the reconstructed slice. `SUMMONER_WEB_EVENT_ALLOW` / dispatch allowlist / `allowTrust` force-false / occupied `run_active` not touched.

---

## Blockers

**None.** DoD 1–7 hold on production source. Open gate is in front of spawn. `--app` is honestly labeled. WS Origin not widened. Overlay cannot Allow/Deny. Electron not added. Swift has no WKWebView.

---

## Findings (non-blocking)

### Nits

**N1 — `openLoopbackPage` spawn is untested; DoD 4/5 tests are source-grep.** `[inspected]` `summoner-shell-open.test.ts:89-100`. Planner unit tests are real. The live function is 18 lines and was hand-walked. A later edit can spawn `open` again while greps still match `planSummonerShellOpen` somewhere in the file.

**N2 — Planner token is length-only; Windows fallback still `shell: true`.** `[inspected]` `shell-open.ts:25,35-36,63-64`; `summoner-web.ts:240`. Production token is 64 hex so this is not a current hole. If `openLoopbackPage` is reused, `&` / `|` in `token` become cmd metacharacters. Restrict token to `[0-9a-f]{16,}` (or drop `shell: true` and `spawn('cmd', …)` without shell — the empty-title `start` trick already uses argv).

**N3 — Planner+chrome reject test uses `token=aa`, so it does not independently prove host rejection.** `[inspected]` `:38-44`. Predicate test with long token on `evil.example` / `https` / `file:` is the real cover. Add one planner call: https + 64-char token + `browserPath` set.

**N4 — Fallback tests do not lock argv / `shell`.** `[inspected]` linux only checks `command==="xdg-open"`; win32 only `command==="cmd"`. Production win32 is `["/c","start","",url]` + `shell: true`. Empty title is load-bearing (`start` otherwise treats the URL as a window title).

**N5 — Spawn failure is silent; tray still says 已在浏览器打开.** `[inspected]` `openLoopbackPage` ignores `error` on the ChildProcess; `stdio: "ignore"`. `openSummonerWebShell` notifies after the call regardless (`menu-bar-agent.ts:1228-1229`). If `browserPath` exists but is not executable, there is **no** degrade to `open`/`xdg-open`. Spec DoD 3 is “no binary → degrade”, which still holds. Honesty of the toast does not.

**N6 — `resolveSummonerBrowserPath` is `existsSync`, not executable, and trusts PATH.** `[inspected]` `:104-129`. First `google-chrome` in `PATH` on linux is launched with `--app=` + the token URL. Local PATH write already implies a local attacker; they then see the token in argv (also true of `open <url>`). Do not treat as a remote hole.

**N7 — `--app=` does not pin navigation after launch.** `[inspected]` Chrome app windows can still navigate. SUMMONER_HTML has no `href` / `window.open` / third-party URLs (grep). CSP `default-src 'none'` + `connect-src 'self'`. Same residual as a system tab; worse UX if XSS ever lands (no address bar). Not a current XSS.

**N8 — Token remains in the process list via `--app=http://127.0.0.1:…/?token=`.** `[inspected]` Same class as P1 `open <url-with-token>`. `--app` makes it slightly more visible (`ps` shows Chrome + URL). Session token, loopback-only, 30 min idle stop. Not a DoD fail.

**N9 — Notification copy still “浏览器” for an app window.** `[inspected]` `menu-bar-agent.ts:1229`. Cosmetic. Not a WKWebView claim.

---

## Trajectory

Slice matches spec P3: same HTML, Chromium/Edge `--app=` + `--window-size=640,720` when a binary is found, loopback+token-only open, honest tab degrade, native WKWebView deferred, Electron / Swift overlay not grown.

Not drive-by: reconstructed touch set is planner + `openLoopbackPage` + spec status + one test file. `lifecycle.ts` / ACL / SSE allowlist / overlay lease / occupied upload look untouched.

TDD: DoD 1–3 are planner unit tests (good). DoD 2’s “even if chrome exists” is one weak planner case plus a strong predicate test. DoD 4–5 are grep. Spawn / Chrome / Swift binary not executed.

Dead path: none new. Unsupported `platform` returns `{error}` and `openLoopbackPage` logs; tray still only runs on darwin/linux/win32.

Honest labeling: comments and commit do **not** pretend this is WKWebView.

---

## Component (file:line)

| Gate | Location |
|------|----------|
| Loopback+token predicate | `companion/src/summoner/shell-open.ts:27-40` |
| `--app=` + window-size | `companion/src/summoner/shell-open.ts:50-55` |
| Tab degrade | `companion/src/summoner/shell-open.ts:57-65` |
| Browser binary resolve | `companion/src/summoner/shell-open.ts:104-129` |
| Spawn uses planner | `companion/src/summoner-web.ts:226-243` |
| Production URL | `companion/src/summoner-web.ts:166-168,257,1228` |
| Tray still calls `openLoopbackPage` | `companion/src/menu-bar-agent.ts:1213-1228` |
| WS Origin (untouched) | `companion/src/ws/lifecycle.ts:196-208` |
| HTML no WS / CSP | `companion/src/summoner-web.ts:339-347,515+` |
| Swift overlay (no WKWebView) | `companion/src/tray/SummonerOverlay.swift` (NSPanel) |
| Swift SHA pin (unchanged) | `companion/src/tray/swift-tray-bridge.ts:58` |
| Planner tests | `companion/tests/summoner-shell-open.test.ts` |
| Origin still rejects loopback HTTP | `companion/tests/summoner-web.test.ts:434-437` |

---

## ADR-020 / P1 watchlist

| ID | This commit |
|----|-------------|
| P1-1 god-mode / `config.set` | **not reachable** — open path only; HTTP/ACL unchanged |
| P1-2 `originWs` | **not touched** — no new `securityConfirmations.request` |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not** `shell_exec`. Local `spawn` of Chrome/`open`/`xdg-open`/`cmd start` with a planner-gated URL. Windows `shell: true` only on the tab fallback (N2) |
| Confirm dialects | none |
| Trust monotonicity | open gate **tightened**; WS Origin unchanged; overlay still cannot write Trust B |
| Pack-first / new runtime | no |

---

## Capability vs production (short)

| Axis | Declared | Production |
|------|----------|------------|
| Surface | L0 HTML summon shell | same HTML, hosted in `--app` window or system tab `[inspected]` |
| L2-classes | none | no confirm chrome added; Swift still has no Allow/Deny from this slice |
| Compose | unchanged | no pack/ACL edits in reconstructed diff |
| Autonomy | same tool-loop | tray still `dispatchSummonerWeb` → existing `handleMessage` |
| Trust | monotonic | URL must be http loopback + token **before** spawn; hostname still not a trust gate |
| Channel | loopback HTML + token; page never companion WS; open only 127.0.0.1\|localhost token URLs | planner enforces the open rule; `isAllowedWsOrigin` still rejects loopback HTTP |

---

VERDICT: APPROVE_WITH_NITS
