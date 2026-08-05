# Lane: Compat/Platform — S45 main pull multi-adversarial

**Range:** `4a2d02f..474df7e`  
**Tip:** live workspace at review time (aligned with patch tip)  
**Lane:** COMPAT / PLATFORM (Windows / macOS / Linux + Chrome MV3 + packaging)  
**Date:** 2026-08-05  
**Diff artifact:** `docs/audit/reviews/s45-main-pull-diff-20260805.patch`  
**Review host:** Windows (`win32`)  
**Production themes in range:** #122 M3' floors + RunBusy · #123 process-path + absolute osascript · #124 fleet RunBusy active thread · S44 file upload diagnostics · **0.4.0 release** (Qwen VL packaging, not TinyClick/ORT)

---

## Verdict

### **APPROVE_WITH_NITS**

No platform **BLOCK**: PATH harden + absolute `osascript` address a real packaged-app production failure (`spawn ENOTDIR`); Windows essentials (System32 / delimiter) are present; Linux is not crashed by macOS-only paths; packaging parity for Qwen worker vs removed ORT/TinyClick is consistent across `package.sh`, `build-windows-exe.ps1`, `release.yml`, and `test-package-gates.sh`. Residuals are version-source drift, cross-version fleet field coupling, MV3 large-upload memory, and incomplete Windows unit coverage — not merge-blocking for a post-ship review.

---

## Scope inspected (sources)

| Area | Path(s) |
|------|---------|
| PATH harden | `companion/src/process-path.ts`, `companion/tests/process-path.test.ts` |
| Consumers | `index.ts`, `server.ts` (startServer), `capability/shell.ts`, `apps/cli-exec.ts`, `mcp/transport.ts` |
| Absolute osascript | `process-path.ts` `OSASCRIPT_BIN`, `platform.ts`, `menu-bar-agent.ts`, `obsidian/folder-picker.ts`, `server.ts` `osascript_eval`, residual `computer/darwin-adapters.ts` |
| RunBusy / fleet | `chrome-extension/src/sidepanel/utils/thread-busy.ts`, components, `orchestrator/fleet.ts`, tests |
| Upload diagnostics | `chrome-extension/src/background/index.ts`, `ws-client.ts`, `sidepanel/App.tsx`, `useWebSocket.ts`, `companion/src/message-router.ts` |
| Packaging 0.4.0 | `scripts/package.sh`, `scripts/build-windows-exe.ps1`, `scripts/installer.nsi`, `.github/workflows/release.yml`, `scripts/tests/test-package-gates.sh` |
| Version surface | `companion/package.json`, `chrome-extension/package.json`, `plasmo.config.ts`, outbound MCP version string |

**Evidence tags:** `[inspected]` = read source / patch; `[assumed]` = not re-executed full suite on this lane pass.

---

## Findings

### C1 — PATH harden drops file-in-PATH and restores essentials (CLEAR · primary #123)

- **Severity:** — (positive)
- **Where:** `companion/src/process-path.ts:43-133` (`splitPathEnv`, `keepOnlyDirectories`, `hardenPath`, `essentialPathCandidates`)
- **Detail:** Documented production failure (PATH = path to `cmspark-agent.js` file) causes Node `spawn ENOTDIR` when walking PATH. Harden drops non-directories, keeps first-wins user order, appends essentials only if missing.
- **Windows:** `essentialPathCandidates` uses `path.delimiter` (`;`), `SystemRoot`/`SYSTEMROOT` → `System32`, root, Wbem, PowerShell `v1.0`, `%APPDATA%\npm`, `%ProgramFiles%\nodejs` (`process-path.ts:76-85`).
- **Unix:** `/usr/bin`, `/bin`, sbin variants, Homebrew (`/opt/homebrew/bin`), `~/.local/bin` (`:86-99`).
- **Apply sites:** `index.ts:28` (earliest CLI/tray entry), `server.ts:5705-5712` (server start + warn log).
- **Evidence:** `[inspected]` + tests `process-path.test.ts:18-109`

### C2 — Absolute `OSASCRIPT_BIN` for macOS spawns (CLEAR)

