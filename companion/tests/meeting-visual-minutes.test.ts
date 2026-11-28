import "./meeting-test-data-dir"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { generateMeetingMinutes } from "../src/meeting/meeting-minutes"
import { DATA_DIR } from "../src/config"
import { createMeeting, listMeetings, loadMeeting, meetingSourceFingerprint, setMinutes, setTranscript } from "../src/meeting/meeting-store"
import { MeetingVisualEvidenceUnavailableError, readMeetingVisualEvidence } from "../src/meeting/meeting-visual-evidence"
import { quarantineUnreadableMeetingEvidence, removeMeetingVisualEvidence, writeMeetingVisualEvidence } from "../src/meeting/meeting-visual-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"

const transcript = "发布日尚未决定。"
const config = { base_url: "https://fixture.invalid", api_key: "test", model_name: "text", temperature: 0 }
const frame = { meetingId: "mtg_visual_fixture", recordingId: "rec_fixture", frameId: "frame_fixture",
  timeMs: 61700, width: 800, height: 600, mime: "image/png" as const, sha256: "a".repeat(64),
  status: "completed" as const, model: "image-fixture", profileId: "profile_fixture", endpoint: "https://image.invalid/v1",
  analyzedAt: "2026-11-24T01:02:03.000Z", recognizedText: "预计周三发布", description: "表格数字为 7.21",
  uncertainties: ["最末一位可能是 1"] }
const quote = "〔画面:frame_fixture@61700ms｜预计周三发布〕"
const response = [
  "### TL;DR", "- 发布日未定〔发布日尚未决定〕",
  "### 决议", "- 决定周三上线" + quote,
  "### 待办", "- [ ] 周三上线" + quote, "- [ ] 摄影组跟进〔预计周三发布〕",
  "### 风险 / 开放问题", "- 日期冲突，待确认〔发布日尚未决定〕" + quote,
  "### 画面要点", "- 屏幕列出暂定发布日期" + quote, "- 未经证实的数值〔画面:frame_fixture@61701ms｜表格数字为 7.21〕",
  "- 未识别的引文〔画面:frame_fixture@61700ms｜数字为 7.22〕",
].join("\n")

test("visual minutes retain only correctly attributed excerpts and never promote a displayed proposal into decisions or actions", async () => {
  const params = { transcriptText: transcript, config, visualEvidence: [frame], extract: async () => response }
  const result = await generateMeetingMinutes(params)
  assert.ok(result.ok)
  assert.match(result.minutes.raw_md, /屏幕列出暂定发布日期/)
  assert.match(result.minutes.raw_md, /日期冲突，待确认/)
  assert.match(result.minutes.raw_md, /发布日未定/)
  assert.deepEqual(result.minutes.decisions, [])
  assert.deepEqual(result.minutes.actions, [])
  assert.doesNotMatch(result.minutes.raw_md, /未经证实|未识别的引文/)
  const plain = await generateMeetingMinutes({ ...params, visualEvidence: [], extract: async () => response } as typeof params)
  assert.ok(plain.ok)
  assert.doesNotMatch(plain.minutes.raw_md, /屏幕列出|日期冲突|画面要点/)
  assert.equal(plain.minutes.source_fingerprint, createHash("sha256").update(JSON.stringify([transcript, "", ""])).digest("hex"))
  assert.notEqual(result.minutes.source_fingerprint, plain.minutes.source_fingerprint)
})

