/**
 * P1 Meeting: retain_until audio GC
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  createMeeting,
  startMeetingRecording,
  gcExpiredMeetingAudio,
  loadMeeting,
  saveMeeting,
  meetingAudioDir,
} from "../src/meeting/meeting-store"

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mtg-gc-"))

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test("gcExpiredMeetingAudio purges past retain_until", () => {
  const s = createMeeting({ title: "gc-test", dataDir })
  assert.ok(s)
  startMeetingRecording(s.id, { audio_retained: true, retain_days: 1 }, dataDir)
  const audio = meetingAudioDir(s.id, dataDir)
  assert.ok(audio)
  fs.writeFileSync(path.join(audio!, "clip.wav"), "fake")

  // Force retain_until into the past
  const full = loadMeeting(s.id, dataDir)!
  full.privacy.retain_until = new Date(Date.now() - 60_000).toISOString()
  saveMeeting(full, dataDir)

  const r = gcExpiredMeetingAudio(dataDir, new Date())
  assert.ok(r.purged >= 1)
  assert.equal(fs.existsSync(path.join(audio!, "clip.wav")), false)
  const after = loadMeeting(s.id, dataDir)!
  assert.equal(after.privacy.audio_retained, false)
  assert.equal(after.privacy.retain_until, null)
})

test("gcExpiredMeetingAudio skips future retain_until", () => {
  const s = createMeeting({ title: "gc-future", dataDir })
  startMeetingRecording(s.id, { audio_retained: true, retain_days: 7 }, dataDir)
  const audio = meetingAudioDir(s.id, dataDir)!
  fs.writeFileSync(path.join(audio, "keep.wav"), "keep")
  gcExpiredMeetingAudio(dataDir, new Date())
  // This meeting's retain is in the future — file remains
  assert.equal(fs.existsSync(path.join(audio, "keep.wav")), true)
})
