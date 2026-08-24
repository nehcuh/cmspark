# Pi re-review — PR #219 C-thin P3 open-gate nits (N1–N4)

> **Lane**: eval-engineering-gate stage 2 (confirm or reject independent adversary)
> **Role**: Pi — did **not** implement this. Do not rubber-stamp.
> **Date**: 2026-08-24
> **Repo**: `/Users/huchen/Projects/cmspark`
> **Branch**: `feat/steer-nextrun-overlay-hub`
> **Commit**: `10dc0c98841c18aa75899eb6a95b384a42909def` (`fix(summoner): hex-lock token URLs and drop Windows cmd shell`)
> **Parent**: `540b7c418892eb22383f8d81faf30a3e79b80092` (`docs(audit): C-thin app-window adversary + Pi APPROVE_WITH_NITS`)
> **PR**: #219 (OPEN) — T2, no auto-merge
> **Adversary**: `docs/audit/reviews/pr219-c-thin-opengate-nits-adversary-20260824.md` — **VERDICT: APPROVE_WITH_NITS** (read in full, not a summary)
> **Prior Pi**: `docs/audit/reviews/pr219-c-thin-appwindow-pi-20260824.md` — **APPROVE_WITH_NITS** on `a10ea4c` (N1–N4 this fold)
> **Spec P3**: `docs/superpowers/specs/2026-08-24-cross-platform-summon-shell-design.md`

HEAD matches claimed commit: `.git/HEAD` → `refs/heads/feat/steer-nextrun-overlay-hub` → `10dc0c98841c18aa75899eb6a95b384a42909def`. Branch reflog last line is `540b7c4188… 10dc0c9884… fix(summoner): hex-lock token URLs and drop Windows cmd shell`. `.git/COMMIT_EDITMSG` is the claimed subject + “Adversary N1–N4: token must be 64 hex and the only query key. Win32 fallback is cmd.exe argv (empty start title) without shell:true. openLoopbackPage is spawn-injected so evil URLs never reach spawn.” `[inspected]`

This Pi session had **no shell tool**. `git diff 540b7c4..10dc0c9` and `companion npm test` were **not executed**. Production files + tests were read at HEAD. Slice membership is reconstructed from COMMIT_EDITMSG + HEAD sources vs the `a10ea4c` Pi review (parent `540b7c4` is docs-only on that implementation), not a `git show` blob. Implementer-claimed `3458` / 0 fail remains `[assumed]`. “Untouched this commit” for `lifecycle.ts` / Swift / SHA pin is HEAD identity with prior #219 reviews + unchanged pin string, not a parent-tree hash.

Must-falsify (from the gate prompt): **evil URL can still spawn**, **token charset is not 64 hex**, **win32 fallback still `shell: true`**, **WS Origin widened**. Any one of those is REJECT. Adversary nits that are still true are carried, not re-litigated as blockers.

Named evil class (same as adversary REJECT triggers): non-loopback / extra query keys / non-hex never reach `spawn`. Path/hash on an otherwise-valid loopback URL is residual reuse (N10), not that class.

---

## Confirmation-order status

1. MACHINE — implementer claimed 3458 / 0 fail this session; Pi did not re-run.
2. Independent adversary — **APPROVE_WITH_NITS** (full report read).
3. Pi — independently walk the predicate (64 hex + sole `token` key) **before** `browserPath` / spawn; confirm `openLoopbackPage(evil, {spawn})` returns `false` without calling spawn; confirm win32 plan is `cmd.exe` argv with no `shell`; confirm spawn site does not pass `shell`; confirm `isAllowedWsOrigin` still two predicates + `return false`.

**Blast**: T2 L0 overlay Surface. Open-gate nits on the existing P3 `--app` / tab host. Overlay must not Allow/Deny. Companion WS Origin must stay `chrome-extension://` ∪ `cmspark-tray://local`. Open gate must not spawn a non-loopback / extra-key / non-hex URL.

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

Axes fit `[inspected]`: nits fold on the existing P3 open gate. Not a new runtime, not a new L2 confirm dialect, not Pack-first Side Panel chrome, not a Trust write. HTML is still `fetch` + EventSource (no `WebSocket` / `ws://` in `summoner-web.ts`); CSP still `connect-src 'self'`; `isAllowedWsOrigin` body at HEAD is still two allow-predicates then `return false`.

The gate is **stricter** than `a10ea4c`: token is exactly 64 ASCII hex and the **only** query key; win32 tab degrade no longer sets `shell: true`; `openLoopbackPage` never spreads `plan.shell`. Trust is not loosened.

