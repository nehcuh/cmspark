# Adversary review (Product / DoD) — meeting stop hang + packaged MCP npx ENOENT

**Batch**: `meeting-mcp-packaged-hang-20260821`  
**Role**: independent Product/DoD skeptic (did **not** implement)  
**Diff**: `docs/audit/reviews/meeting-mcp-packaged-hang-diff-20260821.patch`  
**Base claimed**: `50869a9` (`main`)  
**Blast**: T2 (L0 meeting UX + Compose mcp-server spawn env)

Do **not** treat this as “the 10:00 DMG user is fixed.” They are not.

---

## 1. Findings

### BLOCKER B1 — Incident path still cannot produce minutes; copy lies; generate button stuck

**Product claim to falsify**: after 「结束并生成纪要」 + Companion death, UI leaves 「正在听」, and the user can generate minutes from the existing transcript.

**Evidence (code, not folklore)**

1. User click sets `wantGenerateRef=true` and `phase=stopping`:

```742:756:chrome-extension/src/sidepanel/components/MeetingPanel.tsx
  const stopLiveCapture = (andGenerate: boolean) => {
    if (phaseRef.current === "idle" || phaseRef.current === "stopping") return
    setPhase("stopping")
    wantGenerateRef.current = andGenerate
    ...
    a.stop()
```

2. Any WS drop while not idle force-finalizes after 5s **with that generate flag**, and the new copy says they can generate from the transcript:

```420:434:chrome-extension/src/sidepanel/components/MeetingPanel.tsx
  useEffect(() => {
    if (companionConnected) return
    if (phaseRef.current === "idle") return
    const t = setTimeout(() => {
      if (finalizedRef.current) return
      if (phaseRef.current === "idle") return
      setError((prev) => prev || "Companion 断开，已停止录制。可基于已有转写生成纪要")
      const gen = wantGenerateRef.current
      wantGenerateRef.current = false
      finalizeCapture({ generate: gen, id: meetingIdRef.current })
    }, MEETING_DISCONNECT_FINALIZE_MS)
```

3. `finalizeCapture({ generate: true })` sets **busy + pendingGenerate** then fire-and-forgets WS:

```350:399:chrome-extension/src/sidepanel/components/MeetingPanel.tsx
      if (wantGenerate) {
        setBusy(true)
        setPendingGenerate(true)
      }
      void (async () => {
        ...
        if (id) {
          sendViaRuntime({ type: "meeting.end", v: 1, id })
        }
        ...
            sendViaRuntime({
              type: "meeting.generate_minutes",
```

4. `sendViaRuntime` **ignores** the SW result:

```72:78:chrome-extension/src/sidepanel/components/MeetingPanel.tsx
function sendViaRuntime(msg: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(msg)
  } catch {
    /* SW missing */
  }
}
```

5. SW **does** know the send failed. `wsClient.send` returns `false` when the socket is down (and `onclose` already wiped the pre-auth queue):

```128:132:chrome-extension/src/background/ws-client.ts
    this.ws.onclose = () => {
      const wasConnected = this.state === "connected"
      this.authenticated = false
      this.pending = []
```

```209:231:chrome-extension/src/background/ws-client.ts
  send(data: object): boolean {
    ...
    return false
  }
```

```1314:1324:chrome-extension/src/background/index.ts
          const sent = wsClient.send(message)
          if (!sent) {
            sendResponse({
              ok: false,
              error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接",
            })
```

6. Busy only clears on `meeting.updated` / `minutes_result` / `meeting.error` (`MeetingPanel.tsx:605,644-651`). Companion boot reconcile writes `ready` to disk and **does not** push `meeting.updated`:

```170:181:companion/src/meeting/meeting-store.ts
export function reconcileStaleRecordings(dataDir = DATA_DIR): { demoted: string[] } {
  ...
      full.status = "ready"
      ...
      logger.info("meeting.recording_reconciled", { id: m.id })
```

Called from `companion/src/config.ts:540-543` with no client fan-out.

7. Generate CTA is disabled while busy, and the label becomes 「生成中…」:

```1683:1685:chrome-extension/src/sidepanel/components/MeetingPanel.tsx
      <button type="button" disabled={busy || !ack || capturing} onClick={generate} style={btnStyle(true)}>
        {busy || pendingGenerate ? "生成中…" : "生成会议纪要"}
      </button>
```

