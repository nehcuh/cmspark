# COMPAT/PLATFORM Lane Review

**Repo:** `/Users/huchen/Projects/cmspark`  
**Range:** `2e7cf2f..79d7420`  
**Diff:** `/tmp/cmspark-review-s41/code.diff`  
**Lane:** COMPAT / PLATFORM  
**Date:** 2026-08-04  

## Scope inspected (sources)

| Area | Path(s) |
|------|---------|
| shell_exec argv / windowsHide | `companion/src/capability/shell.ts`, `companion/tests/shell-progress-windowsHide.test.ts` |
| skill install paths | `companion/src/skills/skill-install.ts`, `companion/tests/skill-install.test.ts` |
| Downloads localization | `chrome-extension/src/background/downloads-find.ts`, `chrome-extension/tests/downloads-find.test.ts` |
| Shell UI cards | `chrome-extension/src/sidepanel/utils/shell-card-utils.ts`, `ChatView.tsx` |
| FocusBand MV3 | `FocusBand.tsx`, `focus-band-priority.ts`, `running-tools.ts` |
| Settings / probe | `SettingsSlideout.tsx`, `companion/src/llm/connection-test.ts`, `providers/headers.ts`, `anthropic-convert.ts` |
| Lockfile / deps | Diff has **no** `package-lock.json` / native dep changes |

---

## Findings

### C1 — win32 argv gate correctly rejects `.bat`/`.cmd` / bare PATH names
- **Severity:** (positive / informational)
- **Status:** CLEAR
- **Where:** `companion/src/capability/shell.ts:174-186`, `shell.ts:264-270`
- **Detail:** `shouldUseArgvSpawn` on `win32` requires `/\.(exe|com)$/i` on argv[0]. Bare names (`npm`, `echo`), `.bat`, `.cmd` stay `shell:true`. Non-win32 allows parseable argv except a shell-builtin denylist. Covered by `companion/tests/shell-progress-windowsHide.test.ts:58-71`.
- **Evidence level:** `[inspected]` + tests present

### C2 — `windowsHide: true` on both spawn paths
- **Severity:** (positive)
- **Status:** CLEAR
- **Where:** `shell.ts:96-107` (`shellSpawnOptions`), `shell.ts:216-227` (`shellSpawnArgvOptions`)
- **Detail:** Both legacy `shell:true` and P1b `shell:false` set `windowsHide: true` (harmless no-op on darwin/linux). Addresses win32 console flash for approved one-shots.

### C3 — Windows path backslashes preserved in argv parser
- **Severity:** (positive)
- **Status:** CLEAR
- **Where:** `shell.ts:114-115`, `134-144`; test B2 at `shell-progress-windowsHide.test.ts:38-42`
- **Detail:** Inside quotes, only `\"`, `\'`, `\\` are escapes — `C:\Users\...` is not mangled into control chars. Unquoted tokens keep raw backslashes. Space-containing paths without quotes fail parse into wrong argv[0] → no `.exe` match → safe fallback to `shell:true`.