test("minutes consent binds on-disk observations; changing or removing the last frame invalidates the saved minutes", async () => {
  const meeting = createMeeting({ title: "画面评审" })
  setTranscript(meeting.id, [{ text: transcript, source: "stt" }])
  const saved = { ...frame, meetingId: meeting.id }
  writeMeetingVisualEvidence(meeting.id, saved)
  let calls = 0
  const deps = { getLlmConfig: () => config, generate: (params: Parameters<typeof generateMeetingMinutes>[0]) =>
    generateMeetingMinutes({ ...params, extract: async ({ userContent }) => {
      calls++
      const material = JSON.parse(userContent)
      assert.deepEqual(material.visual_evidence[0].uncertainties, saved.uncertainties)
      assert.equal(material.visual_evidence[0].analyzedAt, saved.analyzedAt)
      assert.equal(material.visual_evidence[0].model, saved.model)
      assert.equal(material.transcript, transcript)
      return response
    } }) }
  const ctx = { origin: "cmspark-tray://local", surface: "summoner", peerId: "tray-fixture" }
  const rpc = (type: string, token?: string, visualCount?: number) =>
    handleMeetingMessage({ type, id: meeting.id, consent_token: token, visual_frames_confirmed: visualCount }, ctx, deps)
  const prepared = await rpc("meeting.prepare_minutes")
  assert.equal(prepared.material.visual_frames, 1)
  assert.ok(prepared.material.visual_chars > saved.description.length)
  assert.deepEqual(prepared.material.visual_sources, [{ frameId: saved.frameId, recordingId: saved.recordingId, sha256: saved.sha256, timeMs: 61700 }])
  assert.equal(calls, 0)
  assert.equal((await rpc("meeting.generate_minutes", prepared.consent_token)).code, "visual_confirmation_required")
  const beforeEdit = await rpc("meeting.prepare_minutes")
  writeMeetingVisualEvidence(meeting.id, { ...saved, description: "另一项测量结果" })
  assert.equal((await rpc("meeting.generate_minutes", beforeEdit.consent_token, 1)).code, "minutes_consent_changed")
  assert.equal(calls, 0)
  const next = await rpc("meeting.prepare_minutes")
  const generated = await rpc("meeting.generate_minutes", next.consent_token, next.material.visual_frames)
  assert.equal(generated.type, "meeting.minutes_result", JSON.stringify(generated))
  assert.equal(generated.minutes.stale, false)
  assert.deepEqual(generated.minutes.visual_sources, next.material.visual_sources)
  assert.equal(calls, 1)
  assert.equal(removeMeetingVisualEvidence(meeting.id, saved.frameId), true)
  const reloaded = loadMeeting(meeting.id)!
  assert.equal(reloaded.minutes!.stale, true)
  assert.equal(reloaded.status, "ready")
  assert.equal(listMeetings().find(summary => summary.id === meeting.id)?.status, "ready")
  assert.deepEqual(reloaded.original_transcript, [{ text: transcript, source: "stt" }])
  assert.deepEqual(reloaded.transcript, reloaded.original_transcript)
  const plain = await rpc("meeting.prepare_minutes")
  assert.equal("visual_sources" in plain.material, false)
})

test("combined limits and model context are checked before visual material leaves the machine", async () => {
  let calls = 0
  for (const [text, context_window, code] of [
    ["文".repeat(199_999), 100_000, "visual_material_too_long"], [transcript, 100, "context_too_small"],
  ] as const) {
    const params = { transcriptText: text, config: { ...config, context_window }, visualEvidence: [frame], extract: async () => { calls++; return response } }
    const result = await generateMeetingMinutes(params)
    assert.ok(!result.ok)
    assert.equal(result.code, code)
  }
  assert.equal(calls, 0)
})

test("a correct screen citation cannot rescue a minutes response missing every transcript-grounded point", async () => {
  const params = { transcriptText: transcript, config, visualEvidence: [frame], extract: async () =>
    "### TL;DR\n- 接受提案〔已同意〕\n### 画面要点\n- PPT 提案" + quote }
  const result = await generateMeetingMinutes(params)
  assert.ok(!result.ok)
  assert.equal(result.code, "invalid_minutes_evidence")
})

