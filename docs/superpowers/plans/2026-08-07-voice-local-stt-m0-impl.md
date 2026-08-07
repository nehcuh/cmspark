# Path B Local STT M0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship **M0 only** — user-triggered Whisper weight download/delete/cancel, Companion readiness state, and Settings UI for engine + model catalog — **without** `voice.stt.*` audio/transcription.

**Architecture:** Mirror `computer.model.*` discipline under a **separate** `companion/src/voice/` tree and `voice.model.*` WS family. Repo-local whisper manifest (https + sha256); download primitives scoped to `~/.cmspark-agent/models/whisper/`; Companion owns `config.voice.sttEngine` + `localModelId`; extension mirrors state; Pack cannot write voice keys.

**Tech Stack:** Companion TypeScript (Node 22), existing WS + `source:"settings"` dual fence, chrome-extension SettingsSlideout + agentStore, node:test.

**Normative refs (read before coding):**

| Pri | Doc |
|-----|-----|
| 1 | [ADR-023](../../adr/023-voice-local-stt-path-b.md) L1–L16 · §6–7 · M0 row |
| 2 | [Path B SoT](../specs/2026-08-07-voice-local-stt-design.md) §6.1 · §7 · §8 `voice.model.*` only |
| 3 | [Spike report](../specs/2026-08-07-voice-local-stt-spike-report.md) — reuse `session-caps`, `binary-resolve` (no STT yet) |
| 4 | Patterns: `computer/model-download.ts`, `model-handlers.ts`, `server.ts` validateWsMessage computer.model.* |

**M0 out of scope (do not implement):**

- `voice.stt.*` / MediaRecorder / whisper-runner spawn / processing phase
- `cmspark-whisper` packaging
- auto-download on install, auto-update weights
- Pack-driven engine switch
- `audioCapture`
- Fake interim / auto-send

**M0 acceptance (Definition of Done):**

1. Settings: 听写方式 browser | local (UI draft); recommended **medium** primary; small + large-v3-turbo under “其他型号”.
2. Download / cancel / delete for each model id; progress broadcast; sha256 verify; no auto network on companion start.
3. Disk budget default **4096 MB** scoped to whisper root only (not Qwen parent double-count).
4. `set_engine local` refused until ≥1 model ready; `set_engine browser` always allowed via `source:"settings"`.
5. `get_state` returns engine, models readiness, binary probe (may be not_found — M1).
6. Pack apply strips/rejects voice risk keys (test).
7. CI: unit tests green; **zero** multi-GB download in CI (mock fetch).
8. No `voice.stt.*` handlers registered.

---

## File map (create / modify)

### Create

| Path | Responsibility |
|------|----------------|
| `companion/src/voice/whisper-catalog.ts` | Model ids, display meta, dir names, recommended id |
| `companion/src/voice/whisper-manifest.ts` | Zod schema + load in-repo manifest (no network) |
| `companion/assets/whisper-models.manifest.json` | Pinned files: url, sha256, size per model |
| `companion/src/voice/whisper-download.ts` | Download/delete/cancel; budget; progress; reuse download primitives style of `model-download.ts` |
| `companion/src/voice/whisper-handlers.ts` | `voice.model.*` handlers + settings belt |
| `companion/src/voice/whisper-state.ts` | Probe dirs → state DTO for get_state / broadcast |
| `companion/tests/voice-whisper-manifest.test.ts` | Schema + basename escape |
| `companion/tests/voice-whisper-download.test.ts` | Budget, hash, cancel, mock fetch |
| `companion/tests/voice-whisper-handlers.test.ts` | source fence, set_engine gates, pack-facing refusal |
| `companion/tests/voice-pack-deny.test.ts` | Pack cannot write voice keys |
| `scripts/pin-whisper-manifest.mjs` | Dev helper: fetch HEAD sizes + sha256 from HF (manual refresh; not runtime) |
| `chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts` | Pure UI copy + recommended id |
| `chrome-extension/tests/voice-whisper-settings-copy.test.ts` | Copy matrix |

### Modify

