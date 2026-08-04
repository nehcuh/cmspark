# Compat/Platform Lane
**Range:** 79d7420..d4c4ebf  
**Tip:** d4c4ebf  
**Lane:** COMPAT / PLATFORM (Windows-first adversarial)  
**Date:** 2026-08-04  
**Diff artifact:** `docs/audit/reviews/s42-main-pull-diff-20260804.patch`  
**Machine:** Windows (`win32`) review host  

## Scope inspected (sources)

| Area | Path(s) |
|------|---------|
| shell_exec argv / windowsHide | `companion/src/capability/shell.ts`, `companion/tests/shell-progress-windowsHide.test.ts` |
| skill install paths | `companion/src/skills/skill-install.ts`, `skill-engine.ts`, `companion/tests/skill-install.test.ts` |
| outbound MCP stdio / HTTP | `outbound-mcp/stdio-server.ts`, `http-client.ts`, `companion-http.ts`, `server.ts` bind + `pickAuthenticatedClientWs` |
| SPA scroll / X CSP | `chrome-extension/src/background/spa-scroll-expr.ts`, `browser-bridge.ts` scroll path, `tests/spa-scroll-expr.test.ts` |
| MV3 message port | `chrome-extension/src/background/index.ts`, Settings unattended ACK |
| tray vs extension dispatch | `server.ts` L8 fan-out, `tray/systray2-bridge.ts`, `tray-adapter.ts` |
| loopback HTTP | `server.ts` `httpServer.listen(port, "127.0.0.1")` |

**Production themes in range (from patch):** SPA scroll CDP-first · MV3 port hygiene · shell `FOO=1`/`~` fail-closed · skill_install Trust packaging (%VAR%, dest honesty, zip budgets, L2 bind) · outbound MCP P0c + L8/L9 · `config.test` empty `base_url` fix.

---

## Status / Recommendation

| Field | Value |
|-------|--------|
| **Status** | **WATCH** |
| **Recommendation** | **APPROVE_WITH_NITS** |

No platform BLOCK: no win32 regression that breaks spawn, path allowlist, loopback binding, or extension CDP dispatch. Residual nits are Windows tray-confirm honesty, locale Downloads, and argv `%VAR%` semantics.

---

## Findings

### C1 — `windowsHide: true` residual on both shell spawn paths (CLEAR)
- **Severity:** — (positive)
- **Where:** `companion/src/capability/shell.ts:96-107` (`shellSpawnOptions`), `shell.ts:222-233` (`shellSpawnArgvOptions`)
- **Detail:** Both legacy `shell:true` and P1b `shell:false` still set `windowsHide: true`. Harmless no-op on darwin/linux. Addresses win32 empty-console flash for approved one-shots.
- **Evidence:** `[inspected]` + tests at `shell-progress-windowsHide.test.ts:18-22`, `:60-64`

### C2 — win32 argv gate remains `.exe`/`.com` only (CLEAR)
- **Severity:** — (positive)
- **Where:** `shell.ts:180-219` (`shouldUseArgvSpawn`)
- **Detail:** On `win32`, bare names (`npm`), `.bat`, `.cmd` stay `shell:true` (Node EINVAL/ENOENT). PE/COM only for argv. Tests lock B1/N1b matrix.
- **Evidence:** `[inspected]` + `shell-progress-windowsHide.test.ts:66-79`