---

## MACHINE

| Check | Result | Evidence |
|-------|--------|----------|
| HEAD is `10dc0c9` | yes | `.git/refs/heads/feat/steer-nextrun-overlay-hub` `[inspected]` |
| Parent is `540b7c4` | yes | branch reflog last line `[inspected]` |
| companion `npm test` 3458 / 0 fail | **not re-run** | implementer claim `[assumed]` |
| DoD 1 token 64 hex + extra keys rejected | yes | `shell-open.ts:25,34-37`; test `:37-45` `[inspected]` |
| DoD 2 non-loopback + 64-hex + chrome path errors | yes | planner test `:48-59` uses `"ab".repeat(32)` `[inspected]` |
| DoD 3 win32 `cmd.exe` + `["/c","start","",url]` without `shell:true` | yes | `shell-open.ts:64-66`; test `:88-94`; spawn site has no `shell` key `[inspected]` |
| DoD 4 spawn-injected: evil no spawn, loopback `--app` | yes | `summoner-web.ts:237-252`; test `:112-139` `[inspected]` |
| DoD 5 `isAllowedWsOrigin` / no Electron / no Swift WKWebView | yes at HEAD | `lifecycle.ts:196-208`; companion `package.json` deps; `**/*.swift` grep empty `[inspected]` |

Agree with adversary: do not treat the spawn mock as a Chrome launch. `child_process.spawn` is injected; Chrome is never launched; Swift is grep + SHA-pin identity, not a rebuild. Origin is body-identity with prior #219 reviews, not a parent-tree hash this session.

---

## Must-falsify 1 — can an evil URL still spawn?

**No for the named class.** `[inspected]`

SoT is `isSummonerLoopbackUrl` → `planSummonerShellOpen` `{error}` → `openLoopbackPage` returns `false` **before** `deps.spawn` is bound (`shell-open.ts:27-48`; `summoner-web.ts:237-245`). Order is load-bearing: `browserPath` is not read on `{error}`; the inject test proves spawn is not called.

Predicate (hand-walked, not executed):

1. non-string / empty → false
2. `new URL` throw → false
3. `protocol !== "http:"` → false (`https:`, `file:`, `javascript:`, `data:`, `chrome:` fail here)
4. `hostname.toLowerCase()` must be exact `127.0.0.1` **or** `localhost` — not `host` (port stripped)
5. search keys: exactly one, and it is `"token"` (`keys.length !== 1 \|\| keys[0] !== "token"`)
6. `searchParams.get("token")` matches `/^[0-9a-f]{64}$/i`

Independent URL walks (WHATWG `hostname` / `searchParams`, not a Node run):

| URL | Predicate | Planner + chrome path | `openLoopbackPage` spawn |
|-----|-----------|----------------------|--------------------------|
| `http://127.0.0.1:23403/?token=` + 64 hex | true | `--app` | spawn once (test `:127-138`) |
| `http://localhost:23403/?token=` + 64 hex | true | `--app` | would spawn (predicate test `:32`) |
| `http://evil.example/?token=` + 64 hex | false (host) | error (test `:48-53`) | **not called** (test `:118-126`) |
| `https://127.0.0.1:23403/?token=` + 64 hex | false (protocol) | error (test `:54-58`) | not called |
| `http://127.0.0.1:23403/` (no token) | false | error | not called |
| `http://127.0.0.1:23403/?token=` + 16 hex | false (len) | error | not called (test `:37`) |
| `http://127.0.0.1:23403/?token=` + 64 `g` | false (charset) | error | not called (test `:42-45`) |
| `http://127.0.0.1:23403/?token=` + 64 hex + `&x` | false (keys) | error | not called (predicate `:38-41`) |
| `?token=<64hex>&token=<64hex>` | false (`keys.length===2`) | error | not called |
| `file:///tmp/x.html` | false | error | not called |
| `http://[::1]/?token=` + 64 hex | false (`::1`) | error | not called |
| `http://127.0.0.1.evil.com/?token=` + 64 hex | false | error | not called |
| `http://127.0.0.1@evil.com/?token=` + 64 hex | false (host `evil.com`) | error | not called |
| `http://0.0.0.0/?token=` + 64 hex | false | error | not called |
| `javascript:` / `data:` / `chrome:` | false | error | not called |

`--app=${url}` is a **single argv**. Extra keys cannot become a second Chrome flag. `new URL` + `protocol === "http:"` + hostname allowlist + sole `token` + hex64 is the SoT.

