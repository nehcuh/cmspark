# Path B Local STT M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Path B loop: when `sttEngine=local` and a Whisper model is ready, Side Panel 🎤 records PCM → authenticated WS → Companion whisper.cpp → draft text (edit then send). Inherit all M0 + M1-WebSpeech floors; **no auto-send**, no silent browser fallback.

**Architecture:** Reuse pure `SttSessionCore` + `pcm-encode` from spike/M0. Add FS session wrapper (tmp 0o600 + boot GC), `whisper-runner` (`execFile` fixed binary), `voice.stt.*` WS (origin-gated, max-1). Extension: factory `browser | local` adapter sharing `session-reducer` with new **`processing`** phase; privacy **ack v2**; mic matrix fail-closed when local + disconnected.

**Tech Stack:** Companion TS + `cmspark-whisper` (whisper.cpp CLI wrap or vendored binary), existing WS auth, chrome-extension React hook, node:test.

**Normative refs:**

| Pri | Doc |
|-----|-----|
| 1 | [ADR-023](../../adr/023-voice-local-stt-path-b.md) L3–L16, §7 protocol, tmp, origin |
| 2 | [Path B SoT](../specs/2026-08-07-voice-local-stt-design.md) §5–§8, error table §6.5 |
| 3 | [M0 completion](./2026-08-07-voice-local-stt-m0-COMPLETION.md) — must stay green |
| 4 | [Spike report](../specs/2026-08-07-voice-local-stt-spike-report.md) S0–S5 machine gates |
| 5 | M1 Web Speech SoT [2026-08-06-voice-input-design.md](../specs/2026-08-06-voice-input-design.md) — browser path zero regression |

**Prerequisite (branching):**

- Prefer stack on `feat/voice-local-stt-m0` (or merge M0 first): branch `feat/voice-local-stt-m1`.
- Human S0–S2 (real gUM/MediaRecorder) **should** be checked before claiming M1 product-ready; machine CI can proceed with pure tests + fake runner.

**M1 out of scope:**

- faster-whisper / dual stack  
- ffmpeg  
- streaming token interim  
- auto-send / wake word  
- Worker/Cockpit mic  
- shipping multi-OS fat binary in one zip (per-platform package only)  
- hard RAM mutex with Qwen (confirm dialog only if cheap; soft warn OK)

---

## M1 Definition of Done

1. **engine=browser**: identical to pre-M1 Web Speech (disconnect still allows mic).  
2. **engine=local** + model ready + binary ready + Companion connected: 🎤 records ≤45s → processing → draft ≥1 non-empty Chinese path (manual) or fixture text (CI fake runner).  
3. **Abort trinity**: stop / chat.abort / thread switch / unmount abort recording **and** `voice.stt.abort` → kill child → unlink tmp.  
4. **No silent fallback** to browser STT; optional banner CTA `set_engine browser` with `source:"settings"` + cloud residual line.  
5. **Logs**: never audio base64 or full transcript; audit codes/sizes/ms/modelId only.  
6. **tmp**: under `DATA_DIR/tmp/voice-stt/`; 0o600; boot GC orphans.  
7. **Tests**: pure reducer processing; session+tmp unit; runner fake; WS validation; extension adapter unit with mock WS.  
8. **Manifest**: still no `audioCapture`.

---

## File map

### Create