### C3 — S41 C4 closed: `expandUserPath` expands Windows `%VAR%` (CLEAR)
- **Severity:** — (fix of prior WATCH)
- **Where:** `companion/src/skills/skill-install.ts:42-58`
- **Detail:** `%USERPROFILE%` / `%TEMP%` / other `%NAME%` expand via `process.env` (case-tolerant). `~` / `~/` / `~\` still map to `os.homedir()`. Tool errors no longer advertise `%TEMP%` while only expanding `~` alone.
- **Evidence:** `[inspected]` + `skill-install.test.ts:152-159`

### C4 — S41 P0: `FOO=1` / unquoted `~` stay shell:true (CLEAR)
- **Severity:** — (positive)
- **Where:** `shell.ts:163-168`, tests `shell-progress-windowsHide.test.ts:52-58`
- **Detail:** Env-prefix tokens and unquoted `~`/`~/`/`~\` return `null` from `tryParseSimpleArgv` → spawn with shell. Avoids ENOENT under `shell:false` on POSIX and literal `~` paths. Windows PE argv path unaffected for plain `C:\Tools\a.exe …`.

### C5 — L8 “tray dialog” copy is macOS-Swift-true, Windows/Linux false (MEDIUM · WATCH)
- **Severity:** MEDIUM
- **Status:** WATCH
- **Where:**
  - `companion/src/server.ts:1599-1613` (`trayEligible = !!tray && !winL2NonceChallenge`)
  - `companion/src/tray/systray2-bridge.ts:170-173` (`showConfirmDialog(): Promise<never>`)
  - `companion/src/tray/tray-adapter.ts:158-169` (win32 → `systray2`)
  - `companion-http.ts:254-258` error text: “approve via system tray dialog…”
- **Detail:** On Windows (and non-Swift Linux), tray backend is **systray2**, which intentionally **never resolves** confirm dialogs so `Promise.race` falls through to Side Panel WS. Outbound L8 still marks `trayEligible` whenever *any* tray adapter exists, logs `tray: true`, and tells MCP clients to use the tray dialog. Real UX on this machine is: **node-notifier toast + Side Panel fan-out only** — no native confirm window.
- **Impact:** Coding agents / users on Windows without an open Side Panel see 45s timeout + misleading “tray dialog” guidance. Fail-closed is correct; **copy and `trayEligible` are platform-dishonest**.
- **Fix (nits):**
  1. `trayEligible` only when backend implements real confirm (Swift), **or** systray2 returns immediate `{approved:false, reason:"no_dialog"}` so race does not hold a never-settling promise.
  2. Platform-branch OUTBOUND_CONFIRM message: Windows → “open Side Panel / click notification path”; macOS Swift → tray dialog OK.

### C6 — win32 argv does not expand `%VAR%` (LOW–MED residual · WATCH)
- **Severity:** LOW–MEDIUM
- **Where:** `shell.ts:117-169`, `264-276`
- **Detail:** `$VAR` / `${…}` rejected for argv mode; **`%CD%` / `%USERPROFILE%` not rejected**. When prog ends in `.exe`/`.com`, spawn is `shell:false` → env-style args stay literal (cmd would expand under `shell:true`).
- **Impact:** Subtle Windows-only semantic split for PE binaries with `%…%` args.
- **Fix:** Document in tool schema; or reject unquoted `%…%` from argv mode (force shell path).

### C7 — Downloads / skill source allowlist still EN + zh-CN only (MEDIUM residual · WATCH)
- **Severity:** MEDIUM
- **Where:** `skill-install.ts:65-87`; extension `downloads-find.ts` (unchanged in spirit)
- **Detail:** Segments `downloads` / `下载` after `\`→`/` lowercasing — good win32 seps. Still missing other locales / Chrome download dir relocated without those folder names. Temp + `getConfigDir()` remain OK fallbacks for skill_install.
- **Impact:** Fail-closed empty `downloads_find` / blocked zip on non-EN/zh or custom dirs.

### C8 — Companion HTTP / outbound bind is loopback-only (CLEAR)
- **Severity:** — (positive)
- **Where:** `server.ts:5682-5683` `httpServer.listen(port, "127.0.0.1")`; `http-client.ts:34` host default `127.0.0.1`; stdio log `stdio-server.ts:201-203`
- **Detail:** Healthz + `/outbound-mcp/v1/*` share loopback HTTP. Stdio MCP posts Bearer `ws_secret` to same host. No `0.0.0.0` bind in this range.
- **Nit:** IPv6-only clients using `::1` will not hit a v4-only listener — acceptable for local product; document if needed.

### C9 — Outbound dispatch prefers Extension WS over tray (CLEAR · critical on Windows)
- **Severity:** — (positive)
- **Where:** `server.ts:188-207` (`pickAuthenticatedClientWs`), `ensureOutboundToolRunnerWired`
- **Detail:** Explicit comment: tray authenticates but does **not** handle `tool.execute`. Prefer `chrome-extension://` origin; tray only as last resort. Prevents 15s timeouts when only tray is paired — especially relevant on Windows where tray cannot CDP.
- **Evidence:** `[inspected]`

### C10 — SPA scroll CDP-first for X/Twitter CSP (CLEAR)
- **Severity:** — (positive)
- **Where:** `spa-scroll-expr.ts` (pure numeric builder); `browser-bridge.ts` scroll: Runtime.evaluate → mouseWheel → PageDown → scripting last
- **Detail:**
  - Expression embeds only coerced numbers (`Number(v)||0`) — no user string injection.
  - Prefers X selectors (`primaryColumn`, `role=main`, Timeline aria).
  - `windowsVirtualKeyCode` / `nativeVirtualKeyCode` 34 for PageDown — OS-neutral CDP.
  - Scripting MAIN is last resort (often blocked on x.com).
- **Evidence:** `[inspected]` + `spa-scroll-expr.test.ts` (no `${` interpolation)

### C11 — MV3 “message port closed” hygiene (CLEAR)
- **Severity:** — (positive)
- **Where:** `chrome-extension/src/background/index.ts` outer try/catch + always-`sendResponse` on computer.model.* and default; Settings unattended ACK handles `lastError` / `message port closed`
- **Detail:** Platform-neutral fix for Chrome MV3 SW lifecycle (Windows Chrome same as others). Stops silent channel close when SW cold or unknown message type.

### C12 — Zip extract path containment uses case-sensitive `startsWith` (LOW · WATCH)
- **Severity:** LOW
- **Where:** `skill-engine.ts:876-887`
- **Detail:** After normalize, containment is `resolvedPath.startsWith(normalizedDest + path.sep)`. NTFS case-insensitivity residual: rare casing mismatch could false-positive as traversal (fail-closed) or, theoretically, bypass if dest casing differs from resolved — dual `path.resolve` usually matches. Optional win32 lowercased compare.

### C13 — `importSkillFromPath` sensitive-root denylist is POSIX-only (LOW · WATCH)
- **Severity:** LOW
- **Where:** `skill-engine.ts:970-978` (`/`, `/etc`, `/System`, …)
- **Detail:** Panel import path does not block `C:\Windows`, `C:\Windows\System32`, etc. LLM `skill_install` still constrained by Downloads/tmp/data allowlist (`skill-install.ts:65-87`). Residual is UI panel import, not new in spirit; Windows users of panel import get weaker “system path” refusal than macOS/Linux.

### C14 — PowerShell `$env:TEMP` not expanded in skill paths (LOW · WATCH)
- **Severity:** LOW
- **Where:** `skill-install.ts:42-58`
- **Detail:** `%TEMP%` works; `$env:TEMP\…` does not. Agents that emit PowerShell env syntax after Windows tooltips may still fail realpath. Prefer absolute paths from `downloads_find`.

### C15 — Shell / skill_install residual case prefix for data dir (LOW · residual)
- **Severity:** LOW
- **Where:** `skill-install.ts:72-76` (`norm.startsWith(dataNorm + path.sep)`)
- **Detail:** Same as S41 C13: case-sensitive after dual `realpathSync`. Usually OK on NTFS after realpath.

### C16 — npm lockfile / native deps (CLEAR)
- **Detail:** Range does not introduce new optional native modules for the outbound/scroll paths reviewed. Outbound uses existing `@modelcontextprotocol/sdk` + `node-notifier` (optional notify).

---

## Solid

1. **win32 shell matrix:** `windowsHide` both paths; `.exe`/`.com`-only argv; quote-safe backslashes; `FOO=1`/`~` fail-closed.
2. **skill_install Windows paths:** `%VAR%` expansion + Downloads/`下载`/tmpdir/data allowlist + honest `dest_path`/`name` + zip extract budgets.
3. **Loopback trust boundary:** HTTP + WS share `127.0.0.1`; outbound stdio → Bearer loopback only; not default-on (`mcp-outbound` explicit).
4. **Tray vs extension:** Dispatch peer prefers Extension; avoids binding CDP to tray on Windows.
5. **SPA scroll / CSP:** CDP-first pure expression; safe for X/Twitter; multi-signal fallback (wheel, PageDown, scripting last).
6. **MV3 port:** Always answer `sendResponse` — kills Windows Chrome “message port closed” flakiness on settings/computer.model paths.
7. **config.test empty base_url:** `nonBlank` merge — Coding Plan preset no longer clobbers stored URL (platform-neutral UX correctness).

---

## Residual

| ID | Topic | Sev | Action |
|----|--------|-----|--------|
| C5 | L8 tray dialog honesty on win32/systray2 | MED | Branch `trayEligible` / error copy by backend capability |
| C6 | `%VAR%` under argv spawn | L–M | Schema note or reject unquoted `%…%` |
| C7 | Downloads locale / custom root | MED | Known-folder or user root (product) |
| C12 | Zip path case on NTFS | LOW | Optional case-fold compare on win32 |
| C13 | Panel import POSIX-only system roots | LOW | Add Windows sensitive roots if panel is first-class |
| C14 | `$env:VAR` not expanded | LOW | Doc: absolute path / `%VAR%` only |
| C15 | Data-dir prefix case | LOW | Lowercase compare on win32 |

---

## Summary table

| ID | Topic | Severity | Status |
|----|--------|----------|--------|
| C1 | windowsHide both spawns | — | CLEAR |
| C2 | win32 .exe/.com-only argv | — | CLEAR |
| C3 | %TEMP%/%USERPROFILE% expand | — | CLEAR (S41 C4 fixed) |
| C4 | FOO=1 / ~ fail-closed | — | CLEAR |
| C5 | tray dialog vs systray2 | MEDIUM | WATCH |
| C6 | %VAR% under argv | LOW–MED | WATCH |
| C7 | Downloads EN/zh only | MEDIUM | WATCH |
| C8 | 127.0.0.1 bind | — | CLEAR |
| C9 | Extension > tray dispatch | — | CLEAR |
| C10 | SPA scroll CDP-first | — | CLEAR |
| C11 | MV3 message port | — | CLEAR |
| C12 | zip startsWith case | LOW | WATCH |
| C13 | panel import system roots | LOW | WATCH |
| C14 | $env: not expanded | LOW | WATCH |
| C15 | data-dir case prefix | LOW | WATCH |
| C16 | native deps | — | CLEAR |

---

## Final recommendation

### **APPROVE_WITH_NITS** · lane status **WATCH**

**Rationale:** Platform-sensitive work in `79d7420..d4c4ebf` is sound on Windows: shell spawn hygiene, skill path allowlist + env expansion, loopback outbound, extension-preferred MCP dispatch, SPA CDP scroll for CSP pages, and MV3 port fixes. Highest residual is **L8 confirm messaging/eligibility assuming a Swift tray dialog that systray2 on Windows never provides** (fail-closed still holds via Side Panel + timeout). Not a merge blocker for non-default-on outbound; track before marketing “tray confirm on all platforms.”

**Suggested nits (non-blocking):**
1. Gate `trayEligible` / OUTBOUND_CONFIRM copy on real confirm-dialog capability (C5).
2. Tool-schema note: win32 argv does not expand `%VAR%` (C6).
3. Optional: Downloads multi-locale / known-folder root (C7).

---

*Evidence: `[inspected]` source + `s42-main-pull-diff-20260804.patch`. Tests cited where present. No full companion/extension suite re-executed in this lane pass (`[assumed]` CI green from other lanes if claimed).*