Production caller is only `openLoopbackPage(summonerWebPageUrl(port, token))` (`menu-bar-agent.ts:1228`) → `http://127.0.0.1:${port}/?token=${crypto.randomBytes(32).toString("hex")}` (`summoner-web.ts:166-168,267`). Always one key, always 64 lowercase hex. Grep: no other `openLoopbackPage` call site.

N3 from `a10ea4c` is folded: planner+chrome reject now uses 64-hex `evil.example` **and** https+64-hex+linux chrome (`:48-59`). Combined with the inject test, DoD 2/4 hold as tests, not only as source-grep.

---

## Must-falsify 2 — is the token charset not 64 hex?

**It is hex, exactly 64.** `[inspected]`

`TOKEN_HEX = /^[0-9a-f]{64}$/i` (`shell-open.ts:25`). `TOKEN_LEN_MIN` is gone (grep: only `TOKEN_HEX` under companion). `{64}` is exact — 16-char (`"aa".repeat(8)`, test `:37`) is now false; that string would have passed the `a10ea4c` `>= 16` length check.

- charset: ASCII hex; `/i` allows `A–F`. Still hex. Production `toString("hex")` is lowercase.
- empty / short / `g`×64 fail.
- URLSearchParams-decoded value is what is tested, so a raw `&` cannot hide in `get("token")` (it splits keys — extra-key reject). `%61`×64 still hex; `%26` / `+` / spaces fail.

JS `$` matches before a **single trailing `\n`**. WHATWG URL parsing strips TAB/LF/CR from the **raw input** before parse, so a raw trailing newline does not land in `searchParams`. Encoded `%0a` after 64 hex **would** decode to `\n` and satisfy `TOKEN_HEX` via that `$` quirk. Spawn uses the **original** `url` string (`--app=${url}` / win32 argv), which still contains `%0a` (three characters), not a metacharacter. Production token never has `%0a`. Not a charset bypass of the named evil class. Adjacent to adversary’s `$` note, not a miss of the must-falsify list.

---

## Must-falsify 3 — does win32 fallback still return `shell: true`?

**No.** `[inspected]`

Win32 plan (`shell-open.ts:64-66`):

```
return { kind: "browser-tab", command: "cmd.exe", args: ["/c", "start", "", url] }
```

No `shell` property. Test `:92-94` locks `command==="cmd.exe"`, `args` deepEqual including empty title, `win.shell === undefined`. Empty title is load-bearing (`start` otherwise treats the first quoted arg as a window title).

Spawn site (`summoner-web.ts:247-251`) is `{ detached, stdio: "ignore", windowsHide }` only. Grep `shell: true` / `plan.shell` under `companion/src/summoner*` and `summoner-web.ts`: empty. The `a10ea4c` spread `...(plan.shell ? { shell: true } : {})` is gone. Re-adding `shell: true` on the **shared** spawn options would fail the linux `--app` inject (`calls[0].shell` undefined, test `:138`). Re-adding it only on the plan would **not** affect spawn unless the spread returns. Type still has `shell?: boolean` (N11).

Settings UI (`menu-bar-agent.ts:1173`) still `spawn("cmd", …, { shell: true })`. **Out of this gate.** Different URL builder (`/settings?token=`), not `openLoopbackPage`. Do not treat as a DoD 3 fail.

---

## Must-falsify 4 — was WS Origin widened?

**No.** `[inspected]` `isAllowedWsOrigin` (`lifecycle.ts:196-208`) still:

1. non-string → false
2. `chrome-extension://[A-Za-z0-9_-]+` → true
3. exact `cmspark-tray://local` → true
4. `return false`

`http://127.0.0.1:23403` / `http://localhost:23403` remain false (`summoner-web.test.ts:434-437`). `ws-origin.test.ts:19` still rejects `:23401`. `--app` does not change the browser-set Origin: it is still `http://127.0.0.1:${port}`. Browser cannot forge `cmspark-tray://local`.

Page still has no `WebSocket` / `ws://` (grep of `summoner-web.ts` empty). CSP `connect-src 'self'` (`:355-356`) is a second gate. Parent-tree empty diff of `lifecycle.ts` was **not** hashed this session; body identity with prior #219 reviews + tests still fail-closed is enough for this must-falsify.

Electron: no `"electron"` in any `package.json`. Companion runtime deps still `systray2` / `ws` / `openai` / etc. (`package.json:30-46`). No `require('electron')` under this review’s grep of the spawn path.

Swift: `SummonerOverlay.swift:9-13` is still `NSPanel` / “not an L2 gate surface.” Grep `WKWebView` under `**/*.swift`: empty. `SWIFT_TRAY_SHA256` = `77139e17…291f` (`swift-tray-bridge.ts:58`) — same pin as earlier #219 reviews.

