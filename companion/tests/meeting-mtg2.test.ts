/**
 * Meeting Mtg2: silence-cut, speakers, import_text.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mtg2-"))

import {
  silenceCutText,
  applySilenceCut,
  applySpeakersByIndex,
  bulkSetSpeaker,
  parseSpeakerPrefix,
  formatTranscriptLines,
} from "../src/meeting/silence-cut"
import { createMeeting, loadMeeting } from "../src/meeting/meeting-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const DATA = process.env.CMSPARK_DATA_DIR!
const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

test("parseSpeakerPrefix", () => {
  assert.deepEqual(parseSpeakerPrefix("张三: 你好"), { speaker: "张三", text: "你好" })
  assert.deepEqual(parseSpeakerPrefix("Alice：hello"), { speaker: "Alice", text: "hello" })
  assert.equal(parseSpeakerPrefix("no prefix here").speaker, undefined)
})

test("silenceCutText splits paragraphs and prefixes", () => {
  const lines = silenceCutText(
    "张三: 第一段内容。\n\n李四: 第二段\n\n第三段无说话人",
    "paste",
  )
  assert.ok(lines.length >= 3)
  assert.equal(lines[0]!.speaker, "张三")
  assert.equal(lines[1]!.speaker, "李四")
  assert.equal(lines[2]!.speaker, undefined)
  assert.match(lines[2]!.text, /第三段/)
})

test("applySpeakersByIndex + bulkSetSpeaker", () => {
  const base = silenceCutText("a\n\nb\n\nc", "paste")
  const labeled = applySpeakersByIndex(base, [
    { index: 0, speaker: "我" },
    { index: 1, speaker: "对方" },
  ])
  assert.equal(labeled[0]!.speaker, "我")
  assert.equal(labeled[1]!.speaker, "对方")
  const all = bulkSetSpeaker(labeled, "我")
  assert.ok(all.every((l) => l.speaker === "我"))
  const cleared = bulkSetSpeaker(all, null)
  assert.ok(cleared.every((l) => !l.speaker))
})

test("applySilenceCut untimed re-parses speaker prefixes", () => {
  const lines = [
    { text: "张三: 甲", source: "paste" as const },
    { text: "乙句", source: "paste" as const },
  ]
  const cut = applySilenceCut(lines)
  assert.ok(cut.length >= 1)
  const fmt = formatTranscriptLines(cut)
  assert.match(fmt, /甲|乙/)
})

test("handler apply_silence_cut + set_speakers + bulk + import_text", async () => {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "Mtg2" },
    { origin: EXT },
  )
  const id = created.meeting.id as string

  await handleMeetingMessage(
    {
      type: "meeting.set_transcript",
      v: 1,
      id,
      text: "第一段。\n\n第二段。",
      source: "paste",
      silence_cut: true,
    },
    { origin: EXT },
  )

  const cut = await handleMeetingMessage(
    { type: "meeting.apply_silence_cut", v: 1, id },
    { origin: EXT },
  )
  assert.equal(cut.type, "meeting.updated")
  assert.ok(cut.meeting.transcript.length >= 2)

  const sp = await handleMeetingMessage(
    {
      type: "meeting.set_speakers",
      v: 1,
      id,
      assignments: [
        { index: 0, speaker: "我" },
        { index: 1, speaker: "对方" },
      ],
    },
    { origin: EXT },
  )
  assert.equal(sp.meeting.transcript[0].speaker, "我")
  assert.equal(sp.meeting.transcript[1].speaker, "对方")

  const bulk = await handleMeetingMessage(
    { type: "meeting.bulk_speaker", v: 1, id, speaker: "全员" },
    { origin: EXT },
  )
  assert.ok(bulk.meeting.transcript.every((l: any) => l.speaker === "全员"))

  const imp = await handleMeetingMessage(
    {
      type: "meeting.import_text",
      v: 1,
      privacy_ack_v1: true,
      title: "导入会",
      text: "甲: 决议通过。\n\n乙: 下周跟进。",
    },
    { origin: EXT },
  )
  assert.equal(imp.type, "meeting.imported")
  assert.ok(imp.meeting.transcript.length >= 2)
  assert.equal(imp.meeting.transcript[0].speaker, "甲")

  const needAck = await handleMeetingMessage(
    { type: "meeting.import_text", v: 1, text: "x" },
    { origin: EXT },
  )
  assert.equal(needAck.code, "need_privacy_ack")

  // disk still under DATA
  assert.ok(loadMeeting(id, DATA))
  assert.ok(createMeeting({ title: "x", dataDir: DATA }).id)
})