| Path | Change |
|------|--------|
| `companion/src/config.ts` | `VoiceConfig` + defaults + `setVoiceFields` |
| `companion/src/server.ts` | `validateWsMessage` for `voice.model.*` |
| `companion/src/message-router.ts` | Route `voice.model.*` → handlers |
| `companion/src/packs/pack-engine.ts` (and/or validator) | Deny/strip `voice*` / stt keys on apply |
| `chrome-extension/src/sidepanel/types.ts` | `VoiceModelState` types |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | Mirror voice model state + progress |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | Handle `voice.model.state` / `.progress` / errors |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | Voice section progressive UI |

### Already from spike (do not rewrite)

- `companion/src/voice/session-caps.ts` — import `STT_MODEL_IDS` / `isSttModelId`
- `companion/src/voice/binary-resolve.ts` — call from get_state only (status field)
- `chrome-extension/src/sidepanel/voice/local-stt-detect.ts` — unused in M0 UI except optional “本机能力” hint

---

## Task 0: Branch + baseline

- [ ] **Step 0.1:** Create branch `feat/voice-local-stt-m0` from updated `main`.

- [ ] **Step 0.2:** Confirm spike tests still green:

```bash
cd chrome-extension && npx tsx --test tests/voice-local-stt-spike.test.ts
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/voice-stt-session-core.test.js \
             .test-dist/tests/voice-binary-resolve.test.js
```

Expected: all pass.

---

## Task 1: Catalog + in-repo manifest

**Files:**
- Create: `companion/src/voice/whisper-catalog.ts`
- Create: `companion/src/voice/whisper-manifest.ts`
- Create: `companion/assets/whisper-models.manifest.json`
- Create: `companion/tests/voice-whisper-manifest.test.ts`
- Optional: `scripts/pin-whisper-manifest.mjs`

- [ ] **Step 1.1: Write failing catalog/manifest tests**

```ts
// companion/tests/voice-whisper-manifest.test.ts
import test from "node:test"
import assert from "node:assert/strict"
import { RECOMMENDED_WHISPER_MODEL, isWhisperModelId, whisperModelDirName } from "../src/voice/whisper-catalog"
import { loadWhisperManifest, WhisperManifestError } from "../src/voice/whisper-manifest"

test("recommended is medium", () => {
  assert.equal(RECOMMENDED_WHISPER_MODEL, "medium")
})

test("allowlist ids", () => {
  assert.equal(isWhisperModelId("small"), true)
  assert.equal(isWhisperModelId("tiny"), false)
})

test("dir names are basenames only", () => {
  assert.equal(whisperModelDirName("medium"), "medium")
  assert.doesNotMatch(whisperModelDirName("medium"), /[/\\]/)
})

test("loadWhisperManifest parses repo asset", () => {
  const m = loadWhisperManifest()
  assert.equal(m.schemaVersion, 1)
  assert.ok(m.models.medium.files.length >= 1)
  for (const f of m.models.medium.files) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/)
    assert.ok(f.url.startsWith("https://"))
    assert.doesNotMatch(f.name, /[/\\]/)
  }
})
```

- [ ] **Step 1.2: Run test — expect FAIL (modules missing)**

```bash
cd companion && npx tsc -p tsconfig.test.json 2>&1 | head -20
```

- [ ] **Step 1.3: Implement catalog**

```ts
// companion/src/voice/whisper-catalog.ts
import { STT_MODEL_IDS, type SttModelId, isSttModelId } from "./session-caps"

export type WhisperModelId = SttModelId
export { isSttModelId as isWhisperModelId, STT_MODEL_IDS as WHISPER_MODEL_IDS }

/** UI primary recommendation (SoT); S3 may later swap to turbo via one-line change. */
export const RECOMMENDED_WHISPER_MODEL: WhisperModelId = "medium"

export function whisperModelDirName(id: WhisperModelId): string {
  return id // basename only; path.join(root, id)
}

export const WHISPER_MODEL_UI: Record<
  WhisperModelId,
  { label: string; approxDiskGB: number; approxRamGB: number; notes: string }
> = {
  small: { label: "small", approxDiskGB: 0.5, approxRamGB: 1, notes: "轻量试水" },
  medium: { label: "medium（推荐）", approxDiskGB: 1.5, approxRamGB: 2.5, notes: "中文短指令默认推荐" },
  "large-v3-turbo": {
    label: "large-v3-turbo",
    approxDiskGB: 0.9,
    approxRamGB: 2,
    notes: "更快大模型蒸馏档",
  },
}

/** Default models root for whisper family only. */
export function defaultWhisperModelsRoot(dataDir: string): string {
  const path = require("node:path") as typeof import("node:path")
  return path.join(dataDir, "models", "whisper")
}
```