- **Severity:** — (positive)
- **Where:** `process-path.ts:22` `export const OSASCRIPT_BIN = "/usr/bin/osascript"`
- **Call sites switched:** `platform.ts` MacOSChromeOpener (`:129-150`), `menu-bar-agent.ts` notify (`:46`), `obsidian/folder-picker.ts` pick folder/file (`:46`, `:116`), `server.ts` `osascript_eval` execFile (`:3789` area).
- **Non-darwin safety:** Tool is omitted from LLM catalog via `shouldExposeOsascript` / `shouldL2GateOsascript` (`bridge/tool-definitions.ts:91-120`); gate returns `OSASCRIPT_MACOS_ONLY_ERROR` before spawn. Constant existence on Windows/Linux is inert unless a bug calls it.
- **Residual NIT:** `computer/darwin-adapters.ts:934` still hardcodes `"/usr/bin/osascript"` instead of `OSASCRIPT_BIN` — behaviorally correct, DRY only.
- **Evidence:** `[inspected]`; darwin repro test skipped off-mac (`process-path.test.ts:118-145`)

### C3 — shell / CLI / MCP PATH consumers (CLEAR with residuals)

| Consumer | Behavior | Notes |
|----------|----------|-------|
| `capability/shell.ts:25-32` | `env.PATH = hardenPath({ pathEnv: env.PATH })` after process.env + user_env | Good for `shell_exec` under corrupted GUI PATH |
| `apps/cli-exec.ts:73-83` | Reads `PATH`/`Path`, hardens, deletes dual `Path` key | Correct win32 dual-key hygiene; cross-platform unit tests skip FS when `platform !== process.platform` |
| `mcp/transport.ts:39-41` | `keepOnlyDirectories(splitPathEnv(existing))` then candidate prepend | Drops file segments; still prepends well-known dirs (nvm/fnm/Volta/Scoop/Choco) without requiring they exist (missing dirs ≠ ENOTDIR) |

- **Residual C3a (LOW):** Per-server `config.env.PATH` still overrides `buildSpawnPath()` **verbatim** without harden (`mcp/transport.ts:152-156`). Malformed MCP PATH can reintroduce ENOTDIR for that server only. Pre-existing contract; not new in spirit.
- **Residual C3b (LOW):** Harden does **not** restore `PATHEXT` if stripped. Bare names under `shell:true`/`cmd` can mis-resolve on win32. Essentials restore System32; PATHEXT usually survives from `process.env` spread.
- **Residual C3c (NIT):** `seen` set is case-sensitive — `C:\Windows\System32` vs `c:\windows\system32` may both appear (harmless duplication on NTFS).
- **Evidence:** `[inspected]`

### C4 — Windows PATH empty / Path key / long paths (MOSTLY CLEAR)

