# Independent adversary — PR #219 C-thin P3 open-gate nits (N1–N4)

> **Lane**: Outcome / Trajectory / Component (Trust + URL-open gate + overlay DoD)
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `10dc0c9` (`fix(summoner): hex-lock token URLs and drop Windows cmd shell`)
> **Parent**: `540b7c4` (`docs(audit): C-thin app-window adversary + Pi APPROVE_WITH_NITS`)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Prior**: `docs/audit/reviews/pr219-c-thin-appwindow-adversary-20260824.md` — **APPROVE_WITH_NITS** (N1–N4 this slice)
> **Spec P3**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/refs/heads/feat/steer-nextrun-overlay-hub` → `10dc0c98841c18aa75899eb6a95b384a42909def`. Branch reflog last line is `540b7c4188… 10dc0c9884… fix(summoner): hex-lock token URLs and drop Windows cmd shell`. `.git/COMMIT_EDITMSG` is the claimed subject + “Adversary N1–N4: token must be 64 hex and the only query key. Win32 fallback is cmd.exe argv (empty start title) without shell:true. openLoopbackPage is spawn-injected so evil URLs never reach spawn.” `[inspected]`

This reviewer has no in-tool shell. `git show HEAD` / `git diff 540b7c4..HEAD` / `companion npm test` were **not executed**. Semantic diff below is reconstructed from HEAD refs, reflog, COMMIT_EDITMSG, production files + tests at HEAD, and the prior adversary’s reconstruction of `a10ea4c` (parent `540b7c4` is docs-only on top of that implementation). Implementer-claimed `3458` / 0 fail is `[assumed]`.

REJECT triggers named in the prompt (checked):
- evil URL can still spawn → **no** (non-loopback / extra keys / non-hex never reach `spawn`; see attacks)
- `shell:true` returns on win32 fallback → **no**
- token charset not hex → **no** (`/^[0-9a-f]{64}$/i`)

This slice is still Chromium/Edge `--app=` / tab degrade, **not** WKWebView. Spec P3 says so. Not a reject reason.

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

Axes fit `[inspected]`: nits fold on the existing P3 open gate. Not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome, not a Trust write. `isAllowedWsOrigin` body is still two allow-predicates then `return false`. HTML still `fetch` + EventSource.

The gate is **stricter** than the `a10ea4c` planner: token is exactly 64 hex and the **only** query key; win32 tab degrade no longer sets `shell: true`; `openLoopbackPage` never spreads `plan.shell`. Trust is not loosened.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `10dc0c9` | yes | `.git/HEAD` / refs / reflog / COMMIT_EDITMSG `[inspected]` |
| Parent is `540b7c4` | yes | reflog `[inspected]` |
| Subject is `fix(summoner): hex-lock token URLs and drop Windows cmd shell` | yes | COMMIT_EDITMSG `[inspected]` |
| companion `npm test` 3458 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| DoD 1 token 64 hex + extra keys rejected | yes | `shell-open.ts:25,34-37`; test `:37-45` `[inspected]` |
| DoD 2 non-loopback + 64-hex + chrome path errors | yes | planner test `:48-59` `[inspected]` |
| DoD 3 win32 `cmd.exe` + `["/c","start","",url]` without `shell:true` | yes | `shell-open.ts:64-66`; test `:88-94`; spawn site never sets `shell` `[inspected]` |
| DoD 4 spawn-injected: evil no spawn, loopback `--app` | yes | `summoner-web.ts:237-252`; test `:112-139` `[inspected]` |
| DoD 5 `isAllowedWsOrigin` / no Electron / no Swift WKWebView | yes at HEAD | `lifecycle.ts:196-208`; companion `package.json`; `**/*.swift` grep empty `[inspected]` |

Do not treat the spawn mock as a Chrome launch: `child_process.spawn` is not the real binary; Swift is grep + SHA-pin identity; Origin is body-identity with prior #219 reviews, not a parent-tree hash this session.

---

## Diff (reconstructed `540b7c4..10dc0c9`) `[inspected]`

Parent `540b7c4` is `docs(audit)` on `a10ea4c`. Code parent of this nits fold is the P3 planner at `a10ea4c` as reconstructed in the prior adversary report.

Touched production (confident):

- **edit** `companion/src/summoner/shell-open.ts` — `TOKEN_LEN_MIN` gone; `TOKEN_HEX`; extra query keys rejected; win32 `cmd.exe` argv, **no** `shell: true`
- **edit** `companion/src/summoner-web.ts` — `OpenLoopbackPageDeps` + spawn inject; `openLoopbackPage` returns `boolean`; spawn options never include `shell`
- **edit** `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md` — status “P3 landed + open-gate nits (hex token, no cmd shell)”

Touched test (confident):

- **edit** `companion/tests/summoner-shell-open.test.ts` — short / extra-key / non-hex predicate cases; planner+chrome uses 64-hex + https; win32 argv + `shell === undefined`; spawn-injected `openLoopbackPage`

Likely **untouched** this commit (bodies match prior PR219 reviews; SHA pin unchanged):

- `companion/src/ws/lifecycle.ts` `isAllowedWsOrigin`
- `companion/src/tray/SummonerOverlay.swift` / `Tray.swift`
- `companion/src/tray/swift-tray-bridge.ts` `SWIFT_TRAY_SHA256` = `77139e17…291f`
- `companion/src/menu-bar-agent.ts` still `openLoopbackPage(summonerWebPageUrl(port, token))` (`:1228`); **settings** path still has its own `shell: true` (`:1173`) — out of this gate
- `companion/package.json` — no `electron`

`isSummonerLoopbackUrl` / win32 plan at HEAD:

```25:66:companion/src/summoner/shell-open.ts
const TOKEN_HEX = /^[0-9a-f]{64}$/i

export function isSummonerLoopbackUrl(url: string): boolean {
  // ...
    const keys = [...u.searchParams.keys()]
    if (keys.length !== 1 || keys[0] !== "token") return false
    const token = u.searchParams.get("token") || ""
    return TOKEN_HEX.test(token)
  // ...
}
  if (opts.platform === "win32") {
    return { kind: "browser-tab", command: "cmd.exe", args: ["/c", "start", "", url] }
  }
```

`openLoopbackPage` at HEAD:

```226:253:companion/src/summoner-web.ts
export function openLoopbackPage(url: string, deps: OpenLoopbackPageDeps = {}): boolean {
  const platform = deps.platform ?? process.platform
  const browserPath =
    deps.browserPath !== undefined ? deps.browserPath : resolveSummonerBrowserPath(platform)
  const plan = planSummonerShellOpen(url, { platform, browserPath })
  if ("error" in plan) {
    console.error(`[summoner-web] ${plan.error}`)
    return false
  }
  const spawn = deps.spawn ?? ((cmd, args, opts) => child_process.spawn(cmd, args, opts))
  spawn(plan.command, plan.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref()
  return true
}
```

vs `a10ea4c`: length-only token (`>= 16`), extra keys allowed, win32 `command: "cmd"` + `shell: true`, spawn site `...(plan.shell ? { shell: true } : {})`, no inject, `void` return.

Commit message is honest. Does **not** claim WKWebView shipped. Does **not** claim path/hash are locked.

---

## DoD vs production

| # | Observable | Verdict |
|---|------------|---------|
| 1 | Token exactly 64 hex; extra query keys rejected | **pass** `[inspected]` `TOKEN_HEX` `^…{64}$` with `/i` (still hex). `keys.length !== 1 \|\| keys[0] !== "token"`. Tests: 16-char now false (`:37`); `&x` false (`:38-41`); `g`×64 false (`:42-45`); `ab`×32 true |
| 2 | Non-loopback with 64-hex token + chrome path still errors | **pass** `[inspected]` planner returns `{error}` **before** `browserPath` is read (`:47-48`). Test `:48-53` is `evil.example` + `ab`.repeat(32) + Darwin Chrome path; `:54-58` is `https://127.0.0.1` + 64-hex + linux chrome. N3 folded |
| 3 | Win32 fallback is `cmd.exe` + `["/c","start","",url]` without `shell:true` | **pass** `[inspected]` plan omits `shell` (`:64-66`). Test `:92-94`. Spawn site (`:247-251`) has no `shell` key even if a future plan set it. N2/N4 win32 half folded |
| 4 | `openLoopbackPage(evil, {spawn})` does not call spawn; loopback + chrome path spawns `--app` | **pass** `[inspected]` error return is before `deps.spawn` is read. Test `:112-139`: evil + chrome path → `false`, `calls.length===0`; `LOOP` → `true`, `command` chrome, args include `--app=${LOOP}`, `shell` undefined. N1 folded (grep test remains as extra) |
| 5 | `isAllowedWsOrigin` unchanged; no Electron; no Swift WKWebView | **pass** `[inspected]` `lifecycle.ts:196-208` still `chrome-extension://…` ∪ exact `cmspark-tray://local` then `return false`. Tests still reject `:23403` / `:23401`. No `electron` in companion/`package.json` / no `require('electron')` under repo. Zero `WKWebView` in `companion/src/tray/*.swift`. SHA pin unchanged |

No named DoD item failed. Trust / WS Origin not weakened. Non-loopback cannot ride `--app=` just because Chrome exists.

---

## N1–N4 fold status (prior adversary)

| ID | Prior finding | This slice |
|----|---------------|------------|
| N1 | `openLoopbackPage` spawn untested; DoD 4/5 tests are source-grep | **folded** for spawn: inject test `:112-139`. Grep test `:106-110` kept (harmless). Overlay still grep (DoD 5) |
| N2 | Token length-only; Windows fallback `shell: true` | **folded** for the stated hole: 64 hex + sole query key; `cmd.exe` argv; spawn site does not honor `plan.shell`. Residual: path/hash still unrestricted — see N10 |
| N3 | Planner+chrome reject used `token=aa` | **folded**: 64-hex `evil.example` + https+64-hex+chrome |
| N4 | Fallback tests do not lock argv / `shell` | **folded for win32** (`cmd.exe`, empty title, `shell === undefined`). **linux still only `command==="xdg-open"`** (no `args`). Darwin already had `args === [LOOP]` |

---

## Attack results (must-falsify)

### 1. Can a non-loopback / extra-key / non-hex URL still spawn?

**No for the named evil class.** `[inspected]`

Order is load-bearing: `isSummonerLoopbackUrl` → `{error}` → `openLoopbackPage` returns `false` **before** `deps.spawn` is bound. Test proves the inject path.

Walked (WHATWG `hostname` / `searchParams`, not a Node run):

| URL | Predicate | Planner with chrome path | `openLoopbackPage` spawn |
|-----|-----------|--------------------------|--------------------------|
| `http://evil.example/?token=<64hex>` | false (host) | error | not called (test) |
| `https://127.0.0.1:23403/?token=<64hex>` | false (protocol) | error (test) | not called |
| `http://127.0.0.1:23403/` (no token) | false | error | not called |
| `http://127.0.0.1:23403/?token=` + 16 hex | false (len) | error | not called |
| `http://127.0.0.1:23403/?token=` + 64 `g` | false (charset) | error | not called |
| `http://127.0.0.1:23403/?token=<64hex>&x` | false (keys) | error | not called |
| `http://127.0.0.1:23403/?token=<64hex>&token=<64hex>` | false (`keys.length===2`) | error | not called |
| `file:///tmp/x.html` | false | error | not called |
| `http://[::1]/?token=<64hex>` | false (`::1`) | error | not called |
| `http://127.0.0.1.evil.com/?token=<64hex>` | false | error | not called |
| `http://127.0.0.1@evil.com/?token=<64hex>` | false (host `evil.com`) | error | not called |
| `http://0.0.0.0/?token=<64hex>` | false | error | not called |
| `javascript:` / `data:` / `chrome:` | false | error | not called |
| `http://127.0.0.1:23403/?token=<64hex>` | true | `--app` | spawn once (test) |

`--app=${url}` is a **single argv**. Extra keys cannot become a second Chrome flag. `new URL` + `protocol === "http:"` + hostname allowlist + sole `token` + hex64 is the SoT.

Production caller is `summonerWebPageUrl` → `http://127.0.0.1:${port}/?token=${crypto.randomBytes(32).toString("hex")}` — always one key, always 64 lowercase hex.

### 2. Does win32 fallback still return `shell: true`?

**No.** `[inspected]` Plan object has no `shell` property. Test `win.shell === undefined`. `openLoopbackPage` spawn options are `{detached, stdio, windowsHide}` only — the `a10ea4c` spread `...(plan.shell ? { shell: true } : {})` is gone. Re-adding `shell: true` on the **shared** spawn options would fail the linux `--app` inject (`calls[0].shell` undefined). Re-adding it only on the plan would **not** affect spawn unless the spread returns. Type still has `shell?: boolean` (N11).

Settings UI (`menu-bar-agent.ts:1173`) still `spawn("cmd", …, { shell: true })`. **Out of this gate.** Different URL builder, not `openLoopbackPage`.

### 3. Is token charset not hex?

**It is hex.** `[inspected]` `/^[0-9a-f]{64}$/i` — exactly 64, ASCII hex, A–F allowed via `/i`. Empty / short / `g` fail. URLSearchParams-decoded value is what is tested, so `%61`×64 still hex; `%26` / `+` / spaces fail.

JS `$` matches before a trailing newline. WHATWG URL parsing **strips** TAB/LF/CR from the input before parse, so a raw trailing `\n` on the string does not land in `searchParams`. Not a charset bypass.

### 4. Electron added?

**No.** `[inspected]` companion runtime deps still `systray2` / `ws` / `openai` / etc. No `electron` in any `package.json` name. `electron-to-chromium` remains a pre-existing extension lockfile browserslist transitive. No `BrowserWindow`.

### 5. Swift overlay grew a WKWebView?

**No WKWebView.** `[inspected]` `SummonerOverlay.swift` is still NSPanel / AppKit (`class` tokens: `SummonerController`, `NSPanel`). Grep `WKWebView` / `WebView2` under `companion/src/tray/*.swift` empty. SHA pin `77139e17…` unchanged from earlier #219 reviews → hashed tray binary not rebuilt for a WebView.

### 6. HTML `--app` window connecting companion WS with spoofed Origin?

**Page cannot.** `[inspected]` No `isAllowedWsOrigin` edit in the reconstructed slice. DevTools `new WebSocket("ws://127.0.0.1:23401")` would present `Origin: http://127.0.0.1:23403`, still rejected (`lifecycle.ts:207-208`). `--app` does not widen that allowlist. `summoner-web.test.ts:434-437` / `ws-origin.test.ts:19` still fail closed.

### 7. `--app=` / Windows `start` command injection via token / extra query?

**Closed on token and query.** `[inspected]` Extra `&…` is a second search key → predicate false → no spawn. Token cannot hold `&` / `|` and still match `TOKEN_HEX`.

**Not closed on path/hash, win32 tab degrade only.** `[inspected]` Pathname and `hash` are not checked. `http://127.0.0.1/&calc.exe?token=<64hex>` and `http://127.0.0.1/?token=<64hex>#&calc.exe` pass the predicate. App-window / darwin `open` / linux `xdg-open` pass that string as **one argv** (no cmd parse). Win32 fallback is `cmd.exe /c start "" <url>` **without** `shell:true`, but `cmd.exe` still parses `/c` metacharacters. Node’s Windows quoting typically quotes only whitespace/`"` — a spaceless `&` in path or fragment may remain unquoted on the CreateProcess command line. Production `summonerWebPageUrl` has path `/` and no hash, so this is **not** reachable from tray today. See N10. Not the prompt’s “evil URL” (non-loopback) class.

### 8. Confirm / Trust chrome via this slice?

**No.** `[inspected]` No HTML/SSE/ACL/router edits in the reconstructed slice.

---

## Blockers

**None.** Named REJECT triggers do not fire. DoD 1–5 hold on production source. Extra query keys and non-hex tokens never reach spawn. Win32 plan does not set `shell: true`. Spawn site does not pass `shell`. WS Origin not widened. Overlay cannot Allow/Deny. Electron not added. Swift has no WKWebView.

---

## Findings (non-blocking)

### Nits folded this slice

N1 spawn inject, N2 hex+no-`shell:true`, N3 64-hex chrome reject, N4 win32 argv/shell lock — see table above.

### Residual / new

**N4 remainder — linux fallback still does not lock argv.** `[inspected]` `summoner-shell-open.test.ts:82-86` asserts `command==="xdg-open"` only. Production is `args: [url]`. Darwin already `deepEqual`s args. Win32 now does. Cheap.

**N10 — pathname and hash are not in the gate; win32 `cmd.exe /c` still parses `&`/`|` if `openLoopbackPage` is reused.** `[inspected]` Predicate allows `http://127.0.0.1/<anything>?token=<64hex>#<anything>`. Dropping `shell: true` is necessary and not sufficient for the `start` builtin. Tray caller cannot produce this. Fail-closed reuse would be: pathname `""` or `"/"` and `u.hash === ""` (and/or refuse any URL whose serialized form contains cmd metacharacters).

**N11 — `SummonerShellPlan.shell?: boolean` is dead.** `[inspected]` `shell-open.ts:17`. No plan sets it; spawn ignores it. Invites a future `...(plan.shell ? { shell: true } : {})` regression that the linux `--app` inject would **not** catch unless the app-window plan also set `shell`.

**N12 — spawn inject does not exercise extra-keys or win32 fallback.** `[inspected]` DoD 4 test is evil host + linux `--app`. Extra keys are predicate-only. Win32 `cmd.exe` argv is planner-only. Shared spawn site currently cannot add `shell` without failing `:138`.

**N5–N9 carried (out of this DoD, still true at HEAD).** `[inspected]`

- **N5** Spawn failure silent; tray still toasts 已在浏览器打开 even when `openLoopbackPage` returns `false` (`menu-bar-agent.ts:1228-1229` ignores the boolean).
- **N6** `resolveSummonerBrowserPath` is `existsSync`, trusts PATH; win32 fallback is bare `cmd.exe` not `System32\cmd.exe`.
- **N7** `--app=` does not pin navigation after launch.
- **N8** Token still in the process list via `--app=http://…/?token=`.
- **N9** Notification copy still “浏览器”.

**N13 — spec P3 bullets lag the gate.** `[inspected]` status line names the nits; `:49-50` still say “with a token” and “`cmd start`”, not 64-hex / sole key / `cmd.exe` argv without shell.

Settings `shell: true` (`menu-bar-agent.ts:1173`) is **not** this slice. Do not treat as a DoD 3 fail.

---

## Trajectory

Slice matches the nits fold: hex-lock + sole query key, win32 `cmd.exe` argv without `shell: true`, spawn-injected `openLoopbackPage` so evil never reaches spawn, `--app` path unchanged, native WKWebView still deferred, Electron / Swift overlay not grown.

Not drive-by: reconstructed touch set is planner predicate + win32 plan + `openLoopbackPage` deps + spec status + one test file. `lifecycle.ts` / ACL / SSE allowlist / overlay lease / occupied upload look untouched.

TDD: DoD 1–4 are unit tests (planner + inject). DoD 5 is grep + Origin tests that pre-exist. Chrome / Swift binary / `cmd.exe /c` quoting not executed.

Dead path: `shell?: boolean` on the plan type (N11). Unsupported `platform` still `{error}` / `false`.

Honest labeling: comments, commit, spec status do **not** pretend this is WKWebView.

---

## Component (file:line)

| Gate | Location |
|------|----------|
| Hex token + sole query key | `companion/src/summoner/shell-open.ts:25,34-37` |
| Loopback host / http only | `companion/src/summoner/shell-open.ts:30-33` |
| `{error}` before `browserPath` | `companion/src/summoner/shell-open.ts:47-48` |
| `--app=` + window-size | `companion/src/summoner/shell-open.ts:51-56` |
| Win32 tab degrade (no shell) | `companion/src/summoner/shell-open.ts:64-66` |
| Spawn uses planner; no `shell` | `companion/src/summoner-web.ts:237-252` |
| Production URL | `companion/src/summoner-web.ts:166-168,267` |
| Tray still calls `openLoopbackPage` | `companion/src/menu-bar-agent.ts:1228` |
| WS Origin (untouched) | `companion/src/ws/lifecycle.ts:196-208` |
| Swift overlay (no WKWebView) | `companion/src/tray/SummonerOverlay.swift` (NSPanel) |
| Swift SHA pin (unchanged) | `companion/src/tray/swift-tray-bridge.ts:58` |
| Planner + spawn tests | `companion/tests/summoner-shell-open.test.ts` |
| Origin still rejects loopback HTTP | `companion/tests/summoner-web.test.ts:434-437` |

---

## ADR-020 / P1 watchlist

| ID | This commit |
|----|-------------|
| P1-1 god-mode / `config.set` | **not reachable** — open path only |
| P1-2 `originWs` | **not touched** |
| P1-3 evaluate | **not touched** |
| P1-4 shell | **not** `shell_exec`. Local `spawn` of Chrome/`open`/`xdg-open`/`cmd.exe start` with a planner-gated URL. **No** `shell: true` on this path. Residual cmd `/c` parse on reuse (N10) |
| Confirm dialects | none |
| Trust monotonicity | open gate **tightened** (hex + sole key); WS Origin unchanged; overlay still cannot write Trust B |
| Pack-first / new runtime | no |

---

## Capability vs production (short)

| Axis | Declared | Production |
|------|----------|------------|
| Surface | L0 HTML summon shell | same HTML, hosted in `--app` window or system tab `[inspected]` |
| L2-classes | none | no confirm chrome; Swift still no Allow/Deny |
| Compose | unchanged | no pack/ACL edits in reconstructed diff |
| Autonomy | same tool-loop | tray still `dispatchSummonerWeb` → existing `handleMessage` |
| Trust | monotonic | URL must be http loopback + **exactly one** `token=` 64-hex **before** spawn |
| Channel | loopback HTML + token; page never companion WS; open only 127.0.0.1\|localhost token URLs | planner enforces the open rule; `isAllowedWsOrigin` still rejects loopback HTTP |

---

VERDICT: APPROVE_WITH_NITS