- [ ] **Step 1.4: Implement manifest loader**

Requirements for `whisper-manifest.ts`:

- Zod: `schemaVersion: 1`, `models: Record<id, { files: [{ name, url, sha256, size }] }>`
- `name` basename-only (`/^[^/\\]+$/`)
- `url` must `startsWith("https://")`
- `sha256` 64 hex lowercase
- Load **only** from package path next to compiled code / `companion/assets/whisper-models.manifest.json` — **never** network
- Throw `WhisperManifestError` if missing model id or corrupt

- [ ] **Step 1.5: Pin real manifest**

1. Run helper (or manual) against Hugging Face `ggerganov/whisper.cpp` ggml files, e.g.:
   - `ggml-small.bin`
   - `ggml-medium.bin`
   - `ggml-large-v3-turbo.bin` (or quant chosen in notes)
2. Write `companion/assets/whisper-models.manifest.json` with **real** sha256 + size.
3. Document in file header comment: refresh via `node scripts/pin-whisper-manifest.mjs`.

If network blocked in CI, commit the pinned JSON in-repo (required).

- [ ] **Step 1.6: Tests PASS**

```bash
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/voice-whisper-manifest.test.js
```

- [ ] **Step 1.7: Commit**

```bash
git add companion/src/voice/whisper-catalog.ts companion/src/voice/whisper-manifest.ts \
  companion/assets/whisper-models.manifest.json companion/tests/voice-whisper-manifest.test.ts \
  scripts/pin-whisper-manifest.mjs
git commit -m "feat(voice-m0): whisper catalog + in-repo model manifest"
```

---

## Task 2: Config.voice + disk budget helpers

**Files:**
- Modify: `companion/src/config.ts`
- Test: extend or add `companion/tests/voice-config.test.ts`

- [ ] **Step 2.1: Add types to config**

```ts
// In config.ts — new interface
export interface VoiceConfig {
  /** Default browser. Companion SoT (ADR-023). */
  sttEngine: "browser" | "local"
  /** Active model when engine=local; may be set only if ready. */
  localModelId: "small" | "medium" | "large-v3-turbo"
  /** Whisper family disk budget MB (default 4096). */
  modelDiskBudgetMB: number
  /** Optional override root; default DATA_DIR/models/whisper */
  modelRootDir?: string
}

// DEFAULT_CONFIG.voice:
voice: {
  sttEngine: "browser",
  localModelId: "medium",
  modelDiskBudgetMB: 4096,
},
```

- [ ] **Step 2.2: Add `setVoiceFields(partial)`** (mirror `setComputerModelFields`): deep-merge only `voice.*`, atomic write, broadcast `config.updated` if project already does for computer.

- [ ] **Step 2.3: Validate on load**

- `modelDiskBudgetMB` must be positive number; else reset 4096 + warn log
- `sttEngine` unknown → `"browser"`
- `localModelId` unknown → `"medium"`

- [ ] **Step 2.4: Unit test load defaults + setVoiceFields**

- [ ] **Step 2.5: Commit**

```bash
git commit -m "feat(voice-m0): config.voice defaults and setVoiceFields"
```

---

## Task 3: whisper-download (budget-scoped)

**Files:**
- Create: `companion/src/voice/whisper-download.ts`
- Create: `companion/tests/voice-whisper-download.test.ts`

**Reuse pattern from** `computer/model-download.ts` (https, Range, sha256, atomic rename, oversize abort) **but**:

- Destination root = `models/whisper/<modelId>/`
- **Budget dir = whisper root only** (`path.join(DATA_DIR,"models","whisper")`), **not** `dirname` of parent `models/`
- Single-flight per modelId (Map of AbortControllers)
- No auto-start on companion boot

- [ ] **Step 3.1: Failing tests**

```ts
test("budgetDir is whisper root not models parent", () => {
  // assert helper or download preflight uses .../models/whisper
})

test("hash mismatch deletes part and throws", async () => {
  // mock fetch returning wrong body
})

test("cancel aborts in-flight download", async () => {
  // abort signal
})

test("already complete same sha skips network", async () => {
  // file on disk with correct size+hash → zero fetch
})
```

