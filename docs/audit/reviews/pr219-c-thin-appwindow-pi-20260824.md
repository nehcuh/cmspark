# Pi re-review — PR #219 C-thin P3 Chromium `--app` window

> **Lane**: eval-engineering-gate stage 2 (confirm or reject independent adversary)
> **Role**: Pi — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `a10ea4c4b4e94394eb3e300138535c7141bf30b6` (`feat(summoner): open HTML shell in Chromium --app window`)
> **Parent**: `679a4033a768ce4658f2061d8c62418bf4aecc77` (`docs(audit): C-thin SSE adversary r1 REJECT, r2+Pi APPROVE_WITH_NITS`)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Adversary**: `docs/audit/reviews/pr219-c-thin-appwindow-adversary-20260824.md` — **VERDICT: APPROVE_WITH_NITS** (read in full, not a summary)
> **Spec P3**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/HEAD` → `refs/heads/feat/steer-nextrun-overlay-hub` → `a10ea4c4b4e94394eb3e300138535c7141bf30b6`. Branch reflog last line is `679a4033… a10ea4c4… feat(summoner): open HTML shell in Chromium --app window`. `.git/COMMIT_EDITMSG` is the claimed subject + body. `[inspected]`

This Pi session had **no shell tool**. `git diff 679a403..a10ea4c` and `companion npm test` were **not executed**. GitHub commit/compare fetch was SSRF-blocked. Production files + tests were read at HEAD. Slice membership is reconstructed from COMMIT_EDITMSG + new `companion/src/summoner/shell-open.ts` / `companion/tests/summoner-shell-open.test.ts` + `openLoopbackPage` at HEAD, not a `git show` blob. Implementer-claimed `3434+20` / 0 fail remains `[assumed]`. “Untouched this commit” for `lifecycle.ts` / Swift / SHA pin is `[assumed]` from HEAD identity with prior #219 reviews + unchanged pin string, not a parent-tree hash.

Must-falsify (from the gate prompt): **non-loopback URLs can open even with a chrome path**, **Electron added**, **Swift WKWebView growth**, **WS Origin widened**, **spec/code claims WKWebView while shipping `--app`**. Any one of those is REJECT. Adversary nits that are still true are carried, not re-litigated as blockers.

---

## Confirmation-order status

1. MACHINE — implementer claimed green this session; Pi did not re-run.
2. Independent adversary — **APPROVE_WITH_NITS** (full report read).
3. Pi — independently walk the planner predicate **before** `browserPath` / spawn; confirm `openLoopbackPage` does not spawn on `{error}`; confirm `isAllowedWsOrigin` still two predicates + `return false`; confirm no Electron / no WKWebView; confirm spec P3 is Chromium `--app`, not WKWebView.

**Blast**: T2 L0 overlay Surface. How the existing HTML shell is hosted (app-window vs system tab). Overlay must not Allow/Deny. Companion WS Origin must stay `chrome-extension://` ∪ `cmspark-tray://local`. Open gate must not take a non-loopback URL just because Chrome exists.

---

## Capability declaration (ADR-020) — checked against production

```text
Surface:      L0 HTML summon shell
L2-classes:   none
Compose:      unchanged
Autonomy:     same tool-loop
Trust:        monotonic
Channel:      loopback HTML + token; page never companion WS; open only 127.0.0.1|localhost token URLs
```

Axes fit `[inspected]`: hosting change for the existing L0 HTML surface, not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome, not a Trust write. HTML is still `fetch` + EventSource; CSP still `connect-src 'self'`; `isAllowedWsOrigin` body at HEAD is still two allow-predicates then `return false`.

The planner is a **stricter** open gate than P1 `open <url>`: `planSummonerShellOpen` returns `{error}` before reading `browserPath` if `isSummonerLoopbackUrl` is false. Trust is not loosened.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `a10ea4c` | yes | `.git/refs/heads/feat/steer-nextrun-overlay-hub` `[inspected]` |
| Parent is `679a403` | yes | branch reflog last line `[inspected]` |
| companion `npm test` 3434+20 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| New tests encode DoD 1–3 as planner unit tests | yes | `summoner-shell-open.test.ts` `[inspected]` |
| DoD 4 (`openLoopbackPage` uses planner) | yes in source; test is grep | `summoner-web.ts:226-243`; test `:89-93` `[inspected]` |
| DoD 5 Swift no WKWebView | yes at HEAD | `**/*.swift` grep empty for `WKWebView`; overlay still `NSPanel`; test `:95-97` `[inspected]` |
| DoD 6 no Electron | yes | companion `package.json` deps; no `electron` import under repo; `electron-to-chromium` is extension lockfile browserslist transitive `[inspected]` |
| DoD 7 `isAllowedWsOrigin("http://127.0.0.1") === false` | yes | `lifecycle.ts:196-208`; `summoner-web.test.ts:434-437`; `ws-origin.test.ts:19` `[inspected]` |

