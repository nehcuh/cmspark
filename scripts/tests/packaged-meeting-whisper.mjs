// Run with the package's own Node on the target architecture, after building companion.
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { SttSessionService } from "../../companion/dist/voice/stt-session-service.js"
import { downloadWhisperModel, probeWhisperModelDir } from "../../companion/dist/voice/whisper-download.js"
import { resolveWhisperArch, resolveWhisperBinary } from "../../companion/dist/voice/binary-resolve.js"
import { expectedWhisperSha256 } from "../../companion/dist/voice/whisper-binary-pins.js"

const [stage, expectedArch, fixturePath, modelRoot, modelId = "small"] = process.argv.slice(2)
assert.equal(resolveWhisperArch(), expectedArch)
const packaged = resolveWhisperBinary({
  searchRoots: [path.resolve(stage, "bin")],
  expectedSha256: expectedWhisperSha256(expectedArch),
  allowUnpinned: false,
})
assert.ok(packaged.ok && packaged.pinned, JSON.stringify(packaged))
const wav = await readFile(fixturePath)
// Upstream samples/jfk.wav is 16 kHz mono PCM with a LIST chunk before its data.
assert.equal(createHash("sha256").update(wav).digest("hex"), "59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e")
const data = wav.indexOf("data", 36, "ascii")
assert.ok(data > 36)
const pcm = wav.subarray(data + 8, data + 8 + wav.readUInt32LE(data + 4))
if (probeWhisperModelDir(modelId, modelRoot).status !== "ready") {
  await downloadWhisperModel(modelId, { rootDir: modelRoot })
}

const dataDir = await mkdtemp(path.join(tmpdir(), "cmspark-packaged-meeting-"))
try {
  const service = new SttSessionService({ dataDir, whisperRoot: modelRoot, companionRoot: stage })
  const peer = "package-smoke"
  const identity = { meeting_id: "mtg_packaged", capture_id: randomUUID(), capture_epoch: 1 }
  const request = { sessionId: identity.capture_id, modelId, format: "pcm_s16le", sampleRate: 16000, channels: 1, lang: "en" }
  const transcripts = []
  let finish
  const terminal = new Promise(resolve => { finish = resolve })
  const capture = service.reserveMeetingCapture(identity, peer, {
    persist(_segment, result) { transcripts.push(result.text) },
    checkpoint() {},
    send(status) { if (status.phase === "finished" || status.phase === "failed") finish(status) },
  })
  assert.ok(capture)
  assert.deepEqual(service.prepareMeetingCapture(request, peer, identity.capture_id, 1), { ok: true })
  for (let offset = 0; offset < pcm.length / 2;) {
    const credit = capture.queue.credits()[0]
    assert.equal(credit.sample_offset, offset)
    const frames = Math.min(credit.max_frames, pcm.length / 2 - offset)
    capture.append(credit.credit_id, offset, frames, pcm.subarray(offset * 2, (offset + frames) * 2))
    offset += frames
  }
  capture.seal(pcm.length / 2, "user_stop")
  const status = await terminal
  assert.equal(status.completion.outcome, "complete", JSON.stringify(status))
  const transcript = transcripts.join(" ")
  assert.match(transcript, /country can do for you/i)
  assert.match(transcript, /can do for your country/i)
  console.log(`${expectedArch} (${modelId}) · ${transcript}`)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