| Path | Role |
|------|------|
| `companion/src/voice/whisper-binary-pins.ts` | Per-arch expected SHA256 constants (updated by build script) |
| `companion/src/voice/stt-tmp.ts` | Session tmp dir create/unlink/boot GC |
| `companion/src/voice/stt-session-service.ts` | Orchestrates SttSessionCore + tmp write + runner + timeouts |
| `companion/src/voice/whisper-runner.ts` | `execFile` cmspark-whisper; parse stdout; timeout kill |
| `companion/src/voice/stt-handlers.ts` | `voice.stt.*` WS handlers (auth origin already on connection) |
| `companion/scripts/build-cmspark-whisper.sh` | Build/copy whisper-cli → dist/bin name + print sha256 |
| `companion/tests/voice-stt-tmp.test.ts` | sandbox + GC |
| `companion/tests/voice-whisper-runner.test.ts` | fake binary script |
| `companion/tests/voice-stt-handlers.test.ts` | protocol, caps, abort, origin class mock |
| `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts` | gUM + PCM + WS chunks |
| `chrome-extension/src/sidepanel/voice/stt-engine.ts` | factory browser \| local |
| `chrome-extension/src/sidepanel/voice/audio-capture.ts` | MediaRecorder or ScriptProcessor/AudioWorklet → float mono |
| `chrome-extension/tests/voice-session-processing.test.ts` | reducer processing phase |
| `chrome-extension/tests/voice-local-stt-adapter.test.ts` | mock WS send |

### Modify

| Path | Change |
|------|--------|
| `companion/src/voice/binary-resolve.ts` | Wire production pins from `whisper-binary-pins.ts` |
| `companion/src/voice/session-caps.ts` | Already has timeouts — use in service |
| `companion/src/server.ts` | validate `voice.stt.*`; reject non-extension origin at handler if available |
| `companion/src/message-router.ts` | route `voice.stt.*` |
| `companion/src/ws-auth.ts` or connection meta | Expose peer origin class to handlers if not already |
| `scripts/package.sh` | Stage `cmspark-whisper` next to host for Tier-1 platforms |
| `chrome-extension/.../voice/types.ts` | Add phase `processing` |
| `chrome-extension/.../voice/session-reducer.ts` | processing transitions |
| `chrome-extension/.../voice/error-map.ts` | local codes §6.5 |
| `chrome-extension/.../hooks/useVoiceInput.ts` | engine from store; factory adapter; ack v2 |
| `chrome-extension/.../App.tsx` / `VoiceMicButton` | listening timer; processing UI; CTA |
| `chrome-extension/.../agentStore.tsx` | voicePrivacyAckV2; engine mirror gates mic |
| `chrome-extension/.../SettingsSlideout.tsx` | ack reset v2; copy if needed |

### Already done (M0/spike) — reuse

- `pcm-encode.ts`, `local-stt-detect.ts`, `stt-session-core.ts`, `whisper-download.ts`, `whisper-handlers.ts` (model only)

---

## Task 0: Branch + baseline

- [ ] **Step 0.1:** `git checkout -b feat/voice-local-stt-m1` from updated M0 branch or main+M0 merge.

- [ ] **Step 0.2:** Baseline green:

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/voice-*.test.js
cd chrome-extension && npx tsx --test tests/voice-*.test.ts
```

- [ ] **Step 0.3:** Confirm no existing `voice.stt` handlers (`rg voice\.stt companion/src` only comments).

---

## Task 1: Session reducer — `processing` phase

**Files:**
- Modify: `chrome-extension/src/sidepanel/voice/types.ts`
- Modify: `chrome-extension/src/sidepanel/voice/session-reducer.ts`
- Create/extend: `chrome-extension/tests/voice-session-processing.test.ts` (or extend existing voice-session tests)

### Behavior

```text
listening + USER_TOGGLE_STOP → processing (not idle yet)
processing + ENGINE_RESULT final → keep finals
processing + ENGINE_END → commit draft / idle (same commit rules as today)
processing + ENGINE_ERROR → error banner; no draft wipe of baseText
processing + CHAT_ABORT | THREAD_SWITCH | UNMOUNT → abort; no merge
listening still has TIMEOUT 45s → stop capture → processing (or abort if empty policy)
```

- [ ] **Step 1.1: Failing tests** for transitions above.

- [ ] **Step 1.2: Implement phase + events**

Add if needed:

```ts
| { type: "LOCAL_UPLOAD_START" }  // optional alias → processing
```

Prefer: local adapter calls `ENGINE_END` only after result; on stop enter processing via new event:

```ts
| { type: "CAPTURE_STOPPED" }  // listening → processing
```

- [ ] **Step 1.3: Tests pass; browser Web Speech path unchanged** (stop still ends without long processing — Web Speech can stay listening→stopping→idle; only local uses processing).

**Design lock:** Browser adapter may skip `processing` (immediate ENGINE_END). Local adapter must enter `processing` after capture stop until result/error.

- [ ] **Step 1.4: Commit**

```bash
git commit -m "feat(voice-m1): session-reducer processing phase for local STT"
```

---

## Task 2: Local error map + privacy ack v2 types

**Files:**
- Modify: `chrome-extension/src/sidepanel/voice/error-map.ts`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx` (ack v2)
- Modify: `chrome-extension/src/sidepanel/App.tsx` / privacy sheet if any
- Tests: error-map local codes