Agree with adversary: do not treat the planner suite as a spawn proof. `openLoopbackPage` is never executed; Chrome is never launched; Swift is grep + SHA-pin identity, not a rebuild.

---

## Must-falsify 1 — non-loopback / https / file opened because Chrome exists?

**No.** `[inspected]`

SoT is `isSummonerLoopbackUrl` then `planSummonerShellOpen` (`shell-open.ts:27-48`). Order is load-bearing: the `{error}` return is **before** `opts.browserPath` is read. `openLoopbackPage` (`summoner-web.ts:226-243`) does not `spawn` when `"error" in plan`.

Predicate (hand-walked, not executed):

1. non-string / empty → false
2. `new URL` throw → false
3. `protocol !== "http:"` → false (`https:`, `file:`, `javascript:`, `data:`, `chrome:` fail here)
4. `hostname.toLowerCase()` must be exact `127.0.0.1` **or** `localhost` — not `host` (port stripped), so `:23403` cannot smuggle
5. `searchParams.get("token")` length `>= 16`

Independent URL walks (WHATWG `hostname`, not a Node run):

| URL | Result | Why |
|-----|--------|-----|
| `http://127.0.0.1:23403/?token=` + 64 hex | true | production shape (`summonerWebPageUrl`) |
| `http://localhost:23403/?token=` + 64 hex | true | spec allows localhost |
| `http://evil.example/?token=` + 64 hex | false | hostname |
| `https://127.0.0.1:23403/?token=` + 64 hex | false | protocol |
| `http://127.0.0.1:23403/` | false | token missing |
| `file:///tmp/x.html` | false | protocol |
| `http://[::1]/?token=` + 64 hex | false | hostname `::1` not in `{127.0.0.1,localhost}` |
| `http://127.0.0.1.evil.com/?token=` + 64 hex | false | hostname |
| `http://127.0.0.1@evil.com/?token=` + 64 hex | false | hostname `evil.com` |
| `http://127.0.0.1:80@evil.com/?token=` + 64 hex | false | userinfo, host is evil |
| `http://0.0.0.0/?token=` + 64 hex | false | hostname |
| `http://127.1/?token=` + 64 hex | false | hostname not exact |
| `http://localhost./?token=` + 64 hex | false | trailing-dot hostname |
| `http://127.0.0.1#@evil.com/?token=` + 64 hex | false | search empty, token missing |
| `http://[::ffff:127.0.0.1]/?token=` + 64 hex | false | hostname is the v4-mapped form |

`--app=${url}` is a **single argv**. Chrome does not see a second flag from the URL. `new URL` + `protocol === "http:"` + hostname allowlist is the SoT, not a string prefix. App-window spawn is **without** `shell`.

Production caller is only `openLoopbackPage(summonerWebPageUrl(port, token))` (`menu-bar-agent.ts:1228`) → `http://127.0.0.1:${port}/?token=${hex64}` (`summoner-web.ts:166-168,257`). Grep: no other `openLoopbackPage` call site.

Tests: predicate covers long-token evil host / https / missing token / `file:` (`summoner-shell-open.test.ts:29-36`). Planner+chrome-path on evil host (`:38-44`) uses `token=aa` (also fails `TOKEN_LEN_MIN`). That test **alone** would not catch a missing host check. Combined with the predicate they cover DoD 2. Adversary N3 is real and non-blocking.

---

## Must-falsify 2 — code/spec claims WKWebView while shipping `--app`?

**No.** `[inspected]`

- `shell-open.ts:1-6`: “Not Electron. Not a new Swift overlay. Native WKWebView / WebView2 / GTK remains a later host.”
- Commit body: same. Does **not** claim WKWebView shipped.
- Spec status: `Implementing P3 Chromium app-window host` (`docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md:4`).
- Spec P3 (`:46-51`): “dedicated Chromium/Edge `--app=` window”; “Native WKWebView / WebView2 / GTK wrapping the same HTML remains a later host.”
- Next slices (`:55`) still name native WKWebView as later.
- Tray toast still says 「已在浏览器打开」 (`menu-bar-agent.ts:1229`) — cosmetic, not a WKWebView claim (adversary N9).