### C4 — skill_install error/docs advertise `%TEMP%` / `%USERPROFILE%` but expander does not expand them
- **Severity:** MEDIUM
- **Status:** WATCH
- **Where:**
  - `companion/src/skills/skill-install.ts:34-40` (`expandUserPath` — only `~` / `~/` / `~\`)
  - `skill-install.ts:141`, `177` (errors: “Downloads, %TEMP%, or ~/.cmspark-agent”)
  - `skill-install.ts:111`, `254` (hint / tool description with `%USERPROFILE%`)
- **Detail:** On Windows, LLMs (and users) often emit `%USERPROFILE%\Downloads\foo.zip` or `%TEMP%\…` after reading tool copy. Those strings are not expanded; `realpathSync` fails → “zip not found” / allowlist miss. Chrome `downloads_find` paths are absolute and fine; the gap is synthetic Windows env paths.
- **Impact:** Windows skill install friction; false Trust denials.
- **Fix (nits):** Expand `%VAR%` via `process.env` (or document “absolute path only” and stop advertising `%TEMP%` / `%USERPROFILE%` in machine-facing errors). Prefer absolute paths from `downloads_find`.

### C5 — Downloads / skill source allowlist is EN + zh-CN segment only
- **Severity:** MEDIUM
- **Status:** WATCH
- **Where:**
  - `chrome-extension/src/background/downloads-find.ts:55-76` (`isPathUnderDownloads`: `downloads` / `下载`)
  - `companion/src/skills/skill-install.ts:48-54` (same segment names)
- **Detail:** Path seps normalized (`\` → `/`) — good for win32. Tests cover `C:\Users\…\Downloads\…` and `/…/下载/…`. Missing:
  - Other OS locales (e.g. `Téléchargements`, `Descargas`, `ダウンロード`)
  - Chrome download dir relocated to a path **without** those folder name segments (e.g. `D:\files\pkg.zip`)
- **Impact:** Fail-closed empty `downloads_find` / blocked `skill_install` on non-EN/zh or custom dirs. Mitigated partly by `__downloadsRoots` inject for tests only (not wired to real Chrome known_folder).
- **Fix (optional):** Prefer Chrome `downloads.search` item paths + optional known Downloads folder API / user-configured root; expand segment list if multi-locale is a product goal.

### C6 — win32 argv mode does not expand `%VAR%` (semantic gap vs `shell:true`)
- **Severity:** LOW–MEDIUM
- **Status:** WATCH
- **Where:** `shell.ts:167-186`, `264-270`
- **Detail:** Commands like `C:\Tools\bin.exe --out %CD%\a.txt` parse as argv and spawn with `shell:false` → `%CD%` stays literal. Same command under `shell:true` (cmd) would expand. Only applies when prog ends in `.exe`/`.com`.
- **Impact:** Subtle Windows-only behavior change for PE binaries with env-style args.
- **Fix:** Document in tool schema; or reject unquoted `%…%` from argv mode (force shell path).

### C7 — Anthropic / OpenAI connection probe: no proxy / custom CA story
- **Severity:** MEDIUM
- **Status:** WATCH
- **Where:** `companion/src/llm/connection-test.ts:141-150`, `185-194` (`fetch` + `AbortSignal.timeout`)
- **Detail:** Probe uses global `fetch` with no explicit proxy dispatcher. Node undici **does not** reliably honor `HTTP_PROXY`/`HTTPS_PROXY` the way some corporate Windows/macOS stacks expect. Custom enterprise MITM CAs need `NODE_EXTRA_CA_CERTS` (undocumented here). Protocol URL joining (`resolveAnthropicMessagesUrl`) and L7 first-party header deny are platform-neutral and sound.
- **Impact:** “连接失败” on proxied enterprise networks while browser works.
- **Note:** Same pattern as other companion LLM calls — not a new isolation bug, but this change surfaces it in Settings “测试连接”.

### C8 — Extension FocusBand / ChatView shell cards vs MV3
- **Severity:** LOW (nits)
- **Status:** CLEAR
- **Where:**
  - `FocusBand.tsx:60-67`, `117-130`, `197-318` (`maxHeight` / `overflow: hidden`, ≤80px budget)
  - `focus-band-priority.ts:65-75` (secondaryTools only when no abort secondary)
  - `shell-card-utils.ts` (pure extractors; CRLF → LF at `:59-60`)
  - `ChatView.tsx` shell card (inline styles, `stopPropagation` on expand buttons)
- **Detail:** No `eval`, no remote script, no new extension permissions, no offscreen/sandbox needs. Side panel React + CSP-safe inline styles. Height machine keeps secondary tools under confirm/fleet without burying 急停. Font stack `Menlo` is mac-biased; `ui-monospace` still works on Windows.
- **Nit:** Secondary tools line under fleet can still feel tight on high-DPI Windows font metrics — overflow is clipped, not broken.

### C9 — Settings UI platform assumptions
- **Severity:** LOW
- **Status:** CLEAR
- **Where:** `SettingsSlideout.tsx` (protocol select, Anthropic `/messages` hints, Coding Plan compat copy)
- **Detail:** Copy is OS-neutral (no “open Terminal.app” / PowerShell-only paths). Correctly warns official Anthropic hosts must not use gateway compat headers. skill_install user-facing hint in companion mentions both `~/.cmspark-agent` and `%USERPROFILE%\.cmspark-agent` (good intent; see C4 for expansion gap).

### C10 — npm lockfile / native dependency platform matrix
- **Severity:** —
- **Status:** CLEAR
- **Detail:** Diff introduces no lockfile or optional native module changes (`canvas`, etc.). No new cross-platform install risk in this range.

### C11 — downloads_find Windows/GitHub robustness
- **Severity:** (positive)
- **Status:** CLEAR
- **Where:** `downloads-find.ts:162-248`
- **Detail:** Narrow `filenameRegex` then broad recent-complete fallback; dropped `exists:true` from query (exists filtered client-side). Aligns with documented Windows/Chrome RE2 empty-hit behavior. Conflict hint (DL-4) is locale-Chinese for agent guidance — fine for product language; not an OS bug.

### C12 — POSIX argv builtin list incomplete (echo/true/pwd often OK via /bin)
- **Severity:** LOW
- **Status:** WATCH
- **Where:** `shell.ts:187-213`
- **Detail:** Denylist covers `cd`/`export`/`source`/… but not pure-shell-only edge builtins. On macOS/Linux most common tools exist as `/bin/*`. Residual risk of confusing ENOENT for rare builtins — acceptable; falls outside win32 gate.

### C13 — skill_install data/tmp prefix check is case-sensitive string compare
- **Severity:** LOW
- **Status:** WATCH
- **Where:** `skill-install.ts:56-67`
- **Detail:** `norm.startsWith(dataNorm + path.sep)` is case-sensitive. After dual `realpathSync` casing usually matches on Windows NTFS; residual mismatch could deny install under data dir. Downloads segment path uses `.toLowerCase()` (safer). Optional: `path` equality under win32 via lowercased compare.

---

## Summary table

| ID | Topic | Severity | Status |
|----|--------|----------|--------|
| C1 | win32 .exe/.com-only argv | — | CLEAR |
| C2 | windowsHide both spawns | — | CLEAR |
| C3 | Win path `\` in parser | — | CLEAR |
| C4 | `%TEMP%`/`%USERPROFILE%` not expanded | MEDIUM | WATCH |
| C5 | Downloads segments EN/zh only | MEDIUM | WATCH |
| C6 | `%VAR%` under argv spawn | LOW–MED | WATCH |
| C7 | probe fetch / proxy / CA | MEDIUM | WATCH |
| C8 | MV3 FocusBand/shell cards | LOW | CLEAR |
| C9 | Settings copy | LOW | CLEAR |
| C10 | lockfile/native deps | — | CLEAR |
| C11 | downloads broad fallback | — | CLEAR |
| C12 | POSIX builtins | LOW | WATCH |
| C13 | win32 path case prefix | LOW | WATCH |

**Lane status:** **WATCH** (no BLOCK; no CRITICAL platform regression)

---

## Final recommendation

### **APPROVE_WITH_NITS**

**Rationale:** Core platform-sensitive work for this range is solid: win32 argv is correctly restricted to `.exe`/`.com`, `windowsHide` is applied on both spawn modes, Downloads path filtering normalizes separators and accepts `下载`, and extension shell/FocusBand UI stays within MV3 constraints without new native deps. Remaining issues are operational nits (Windows env expansion messaging, multi-locale/custom Downloads roots, enterprise proxy probe) that should be tracked but do not justify REQUEST_CHANGES for this merge.

**Suggested nits (non-blocking):**
1. Expand or stop advertising `%TEMP%` / `%USERPROFILE%` in `skill_install` errors (C4).
2. Tool-schema note: win32 argv does not expand `%VAR%` (C6).
3. Document probe proxy/CA limitations or align with undici `EnvHttpProxyAgent` later (C7).
4. Optional: more Downloads folder name segments or user-configured root (C5).

---

*Evidence tags: `[inspected]` source+diff; tests cited where present. No live win32/darwin matrix execution in this lane pass.*