### Codes → Chinese (SoT §6.5)

| code | message |
|------|---------|
| empty_result | 未识别到内容，请重试 |
| model_missing | 本机模型未就绪，请先在设置下载 |
| binary_missing | 本机听写组件不可用，请更新 Companion |
| hash_fail | 本机听写组件校验失败，请重装 Companion |
| companion_disconnected | Companion 未连接，本机转写不可用 |
| session_busy | 正在识别，请稍候或取消 |
| payload_too_large | 录音过长或数据异常 |
| infer_timeout | 识别超时，请缩短后重试 |
| resource_conflict | 本机资源不足（可关闭实验模型后重试） |
| aborted | silent |

- [ ] **Step 2.1:** `mapLocalSttError(code)` + tests.

- [ ] **Step 2.2:** Store `voicePrivacyAckV2: boolean` in chrome.storage; load/save like v1.

- [ ] **Step 2.3:** Privacy sheet text for v2 (SoT §5.2 six clauses). First local start requires ack; browser continues to use v1 or unified sheet that covers both.

**Lock:** Starting **local** without `voice_privacy_ack_v2` → show sheet; do not start capture.

- [ ] **Step 2.4: Commit**

```bash
git commit -m "feat(voice-m1): local STT error map and privacy ack v2"
```

---

## Task 3: Companion tmp + session service + runner (fakeable)

**Files:**
- Create: `companion/src/voice/stt-tmp.ts`
- Create: `companion/src/voice/whisper-runner.ts`
- Create: `companion/src/voice/stt-session-service.ts`
- Tests as above

### stt-tmp.ts

```ts
export function voiceSttTmpRoot(dataDir: string): string
// DATA_DIR/tmp/voice-stt
export async function createSessionDir(sessionId: string): Promise<string>
// randomize if sessionId unsafe; reject .. ; mode 0o700/0o600
export async function writeSessionAudio(dir: string, name: string, buf: Buffer): Promise<string>
export async function removeSessionDir(dir: string): Promise<void>
export async function gcOrphanSessions(maxAgeMs: number): Promise<number>
```

Call `gcOrphanSessions` once on companion start (from server.ts boot) — best-effort.

### whisper-runner.ts

```ts
export type WhisperRunResult = { text: string; ms: number }

export async function runWhisperTranscribe(opts: {
  binaryPath: string
  modelPath: string  // absolute under whisper root, server-resolved
  audioPath: string
  lang?: string      // default zh
  timeoutMs?: number // STT_INFER_MAX_MS
  signal?: AbortSignal
}): Promise<WhisperRunResult>
```

Implementation:

1. `execFile(binaryPath, args, { timeout, killSignal })` — **no shell**  
2. Args must match actual `cmspark-whisper` / whisper-cli CLI. **Spike proven:**  
   `whisper-cli -m MODEL -f AUDIO -l zh -nt`  