- **Empty PATH:** `hardenPath` falls through to essentials; `cli-exec` has `defaultCliPathFallback` if harden returns empty (`cli-exec.ts:50-58`, `:80`).
- **Path vs PATH:** `hardenPath` reads `process.env.PATH ?? process.env.Path`; `applyHardenedProcessPath` writes `process.env.PATH`. On Node win32 env is case-insensitive — OK. Linux dual keys are rare.
- **Long paths / MAX_PATH:** No special `\\?\` handling; `statSync` fails → segment dropped (fail-safe). Extremely long PATH strings after append are not capped — **NIT / theoretical** CreateProcess env-block pressure only.
- **Evidence:** `[inspected]`

### C5 — macOS absolute path + TCC / Homebrew (CLEAR)

- Absolute `/usr/bin/osascript` does **not** change Apple Events TCC identity relative to bare `osascript` (same binary). Automation grants remain per-app (Chrome / System Events) as before.
- Homebrew node: essentials **append** missing `/opt/homebrew/bin` without stealing first-wins order when user PATH already has valid nvm/homebrew dirs (`process-path.ts:106-107` comment + logic).
- Packaged `.app` corruption case is the design center — absolute bin + process-wide harden both address it.
- **Evidence:** `[inspected]`

### C6 — Linux: PATH harden works; no osascript path crashes (CLEAR)

- Unix essentials applied when `platform !== "win32"`.
- `osascript_eval` not exposed; folder-picker / chrome-opener use zenity / xdg-open on Linux (`folder-picker` platform branch, `platform.ts` LinuxChromeOpener).
- `OSASCRIPT_BIN` unused on Linux code paths → no accidental spawn of missing absolute path.
- **Evidence:** `[inspected]`

### C7 — Fleet / RunBusy active-thread scoping (#124) (CLEAR · product correct)

- **Where:** `thread-busy.ts:123-292` (`resolveFleetScope`, `buildScopedRunBusyInput`, `resolveOpenIntentsForScope`); companion `orchestrator/fleet.ts` adds `open_intents_by_run`.
- **Behavior:** Normal single-thread chat gets `scope.kind === "none"` → zero fleet signals → no foreign 「子任务还在跑」. Stamped `orchestrator_run_id` scopes workers/locks/intents/llm_active.
- **UI strings:** Platform-neutral Chinese copy in `composerBusyPlaceholder` (`thread-busy.ts:49-73`); no OS-specific claims.
- **Tests:** `chrome-extension/tests/thread-busy.test.ts` covers foreign residual worker + same-run busy.
- **Evidence:** `[inspected]`

### C8 — Cross-version extension ↔ companion busy protocol (MEDIUM · WATCH)

- **Severity:** MEDIUM
- **Where:** Fleet field `open_intents_by_run` optional on extension (`types.ts`); `resolveOpenIntentsForScope` for `run` uses `openIntentsByRun?.[runId] ?? 0` only (`thread-busy.ts:204-205`).
- **Matrix:**

| Extension | Companion | Effect |
|-----------|-----------|--------|
| **Old** | **New** | Extra field ignored; old process-wide `open_intent_count` sticky false RunBusy **returns** (bug #124 unfixed until ext update) |
| **New** | **Old** | Field missing → open intents always 0 under run scope; **under-busy** for board intents only (locks/workers/llm still scoped if present) |
| **New** | **New** | Honest per-run intents |

- **Impact:** 0.4.0 release notes should require **paired** extension + companion upgrade for multi-agent RunBusy honesty. Not a crash / security hole.
- **`chat.reasoning`:** Additive; old extension ignores unknown types; new without field still works.
- **Evidence:** `[inspected]`

### C9 — File upload diagnostics + MV3 SW lifetime (CLEAR with MEDIUM residual)

- **Where:** SW `file.upload` / `diag.file_upload` (`background/index.ts:452-609`); panel busy free on `lastError` / `!ok` (`App.tsx:570-616`); companion `file.upload_status` / `_error` / `uploaded` (`message-router.ts` + `useWebSocket.ts:1153-1217`).
- **Positives:**
  - No base64 content in logs — names/types/lengths only.
  - Async handler keeps `return true` and always `sendResponse` after hostname resolve/fail.
  - SW send failure and companion parse errors both clear `isProcessing` / `threadBusy` (fixes sticky 「思考中」).
  - `over_companion_10mb` flags client estimate vs companion `MAX_WS_MESSAGE_SIZE` 10MB (`server.ts:104`).
- **C9a (MEDIUM · WATCH):** `JSON.stringify(payload)` + `TextEncoder` on full base64 files inside the SW for `json_bytes` (`index.ts:562-567`) **doubles peak memory** near the 10MB WS cap. On Windows Chrome, SW OOM / kill → port disconnect → panel shows send error (busy cleared). Diagnostics themselves may not reach companion if WS died.
- **C9b (LOW):** `diag.file_upload` after response is best-effort; if SW already dead, panel `catch` swallows — acceptable.
- **Evidence:** `[inspected]`

### C10 — 0.4.0 packaging: Qwen VL not TinyClick/ORT (CLEAR · parity)

| Artifact | Change |
|----------|--------|
| `scripts/package.sh` | Removes `stage_onnxruntime` / tinyclick bundle+stage; **hard-gate** `qwen-vl-worker.py` (dist or src); versions from `companion/package.json` |
| `scripts/build-windows-exe.ps1` | Version `0.4.0`; Qwen worker hard-fail; ORT staging removed |
| `scripts/installer.nsi` | `PRODUCT_VERSION "0.4.0"` |
| `.github/workflows/release.yml` | Asserts `qwen-vl-worker.py` on macOS-arm64 + windows-x64 zips; release body documents on-demand weights |
| `scripts/tests/test-package-gates.sh` | Static/dynamic gates flipped TinyClick/ORT → Qwen |

- **Windows vs mac parity:** Both ship `qwen-vl-worker.py` next to agent; neither ships ORT natives; weights under `~/.cmspark-agent/` (Windows `%USERPROFILE%\.cmspark-agent\`) on demand — honest for SEA/zip size.
- **Runtime Python:** Locate layer needs Python on host PATH; UX copy already branches Mac brew vs Windows python.org (`model-state-messages.ts` python-missing) — outside this range’s packaging change but platform-correct.
- **Evidence:** `[inspected]` patch + live scripts

### C11 — Version bump consistency (MEDIUM residual · WATCH)

| Source | Version |
|--------|---------|
| `companion/package.json` | **0.4.0** (drives `package.sh` zip name) |
| `chrome-extension/package.json` | **0.4.0** |
| `scripts/build-windows-exe.ps1` `$Version` | **0.4.0** (hardcoded — dual source vs package.json) |
| `scripts/installer.nsi` | **0.4.0** (hardcoded) |
| `outbound-mcp/stdio-server.ts` MCP name version | **0.4.0** |
| `chrome-extension/plasmo.config.ts` | **0.3.0** ← **stale** |
| `build-windows-exe.ps1` header comments | still mention `v0.2.0` output names (docs only) |

- **Impact:** If Plasmo prefers `plasmo.config` version for MV3 `manifest.version`, Chrome “扩展程序” may show **0.3.0** while companion CLI prints **0.4.0** — support confusion on all platforms. Confirm build output; fix config to 0.4.0 or delete redundant version key.
- **NIT:** Prefer single source: ps1/nsi read `package.json` like `package.sh`.
- **Evidence:** `[inspected]`

### C12 — User-facing strings vs platform behavior (CLEAR for this range)

- RunBusy / composer placeholders: Chinese, OS-neutral.
- Upload status/error strings: Chinese, format-agnostic (docx/pdf mentioned as examples — correct).
- `osascript_eval` error explicitly “macOS-only” with cross-platform alternative (`tool-definitions.ts:88-89`).
- No new strings claiming Windows tray native confirm dialog (prior S42 C5 residual **not** regressed by this range).
- **Evidence:** `[inspected]`

### C13 — Unit test platform coverage gap (LOW · WATCH)

- `process-path.test.ts` exercises unix delimiters + live `applyHardenedProcessPath` on host; soft-asserts System32 suffix for shell env on any OS (`:173-175`).
- **Missing:** explicit `platform: "win32"`, `delimiter: ";"`, file-in-PATH `C:\…\agent.js`, essential `System32` inject mock — would lock Windows behavior on Linux CI.
- **Evidence:** `[inspected]`

---

## Positives

1. **Root-cause fix for packaged PATH corruption** — file-in-PATH → ENOTDIR is a real .app class of bug; harden + absolute osascript is the right dual approach.
2. **Process-wide earliest harden** at `index.ts` import + again at `startServer` — covers tray, daemon, and server entry.
3. **CLI env dual-key cleanup** (`Path` deleted after unify) — correct for Windows CreateProcess child env.
4. **shell_exec / MCP / CLI** all get file-segment drop; shell uses full `hardenPath` essentials.
5. **Fleet RunBusy scoping** pure functions + tests prevent cross-thread UI lies without platform branches.
6. **Upload pipeline** closes the “stuck 思考中” failure mode with typed status/error + SW send failure path.
7. **Release packaging story coherent:** Qwen worker fail-closed; ORT/TinyClick no longer hard-required; CI asserts match scripts; zip sizes improve especially on Windows.
8. **Linux/Windows not broken by macOS absolute path** — gates and openers are platform-branched.

---

## Platform matrix notes

| Topic | Windows | macOS | Linux |
|-------|---------|-------|-------|
| PATH harden essentials | System32, Wbem, PS, npm, nodejs | /usr/bin, Homebrew, ~/.local | /usr/bin, /bin, ~/.local |
| File-in-PATH ENOTDIR | Dropped | Dropped (prod .app case) | Dropped |
| osascript | N/A (tool hidden) | Absolute `/usr/bin/osascript` | N/A |
| Folder picker | PowerShell | Absolute osascript | zenity |
| Chrome open | cmd start / tasklist | osascript activate | xdg-open |
| Package hard-gate | host-scripts-win + qwen-vl-worker.py | host/tray/scpt + qwen | qwen (full package); systray2 |
| ORT/TinyClick ship | **Removed** | **Removed** | **Removed** |
| Qwen weights | On demand under data dir | On demand | On demand |
| RunBusy fleet field | Protocol same | same | same |
| MV3 SW upload diag | Highest memory pressure risk | same SW model | same (if used) |
| Version surface risk | plasmo 0.3.0 + ps1 dual source | same extension | same |

---

## Residual watch list

| ID | Topic | Sev | Action |
|----|--------|-----|--------|
| C8 | New ext + old companion under-busy intents; old ext + new companion sticky RunBusy | MED | Ship paired 0.4.0; release note “upgrade both” |
| C9a | SW JSON.stringify full upload for size | MED | Optional: estimate from b64 lengths only (already have `content_b64_len`) |
| C11 | `plasmo.config.ts` still 0.3.0; ps1/nsi hardcoded version | MED | Align to 0.4.0 / single source |
| C3a | MCP `config.env.PATH` unhardened | LOW | Harden or document |
| C3b | PATHEXT not restored | LOW | Append default PATHEXT if empty on win32 |
| C3c | PATH dedupe case-sensitive | NIT | Optional case-fold on win32 |
| C13 | No dedicated win32 unit cases for hardenPath | LOW | Add `;` + System32 mock tests |
| C2 residual | darwin-adapters hardcode vs OSASCRIPT_BIN | NIT | Import constant |

*(Prior S42 WATCH items — tray dialog honesty on systray2, Downloads locale — unchanged by this range.)*

---

## Summary table

| ID | Topic | Severity | Status |
|----|--------|----------|--------|
| C1 | PATH harden core | — | CLEAR |
| C2 | Absolute OSASCRIPT_BIN | — | CLEAR |
| C3 | shell/cli/mcp consumers | LOW residual | CLEAR / WATCH |
| C4 | Empty Path / long path | NIT | CLEAR |
| C5 | macOS TCC / Homebrew order | — | CLEAR |
| C6 | Linux no osascript crash | — | CLEAR |
| C7 | RunBusy active-thread scope | — | CLEAR |
| C8 | Cross-version fleet protocol | MEDIUM | WATCH |
| C9 | Upload diag + SW lifetime | MEDIUM residual | CLEAR / WATCH |
| C10 | Qwen packaging parity | — | CLEAR |
| C11 | Version consistency | MEDIUM | WATCH |
| C12 | Platform-wrong UX strings | — | CLEAR |
| C13 | Win32 unit gap | LOW | WATCH |

---

## Recommendation summary

### **APPROVE_WITH_NITS** · lane status **WATCH**

**Rationale:** S45 platform-sensitive work is sound. The #123 PATH/osascript fix is correctly designed for GUI and packaged launches across OSes; #124 RunBusy scoping is pure and well-tested; S44 upload diagnostics close a real UX hang without logging secrets; 0.4.0 packaging consistently replaces TinyClick/ORT hard-gates with Qwen worker staging.

**Non-blocking nits before or right after release marketing:**
1. Bump `chrome-extension/plasmo.config.ts` version to **0.4.0** (or drop the key) and verify built `manifest.json` (C11).
2. Release note: **upgrade Companion and Chrome extension together** for RunBusy + `open_intents_by_run` (C8).
3. Prefer size estimate without full `JSON.stringify` of base64 payloads in the SW (C9a).
4. Optional: win32-focused `hardenPath` unit tests + PATHEXT default (C13 / C3b).

---

*Evidence: `[inspected]` live tip sources + `docs/audit/reviews/s45-main-pull-diff-20260805.patch`. Full companion/extension suite not re-executed in this lane pass (`[assumed]` other CI/gates if green).*