- [ ] **Step 3.2: Implement API**

```ts
export type WhisperDownloadProgress = {
  modelId: string
  file: string
  receivedBytes: number
  totalBytes: number
}

export async function downloadWhisperModel(
  modelId: WhisperModelId,
  opts: {
    signal?: AbortSignal
    onProgress?: (p: WhisperDownloadProgress) => void
    fetchImpl?: typeof fetch
    budgetMB?: number
    rootDir?: string
  },
): Promise<void>

export async function deleteWhisperModel(modelId: WhisperModelId, rootDir?: string): Promise<void>

export function probeWhisperModelDir(
  modelId: WhisperModelId,
  rootDir?: string,
): { status: "ready" | "absent" | "incomplete"; error?: string }
```

- [ ] **Step 3.3: Tests PASS with mock fetch** (no real HF in CI)

- [ ] **Step 3.4: Commit**

```bash
git commit -m "feat(voice-m0): whisper download/delete with scoped disk budget"
```

---

## Task 4: whisper-state + handlers + WS fence

**Files:**
- Create: `companion/src/voice/whisper-state.ts`
- Create: `companion/src/voice/whisper-handlers.ts`
- Modify: `companion/src/server.ts` (`validateWsMessage`)
- Modify: `companion/src/message-router.ts`
- Create: `companion/tests/voice-whisper-handlers.test.ts`

### Message contract (M0)

| type | source | behavior |
|------|--------|----------|
| `voice.model.get_state` | any auth | return + optional broadcast state |
| `voice.model.download` | **settings** | start download; progress events |
| `voice.model.cancel` | **settings** | abort download |
| `voice.model.delete` | **settings** | delete dir; if active model deleted → force engine browser or clear ready |
| `voice.model.set_active` | **settings** | set `localModelId` only if ready |
| `voice.model.set_engine` | **settings** | `browser` always; `local` only if ≥1 ready **and** active ready |

Downlink:

```ts
// voice.model.state
{
  type: "voice.model.state",
  sttEngine: "browser" | "local",
  localModelId: string,
  recommendedModelId: "medium",
  models: Record<id, { status: "ready"|"absent"|"incomplete"|"downloading"; bytesOnDisk?: number }>,
  binary: { status: "ready"|"not_found"|"hash_mismatch"|"unsupported_arch"; path?: string },
  diskBudgetMB: number,
  diskUsedMB: number,
  whisperRoot: string, // display basename only if privacy-sensitive; full path OK in settings
}

// voice.model.progress
{ type: "voice.model.progress", modelId, file, receivedBytes, totalBytes }

// errors
{ type: "error", family: "voice.model", error: string, code?: string }
```

- [ ] **Step 4.1: validateWsMessage entries** (same pattern as computer.model)

```ts
"voice.model.get_state": () => ({ valid: true }),
"voice.model.download": (m) => {
  if (m.source !== "settings") return { valid: false, error: 'voice.model.download requires source:"settings"' }
  if (!isWhisperModelId(m.modelId)) return { valid: false, error: "invalid modelId" }
  return { valid: true }
},
// cancel, delete, set_active, set_engine similarly
```

- [ ] **Step 4.2: Handler belt** — even if validate passed, re-check `source === "settings"` on mutators (computer.model belt).

- [ ] **Step 4.3: set_engine local gate**

```ts
if (engine === "local") {
  const ready = listReadyModels()
  if (ready.length === 0) {
    return modelError("NO_READY_MODEL", { message: "请先下载本机模型" })
  }
  // ensure localModelId is ready; else set to recommended ready or refuse
}
```

- [ ] **Step 4.4: delete mutex with download** (same DOWNLOAD_IN_PROGRESS / DELETE_IN_PROGRESS as computer.model)

- [ ] **Step 4.5: Wire message-router** `case "voice.model.*": return handleVoiceModelMessage(...)`

- [ ] **Step 4.6: Tests**

- missing source → INVALID_SOURCE / validation fail  
- set_engine local with no ready → zero config write  
- download without settings → reject  
- get_state shape  

- [ ] **Step 4.7: Commit**