---

## DoD vs production (confirm or refute)

| # | Observable | Adversary | Pi |
|---|------------|-----------|----|
| 1 | Token exactly 64 hex; extra query keys rejected | pass | **confirm** `TOKEN_HEX` `^…{64}$` with `/i` (still hex). `keys.length !== 1 \|\| keys[0] !== "token"`. Tests: 16-char now false; `&x` false; `g`×64 false; `ab`×32 true |
| 2 | Non-loopback with 64-hex token + chrome path still errors | pass | **confirm** planner returns `{error}` **before** `browserPath` is read (`:47-48`). Tests use 64-hex `evil.example` and https+64-hex+chrome. N3 folded |
| 3 | Win32 fallback is `cmd.exe` + `["/c","start","",url]` without `shell:true` | pass | **confirm** plan omits `shell`. Test locks argv + `shell === undefined`. Spawn site has no `shell` key even if a future plan set it |
| 4 | `openLoopbackPage(evil, {spawn})` does not call spawn; loopback + chrome path spawns `--app` | pass | **confirm** error return is before `deps.spawn` is read. Test `:112-139`: evil + chrome path → `false`, `calls.length===0`; `LOOP` → `true`, `--app=${LOOP}`, `shell` undefined. Grep test `:106-110` kept (harmless) |
| 5 | `isAllowedWsOrigin` unchanged; no Electron; no Swift WKWebView | pass at HEAD | **confirm at HEAD**, not independently hashed vs parent. Origin body + tests. Zero `WKWebView`. SHA pin unchanged. No Electron dep |

No named DoD item failed. Trust / WS Origin not weakened. Non-loopback cannot ride `--app=` just because Chrome exists.

---

## Attack results (same threat list as adversary)

### 1. Non-loopback / extra-key / non-hex still spawn?

**Confirm adversary: no.** Predicate before spawn. Inject test covers evil host. Extra keys / non-hex are predicate tests; planner uses the same function, so they never reach spawn either. Spawn-inject does not **exercise** extra-keys or win32 (N12) — coverage gap, not a bypass.

### 2. Win32 `shell: true`?

**Confirm adversary: no** on this path. Plan has no `shell`. Spawn options have no `shell`. Settings `shell: true` is a different caller.

### 3. Token charset not hex?

**Confirm adversary: it is hex.** Exact 64. `/i` is still hex.

### 4. Electron added?

**Confirm adversary: no.**

### 5. Swift overlay grew a WKWebView?

**Confirm adversary: no WKWebView.** SHA pin identity + source grep. Empty Swift diff not `git show`'d.

### 6. HTML `--app` window connecting companion WS with spoofed Origin?

**Confirm adversary: page cannot.** No `WebSocket`; CSP `connect-src 'self'`; Origin allowlist unchanged at HEAD.

### 7. `--app=` / Windows `start` command injection via token / extra query?

**Confirm adversary: closed on token and query.** Extra `&…` is a second search key → no spawn. Token cannot hold `&` / `|` and still match `TOKEN_HEX`. `--app=${url}` is one argv.

**Confirm adversary: not closed on path/hash, win32 tab degrade only.** Pathname and `hash` are not checked. `http://127.0.0.1/&calc.exe?token=<64hex>` and `http://127.0.0.1/?token=<64hex>#&calc.exe` pass the predicate. App-window / darwin `open` / linux `xdg-open` pass that string as **one argv**. Win32 fallback is `cmd.exe /c start "" <url>` **without** `shell:true`, but `cmd.exe` still parses `/c` metacharacters. Node’s Windows quoting typically quotes whitespace/`"` — a spaceless `&` in path or fragment may remain unquoted on the CreateProcess command line. Production `summonerWebPageUrl` has path `/` and no hash, so this is **not** reachable from tray today. N10. Not the prompt’s “evil URL” (non-loopback / extra-key / non-hex) class.

Independent walk of `#&calc.exe`: `u.hash` is not consulted; `searchParams` is only the query. Predicate true. Tray cannot produce a hash. Not promoted.

### 8. Confirm / Trust chrome via this slice?

**Confirm adversary: no at HEAD.** No HTML/SSE/ACL/router edits visible in the reconstructed slice. Overlay still capture-only.

---

## Adversary nits — confirm or drop