Honest labeling holds.

---

## Must-falsify 3 — Electron added?

**No.** `[inspected]` companion runtime deps still `systray2` / `ws` / `openai` / etc. (`package.json:30-46`). No `electron` in any `package.json`. No `require('electron')` / `from 'electron'` / `BrowserWindow` under the repo. `electron-to-chromium` remains a pre-existing `chrome-extension/package-lock.json` browserslist transitive, not a runtime. No new Electron host.

---

## Must-falsify 4 — Swift overlay grew a WKWebView?

**No WKWebView at HEAD.** `[inspected]`

- Grep `WKWebView` / `WebView` under `companion/src/tray/*.swift`: empty (overlay comments mention NSPanel only).
- `SummonerOverlay.swift:9-13,146,1006-1009` is still `class SummonerController` + lazy `NSPanel` capture overlay. “Overlay is capture-only — not an L2 gate surface.”
- `Tray.swift:1419` is still the comment “Summoner overlay lives in SummonerOverlay.swift”.
- `SWIFT_TRAY_SHA256` = `77139e17cd5f48d6c25aa0268806e9ba7275a30b535c2dc82749f4621f53291f` (`swift-tray-bridge.ts:58`) — same pin string as earlier #219 reviews. Binary was not rebuilt for a WebView host.
- Test greps overlay (`summoner-shell-open.test.ts:95-97`).

Parent-tree empty Swift diff was **not** hashed this session. Absence of WKWebView + unchanged SHA is enough for DoD 5. A silent AppKit tweak without rebuild would not match “grew a WebView overlay.”

---

## Must-falsify 5 — WS Origin widened so the `--app` page can drive companion WS?

**No.** `[inspected]` `isAllowedWsOrigin` (`lifecycle.ts:196-208`) still:

1. non-string → false
2. `chrome-extension://[A-Za-z0-9_-]+` → true
3. exact `cmspark-tray://local` → true
4. `return false`

`http://127.0.0.1:23403` / `http://localhost:23403` remain false (`summoner-web.test.ts:434-437`). `ws-origin.test.ts:19` still rejects `:23401`. `--app` does not change the browser-set Origin: it is still `http://127.0.0.1:${port}`. Browser cannot forge `cmspark-tray://local`.

Page still has no `WebSocket` / `ws://` (grep of `summoner-web.ts` empty). Inline script is `fetch` + token query (`:584-593`). CSP `connect-src 'self'` (`:345-346`) is a second gate: DevTools `new WebSocket("ws://127.0.0.1:23401")` is a **different origin/port**, blocked by CSP and then by `verifyClient`. `pushSummonerWebEvent` still drops `/confirm/i` except `mcp.confirm.pending` (`:199-203,35-52`) — same as P2, not this slice.

---

## DoD vs production (confirm or refute)

| # | Observable | Adversary | Pi |
|---|------------|-----------|----|
| 1 | `planSummonerShellOpen` uses `--app=` + window-size when `browserPath` set | pass | **confirm** `shell-open.ts:50-55`; test `:46-57` asserts `kind==="app-window"`, exact `` `--app=${LOOP}` ``, `--window-size=640` prefix (not exact `640,720` — see N4) |
| 2 | Rejects non-loopback / missing token / https / `file:` even if chrome exists | pass | **confirm** predicate first (`:27-48`). Planner+chrome evil-host test is weak (`token=aa`, N3); predicate with 64-char token on `evil.example` / `https` / `file:` is the real cover. Combined they hold. |
| 3 | No `browserPath` → darwin `open` / linux `xdg-open` / win32 `cmd start` | pass | **confirm** `:57-65`. Win32 production is `cmd` + `["/c","start","",url]` + `shell: true`. Test only asserts `command==="cmd"` (N4). Empty title is load-bearing. |
| 4 | `openLoopbackPage` uses the planner | pass | **confirm** `:226-243`. Test is source-grep (`:89-93`), not a spawn (N1). Hand-walk: `{error}` → `console.error` + return; else `spawn(plan.command, plan.args, {detached, stdio:ignore, windowsHide, shell?})` + `unref`. |
| 5 | `SummonerOverlay.swift` has no WKWebView this slice | pass | **confirm at HEAD**, not independently hashed vs parent. Zero `WKWebView` in `*.swift`. SHA pin unchanged. |
| 6 | No Electron | pass | **confirm** companion deps; no Electron import. |
| 7 | `isAllowedWsOrigin` still rejects `http://127.0.0.1` | pass | **confirm** `lifecycle.ts:207-208` `return false` unless the two predicates. Tests still reject HTML loopback ports. |