```bash
git commit -m "feat(voice-m0): voice.model.* handlers and WS validation"
```

---

## Task 5: Pack deny-list

**Files:**
- Modify: `companion/src/packs/pack-engine.ts` and/or `validator.ts`
- Create: `companion/tests/voice-pack-deny.test.ts`

- [ ] **Step 5.1:** On pack apply / install / save, strip or reject keys matching:

```ts
const VOICE_FORBIDDEN_KEY_RE = /^(voice|sttEngine|localModelId|voiceStt|voice_privacy|voiceAutoSend)/i
```

Also reject nested `config.voice` / `trust.voice` if pack schema allows free config merge.

- [ ] **Step 5.2: Test** — pack with `voice.sttEngine: "local"` does not change `getConfig().voice.sttEngine`.

- [ ] **Step 5.3: Commit**

```bash
git commit -m "fix(voice-m0): pack cannot write voice engine or model keys"
```

---

## Task 6: Extension types + store + WS mirror

**Files:**
- Modify: `chrome-extension/src/sidepanel/types.ts`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`

- [ ] **Step 6.1: Types**

```ts
export type VoiceModelStatus = "ready" | "absent" | "incomplete" | "downloading"

export interface VoiceModelState {
  sttEngine: "browser" | "local"
  localModelId: string
  recommendedModelId: string
  models: Record<string, { status: VoiceModelStatus; bytesOnDisk?: number }>
  binary: { status: string; path?: string }
  diskBudgetMB: number
  diskUsedMB: number
  whisperRoot?: string
}

export interface VoiceModelProgress {
  modelId: string
  file: string
  receivedBytes: number
  totalBytes: number
}
```

- [ ] **Step 6.2: agentStore**

- State: `voiceModel: VoiceModelState | null`, `voiceModelProgress: VoiceModelProgress | null`, `voiceModelError: string | null`
- Actions: `SET_VOICE_MODEL_STATE`, `SET_VOICE_MODEL_PROGRESS`, `SET_VOICE_MODEL_ERROR`
- On non-downloading state, clear progress (mirror computer.model)

- [ ] **Step 6.3: useWebSocket**

```ts
case "voice.model.state":
  dispatch({ type: "SET_VOICE_MODEL_STATE", state: msg /* mapped */ })
  break
case "voice.model.progress":
  dispatch({ type: "SET_VOICE_MODEL_PROGRESS", progress: { ... } })
  break
// error family === "voice.model" → SET_VOICE_MODEL_ERROR
```

- [ ] **Step 6.4: On settings open** — send `{ type: "voice.model.get_state" }` (alongside computer.model.get_state if already there).

- [ ] **Step 6.5: Persist lastKnown mirror (SoT §7)**

On each `voice.model.state`:

```ts
chrome.storage.local.set({
  lastKnownVoiceEngine: state.sttEngine,
  lastKnownVoiceModelId: state.localModelId,
})
```

M0: **do not** change mic start logic yet (still browser-only path).

- [ ] **Step 6.6: Commit**

```bash
git commit -m "feat(voice-m0): extension mirror for voice.model state"
```

---

## Task 7: Settings UI (progressive disclosure)

**Files:**
- Create: `chrome-extension/src/sidepanel/voice/whisper-settings-copy.ts`
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` (voice block ~914–957)
- Create: `chrome-extension/tests/voice-whisper-settings-copy.test.ts`

### UX locks (SoT §6.1)

```text
[x] 启用语音输入   (existing chrome.storage)

听写方式
  (•) 浏览器听写 — ...
  ( ) 本机转写 — ...
        └ UI draft expanded when local radio selected:
            推荐 medium [下载|取消|删除] + progress
            其他型号 ▸ small · large-v3-turbo
            disk used / budget
            binary status (not_found OK in M0)
```

- [ ] **Step 7.1: UI draft state (chicken-and-egg)**

```ts
// local component state
const [engineDraft, setEngineDraft] = useState<"browser" | "local">("browser")
// Sync draft FROM companion state when state arrives:
// if voiceModel.sttEngine === "local" → draft local
// Selecting local radio sets draft only — does NOT send set_engine until ready
```

- [ ] **Step 7.2: Commit engine**