3. Wrapper binary may normalize argv to that form.  
4. Parse stdout: strip log noise; take last non-empty transcript line or `[BLANK_AUDIO]` → empty.  
5. On abort: kill process group if needed.

**Test:** ship `companion/tests/fixtures/fake-cmspark-whisper.js` (node script prints fixed text, respects sleep for timeout tests).

### stt-session-service.ts

Process-global singleton wrapping `SttSessionCore`:

```ts
class SttSessionService {
  start(msg, peer): Result
  chunk(msg, peer): Result
  end(msg, peer): Promise<Result & { text?: string }>
  abort(msg, peer): Result
}
```

Rules:

1. Peer must be same connection that started (store `peerId` / ws ref).  
2. On `end`: concat audio → write wav/pcm path → resolve model path via allowlist only → `runWhisperTranscribe` → unlink → return text.  
3. Server-side 45s timer from start; idle 10s without chunk.  
4. Infer timeout 90s.  
5. Inject runner/binary/model resolvers for tests.

- [ ] **Step 3.1–3.4:** TDD implement tmp, runner, service.

- [ ] **Step 3.5: Commit**

```bash
git commit -m "feat(voice-m1): STT tmp, whisper-runner, session service"
```

---

## Task 4: `voice.stt.*` WS handlers + validation

**Files:**
- Create: `companion/src/voice/stt-handlers.ts`
- Modify: `server.ts` validateWsMessage  
- Modify: `message-router.ts`  
- Origin check: only `chrome-extension://` (ADR-023 L6)

### validateWsMessage (shape)

```ts
"voice.stt.start": (m) => {
  // v===1, sessionId string, modelId allowlist, format pcm_s16le|wav,
  // sampleRate===16000, channels===1, maxMs<=45000
},
"voice.stt.chunk": (m) => {
  // sessionId, seq int, data base64 string, decoded size <= STT_MAX_CHUNK_BYTES
},
"voice.stt.end": (m) => { /* sessionId, totalSeq int */ },
"voice.stt.abort": (m) => { /* sessionId */ },
```

**Not** `source:settings` — these are Side Panel runtime messages (authenticated extension). Origin class is the security fence.

### Handler responses

- On start ok → optional `voice.stt.partial` status receiving  
- On end success → `voice.stt.result`  
- On failure → `voice.stt.error` with code  
- Never put audio in logs  

Wire router like model handlers; pass `ws` / origin / broadcast into service.

- [ ] **Step 4.1: Tests** — invalid format, seq gap, busy, abort, happy path with fake runner.

- [ ] **Step 4.2: Commit**

```bash
git commit -m "feat(voice-m1): voice.stt.* WS protocol and handlers"
```

---

## Task 5: Binary build, pins, packaging

**Files:**
- Create: `companion/scripts/build-cmspark-whisper.sh`
- Create: `companion/src/voice/whisper-binary-pins.ts`
- Modify: `scripts/package.sh` (and Windows package if applicable)
- Modify: `binary-resolve` usage in get_state + runner

### Dev path (M1.0 acceptable)

1. Script copies `/opt/homebrew/bin/whisper-cli` → `companion/dist/bin/cmspark-whisper-darwin-arm64` (or builds from source when CI has tools).  
2. Prints SHA256 → developer updates `whisper-binary-pins.ts`.  
3. `resolveWhisperBinary({ searchRoots: defaultWhisperSearchRoots(companionRoot), expectedSha256: PIN[arch] })`.

### Production path

- `package.sh` for `macos-arm64` / `macos-x64` / `windows-x64` stages arch-specific binary under staged `bin/` or next to `cmspark-host`.  
- Hash mismatch → `binary.status = hash_mismatch`; local mic Disable.

### Dev convenience

- `allowUnpinned: process.env.CMSPARK_WHISPER_UNPINNED === "1"` loud log only.

- [ ] **Step 5.1:** Script + pin file + package.sh stage (at least darwin-arm64 documented).