No DoD item failed. Trust / WS Origin not weakened. Non-loopback cannot ride `--app=` just because Chrome exists.

---

## Attack results (same threat list as adversary)

### 1. Non-loopback opened because Chrome exists?

**Confirm adversary: no.** Predicate before `browserPath`. Production URL is loopback hex token only.

### 2. Claims WKWebView, ships `--app`?

**Confirm adversary: no.** Spec P3 / commit / `shell-open.ts` header all say Chromium `--app` now, native webview later.

### 3. Electron?

**Confirm adversary: no.**

### 4. Swift WKWebView sneak-in?

**Confirm adversary: no WKWebView.** SHA pin identity + source grep. Empty Swift diff not `git show`'d.

### 5. `--app` page → companion WS with spoofed Origin?

**Confirm adversary: page cannot.** No `WebSocket`; CSP `connect-src 'self'`; Origin allowlist unchanged.

### 6. `--app=` / Windows `start` command injection via token?

**Confirm adversary: not on the production caller.** Token is `crypto.randomBytes(32).toString("hex")` (`summoner-web.ts:257`). App-window spawn is without `shell`. Windows tab fallback still `shell: true` + `cmd /c start "" url` — same family as P1, only after the loopback+token predicate.

Planner token is **length-only** (`TOKEN_LEN_MIN = 16`). A future `openLoopbackPage("http://127.0.0.1/?token=aaaaaaaaaaaaaaaa&calc.exe")` would pass (`searchParams.get("token")` stops at `&`) and, on the no-chrome Windows path, hand `cmd` an `&`. Not reachable from tray today. N2 stands, not a current hole.

### 7. Confirm / Trust chrome via this slice?

**Confirm adversary: no at HEAD.** HTTP reconstruct / dispatch allowlist / SSE allowlist / `allowTrust` force-false / occupied `run_active` bodies match prior P1/P2 reviews. HTML composer is still 发送/纠偏/排队/停止; badge is 「本页不代替侧栏批准」. No Allow/Deny DOM. Slice-membership of those files vs `679a403` is `[assumed]`.

---

## Adversary nits — confirm or drop

| ID | Adversary | Pi |
|----|-----------|----|
| N1 | `openLoopbackPage` spawn untested; DoD 4/5 are grep | **keep.** A later edit can `spawn("open", …)` while the file still mentions `planSummonerShellOpen`. |
| N2 | Token charset-unlocked; Windows fallback `shell: true` | **keep.** Restrict token to `[0-9a-f]{16,}` **or** drop `shell: true` and `spawn('cmd', argv)` without shell. Empty-title `start` already uses argv. Not a current hole. |
| N3 | Planner+chrome reject uses `token=aa` | **keep.** Add one planner call: https + 64-char token + `browserPath` set (and/or long-token evil host). |
| N4 | Fallback tests do not lock argv / `shell` | **keep.** Also: app-window test locks `--window-size=640` prefix, not `640,720`. Linux fallback does not assert `args === [url]`. Production win32 empty title is load-bearing. |
| N5 | Spawn failure silent; toast still 已在浏览器打开; no degrade if binary exists but not executable | **keep.** Spec DoD 3 is “no binary → degrade”, which still holds. Toast honesty does not. |
| N6 | `existsSync`, not executable; trusts PATH | **keep.** Local PATH write already implies a local attacker; they then see the token in argv (also true of P1 `open <url>`). Not a remote hole. |
| N7 | `--app=` does not pin navigation after launch | **keep.** SUMMONER_HTML has no `href` / `window.open` / third-party URLs. `innerHTML` is only `""` clears + one static chip string (`:598,611,613,623,644`); user strings use `textContent`. CSP `default-src 'none'` + `connect-src 'self'`. Same residual as a system tab; worse UX if XSS ever lands (no address bar). Not a current XSS. |
| N8 | Token in process list via `--app=http://…?token=` | **keep.** Same class as P1. Session token, loopback-only, 30 min idle stop. Not a DoD fail. |
| N9 | Notification copy still “浏览器” | **keep.** Cosmetic. Not a WKWebView claim. |

