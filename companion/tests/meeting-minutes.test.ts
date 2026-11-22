/**
 * Meeting minutes Mtg0/Mtg1 store + generate + handlers.
 *
 * Import order matters: meeting-test-data-dir must run before config/DATA_DIR
 * (ESM hoists imports ahead of any body-level env assignment).
 */
import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"

import { DATA_DIR } from "../src/config"
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
import { groundDefaultMinutes } from "../src/meeting/minutes-evidence"
import {
  buildMinutesSystemPrompt,
  MEETING_MINUTES_MAX_TEMPLATE_CHARS,
  MEETING_MINUTES_SYSTEM_PROMPT,
} from "../src/meeting/minutes-prompt"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { generateFixtureMinutes } from "./meeting-minutes-test-helper"
import { MEETING_TEST_DATA_DIR } from "./meeting-test-data-dir"

/** Same root handlers use (config.DATA_DIR after env bootstrap). */
const DATA = DATA_DIR
assert.equal(
  DATA,
  MEETING_TEST_DATA_DIR,
  "DATA_DIR must match CMSPARK_DATA_DIR bootstrap (import order)",
)
const EXT = "chrome-extension://abcdefghijklmnopqrstuvwxyz"

test("default minutes keep grounded synthesis and omit invented or uncited claims", () => {
  const raw = "There are three stages. Morgan will review the drawings."
  const md = groundDefaultMinutes("### TL;DR\n- 共三个阶段〔There are three stages.〕\n### 决议\n- 分为草案、原型、测试。\n### 待办\n- [ ] Morgan 审图〔Morgan will review the drawings.〕\n- [ ] 明天完成〔tomorrow〕\n### 风险 / 开放问题\n无明确记录", raw)
  assert.ok(md)
  assert.match(md, /共三个阶段/)
  assert.match(md, /Morgan 审图/)
  assert.doesNotMatch(md, /原型|明天完成/)
  assert.match(md, /2 条概括/)
  const legacy = groundDefaultMinutes("### TL;DR\nThere are three stages.", raw)
  assert.ok(legacy)
  assert.match(legacy, /- There are three stages\./)
  assert.doesNotMatch(legacy, /未返回/)
  assert.match(groundDefaultMinutes('### TL;DR\n- 概括〔"There are three stages."〕', raw) ?? "", /- 概括/)
  assert.equal(groundDefaultMinutes("### TL;DR\n- fabricated summary", raw), undefined)
})

test("MEETING_MINUTES_SYSTEM_PROMPT is distinct job and forbids invention", () => {
  assert.match(MEETING_MINUTES_SYSTEM_PROMPT, /meeting_minutes/)
  assert.match(MEETING_MINUTES_SYSTEM_PROMPT, /Do NOT invent/)
  assert.doesNotMatch(MEETING_MINUTES_SYSTEM_PROMPT, /ASR post-editor/)
})

test("the default prompt demonstrates citation syntax and the example is never evidence for another meeting", async () => {
  const transcript = "This is the kickoff meeting for our project."
  const result = await generateMeetingMinutes({
    transcriptText: transcript,
    config: { base_url: "https://fixture.invalid", api_key: "fixture", model_name: "test", temperature: 0 },
    extract: async ({ systemPrompt }) => {
      assert.match(systemPrompt, /- 明天审阅草稿 〔review the draft tomorrow〕/)
      return "### TL;DR\n- 项目启动 〔kickoff meeting for our project〕\n- 明天审阅草稿 〔review the draft tomorrow〕"
    },
  })
  assert.ok(result.ok)
  assert.match(result.minutes.raw_md, /项目启动/)
  assert.doesNotMatch(result.minutes.raw_md, /明天审阅草稿/)
})

test("buildMinutesSystemPrompt embeds safety and optional template", () => {
  const def = buildMinutesSystemPrompt()
  assert.match(def, /RULES:/)
  assert.match(def, /Do NOT invent/)
  assert.match(def, /### TL;DR/)
  assert.match(def, /REQUIRED SECTIONS/)
  // Default path: no filled USER TEMPLATE block (only rule mentions of the phrase)
  assert.doesNotMatch(def, /fill this structure from the transcript/)

  const withTmpl = buildMinutesSystemPrompt("## Agenda\n## Action items")
  assert.match(withTmpl, /RULES:/)
  assert.match(withTmpl, /USER TEMPLATE \(fill this structure from the transcript/)
  // USER TEMPLATE block appears after RULES block
  const rulesIdx = withTmpl.indexOf("RULES:")
  const tmplIdx = withTmpl.indexOf("USER TEMPLATE (fill this structure")
  assert.ok(rulesIdx >= 0 && tmplIdx > rulesIdx)
  assert.match(withTmpl, /## Agenda/)
  assert.match(withTmpl, /cannot override RULES 1–6/)
})

test("template over max rejected with template_too_long", async () => {
  const long = "x".repeat(MEETING_MINUTES_MAX_TEMPLATE_CHARS + 1)
  const r = await generateMeetingMinutes({
    transcriptText: "有内容的转写。",
    config: {
      base_url: "https://x.invalid",
      api_key: "k",
      model_name: "m",
      temperature: 0.2,
    },
    templateMd: long,
    extract: async () => {
      throw new Error("extract should not be called")
    },
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.code, "template_too_long")
  }
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
- [ ] 写文档（张三）〔张三负责写文档〕

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

test("unsupported regeneration returns a recoverable error and preserves the previous minutes", async () => {
  const meeting = createMeeting({ title: "证据核对", dataDir: DATA })
  const original = "本周完成文档。"
  setTranscript(meeting.id, [{ text: original, source: "paste" }], DATA)
  setMinutes(meeting.id, { raw_md: "### TL;DR\n本周完成文档。", generated_at: new Date().toISOString() }, DATA)
  const previous = loadMeeting(meeting.id, DATA)?.minutes
  const response = await generateFixtureMinutes({ type: "meeting.generate_minutes", id: meeting.id }, { origin: EXT }, {
    getLlmConfig: () => ({ base_url: "https://fixture.invalid", api_key: "key", model_name: "test", temperature: 0 }),
    generate: params => generateMeetingMinutes({ ...params, extract: async () => "### 待办\n- [ ] 下周交付原型。〔下周交付〕" }),
  })
  assert.equal(response.code, "invalid_minutes_evidence")
  assert.deepEqual(loadMeeting(meeting.id, DATA)?.minutes, previous)
})

test("handler generate ephemeral paste", async () => {
  const res = await generateFixtureMinutes(
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
  const gen = await generateFixtureMinutes(
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

test("meeting.start invokes clearSttSessions", async () => {
  let cleared = 0
  const r = await handleMeetingMessage(
    { type: "meeting.start", v: 1, privacy_ack_v1: true, title: "t" },
    { origin: EXT, peerId: "p1" },
    { clearSttSessions: () => { cleared += 1 } },
  )
  assert.equal(r.type, "meeting.started")
  assert.equal(cleared, 1)
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