test("reference corrections and custom headings cannot turn visual facts into agreement", async () => {
  const params = { transcriptText: transcript, referenceNotes: "另行讨论。", visualEvidence: [frame],
    templateMd: "## Agreements", config, extract: async () => JSON.stringify({
      minutes_md: "## Agreements\n- 锁定上线日期" + quote + "\n- 日程未定〔发布日尚未决定〕\n### 画面要点\n- PPT 预计周三发布" + quote,
      corrections: [], reference_supplements: [], conflicts: [],
    }) }
  const result = await generateMeetingMinutes(params)
  assert.ok(result.ok)
  assert.match(result.minutes.raw_md, /## Agreements/)
  assert.match(result.minutes.raw_md, /PPT 预计周三发布/)
  assert.doesNotMatch(result.minutes.raw_md, /锁定上线日期/)
  assert.equal(result.minutes.corrected_transcript, transcript)
  assert.equal(meetingSourceFingerprint(transcript), createHash("sha256").update(JSON.stringify([transcript, "", ""])).digest("hex"))
})

test("corrupt independent evidence leaves raw speech and prior minutes readable and editable, blocking every minutes submission", async () => {
  const { id } = createMeeting({ title: "证据恢复" })
  setTranscript(id, [{ text: transcript, source: "stt" }])
  setMinutes(id, { raw_md: "上次纪要", generated_at: "2026-11-24T01:02:03.000Z" })
  const dir = path.join(DATA_DIR, "meetings", id)
  const file = path.join(dir, "visual-evidence.json")
  const ctx = { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" }
  let calls = 0
  const deps = { getLlmConfig: () => config, generate: async () => { calls++; throw new Error("must not generate") } }
  const prepared = await handleMeetingMessage({ type: "meeting.prepare_minutes", id }, ctx, deps)
  for (const corrupt of ['[{"incomplete":', JSON.stringify([{ ...frame, meetingId: id, uncertainties: { bad: true } }]),
    JSON.stringify([{ ...frame, meetingId: id, base64: "foreign-payload" }])]) {
    fs.writeFileSync(file, corrupt)
    const meeting = (await handleMeetingMessage({ type: "meeting.get", id }, ctx)).meeting
    assert.equal(meeting.visual_evidence_unavailable, true)
    assert.deepEqual(meeting.original_transcript, [{ text: transcript, source: "stt" }])
    assert.equal(meeting.minutes.raw_md, "上次纪要")
    assert.equal(meeting.minutes.stale, true)
    assert.equal(listMeetings().find(entry => entry.id === id)?.status, "ready")
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "minutes.json"), "utf8")).stale, true)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")).status, "ready")
    const edit = await handleMeetingMessage({ type: "meeting.set_transcript", id, text: "编辑的转写" }, ctx)
    assert.equal(edit.meeting.transcript[0].text, "编辑的转写")
    for (const type of ["meeting.prepare_minutes", "meeting.generate_minutes"]) {
      const result = await handleMeetingMessage({ type, id, consent_token: prepared.consent_token }, ctx, deps)
      assert.equal(result.code, "visual_evidence_corrupt")
    }
    assert.equal(calls, 0)
    assert.equal(fs.readFileSync(file, "utf8"), corrupt)
  }
})

