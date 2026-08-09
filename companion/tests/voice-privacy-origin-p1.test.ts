/**
 * P1: voice.model origin fence + privacy_ack_v2 + stt engine gate
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-voice-p1-"))

let handleVoiceModelMessage: typeof import("../src/voice/whisper-handlers").handleVoiceModelMessage
let handleVoiceSttMessage: typeof import("../src/voice/stt-handlers").handleVoiceSttMessage
let setVoiceFields: typeof import("../src/config").setVoiceFields
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  const cfg = await import("../src/config")
  const wh = await import("../src/voice/whisper-handlers")
  const st = await import("../src/voice/stt-handlers")
  initDataDir = cfg.initDataDir
  setVoiceFields = cfg.setVoiceFields
  handleVoiceModelMessage = wh.handleVoiceModelMessage
  handleVoiceSttMessage = st.handleVoiceSttMessage
  await initDataDir()
})

const extOrigin = "chrome-extension://abcdefghijklmnop"

test("voice.model.get_state refuses non-extension origin", async () => {
  const r: any = await handleVoiceModelMessage(
    { type: "voice.model.get_state" },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "ORIGIN_DENIED")
})

test("voice.model.set_engine local requires privacy_ack_v2", async () => {
  const r: any = await handleVoiceModelMessage(
    { type: "voice.model.set_engine", engine: "local", source: "settings" },
    { origin: extOrigin },
    {
      listReady: () => ["medium" as any],
      probe: () => ({ status: "ready" as const }),
    },
  )
  assert.equal(r.type, "error")
  assert.equal(r.code, "NEED_PRIVACY_ACK")
})

test("voice.stt.start refuses when sttEngine is browser", async () => {
  setVoiceFields({ sttEngine: "browser" })
  const r: any = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "sess-abc12345",
      modelId: "medium",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
      privacy_ack_v2: true,
    },
    { origin: extOrigin, peerId: "panel-1" },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "engine_not_local")
})

test("voice.stt.start refuses without privacy_ack_v2", async () => {
  setVoiceFields({ sttEngine: "local", localModelId: "medium" })
  const r: any = await handleVoiceSttMessage(
    {
      type: "voice.stt.start",
      v: 1,
      sessionId: "sess-abc12346",
      modelId: "medium",
      format: "wav",
      sampleRate: 16000,
      channels: 1,
    },
    { origin: extOrigin, peerId: "panel-1" },
  )
  assert.equal(r.type, "voice.stt.error")
  assert.equal(r.code, "need_privacy_ack")
})
