# Adversary review — meeting stop hang + packaged MCP npx ENOENT

**Reviewer**: independent MCP/packaging/security skeptic (did not implement)  
**Batch**: `meeting-mcp-packaged-hang-20260821`  
**Base**: `50869a9` (`main`)  
**Diff**: `docs/audit/reviews/meeting-mcp-packaged-hang-diff-20260821.patch`  
**Blast**: T2 (L0 meeting UX + Compose mcp-server spawn env)  
**Date**: 2026-08-21

Focus of this lane: packaged node + nvm `npx` `Contents/lib` ENOENT, `dirHasNpx` / `buildSpawnPath` ordering, `buildMcpStdioEnv` `npm_config_prefix`, PATH verbatim override, Windows/SEA, `launch-companion.sh`, MCP env secret leak, codesign if writing `Contents/lib`.

---

## Capability declaration (checked)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (stdio spawn PATH + npm_config_prefix)
Autonomy:     single
Trust:        无新确认门；MCP stdio env 仍走 allowlist（不 dump process.env / user_env）
Channel:      community
```

Axes fit. MCP is **Composition**, not a “中层 Agent”. No new L2 tool, confirm family, god-mode, or primary Side Panel chrome.

---

## Verdict in one paragraph

The two incident classes have real, inspectable fixes: meeting stop no longer waits forever on a missing `voice.stt.end` ACK, and MCP stdio no longer **prepends** an unpaired packaged `Contents/Resources` node ahead of nvm’s `npx` pair. `npm_config_prefix` is pinned under the data dir on the MCP child env (the path that actually spawns `npx`). I did **not** find a Trust regression or a codesign write into the `.app`. Remaining holes are launch-path overclaim (DMG does not run `launch-companion.sh`), PATH-verbatim + leftover-PATH ordering, Windows launcher parity, and a few tests that cannot fail the way the implementer described. None of those falsify the incident fixes themselves.

---

## 1. Findings

### BLOCKER

None.

I tried to turn the PATH-verbatim bypass, the DMG launch-script miss, and the leftover-PATH ordering into blockers. They do not break the **reproduced incident** (`PATH=Resources:nvm-bin` + default filesystem `npx` with no `config.env.PATH`). Standard nvm is in the candidate HEAD; MCP children get `npm_config_prefix` from `buildMcpStdioEnv` even when the `.app` never sources `launch-companion.sh`. See NITs.

---

### NIT-1 — Claim 4 overstates `launch-companion.sh` as the next-DMG fix

**Evidence**

- Product `.app` entry is Mach-O `Contents/MacOS/CMspark` (`scripts/macos/Info.plist:7-8`, `scripts/create-dmg.sh:79-86`).
- Tray spawn is `host.swift:568-572`: `/usr/bin/arch -arm64 <Resources/node> <Resources/cmspark-agent.js> tray` with `proc.environment = ProcessInfo.processInfo.environment`. **No** `npm_config_prefix`.
- `scripts/launch-companion.sh:8-11` does export prefix, but `create-dmg.sh` only copies staging (including that script) into `Contents/Resources/`. It is **not** `CFBundleExecutable`.
- Live `/Applications/CMspark.app/Contents/Resources/launch-companion.sh` is still the 2-line unpatched script (`exec "${DIR}/node" ...` only). Matches implementer “10:00 build is not patched”.
- `scripts/launchd/com.cmspark.companion.plist:55-60` EnvironmentVariables = `NODE_ENV=production` only.
- `companion/launch.bat` / Windows zip path: no `npm_config_prefix`.

**Inference**

Zip/linux users who exec `launch-companion.sh` get process-level prefix. **DMG double-click does not.** MCP is still saved by `buildMcpStdioEnv` (`transport.ts:227-239`), which is inside `cmspark-agent.js`. Package-gates grepping `launch-companion.sh` for the string `npm_config_prefix` does **not** prove the next DMG’s Aqua launch is patched.

**Ask**: if defense-in-depth at process env is desired, set prefix in `host.swift` (and Windows launchers). Do not document `launch-companion.sh` as the DMG mechanism.

---

### NIT-2 — Unpaired Resources is “last in HEAD”, not last on PATH

**Evidence** — `companion/src/mcp/transport.ts:153-172`

Unpaired `nodeDir` is pushed onto `candidates`, then **all candidates become HEAD**, then leftover `process.env.PATH` segments (not already in candidates) are appended.

So for incident `PATH=Resources:<nvm-bin>`:

- nvm dirs from `~/.nvm/versions/node/*/bin` **are** candidates (`transport.ts:119-135`) → they precede Resources. **Incident layout is fixed.**
- A custom npx dir that is **only** on existing PATH (asdf/mise/fnm-macos default, a non-`NVM_DIR` install) ends up **after** Resources.

`dirHasNpx` is only applied to `execPath`’s directory (`:75-78`, `:153-156`). Homebrew `/opt/homebrew/bin` is always HEAD without an npx-pair check (`:79-80`).

**Inference**

Claim “unpaired bundled node dir is not first ahead of an npx pair” is true for **well-known** pairs (nvm default, brew, Program Files\nodejs). It is false for an npx pair that only lives on leftover PATH. Escape hatch is still `config.env.PATH` verbatim + TROUBLESHOOTING (`docs/TROUBLESHOOTING.md:73`).

True last-resort would append unpaired `nodeDir` **after** leftover PATH, not into HEAD.

---

### NIT-3 — `config.env.PATH` verbatim can still put Resources first; prefix is the only remaining save; combo untested

**Evidence**

- `transport.ts:227`: `env.PATH = configEnv?.PATH || buildSpawnPath()`
- `companion/tests/mcp.test.ts:401-418` **requires** verbatim PATH (roadmap 5c). Intentionally not merged.
- Prefix is still applied unless `config.env.npm_config_prefix` is set (`transport.ts:230-239`).
- `p0-deep-diagnosis-batch.test.ts:24-27` tests `PATH: "/custom/bin"` but does **not** assert `npm_config_prefix` is still the data-dir pin on that object.
- `p0-deep-diagnosis-batch.test.ts:30-35` tests prefix default + override, not the Resources-first PATH combo.

**Inference (npm, not folklore)**

nvm `npx` is `#!/usr/bin/env node` (`~/.nvm/versions/node/v22.23.2/bin/npx` → `npx-cli.js`). First `node` on PATH wins.

`@npmcli/config` Unix default prefix = `dirname(dirname(execPath))` (`loadGlobalPrefix`, packaged node → `/Applications/CMspark.app/Contents`). `Npm.globalDir` = `{globalPrefix}/lib/node_modules`. That is the `lstat .../Contents/lib` path. **Confirmed**: live app has `Contents/Resources/lib` (whisper dylibs) and **no** `Contents/lib`.

`npm_config_prefix` is loaded in `loadEnv()` and then `this.globalPrefix = this.get('prefix')` after full load. It does **not** set `localPrefix` (only CLI `--prefix` does). So prefix pin should retarget `globalDir` away from `Contents/lib` **after config load**.

I did **not** execute `PATH=Resources:nvm-bin npm_config_prefix=... npx -y ...`. Residual: something that lstats default prefix before env merge, or an older npm.

Default filesystem MCP (`filesystem-home.ts:204-211`) has **no** `env.PATH` — reorder + prefix both apply. The hole is operator/stale `config.env.PATH` that still contains `Contents/Resources`. TROUBLESHOOTING says so; there is no automated guard.

---

### NIT-4 — Windows / SEA launch gap (MCP child is mostly OK)

**Evidence**

- `dirHasNpx` Windows names: `npx.cmd`, `npx.exe`, `npx` (`transport.ts:43-44`). Correct for official Node MSI / nvm-windows version dirs.
- SEA `cmspark-agent.exe`: `dirHasNpx(dirname(execPath))` is false unless they ship `npx.cmd` next to the exe → unpaired dir goes to end of candidates. `node.exe` is not the SEA name, so `npx.cmd`’s `SET NODE_EXE=node` fallback is less likely to pick the SEA binary than the macOS `#!/usr/bin/env node` case.
- Windows zip **does** ship `node.exe` without npm (`scripts/package.sh` node staging). If that dir is first on PATH, `npx.cmd` from `%APPDATA%\npm` (no sibling `node.exe`) uses PATH `node` → same mixed-node class. Prefix is the belt.
- `launch-companion.sh` is explicitly not the Windows zip entry (`package.sh:498-506`). `launch.bat` does not export `npm_config_prefix`.
- Windows `buildSpawnPath` fill-in test is `{ skip: process.platform !== "win32" }` (`mcp.test.ts:277`). Darwin CI never runs it.

**Inference**

Not a macOS-incident blocker. Next Windows NSIS/SEA build still depends on `buildMcpStdioEnv`, not a launcher script. Honest docs gap, not a revert.

---

### NIT-5 — `npm-prefix` mkdir permissions / DATA_DIR create

**Evidence** — `transport.ts:231-237`

```ts
fs.mkdirSync(prefix, { recursive: true })
```

No `mode: 0o700`. `config.ts:538-550` creates `DATA_DIR` as `0o700` and chmod’s it. Recursive mkdir of `~/.cmspark-agent/npm-prefix` **before** `initDataDir` can create `~/.cmspark-agent` as `0755 & ~umask`.

**Inference**

Once parent is `0700`, a `0755` child is still owner-only. Race with first MCP connect vs config init is the only interesting case. Not a secret dump.

No containment: `config.env.npm_config_prefix = "/Applications/CMspark.app/Contents"` would point npm global writes at the bundle (codesign). Operator-intent path; default does not. Fix does **not** write `Contents/lib`.

---

### NIT-6 — MCP env allowlist: no new leak; prefix is not inherited from process.env

**Evidence**

- `MCP_STDIO_ENV_ALLOW` (`transport.ts:176-210`) still has no `OPENAI_API_KEY` / `AWS_*` / user-env names. Includes `npm_config_cache` (pre-existing), **not** `npm_config_prefix`.
- `buildMcpStdioEnv` copies allowlist from `process.env`, then `config.env`, then forces PATH, then sets prefix if missing.
- `createTransport` comments + `void getUserEnvVars` (`:245-251`): still no `process.env` / user-env spread.
- `companion/tests/user-env.test.ts:253-272` and `p0-deep-diagnosis-batch.test.ts:8-22` still assert secrets excluded; `config.env` secrets still allowed (operator).

**Inference**

`launch-companion.sh`’s process-level `npm_config_prefix` does **not** flow into MCP children via the allowlist; children get it from the explicit pin. That is actually tighter than inheriting PREFIX. No SEC-02 regression.

`config.env` remains an arbitrary-key injection surface (pre-existing, operator). New key `npm_config_prefix` can be overridden to a bad path (NIT-5).

---

### NIT-7 — Meeting classic `stop()` while already waiting does not re-arm stopGrace

**Evidence** — `local-stt-adapter.ts:975-1001`

Continuous: `wantListening=false` then re-arm if `waiting|uploading`.  
Classic: if `uploading|waiting`, **return** without re-arm. An already-armed 95s `pendingTimeoutMs` keeps running.

New classic test (`voice-local-stt-adapter-ws.test.ts:556-586`) calls `stop()` ~20ms after start — still **recording**, so `uploadAndWait` arms the timer **after** `wantListening` is false. That tests `pendingWaitMs()`, **not** stop-while-waiting.

Meeting near-realtime uses continuous (`meeting-caps` 8s copy). `MEETING_STOP_FAILSAFE_MS=20s` (`MeetingPanel.tsx:406-418`) still force-finalizes UI. Dictation classic hang is 95s not ∞.

**Inference**

Incident path (meeting + continuous + missing ACK) is covered by re-arm + failsafe + disconnect debounce. Classic stop-while-waiting is a leftover no-op except `wantListening=false` (which does not change an already-armed timer).

---

### NIT-8 — Stopping copy can still be `识别中…` if interim text is non-empty

**Evidence** — `meeting-caps.ts:53-55`: interim trim wins **before** `phase === "stopping"`. Test (`meeting-caps.test.ts`) only uses empty interim. DoD (“≠ 正在听…约 8 秒”) still holds.

---

### NIT-9 — Tests: silent skip, no incident PATH fixture, package-gates are string greps

**Evidence**

- `mcp.test.ts:237-257`: `if (segments.includes(paired) && existsSync(npx)) { assert order }`. If the test runner has no sibling `npx`, the core assertion **does not run** and the test still passes (only `segments.includes(resDir)`).
- No test sets `process.env.PATH = <fake Resources>:<nvm-bin>` (the executed reproduction).
- `test-package-gates.sh:137-143`: `assert_file_has` `npm_config_prefix` / `npm-prefix` in the **source** launch script. Would fail on old `launch-companion.sh`. Does not execute spawn.
- New adapter tests would fail on old code (no `onEnd` within 120ms). That RED is real for meeting. Prefix test would fail on old `buildMcpStdioEnv` (no key).

**Inference**

Implementer “RED then GREEN” is credible for meeting adapter + prefix presence, weak for PATH ordering vs the actual incident PATH.

---

### NIT-10 — Drive-by / docs

- Live `/Applications/CMspark.app` is **not** this diff. Do not ship “installed app is fixed”. `[inspected]` launch-companion.sh in that bundle has no prefix.
- `docs/mcp.md` still omits the packaged-node `Contents/lib` footgun; only TROUBLESHOOTING grew a bullet.
- No `host.swift` / launchd / `launch.bat` change in the patch. Scope honesty: zip launcher + MCP transport + meeting UI.

---

## 2. External DoD (observable)

| DoD | Result | Evidence |
|-----|--------|----------|
| `adapter.stop()` no STT ACK → `onEnd` within stopGrace (classic + streaming) | **Met (tests written; not re-run here)** | `voice-local-stt-adapter-ws.test.ts:556-631`; re-arm `local-stt-adapter.ts:990-994`; `pendingWaitMs` `:203` |
| Stopping hint ≠ 「正在听…约 8 秒」 | **Met** (empty interim) | `meeting-caps.ts:55`; test `:300-325` |
| Disconnect debounce 5s < stop failsafe 20s | **Met** | `meeting-caps.ts:35,47`; test asserts inequality |
| `buildSpawnPath({execPath: fake.app/Contents/Resources/node})` npx-pair before Resources | **Met for test-runner/nvm pair; weak fixture** | `mcp.test.ts:237-257`; logic `transport.ts:75-78,153-156` |
| `buildMcpStdioEnv()` prefix under `.cmspark-agent/npm-prefix`; secrets excluded | **Met** | `transport.ts:230-238`; `p0-deep-diagnosis-batch.test.ts:8-35` |
| `launch-companion.sh` contains prefix + npm-prefix | **Met as source** | `scripts/launch-companion.sh:8-10`; gates `:137-143` |
| No new L2 / confirm / default-on | **Met** | patch: meeting UI + MCP env + launch script + docs/tests |
| MCP allowlist does not spread `process.env` / user-env | **Met** | `transport.ts:176-226,245-251` |

---

## 3. Attack list (checked)

| # | Attack | Result |
|---|--------|--------|
| 1 | Double finalize / lost minutes | `finalizeCapture` first-wins via `finalizedRef` (`MeetingPanel.tsx:337-339`). Both timers snapshot `wantGenerateRef` then clear it. If user already set generate, 5s disconnect still generates. Race is “who finalizes”, not double `meeting.generate_minutes`. **No blocker.** |
| 2 | WS 1s blip vs 5s debounce | Effect starts timer only when `!companionConnected`; reconnect cleanup clears it (`:420-434`). 1s blip should not finalize. **Logic OK; not executed against live WS.** |
| 3 | Last window dropped (12s grace vs slow infer) | Product residual. Copy is honest (`正在结束…等待最后一段识别`). Failsafe 20s > 12s so a live last infer can finish if ACK returns. Slow medium >12s after **user stop** may omit last window. **Residual, not incident hang.** |
| 4 | PATH override bypass | **Real residual.** Verbatim PATH + Resources first: reorder skipped; prefix should still retarget npm globalPrefix (NIT-3). **Not tested as a combo.** |
| 5 | Windows npx.cmd / SEA / launch-companion.sh | **Gap documented** (NIT-4). `npx.cmd` pairing exists. SEA unpaired. Launch script is mac/linux zip. |
| 6 | prefix write into app bundle / codesign | Default mkdir is data dir, **not** `Contents/lib`. Live `Contents/Resources/lib` is whisper, unrelated. Operator override could aim at the bundle (NIT-5). **No codesign write in this patch.** |
| 7 | Trust: prefix mkdir perms; MCP child env leak | Allowlist intact (NIT-6). mkdir mode NIT-5. |
| 8 | Incomplete recovery (ready, no minutes, no “load last”) | **In-scope residual**, not a hang regression. Disconnect-without-user-stop finalizes `generate:false`. Copy tells user they can generate from transcript. No new “load last meeting” UI. |
| 9 | Tests that would pass on old code | Meeting adapter hang tests: **would fail**. Prefix presence: **would fail**. PATH order test: **can skip**. Package-gates: string-only, would fail on old launch script. |
| 10 | Drive-by: installed `.app` | **Confirmed unpatched** (NIT-10). |

---

## 4. Three layers

| Layer | Assessment |
|-------|------------|
| **Outcome** | DoD true for the two incidents on source, with the caveats in §2. Packaged nvm+Resources default MCP path is fixed in `transport.ts`. Meeting stop hang is fixed in adapter + UI failsafe/debounce/copy. |
| **Trajectory** | Scope stayed on the two incidents. `startPcmStreamCapture` inject is test-only. No new L2/confirm/runtime. Claim 4 (DMG via `launch-companion.sh`) is the only overclaim of mechanism. |
| **Component** | Remaining holes: `transport.ts:153-172` leftover PATH; `transport.ts:227` verbatim PATH; `host.swift:572` / `launch.bat` no prefix; `local-stt-adapter.ts:998-1001` classic no re-arm; tests `mcp.test.ts:248-253`. |

---

## 5. Capability checklist

| Check | Result |
|-------|--------|
| Axes fit (Surface vs Composition vs Autonomy) | Pass. Meeting = L0 UX. MCP PATH/prefix = Compose `mcp-server`. |
| Do not call MCP a 中层 Agent | Pass (this review + TROUBLESHOOTING). |
| Pack-first / no new primary chrome | Pass. |
| New confirm dialect | None. |
| Trust monotonicity | N/A (no deeper Surface). |
| originWs | Untouched. |
| No new runtime | Pass. Single tool-loop. |
| Experimental locators as write-path success | Untouched. |
| P1-1 god-mode / P1-2 originWs / P1-3 evaluate / P1-4 shell | Untouched. |

Eval: T2. Machine numbers **not re-executed** in this review (no shell in this agent). Claims tagged `[inspected]` unless noted.

---

## 6. What I executed / inspected

**Inspected (read, grep, list):**

- Patch file; `companion/src/mcp/transport.ts` (full); `companion/tests/mcp.test.ts` PATH/dirHasNpx/createTransport; `companion/tests/p0-deep-diagnosis-batch.test.ts`; `companion/tests/user-env.test.ts` MCP block.
- `scripts/launch-companion.sh`; `scripts/tests/test-package-gates.sh:137-143`; `scripts/create-dmg.sh`; `scripts/package.sh:496-512`; `scripts/macos/Info.plist`; `scripts/macos/launcher.sh` (unused by current DMG); `scripts/launchd/com.cmspark.companion.plist`; `companion/launch.bat`; `companion/src/host-use/darwin/host.swift:496-572`.
- `docs/TROUBLESHOOTING.md:51-73`; `docs/mcp.md` (no new bullet); ADR-020; dual-review checklist; ADR-019 §6.2 (historical full-env merge — **not** current code).
- Meeting: `MeetingPanel.tsx:336-434,742-756`; `local-stt-adapter.ts:196-217,975-1001,1049-1059`; `meeting-caps.ts:30-63`; tests cited above.
- Live `/Applications/CMspark.app/Contents/` listing: `Resources/node` present, **no** `Contents/lib`, `Resources/lib` = whisper dylibs, `launch-companion.sh` unpatched.
- nvm `npx` shebang + npm `@npmcli/config` `loadGlobalPrefix` / `Npm.globalDir` (v22.23.2 on this host).

**Not executed:** companion/extension test runners, `test-package-gates.sh`, live `PATH=Resources:nvm-bin npx` with/without prefix, packaged `.app` MCP start. Implementer machine line is **unverified** by this reviewer.

---

## 7. Residual risks (honest)

1. Stale `config.env.PATH` containing `CMspark.app/Contents/Resources` — reorder skipped; depends on `npm_config_prefix` after npm config load.
2. Non-nvm npx only on leftover PATH — unpaired Resources still earlier (NIT-2).
3. Next DMG Aqua launch still has no process-level prefix until `host.swift` is taught; MCP children are fine.
4. Windows zip `node.exe` + `%APPDATA%\npm\npx.cmd` mixed-node; prefix should help; not tested here.
5. Meeting: last window may drop after 12s; companion death without user-stop does not auto-generate minutes; no “resume last meeting” UI.
6. Installed 10:00 `.app` remains broken until rebuild.

---

## 8. Implementer claims — falsification

| Claim | Verdict |
|-------|---------|
| 1. Adapter pending timeout 95s; after stop, stopGrace 12s including re-arm | **Mostly true.** Re-arm is continuous-only. Classic stop-while-waiting does not re-arm (NIT-7). New tests cover classic stop-from-recording and streaming stop-while-waiting. |
| 2. Stopping copy; 20s failsafe; 5s disconnect debounce; finalize idempotent | **True** on code. Interim-nonempty copy NIT-8. |
| 3. `dirHasNpx`; unpaired not first ahead of npx pair; prefix unless config.env overrides; PATH verbatim | **True for well-known pairs + default MCP env.** Overstated for leftover PATH (NIT-2). PATH verbatim is explicit and tested. Prefix always set unless override. |
| 4. `launch-companion.sh` so next DMG is not nvm-PATH-dependent | **Mechanism false for DMG; outcome true via `buildMcpStdioEnv`.** (NIT-1) |
| 5. Tests green; live app not patched | Tests **not re-run**. Live app **confirmed unpatched**. |

---

VERDICT: APPROVE_WITH_NITS