```ts
function commitEngine(engine: "browser" | "local") {
  send({ type: "voice.model.set_engine", engine, source: "settings" })
}
// Call commitEngine("local") only when models[active].status === "ready"
// After successful download of recommended, offer "启用本机转写" button → set_engine local
```

- [ ] **Step 7.3: Privacy copy**

- When draft/engine is **browser**: keep M1 cloud STT wording.
- When draft/engine is **local**: **must not** say “音频不经过 Companion”; use Path B dual-engine residual one-liner (SoT §5).

- [ ] **Step 7.4: Download buttons**

```ts
send({ type: "voice.model.download", modelId: "medium", source: "settings" })
send({ type: "voice.model.cancel", modelId: "medium", source: "settings" })
send({ type: "voice.model.delete", modelId: "medium", source: "settings" })
send({ type: "voice.model.set_active", modelId: "medium", source: "settings" })
```

- [ ] **Step 7.5: Progress UI** — percent from `receivedBytes/totalBytes`; clear on state ready/absent.

- [ ] **Step 7.6: Pure copy tests** — recommended id medium; forbidden strings for local mode.

- [ ] **Step 7.7: Manual smoke (implementer)**

1. Companion running, open settings  
2. Expand 本机转写 draft  
3. Download medium (real network once)  
4. Progress moves; state ready  
5. Enable 本机转写 → get_state engine=local  
6. Delete model → engine forced back browser or set_engine fails closed  
7. Browser mic still works (M1 path)

- [ ] **Step 7.8: Commit**

```bash
git commit -m "feat(voice-m0): settings UI for local STT model download"
```

---

## Task 8: Docs + gate note

**Files:**
- Modify: `docs/superpowers/specs/2026-08-07-voice-local-stt-design.md` (M0 checkbox if any)
- Modify: `docs/adr/023-voice-local-stt-path-b.md` M0 status line when done
- Optional short: `docs/superpowers/plans/2026-08-07-voice-local-stt-m0-COMPLETION.md` after ship

- [ ] **Step 8.1:** Mark M0 ship note: no STT WS; human S0–S2 still pending for M1.

- [ ] **Step 8.2: Full test sweep**

```bash
cd companion && npm test 2>&1 | tail -30
cd chrome-extension && npx tsx --test tests/voice-*.test.ts
```

- [ ] **Step 8.3: Final commit / PR**

```bash
git commit -m "docs(voice-m0): mark M0 complete gates"
```

PR title: `feat(voice): Path B M0 — Whisper model download + settings`

PR body must include ADR-020 checklist from ADR-023 §3.

---

## Testing matrix (M0)

| Case | Automated | Manual |
|------|-----------|--------|
| Manifest parse + basename | yes | |
| Budget scoped to whisper root | yes | |
| Mock download hash fail | yes | |
| settings source fence | yes | |
| set_engine local without ready | yes | |
| Pack cannot set voice | yes | |
| Real download medium once | | yes |
| UI draft before commit engine | | yes |
| Browser privacy copy vs local | | yes |
| M1 mic still works engine=browser | | yes |

---

## Risk register (M0)

| Risk | Mitigation |
|------|------------|
| HF rate limit / China network | downloadSource later; M0 single https URL; document mirror as M0.1 if needed |
| Wrong sha256 in manifest | pin script + CI test load only (not re-download) |
| UI commits engine before ready | UI draft rule + server refuse |
| Double-count disk with Qwen | budgetDir = whisper root only (Task 3) |
| Scope creep into STT WS | checklist “no voice.stt handlers” in PR |

---

## Spec coverage self-check

| SoT / ADR M0 item | Task |
|-------------------|------|
| Default browser | T2, T4, T7 |
| medium recommended; others folded | T1, T7 |
| User download/cancel/delete | T3, T4, T7 |
| https + sha256 + no auto update | T1, T3 |
| Disk budget 4096 whisper-scoped | T2, T3 |
| source:settings mutators | T4 |
| set_engine local only when ready | T4, T7 |
| Companion SoT engine/model | T2, T4 |
| Pack deny voice* | T5 |
| No voice.stt.* | whole plan out-of-scope |
| lastKnown mirror | T6 |
| Dual privacy copy | T7 |

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-voice-local-stt-m0-impl.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session implements Task 1→8 with checkpoints  

Which approach?
