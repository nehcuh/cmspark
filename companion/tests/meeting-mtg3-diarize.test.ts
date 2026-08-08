/**
 * Meeting Mtg3 auto-diarize (local k-means, anonymous labels).
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mtg3-"))

import {
  kMeansCluster,
  diarizeByAudioFeatures,
  diarizeByTextGap,
  applyDiarizeToLines,
  extractSegmentFeatures,
  diarizeLabel,
  clampDiarizeK,
} from "../src/meeting/auto-diarize"
import { createMeeting, loadMeeting } from "../src/meeting/meeting-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"
const DATA = process.env.CMSPARK_DATA_DIR!

test("clampDiarizeK and labels", () => {
  assert.equal(clampDiarizeK(1), 2)
  assert.equal(clampDiarizeK(9), 4)
  assert.equal(diarizeLabel(0), "发言人1")
})

test("kMeansCluster separates two energy peaks", () => {
  const feats = [
    [0.1, 0.1, 0.1],
    [0.12, 0.11, 0.1],
    [2.0, 0.5, 0.8],
    [2.1, 0.48, 0.75],
  ]
  const c = kMeansCluster(feats, 2)
  assert.equal(c.length, 4)
  // first two same cluster, last two same, different groups
  assert.equal(c[0], c[1])
  assert.equal(c[2], c[3])
  assert.notEqual(c[0], c[2])
})

test("extractSegmentFeatures silence vs tone", () => {
  const silent = new Float32Array(1600)
  const loud = new Float32Array(1600)
  for (let i = 0; i < loud.length; i++) loud[i] = Math.sin(i / 8) * 0.9
  const fs = extractSegmentFeatures(silent, 16000)
  const fl = extractSegmentFeatures(loud, 16000)
  assert.ok(fl[0]! > fs[0]!)
})

test("diarizeByAudioFeatures assigns 发言人N", () => {
  const lines = [
    { text: "a", source: "stt" as const },
    { text: "b", source: "stt" as const },
    { text: "c", source: "stt" as const },
    { text: "d", source: "stt" as const },
  ]
  const features = [
    [0.1, 0.1, 0.1],
    [0.11, 0.1, 0.1],
    [2.0, 0.5, 0.8],
    [2.05, 0.5, 0.8],
  ]
  const r = diarizeByAudioFeatures(lines, features, 2)
  assert.equal(r.method, "audio_cluster")
  assert.equal(r.experimental, true)
  assert.ok(r.speakers.every((s) => s && s.startsWith("发言人")))
  const applied = applyDiarizeToLines(lines, r)
  assert.equal(applied[0]!.speaker, r.speakers[0])
})

test("diarizeByTextGap alternates", () => {
  const lines = [
    { text: "1", source: "paste" as const },
    { text: "2", source: "paste" as const },
    { text: "3", source: "paste" as const },
  ]
  const r = diarizeByTextGap(lines, 2)
  assert.equal(r.method, "text_gap")
  assert.equal(r.speakers[0], "发言人1")
  assert.equal(r.speakers[1], "发言人2")
  assert.equal(r.speakers[2], "发言人1")
})

test("handler auto_diarize audio_cluster + ack", async () => {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "Diarize" },
    { origin: EXT },
  )
  const id = created.meeting.id as string
  await handleMeetingMessage(
    {
      type: "meeting.set_transcript",
      v: 1,
      id,
      text: "第一段\n\n第二段\n\n第三段\n\n第四段",
      silence_cut: true,
    },
    { origin: EXT },
  )
  const m = loadMeeting(id, DATA)!
  assert.ok(m.transcript.length >= 4)

  const need = await handleMeetingMessage(
    { type: "meeting.auto_diarize", v: 1, id, mode: "audio_cluster", features: [[0, 0, 0]] },
    { origin: EXT },
  )
  assert.equal(need.code, "need_privacy_ack")

  const feats = m.transcript.map((_, i) => (i < 2 ? [0.1, 0.1, 0.1] : [2.0, 0.5, 0.8]))
  const ok = await handleMeetingMessage(
    {
      type: "meeting.auto_diarize",
      v: 1,
      id,
      privacy_ack_v1: true,
      mode: "audio_cluster",
      k: 2,
      features: feats,
    },
    { origin: EXT },
  )
  assert.equal(ok.type, "meeting.diarized")
  assert.equal(ok.meeting.diarize.method, "audio_cluster")
  assert.ok(ok.meeting.transcript.every((l: any) => String(l.speaker || "").startsWith("发言人")))

  const gap = await handleMeetingMessage(
    {
      type: "meeting.auto_diarize",
      v: 1,
      id,
      privacy_ack_v1: true,
      mode: "text_gap",
      k: 2,
      text: "甲\n\n乙\n\n丙",
    },
    { origin: EXT },
  )
  assert.equal(gap.type, "meeting.diarized")
  assert.equal(gap.meeting.diarize.method, "text_gap")
})

test("createMeeting has diarize null", () => {
  const m = createMeeting({ title: "x", dataDir: DATA })
  assert.equal(m.diarize, null)
})

test("handler features_mismatch and features_required", async () => {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "mm" },
    { origin: EXT },
  )
  const id = created.meeting.id as string
  await handleMeetingMessage(
    {
      type: "meeting.set_transcript",
      v: 1,
      id,
      text: "a\nb",
      silence_cut: false,
    },
    { origin: EXT },
  )
  const req = await handleMeetingMessage(
    {
      type: "meeting.auto_diarize",
      v: 1,
      id,
      privacy_ack_v1: true,
      mode: "audio_cluster",
    },
    { origin: EXT },
  )
  assert.equal(req.code, "features_required")

  const mis = await handleMeetingMessage(
    {
      type: "meeting.auto_diarize",
      v: 1,
      id,
      privacy_ack_v1: true,
      mode: "audio_cluster",
      features: [[0, 0, 0]],
    },
    { origin: EXT },
  )
  assert.equal(mis.code, "features_mismatch")
})

test("applyDiarizeToLines preserveManual keeps hand labels", () => {
  const lines = [
    { text: "a", source: "paste" as const, speaker: "张三" },
    { text: "b", source: "paste" as const },
  ]
  const r = diarizeByTextGap(lines, 2)
  const kept = applyDiarizeToLines(lines, r, { preserveManual: true })
  assert.equal(kept[0]!.speaker, "张三")
  assert.equal(kept[1]!.speaker, r.speakers[1])
})