8. There is **no** `meeting.list` / “load last meeting” in `MeetingPanel.tsx` (grep: zero). Closing the panel remounts empty `useState`. Disk transcript at `~/.cmspark-agent/meetings/<id>/` is not offered in the UI.

**Inference**: the 2026-08-21 incident (`mtg_721938474f46daa0`, click 「结束并生成纪要」, Companion `SIGTERM` ~18s) maps onto this new path, not the happy path. Disconnect debounce (5s) beats `stopGrace` (12s) and failsafe (20s). `generate_minutes` is dropped on a dead socket. UI then advertises 「可基于已有转写生成纪要」 while the only button that does that is stuck on 「生成中…」. Closing the panel unsticks `busy` and **wipes** the in-memory transcript. That is not recovery; it is a new dishonest busy-state.

This is **in-scope** for this batch (attack list #1 and #8). Hang-unstick without minutes is not the user-visible DoD for 「结束并生成纪要」.

**Required to lift**: on disconnect/failsafe, either (a) `generate:false` + keep the generate button enabled + honest copy, or (b) retry `generate_minutes` after `connectionState==="connected"` and time out `busy` if send fails. Optional but product-complete: load last `ready` meeting from `meeting.list`.

---

### BLOCKER B2 — Installed `/Applications/CMspark.app` is still the 10:00 binary; user-facing docs speak in the present tense

**Evidence [executed on this machine]**

| Probe | Installed `.app` | Source tree |
|---|---|---|
| `Contents/Resources/launch-companion.sh` | `exec "${DIR}/node" …` only — **no** `npm_config_prefix` | exports `npm_config_prefix="${DATA_DIR}/npm-prefix"` (`scripts/launch-companion.sh:8-11`) |
| `cmspark-agent.js` | **no** `npm_config_prefix` / `dirHasNpx` | `companion/src/mcp/transport.ts:47-56,230-238` |
| packaged extension | **no** `MEETING_STOP_FAILSAFE` / 「正在结束」 | `meeting-caps.ts:35-55`, `MeetingPanel.tsx:1619` |

Also: packaged node is `Contents/Resources/node` with **no** `npx`/`npm` sibling. `Contents/Resources/lib/` is whisper dylibs, **not** npm’s `Contents/lib`. The incident `lstat /Applications/CMspark.app/Contents/lib` is still the layout.

**Evidence (docs overclaim)**

`docs/TROUBLESHOOTING.md:73` (this diff) states as current fact:

> Companion 会把「带 npx 的 node 目录」排在打包 node 之前，并把 `npm_config_prefix` 指到 `~/.cmspark-agent/npm-prefix`。

No version, no “下一版 DMG”, no “源码已修 / 已装 10:00 未修”.

`docs/mcp.md` (stdio / filesystem default) is **unchanged**: still “Companion 会自动补充 nvm、homebrew” (`docs/mcp.md:200-201`) with default `npx -y @modelcontextprotocol/server-filesystem` (`docs/mcp.md:42-48`). A 10:00 user following that page will keep hitting `-32000`.

`docs/meeting-and-dictation-user-guide.md` is **unchanged**: no stop-hang, no disconnect recovery, no “ready without minutes”.

**Inference**: implementer claims §5 correctly say the live `.app` is unpatched. The **user-facing** troubleshooting sentence does not. Shipping this diff as “MCP packaged hang fixed” to the person still running the 10:00 DMG is an overclaim. Chrome-extension hang fix also does not enter that `.app` until a new package + reload.

Not a reason to reject the **code** by itself; it **is** a reason to reject any “DoD satisfied for the 10:00 user” reading, and to require a version caveat before this docs line ships.

---

### NIT N1 — `stopGrace=12s` vs large-v3-turbo (and slow medium) last window

**Evidence**

- Client: `LOCAL_STT_STOP_GRACE_MS = 12_000`, `LOCAL_STT_PENDING_TIMEOUT_MS = 95_000` (`local-stt-adapter.ts:65-69`).
- Server large infer cap is **300s**: `stt-session-service.ts:413-414` (`Math.max(baseTimeout, 300_000)`).
- User guide already says large-v3-turbo finals may take tens of seconds to minutes; recommend medium (`docs/meeting-and-dictation-user-guide.md:87-88,121`).
- Stopping copy: 「正在结束…等待最后一段识别」 (`meeting-caps.ts:55`) — does **not** say the last window may be dropped.
- After user stop, `empty_result` is used so streaming/classic can `onEnd` without a banner (`local-stt-adapter.ts:211-216,1052-1054`).
- **Non-streaming continuous** (large-v3-turbo meetings: `streamPartial` forced false at `local-stt-adapter.ts:946-948`) does **not** swallow `empty_result`. After stop, `wantListening` is false, so the code falls through to `onError(errCode)` (`local-stt-adapter.ts:866-879`). `mapLocalSttError("empty_result")` is a **banner**: 「未识别到内容，请重试」 (`error-map.ts:102-103`).

**Inference**: for the SIGTERM incident, 12s is honesty (Companion is dead). For a live large (or slow medium) last window, 12s will often drop the window. Product-broken only if we claim last-window preservation. Default/recommended model is medium + 8s windows — 12s is a bet, not a measurement. Banner on large stop-timeout is a copy defect, not a hang.

Honesty copy should name the drop: 「若最后一段仍在识别中，可能不会写入转写；可稍后点生成纪要」. Not enough to APPROVE the incident path (see B1).

---

### NIT N2 — 5s WS debounce vs ~1s blips is plausible, not proven; packed MV3 alarm floor is a residual

**Evidence**

- `MEETING_DISCONNECT_FINALIZE_MS = 5_000` (`meeting-caps.ts:42`). Constant test only: `meeting-caps.test.ts:33-37`.
- Any socket close immediately sets `connectionState=disconnected` (`ws-client.ts:128-133`).
- Reconnect uses `chrome.alarms` with `delayInMinutes: delay/60000`; first delay `1000 * 2^0` ms (`ws-client.ts:310-314`).
- Companion incident death ~18s > 5s (prompt fact). `onopen` resets `reconnectAttempts` (`ws-client.ts:89`).

**Inference**: a healthy 1s auth blip should cancel the 5s timer (`useEffect` cleanup on `companionConnected`). I did **not** replay a live `ws.client_disconnected` blip. Packed MV3 historically floors alarms (~30s); unpacked (DMG “加载已解压”) often honors sub-minute delays — which matches the “~1s blips” log story. If reconnect RTT ever exceeds 5s (backoff already >0, SW sleep, packed alarm floor), a live meeting is force-finalized. Residual, not the incident.

---

### NIT N3 — `config.env.PATH` verbatim still reproduces the incident PATH; prefix is untested as the save

**Evidence**

- `env.PATH = configEnv?.PATH || buildSpawnPath()` (`transport.ts:227`). Verbatim override is **tested and required** (`mcp.test.ts:401-418`).
- `npm_config_prefix` is still set when PATH is overridden (`transport.ts:230-238`) unless `config.env.npm_config_prefix` is set.
- Prefix test does **not** combine `PATH=…/Contents/Resources:…/nvm/bin` (`p0-deep-diagnosis-batch.test.ts:30-35`).
- `buildSpawnPath` ordering test is conditional on the **test runner’s** `process.execPath` dir already being on PATH **and** containing npx (`mcp.test.ts:237-257`). It does not construct a fake `Resources:nvm-bin` incident PATH.

**Inference**: default spawn PATH fix is real (`dirHasNpx` + unpaired dir last, `transport.ts:75-78,153-156`). Operator PATH that still puts packaged `Contents/Resources` first can still run nvm `npx` under bundled node. Prefix **should** stop `lstat Contents/lib` if npm honors `npm_config_prefix`; that combo is [assumed], not [executed]. TROUBLESHOOTING workaround (write nvm `bin` only) is the real escape hatch.

---

### NIT N4 — Windows launcher gap; SEA `execPath`; prefix mkdir mode

**Evidence**

- `scripts/launch-companion.sh` is mac/linux zip/DMG (`package.sh:508-511`). Windows copies `launch.bat` with **no** `npm_config_prefix` (`companion/launch.bat`, `package.sh:498-507`).
- MCP child env still pins prefix via `buildMcpStdioEnv` on every platform (`transport.ts:230-238`). Incident is macOS `.app`.
- `dirHasNpx` checks `npx.cmd`/`npx.exe`/`npx` (`transport.ts:43-44`). SEA `cmspark-agent.exe` dir without npx is treated unpaired and pushed last — same logic.
- `fs.mkdirSync(prefix, { recursive: true })` has **no** `0o700` (`transport.ts:234`). Sibling data dirs use `0o700` (`config.ts:538`).
- `MCP_STDIO_ENV_ALLOW` still excludes secrets; tests assert `OPENAI_API_KEY` / `AWS_SECRET_ACCESS_KEY` absent (`p0-deep-diagnosis-batch.test.ts:8-16`). `npm_config_prefix` is **not** inherited from `process.env` (not on allowlist); only explicit set or `config.env` override.

**Inference**: Windows MCP is not the incident. Prefix dir `0755` on a shared Mac is a small trust nit. Operator override of `npm_config_prefix` into the `.app` is a codesign footgun (attack #6); default does not write the bundle.

---

### NIT N5 — Tests: adapter hang tests would fail pre-fix; MeetingPanel recovery is untested; PATH test is weak

**Evidence**

- New classic/streaming tests wait 120ms for `onEnd` with `stopGraceMs: 40` (`voice-local-stt-adapter-ws.test.ts:556-641`). Pre-fix `stop()` while `waiting` was a no-op besides `wantListening=false` — these would time out / miss `end`. [inspected]
- `meetingLiveInterimHint` tests the helper + constants, not `MeetingPanel` wiring, failsafe, or disconnect (`meeting-caps.test.ts:32-57`). Leftover `interimText` still wins over stopping copy (`meeting-caps.ts:54-55`) — original hang had empty interim, so the 8s 「正在听」 copy **is** fixed for that case.
- MACHINE numbers in the prompt were **not** re-run here (this agent has no shell). Treat implementer green as [assumed] until CI/human re-runs.

---

### Drive-by

Diff file list is meeting adapter/UI + MCP spawn PATH/prefix + launch script + TROUBLESHOOTING + tests. `startPcmStreamCapture` DI is for the new streaming hang test. No new L2 tool, confirm family, Side Panel chrome, Pack, or “中层 Agent”. Trajectory matches the two incidents. Acceptable.

---

## 2. What was executed vs inspected vs assumed

| Item | Level |
|---|---|
| Read prompt, patch, checklist, `docs/meeting-and-dictation-user-guide.md`, `docs/mcp.md`, `docs/TROUBLESHOOTING.md` | [inspected] |
| Read `MeetingPanel.tsx`, `local-stt-adapter.ts`, `meeting-caps.ts`, `transport.ts`, `launch-companion.sh`, `ws-client.ts`, `background/index.ts`, `meeting-store.ts`, tests | [inspected] |
| Grep: `meeting.list` in MeetingPanel, `npm_config_prefix`, `generate_minutes`, `finalizeCapture`, Windows launchers | [inspected] |
| List `/Applications/CMspark.app/Contents/Resources`; read installed `launch-companion.sh`; grep installed `cmspark-agent.js` + packaged extension for the new strings | [executed] — **10:00 app unpatched** |
| Re-run `tsc` / node:test / `test-package-gates.sh` | **not executed** (no shell in this agent) |
| Live WS 1s blip during a meeting; live `npx` under bundled node with prefix | **not executed** |
| `config.env.PATH=Resources:nvm-bin` + prefix actually avoids `Contents/lib` | [assumed] from npm prefix semantics |

---

## 3. External DoD (observable) — scored

| DoD | Source tree | 10:00 `.app` user |
|---|---|---|
| `adapter.stop()` + no STT ACK → `onEnd` within stopGrace (classic + streaming tests) | **PASS** [inspected tests + code] | **FAIL** (extension binary unpatched) |
| Stopping hint ≠ 「正在听…约 8 秒」 | **PASS** for empty interim (`MeetingPanel.tsx:1619` + `meeting-caps.ts:55`) | **FAIL** |
| Disconnect debounce 5s < stop failsafe 20s | **PASS** constants | n/a |
| `buildSpawnPath({execPath: fake.app/…/node})` npx-pair before Resources | **WEAK PASS** (conditional on runner PATH) | **FAIL** (bundle unpatched) |
| `buildMcpStdioEnv()` prefix under `.cmspark-agent/npm-prefix`; secrets excluded | **PASS** code + p0 test | **FAIL** |
| `launch-companion.sh` has `npm_config_prefix` + `npm-prefix` | **PASS** source | **FAIL** installed script |
| No new L2 / confirm / default-on | **PASS** | n/a |
| MCP allowlist still does not spread `process.env` / user-env | **PASS** | n/a |
| **User-visible**: 「结束并生成纪要」 + Companion death → minutes or a working generate CTA | **FAIL** (B1) | **FAIL** |
| Pack-first / no new chrome | **PASS** — copy in existing meeting workbench; MCP spawn env only | n/a |

---

## 4. Capability checklist (ADR-020)

```text
Surface:      L0 (会议工作台 STT / 结束并生成纪要)
L2-classes:   (none)
Compose:      mcp-server (stdio spawn PATH + npm_config_prefix)
Autonomy:     single
Trust:        无新确认门；MCP stdio env 仍走 allowlist
Channel:      community
```

| Check | Result |
|---|---|
| Axes fit | **OK** — hang is L0 meeting UX; MCP PATH is Composition spawn, not a “中层 Agent” |
| Pack-first | **OK** — no new scenario chrome; meeting already Pack-gated (user guide §1 / §3.1) |
| Confirm dialects | **OK** — none added |
| Trust monotonicity | **OK** — prefix is data-dir; allowlist unchanged; operator `config.env` still wins |
| originWs | **n/a** — no `securityConfirmations.request` |
| No new runtime | **OK** |
| Experimental layers | **n/a** |
| P1-1 god-mode | **n/a** |
| P1-2 originWs | **n/a** |
| P1-3 evaluate | **n/a** |
| P1-4 shell | **n/a** (stdio spawn PATH only) |

---

## 5. Layers

| Layer | Result |
|---|---|
| **Outcome** | Source DoD checkboxes for hang-unstick + MCP PATH are mostly true. The **user outcome** of the meeting incident (minutes, or a working “generate from transcript”) is **not**. The **10:00 DMG user** is completely unpatched. |
| **Trajectory** | Scope is the two incidents. No drive-by chrome. Incomplete recovery is in-scope, not a later epic. |
| **Component** | Holes: `MeetingPanel.tsx:350-353,420-431,72-78,1683-1685`; `ws-client.ts:128-231`; `meeting-store.ts:170-181`; installed `launch-companion.sh`; `TROUBLESHOOTING.md:73`; `local-stt-adapter.ts:866-879` (large empty_result banner); `transport.ts:227` (verbatim PATH). |

---

## 6. Residual risks (non-blocking if B1/B2 addressed)

- Last ~8s (or full large window) dropped after stop when infer > 12s; audio already default-deleted.
- 5s debounce vs packed-MV3 alarm floor / backoff >5s → false stop of a live meeting.
- `config.env.PATH` including `Contents/Resources` first; prefix may or may not save `Contents/lib`.
- Windows parent env has no launch-script prefix (MCP child still does).
- `npm-prefix` mkdir `0755`; npx cache grows under `~/.cmspark-agent`.
- Operator `npm_config_prefix` pointing at the `.app` (codesign).
- No `meeting.list` UI — even a correct busy-clear still leaves “reopen panel = blank” unless they paste from disk.

---

## 7. Implementer claims — falsification

| Claim | Verdict |
|---|---|
| pending timeout 95s / stopGrace 12s + re-arm while waiting | **Mostly true** for continuous/streaming (`local-stt-adapter.ts:990-994`). Classic waiting is not re-armed (classic arms after stop with `wantListening` already false). |
| Stopping copy ≠ 「正在听」; 20s failsafe; 5s debounce; finalize idempotent | Copy true if `interimText` empty. Failsafe/debounce exist. `finalizedRef` is idempotent. **Generate-during-dead-socket is not.** |
| `dirHasNpx`; unpaired Resources not first; prefix unless config.env overrides; PATH verbatim | **True** in source. |
| `launch-companion.sh` for the **next** DMG | **True** in source. **False** for installed app ([executed]). |
| Tests green | [assumed] — not re-run. New adapter tests look RED-then-GREEN capable. |
| Live `.app` still 10:00 | **Confirmed [executed].** Do not let TROUBLESHOOTING present-tense overwrite this. |

---

## 8. Product bottom line

This batch **unsticks 「正在听」** and **rewrites MCP PATH for the next package**. It does **not**:

1. Give the 10:00 DMG user a working meeting stop or working packaged `npx` filesystem MCP.
2. Complete 「结束并生成纪要」 when Companion dies — the exact incident — without trapping the user on 「生成中…」 with a disabled button and no load-last.

Do not merge as “incident closed” until B1 is fixed and user-facing MCP copy names **which build** has the PATH/prefix change.

VERDICT: REJECT