- [ ] **Step 5.2:** get_state binary field uses pins in prod.

- [ ] **Step 5.3: Commit**

```bash
git commit -m "feat(voice-m1): cmspark-whisper package pins and resolve"
```

**Note:** If CI cannot produce Windows binary, document Tier-1 skip and Disable local on unsupported.

---

## Task 6: Extension audio capture + local-stt-adapter + engine factory

**Files:**
- Create: `audio-capture.ts`, `local-stt-adapter.ts`, `stt-engine.ts`
- Modify: `useVoiceInput.ts`, `background/index.ts` (forward voice.stt.*)
- Tests: mock send

### audio-capture.ts

Preferred path (SoT/spike):

1. `getUserMedia({ audio: true })`  
2. Prefer **AudioWorklet/ScriptProcessor** or MediaRecorder → decodeAudioData → `encodeMonoFloatToWav16k`  
3. Emit `Uint8Array` wav once on stop (or stream pcm chunks during record — either OK if total cap enforced)

**Lock for M1 simplicity:** record full session → one WAV → splitIntoChunks for WS (easier seq). Continuous chunk streaming is optimization M1.1.

### local-stt-adapter.ts

Implements same surface as Web Speech adapter:

```ts
{
  start({ sessionId, modelId, lang }): void
  stop(): void   // stop capture → send end → wait result
  abort(): void
  destroy(): void
}
```

Handlers:

- onStart when gUM+record starts  
- onResult with finalChunk from `voice.stt.result`  
- onError from `voice.stt.error`  
- onEnd after result/error handled  

Must register temporary WS message listeners (via callback injection from useVoiceInput/useWebSocket — avoid circular imports). Pattern: pass `send(msg)` and `subscribe(handler): unsubscribe` into adapter factory.

### stt-engine.ts

```ts
export function createSttAdapter(kind: "browser" | "local", deps): SpeechAdapter | null
```

### useVoiceInput changes

1. Read `sttEngine` from opts (from store mirror / lastKnown).  
2. If local: require companion connected + model ready + binary ready + privacy ack v2.  
3. Else browser path as today.  
4. Fail-closed: local + disconnected → do not start; banner companion_disconnected + optional CTA.  
5. **Never** fall back to Web Speech silently when engine=local.

### Mic visibility matrix (App.tsx)

| Condition | Behavior |
|-----------|----------|
| voiceInputEnabled false | Hide |
| engine browser + no SpeechRecognition | Hide |
| engine local + no gUM | Hide/Disable |
| engine local + disconnected | Disable + banner |
| engine local + !modelReady | Disable + 去设置 |
| engine local + binary bad | Disable |
| engine browser + disconnected | **Allow** (M1 Web Speech) |

- [ ] **Step 6.1–6.4:** Implement + unit tests with mock WS.

- [ ] **Step 6.5: Commit**

```bash
git commit -m "feat(voice-m1): local STT adapter and engine factory"
```

---

## Task 7: Composer UX — timer, processing, CTA

**Files:**
- `VoiceMicButton.tsx` / InputArea / App.tsx
- error-map banner CTA

### UX locks

1. Local listening: show elapsed or remaining of 45s + “结束后本机识别” (aria-live polite).  
2. Processing: spinner / mic busy; cancel → abort.  
3. Banner CTA「改用浏览器听写」→ `voice.model.set_engine` `{ engine:"browser", source:"settings" }` + toast + residual cloud sentence.  
4. No third permanent status row at 320px — use mic chrome + existing banner slot.

- [ ] **Step 7.1:** Wire UI.  
- [ ] **Step 7.2:** Manual checklist doc snippet.  
- [ ] **Step 7.3: Commit**

```bash
git commit -m "feat(voice-m1): local listening/processing chrome and browser CTA"
```

---

## Task 8: Qwen coexistence soft gate (optional but small)