| ID | Adversary | Pi |
|----|-----------|----|
| N1 spawn inject | folded; grep kept | **confirm folded.** Test `:112-139` is a real inject. Grep `:106-110` is redundant, not harmful. Overlay DoD 5 remains grep |
| N2 hex + no `shell:true` | folded for the stated hole | **confirm folded** for token charset + win32 `shell:true`. Residual path/hash is N10, not a re-open of N2’s extra-key `&calc.exe` (that URL now fails `keys.length`) |
| N3 planner+chrome used `token=aa` | folded | **confirm folded.** Both chrome-reject cases are 64-hex |
| N4 win32 argv/shell lock | folded for win32; linux remainder | **confirm.** Win32 now `deepEqual`s args + `shell === undefined`. **linux still only `command==="xdg-open"`** (`:82-86`) — production is `args: [url]`. Darwin already had `args === [LOOP]`. Keep the remainder |
| N10 path/hash not gated; win32 `cmd /c` still parses `&`/`\|` on reuse | new residual | **keep.** Independently walked. Fail-closed reuse: pathname `""` or `"/"` and `u.hash === ""` (and/or refuse serialized forms with cmd metacharacters). Not a current tray hole. Not a REJECT trigger |
| N11 `SummonerShellPlan.shell?: boolean` dead | new | **keep.** `shell-open.ts:17`. No plan sets it; spawn ignores it. Invites a future spread that the linux `--app` inject would **not** catch unless the app-window plan also set `shell` |
| N12 spawn inject does not exercise extra-keys or win32 | new | **keep.** Test completeness. Extra keys are predicate-only; win32 argv is planner-only. Shared spawn site currently cannot add `shell` without failing `:138` |
| N5–N9 carried | still true at HEAD | **keep.** N5: tray ignores the new boolean (`menu-bar-agent.ts:1228-1229`) and still does not listen for spawn `error`. N6: `existsSync` + PATH; win32 fallback is bare `cmd.exe` not `System32\cmd.exe`. N7: `--app=` does not pin navigation. N8: token in process list. N9: toast still “浏览器” |
| N13 spec P3 bullets lag the gate | new | **keep.** Status line names the nits (`:3`); `:49-50` still say “with a token” and “`cmd start`”, not 64-hex / sole key / `cmd.exe` argv without shell |

No nits promoted to blockers. No adversary miss on DoD/Trust that would flip the verdict.

Pi extra (non-blocking, not a miss of the adversary’s must-falsify list): encoded `%0a` after 64 hex satisfies `TOKEN_HEX` because JS `$` allows a trailing newline; spawn still receives the original percent-encoded string. Production hex never has it. Fold into N10 if anyone tightens the regex (`{64}$` → more defensive: length check + `/^[0-9a-f]+$/i` without `$`, or reject `%` in the raw query).

Settings `shell: true` (`menu-bar-agent.ts:1173`) is **not** this slice.

---

## Trajectory / Component

Slice matches the nits fold: hex-lock + sole query key, win32 `cmd.exe` argv without `shell: true`, spawn-injected `openLoopbackPage` so evil never reaches spawn, `--app` path unchanged, native WKWebView still deferred, Electron / Swift overlay not grown.

Not drive-by at HEAD: planner predicate + win32 plan + `openLoopbackPage` deps + spec status + one test file. `lifecycle.ts` / ACL / SSE allowlist / overlay lease / occupied upload look untouched (`[assumed]` vs parent tree).

TDD: DoD 1–4 are unit tests (planner + inject). DoD 5 is grep + Origin tests that pre-exist. Chrome / Swift binary / `cmd.exe /c` quoting not executed.

Dead path: `shell?: boolean` on the plan type (N11). Unsupported `platform` still `{error}` / `false`.

Honest labeling: comments, commit, spec status do **not** pretend this is WKWebView. Spec bullets lag the tightened gate (N13).

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
| WS Origin (untouched at HEAD) | `companion/src/ws/lifecycle.ts:196-208` |
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
| Compose | unchanged | no pack/ACL edits visible at HEAD |
| Autonomy | same tool-loop | tray still `dispatchSummonerWeb` → existing `handleMessage` |
| Trust | monotonic | URL must be http loopback + **exactly one** `token=` 64-hex **before** spawn |
| Channel | loopback HTML + token; page never companion WS; open only 127.0.0.1\|localhost token URLs | planner enforces the open rule; `isAllowedWsOrigin` still rejects loopback HTTP |

---

Adversary did not miss a DoD/Trust hole. Independent walk of the open gate (evil host / extra keys / non-hex never spawn), 64-hex lock, win32 argv without `shell:true`, and Origin allowlist agrees. Residuals are reuse/test/spec, not current bypasses.

VERDICT: APPROVE_WITH_NITS