test("visual prompts supply a directly copyable source prefix for multiline table rows without transcript-only instructions", async () => {
  const evidence = { ...frame, recognizedText: "版本  数值\nv1    7.21\nv2    7.31" }
  for (const templateMd of ["", "## Review"]) {
    const referenceNotes = templateMd ? "待复核。" : ""
    const result = await generateMeetingMinutes({ transcriptText: transcript, visualEvidence: [evidence], config, templateMd, referenceNotes,
      extract: async ({ systemPrompt, userContent }) => {
        const { citationPrefix, recognizedText } = JSON.parse(userContent).visual_evidence[0]
        assert.equal(citationPrefix, "〔画面:frame_fixture@61700ms｜")
        assert.doesNotMatch(systemPrompt, /Use ONLY information present in the transcript|Every nonempty factual bullet MUST end with 〔exact words copied from this transcript〕/)
        assert.match(systemPrompt, /citationPrefix/)
        const md = (templateMd || "### TL;DR") + "\n- 未定〔发布日尚未决定〕\n### 画面要点\n- 数值 7.31 " + citationPrefix + recognizedText.split("\n")[2] + "〕"
        return referenceNotes ? JSON.stringify({ minutes_md: md, corrections: [], reference_supplements: [], conflicts: [] }) : md
      } })
    assert.ok(result.ok)
    assert.match(result.minutes.raw_md, /画面:frame_fixture@61700ms｜v2    7\.31〕/)
    if (templateMd) assert.match(result.minutes.raw_md, /## Review/)
  }
})

test("explicit recovery rechecks the corrupt digest, retains the exact bytes, and never resets valid or inaccessible materials", () => {
  const { id } = createMeeting({})
  const dir = path.join(DATA_DIR, "meetings", id)
  const file = path.join(dir, "visual-evidence.json")
  const broken = Buffer.from([0x5b, 0xff, 0x01])
  const digest = createHash("sha256").update(broken).digest("hex")
  fs.writeFileSync(file, broken)
  assert.throws(() => readMeetingVisualEvidence(id), (e: unknown) => e instanceof MeetingVisualEvidenceUnavailableError &&
    e.recoverable && e.sha256 === digest)
  assert.throws(() => quarantineUnreadableMeetingEvidence(id, "a".repeat(64)))
  assert.deepEqual(fs.readFileSync(file), broken)
  quarantineUnreadableMeetingEvidence(id, digest)
  assert.deepEqual(readMeetingVisualEvidence(id), [])
  const backup = fs.readdirSync(dir).find(name => name.startsWith("visual-evidence.corrupt-"))
  assert.ok(backup)
  assert.deepEqual(fs.readFileSync(path.join(dir, backup)), broken)
  writeMeetingVisualEvidence(id, { ...frame, meetingId: id })
  assert.throws(() => quarantineUnreadableMeetingEvidence(id, digest))
  assert.equal(readMeetingVisualEvidence(id)[0].model, frame.model)
  fs.unlinkSync(file)
  fs.mkdirSync(file)
  assert.throws(() => readMeetingVisualEvidence(id), (e: unknown) => e instanceof MeetingVisualEvidenceUnavailableError && !e.recoverable)
  assert.throws(() => quarantineUnreadableMeetingEvidence(id, digest))
  assert.equal(fs.statSync(file).isDirectory(), true)
})

test("evidence corruption during minutes inference preserves the previous result", async () => {
  const { id } = createMeeting({})
  setTranscript(id, [{ text: transcript, source: "stt" }])
  setMinutes(id, { raw_md: "previous result", generated_at: frame.analyzedAt })
  writeMeetingVisualEvidence(id, { ...frame, meetingId: id })
  const file = path.join(DATA_DIR, "meetings", id, "visual-evidence.json")
  const ctx = { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyz" }
  const deps = { getLlmConfig: () => config, generate: async (params: Parameters<typeof generateMeetingMinutes>[0]) =>
    generateMeetingMinutes({ ...params, extract: async () => { fs.writeFileSync(file, "["); return response } }) }
  const prepared = await handleMeetingMessage({ type: "meeting.prepare_minutes", id }, ctx, deps)
  const generated = await handleMeetingMessage({ type: "meeting.generate_minutes", id,
    consent_token: prepared.consent_token, visual_frames_confirmed: 1 }, ctx, deps)
  assert.equal(generated.code, "visual_evidence_corrupt")
  assert.equal(loadMeeting(id)?.minutes?.raw_md, "previous result")
  assert.equal(loadMeeting(id)?.status, "ready")
})

test("structured default visual minutes render only verified speech and numbered frame quotes into canonical citations", async () => {
  const raw = "预算仍需核对。方案尚未批准发布。我们决定推迟上线。我会更新会议记录。"
  const second = { ...frame, frameId: "frame_second", timeMs: 99000, recognizedText: "B: 24" }
  const extracted = {
    tldr: [{ claim: "预算待核", transcriptQuote: "预算仍需核对。" }, { claim: "发言未附依据" }],
    decisions: [{ claim: "已批准发布", transcriptQuote: "方案尚未批准发布。" },
      { claim: "推迟上线", transcriptQuote: "我们决定推迟上线。" }],
    actions: [{ claim: "更新会议记录", transcriptQuote: "我会更新会议记录。" },
      { claim: "无端指派", frameNumber: 1, frameQuote: "预计周三发布" }],
    risks: [{ claim: "口头预算待核；表中记为 24", transcriptQuote: "预算仍需核对。", frameNumber: 2, frameQuote: "B: 24" }],
    screen: [{ claim: "方案 B 显示 24", frameNumber: 2, frameQuote: "B: 24" },
      { claim: "移植别帧", frameNumber: 1, frameQuote: "B: 24" }, { claim: "虚构数值", frameNumber: 2, frameQuote: "B: 29" },
      { claim: "无此序号", frameNumber: 0, frameQuote: "B: 24" }, { claim: "伪造身份", frameNumber: 2, frameQuote: "B: 24", frameId: "elsewhere" }],
  }
  const params = { transcriptText: raw, config, visualEvidence: [frame, second] }
  const generated = await generateMeetingMinutes({ ...params, extract: async ({ systemPrompt, userContent }) => {
    assert.match(systemPrompt, /JSON/)
    assert.equal(JSON.parse(userContent).visual_evidence[1].frameNumber, 2)
    return JSON.stringify(extracted)
  } })
  assert.ok(generated.ok)
  assert.match(generated.minutes.raw_md, /口头预算待核；表中记为 24.*〔预算仍需核对。〕.*〔画面:frame_second@99000ms｜B: 24〕/)
  assert.match(generated.minutes.raw_md, /方案 B 显示 24.*〔画面:frame_second@99000ms｜B: 24〕/)
  assert.doesNotMatch(generated.minutes.raw_md, /已批准发布|移植别帧|虚构数值|无此序号|伪造身份|发言未附依据|无端指派/)
  assert.equal(generated.minutes.decisions!.length, 1)
  assert.equal(generated.minutes.actions!.length, 1)
  const fallback = await generateMeetingMinutes({ ...params, extract: async () => [
    "### TL;DR", "- 金额待核〔预算仍需核对。〕", "### 决议", "- 已通过〔批准发布〕",
    "- 已延期〔我们决定推迟上线。〕", "### 画面要点", "- 日期暂定" + quote,
  ].join("\n") })
  assert.ok(fallback.ok)
  assert.deepEqual(fallback.minutes.decisions, ["已延期〔我们决定推迟上线。〕"])
  for (const overrides of [{ tldr: [], decisions: [], actions: [], risks: [] }, { risks: [], screen: [{ claim: "计数", frameNumber: 4, frameQuote: "B: 24" }] }]) {
    const invalid = await generateMeetingMinutes({ ...params, extract: async () => JSON.stringify({ ...extracted, ...overrides }) })
    assert.ok(!invalid.ok)
    assert.equal(invalid.code, "invalid_minutes_evidence")
  }
})

test("pending approval is scoped to the quoted clause in structured and Markdown default decisions", async () => {
  const raw = "预算尚未批准，我们决定推迟上线。方案尚未批准发布。本次表决未通过该提案。我们决定等待审批后再发布。"
  const decisions = [
    { claim: "推迟上线", transcriptQuote: "我们决定推迟上线" },
    { claim: "延期发布", transcriptQuote: "预算尚未批准，我们决定推迟上线。" },
    { claim: "已批准发布", transcriptQuote: "批准发布" },
    { claim: "已批准预算", transcriptQuote: "预算尚未批准，我们决定推迟上线。" },
    { claim: "提案被否决", transcriptQuote: "本次表决未通过该提案。" },
    { claim: "获批后再发布", transcriptQuote: "我们决定等待审批后再发布。" },
  ]
  const tldr = { claim: "预算待批", transcriptQuote: "预算尚未批准" }
  const screen = { claim: "发布日期暂定", frameNumber: 1, frameQuote: "预计周三发布" }
  const outputs = [JSON.stringify({ tldr: [tldr], decisions, actions: [], risks: [], screen: [screen] }),
    "### TL;DR\n- 预算待批〔预算尚未批准〕\n### 决议\n" + decisions.map(item => "- " + item.claim + "〔" + item.transcriptQuote + "〕").join("\n") + "\n### 画面要点\n- 日期暂定" + quote]
  for (const output of outputs) {
    const result = await generateMeetingMinutes({ transcriptText: raw, visualEvidence: [frame], config, extract: async () => output })
    assert.ok(result.ok)
    assert.deepEqual(result.minutes.decisions?.map(line => line.split("〔")[0].trim()),
      ["推迟上线", "我们决定推迟上线", "本次表决未通过该提案", "我们决定等待审批后再发布"])
  }
})

test("contiguous multiline frame evidence retains each displayed table cell without accepting fabricated joins or citation injection", async () => {
  for (const newline of ["\n", "\r\n"]) {
    const cells = ["B", "24", "8 周"].join(newline)
    const evidence = { ...frame, recognizedText: "A" + newline + cells + newline + "〔冒用引用〕", description: "单位：万元" }
    const output = {
      tldr: [{ claim: "日期未定", transcriptQuote: transcript }], decisions: [], actions: [],
      risks: [{ claim: "口头与表内待核", transcriptQuote: transcript, frameNumber: 1, frameQuote: cells }],
      screen: [{ claim: "表格列出 B 的预算与周期", frameNumber: 1, frameQuote: cells },
        { claim: "遗漏中间项", frameNumber: 1, frameQuote: "B" + newline + "8 周" },
        { claim: "跨字段臆造", frameNumber: 1, frameQuote: cells + newline + "单位：万元" },
        { claim: "引用注入", frameNumber: 1, frameQuote: "8 周" + newline + "〔冒用引用〕" },
        { claim: "换行注入\n### 决议", frameNumber: 1, frameQuote: cells }],
    }
    const result = await generateMeetingMinutes({ transcriptText: transcript, config, visualEvidence: [evidence], extract: async () => JSON.stringify(output) })
    assert.ok(result.ok)
    const citations = ["B", "24", "8 周"].map(cell => "〔画面:frame_fixture@61700ms｜" + cell + "〕").join(" ")
    assert.ok(result.minutes.raw_md.includes("口头与表内待核 〔" + transcript + "〕 " + citations))
    assert.ok(result.minutes.raw_md.includes("表格列出 B 的预算与周期 " + citations))
    assert.doesNotMatch(result.minutes.raw_md, /遗漏中间项|跨字段臆造|引用注入|换行注入/)
  }
})