No nits promoted to blockers. No adversary miss on DoD/Trust that would flip the verdict.

Pi extra (non-blocking, not a miss of the adversary’s must-falsify list): `whichFromPath` keys PATH separator off `process.platform`, not `resolveSummonerBrowserPath`’s `platform` argument (`shell-open.ts:93-101,104-129`). Production always passes `process.platform`. Test injection of `platform: "linux"` on darwin still uses `:`. Not a hole.

---

## Trajectory / Component

Slice matches spec P3: same HTML, Chromium/Edge `--app=` + `--window-size=640,720` when a binary is found, loopback+token-only open, honest tab degrade, native WKWebView deferred, Electron / Swift overlay not grown.

Not drive-by at HEAD: planner + `openLoopbackPage` + spec status + one test file. `lifecycle.ts` / ACL / SSE allowlist / overlay lease / occupied upload look untouched (`[assumed]` vs parent tree).

TDD: DoD 1–3 are planner unit tests (good). DoD 2’s “even if chrome exists” is one weak planner case plus a strong predicate test. DoD 4–5 are grep. Spawn / Chrome / Swift binary not executed.

Dead path: none new. Unsupported `platform` returns `{error}` and `openLoopbackPage` logs; tray still only runs on darwin/linux/win32.

Honest labeling: comments, spec, and commit do **not** pretend this is WKWebView.

| Gate | Location |
|------|----------|
| Loopback+token predicate | `companion/src/summoner/shell-open.ts:27-40` |
| `--app=` + window-size | `companion/src/summoner/shell-open.ts:50-55` |
| Tab degrade | `companion/src/summoner/shell-open.ts:57-65` |
| Browser binary resolve | `companion/src/summoner/shell-open.ts:104-129` |
| Spawn uses planner | `companion/src/summoner-web.ts:226-243` |
| Production URL | `companion/src/summoner-web.ts:166-168,257` |
| Tray still calls `openLoopbackPage` | `companion/src/menu-bar-agent.ts:1213-1228` |
| WS Origin | `companion/src/ws/lifecycle.ts:196-208` |
| HTML no WS / CSP | `companion/src/summoner-web.ts:339-347,515+,584` |
| Swift overlay (no WKWebView) | `companion/src/tray/SummonerOverlay.swift` (NSPanel) |
| Swift SHA pin | `companion/src/tray/swift-tray-bridge.ts:58` |
| Planner tests | `companion/tests/summoner-shell-open.test.ts` |
| Origin still rejects loopback HTTP | `companion/tests/summoner-web.test.ts:434-437` |

---

## ADR-020 / P1 watchlist

| ID | This commit |
|----|-------------|
| P1-1 god-mode / `config.set` | **not reachable** — open path only; HTTP/ACL unchanged at HEAD |
| P1-2 `originWs` | **not touched** — no new `securityConfirmations.request` |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not** `shell_exec`. Local `spawn` of Chrome/`open`/`xdg-open`/`cmd start` with a planner-gated URL. Windows `shell: true` only on the tab fallback (N2) |
| Confirm dialects | none |
| Trust monotonicity | open gate **tightened**; WS Origin unchanged; overlay still cannot write Trust B |
| Pack-first / new runtime | no — `--app` is the user’s Chromium, not a third Agent runtime |

---

## Capability vs production (short)

| Axis | Declared | Production |
|------|----------|------------|
| Surface | L0 HTML summon shell | same HTML, hosted in `--app` window or system tab `[inspected]` |
| L2-classes | none | no confirm chrome added; Swift still has no Allow/Deny from this slice |
| Compose | unchanged | no pack/ACL edits visible at HEAD |
| Autonomy | same tool-loop | tray still `dispatchSummonerWeb` → existing `handleMessage` |
| Trust | monotonic | URL must be http loopback + token **before** spawn; hostname still not a trust gate |
| Channel | loopback HTML + token; page never companion WS; open only 127.0.0.1\|localhost token URLs | planner enforces the open rule; `isAllowedWsOrigin` still rejects loopback HTTP |

---

Adversary did not miss a DoD/Trust hole. Independent walk of the open gate, Origin allowlist, Electron/WKWebView absence, and spec wording agrees. Nits are test/robustness, not current bypasses.

VERDICT: APPROVE_WITH_NITS
