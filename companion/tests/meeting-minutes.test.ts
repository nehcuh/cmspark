/**
 * Meeting minutes Mtg0/Mtg1 store + generate + handlers.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

process.env.CMSPARK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-meeting-"))

import {
  createMeeting,
  loadMeeting,
  setTranscript,
  setMinutes,
  listMeetings,
  transcriptToText,
  startMeetingRecording,
  endMeetingRecording,
  meetingAudioDir,
  deleteMeetingAudio,
} from "../src/meeting/meeting-store"
import { generateMeetingMinutes } from "../src/meeting/meeting-minutes"
import { MEETING_MINUTES_SYSTEM_PROMPT } from "../src/meeting/minutes-prompt"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const DATA = process.env.CMSPARK_DATA_DIR!
const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

test("MEETING_MINUTES_SYSTEM_PROMPT is distinct job and forbids invention", () => {
  assert.match(MEETING_MINUTES_SYSTEM_PROMPT, /meeting_minutes/)
  assert.match(MEETING_MINUTES_SYSTEM_PROMPT, /Do NOT invent/)
  assert.doesNotMatch(MEETING_MINUTES_SYSTEM_PROMPT, /ASR post-editor/)
})

test("create/load/list meeting on disk", () => {
  const m = createMeeting({ title: "周会", thread_id: "t1", dataDir: DATA })
  assert.ok(m.id.startsWith("mtg_"))
  const loaded = loadMeeting(m.id, DATA)
  assert.equal(loaded?.title, "周会")
  assert.equal(loaded?.thread_id, "t1")
  const list = listMeetings(DATA)
  assert.ok(list.some((x) => x.id === m.id))
})

test("setTranscript + generateMeetingMinutes mock", async () => {
  const m = createMeeting({ title: "测", dataDir: DATA })
  setTranscript(
    m.id,
    [{ text: "今天决定下周发布，张三负责写文档。", source: "paste" }],
    DATA,
  )
  const text = transcriptToText(loadMeeting(m.id, DATA)!.transcript)
  const r = await generateMeetingMinutes({
    transcriptText: text,
    config: {
      base_url: "https://x.invalid",
      api_key: "k",
      model_name: "m",
      temperature: 0.5,
    },
    extract: async () => `### TL;DR
下周发布。

### 决议
- 下周发布

### 待办
- [ ] 写文档（张三）

### 风险 / 开放问题
- 无
`,
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.match(r.minutes.raw_md, /TL;DR/)
    assert.ok((r.minutes.actions || []).length >= 1)
    setMinutes(m.id, r.minutes, DATA)
    const again = loadMeeting(m.id, DATA)
    assert.equal(again?.status, "done")
    assert.ok(fs.existsSync(path.join(DATA, "meetings", m.id, "minutes.md")))
  }
})

test("handler origin denied", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.create", v: 1 },
    { origin: "cmspark-tray://local" },
  )
  assert.equal(res.code, "origin_denied")
})

test("handler generate ephemeral paste", async () => {
  const res = await handleMeetingMessage(
    {
      type: "meeting.generate_minutes",
      v: 1,
      text: "会议决定采用方案 A，李四跟进。",
    },
    { origin: EXT },
    {
      getLlmConfig: () => ({
        base_url: "https://x",
        api_key: "k",
        model_name: "m",
        temperature: 0.2,
      }),
      generate: async () => ({
        ok: true as const,
        minutes: {
          raw_md: "### TL;DR\nok\n\n### 决议\n- A\n\n### 待办\n- [ ] 跟进\n\n### 风险 / 开放问题\n- 无",
          generated_at: new Date().toISOString(),
          tldr: "ok",
          decisions: ["A"],
          actions: ["跟进"],
          risks: ["无"],
        },
      }),
    },
  )
  assert.equal(res.type, "meeting.minutes_result")
  assert.equal(res.meeting, null)
  assert.match(res.minutes.raw_md, /TL;DR/)
})

test("handler create + set_transcript + generate", async () => {
  const created = await handleMeetingMessage(
    { type: "meeting.create", v: 1, title: "产品会" },
    { origin: EXT },
  )
  assert.equal(created.type, "meeting.created")
  const id = created.meeting.id
  await handleMeetingMessage(
    {
      type: "meeting.set_transcript",
      v: 1,
      id,
      text: "决定延期两周。\n无负责人。",
      source: "paste",
    },
    { origin: EXT },
  )
  const gen = await handleMeetingMessage(
    { type: "meeting.generate_minutes", v: 1, id },
    { origin: EXT },
    {
      getLlmConfig: () => ({
        base_url: "https://x",
        api_key: "k",
        model_name: "m",
        temperature: 0.2,
      }),
      generate: async ({ transcriptText }) => {
        assert.match(transcriptText, /延期/)
        return {
          ok: true as const,
          minutes: {
            raw_md: "### TL;DR\n延期\n\n### 决议\n- 延期两周\n\n### 待办\n- [ ] 未指定\n\n### 风险 / 开放问题\n- 无",
            generated_at: new Date().toISOString(),
          },
        }
      },
    },
  )
  assert.equal(gen.type, "meeting.minutes_result")
  assert.equal(gen.meeting.status, "done")
})

test("start requires privacy_ack_v1", async () => {
  const res = await handleMeetingMessage(
    { type: "meeting.start", v: 1, title: "无 ack" },
    { origin: EXT },
  )
  assert.equal(res.code, "need_privacy_ack")
})

test("start/end live capture + default delete audio", async () => {
  const started = await handleMeetingMessage(
    {
      type: "meeting.start",
      v: 1,
      title: "录制会",
      privacy_ack_v1: true,
      audio_retained: false,
    },
    { origin: EXT },
  )
  assert.equal(started.type, "meeting.started")
  assert.equal(started.meeting.status, "recording")
  assert.equal(started.meeting.privacy.stt_engine, "local")
  const id = started.meeting.id as string

  // Simulate residual durable audio under meetings/<id>/audio
  const audioDir = meetingAudioDir(id, DATA)!
  fs.mkdirSync(audioDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(path.join(audioDir, "seg0.wav"), Buffer.from("fake"), { mode: 0o600 })
  assert.ok(fs.existsSync(path.join(audioDir, "seg0.wav")))

  await handleMeetingMessage(
    {
      type: "meeting.append_transcript",
      v: 1,
      id,
      text: "第一段本机转写内容。",
      source: "stt",
    },
    { origin: EXT },
  )

  const ended = await handleMeetingMessage(
    { type: "meeting.end", v: 1, id },
    { origin: EXT },
  )
  assert.equal(ended.type, "meeting.ended")
  assert.equal(ended.meeting.status, "ready")
  assert.equal(ended.audio_deleted, true)
  assert.equal(fs.existsSync(path.join(audioDir, "seg0.wav")), false)
})

test("endMeetingRecording retains audio when opt-in", () => {
  const m = createMeeting({ title: "保留音频", dataDir: DATA })
  startMeetingRecording(m.id, { audio_retained: true, retain_days: 3 }, DATA)
  const audioDir = meetingAudioDir(m.id, DATA)!
  fs.mkdirSync(audioDir, { recursive: true })
  fs.writeFileSync(path.join(audioDir, "keep.wav"), "x")
  const r = endMeetingRecording(m.id, DATA)
  assert.ok(r)
  assert.equal(r!.audioDeleted, false)
  assert.ok(fs.existsSync(path.join(audioDir, "keep.wav")))
  // cleanup
  deleteMeetingAudio(m.id, DATA)
})