When starting local STT, if computer model session is loaded (reuse existing probe if available), show confirm or banner `resource_conflict` soft warn. **Do not block M1** if probe unreliable — soft only.

- [ ] Implement if `computerModelSession` or equivalent is easy to query from companion stt start; else document residual.

---

## Task 9: Integration tests + packaging smoke + docs

**Files:**
- Companion integration test optional with fake binary end-to-end through handlers  
- `docs/superpowers/plans/2026-08-07-voice-local-stt-m1-COMPLETION.md`  
- Update ADR-023 M1 row, Path B SoT wave table  

### Automated suite

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/voice-*.test.js
cd chrome-extension && npx tsx --test tests/voice-*.test.ts
# package dry-run on darwin-arm64 if feasible
```

### Manual acceptance (SoT §12 M1)

| # | Check |
|---|--------|
| 1 | engine=browser: zh-CN ≥15 chars draft works offline Companion |
| 2 | engine=local: download medium already from M0; enable; 🎤; draft text |
| 3 | abort mid-record; mid-processing |
| 4 | disconnect mid-local → error not silent browser |
| 5 | CTA switch browser + cloud disclosure |
| 6 | no audio files left under tmp after 5 sessions |
| 7 | logs grep no transcript |

- [ ] **Step 9.1:** Full test green.  
- [ ] **Step 9.2:** Completion note + ADR/SoT status.  
- [ ] **Step 9.3: Commit**

```bash
git commit -m "docs(voice-m1): completion note and SoT/ADR status"
```

---

## Protocol reference (copy into handlers)

```ts
// start
{ type: "voice.stt.start", v: 1, sessionId, modelId, format: "wav",
  sampleRate: 16000, channels: 1, lang: "zh", maxMs: 45000 }

// chunk
{ type: "voice.stt.chunk", v: 1, sessionId, seq, data: base64 }

// end
{ type: "voice.stt.end", v: 1, sessionId, totalSeq }

// abort
{ type: "voice.stt.abort", v: 1, sessionId }

// result
{ type: "voice.stt.result", v: 1, sessionId, text, ms, modelId }

// error
{ type: "voice.stt.error", v: 1, sessionId, code, message }
```

---

## Risk register

| Risk | Mitigation |
|------|------------|
| whisper-cli argv drift across brew versions | Pin wrapper `cmspark-whisper` that only accepts our argv schema |
| MediaRecorder WebM decode fails | Prefer live PCM capture path; test both |
| Large base64 WS messages | chunk ≤256KB; session ≤2.5MB |
| Binary not in CI | fake runner tests; human package smoke |
| Engine desync | lastKnown fail-closed for local (M0 already mirrors) |
| Scope creep dual-stack | refuse in PR checklist |

---

## Spec coverage self-check

| SoT / ADR M1 item | Task |
|-------------------|------|
| PCM 16k no ffmpeg | T6 |
| voice.stt protocol + origin | T4 |
| max-1 session + caps | T3–T4 |
| tmp 0o600 + GC | T3 |
| whisper.cpp execFile + pin | T3, T5 |
| processing phase | T1, T7 |
| ack v2 | T2 |
| error table | T2 |
| no silent fallback + CTA | T6–T7 |
| browser zero regression | T6 matrix |
| no audioCapture | package check T9 |
| no transcript logs | T3–T4 review |

---

## Suggested task order (dependencies)

```text
T0 baseline
 → T1 processing reducer (extension pure)
 → T2 error map + ack v2
 → T3 tmp + runner + service (companion pure-ish)
 → T4 WS handlers (depends T3)
 → T5 binary packaging (can parallel T3 after API stable)
 → T6 adapter + useVoiceInput (depends T1,T2,T4)
 → T7 composer chrome (depends T6)
 → T8 soft Qwen (optional)
 → T9 docs + full gate
```

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-voice-local-stt-m1-impl.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task + review  
2. **Inline Execution** — implement in this session with checkpoints  

Which approach?
