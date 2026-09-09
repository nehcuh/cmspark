import "./meeting-test-data-dir"
import test, { after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import AdmZip from "adm-zip"
import { DATA_DIR } from "../src/config"
import * as store from "../src/meeting/meeting-store"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { generateMeetingMinutes } from "../src/meeting/meeting-minutes"

const origin = { origin: "chrome-extension://meetingreferencefixture" }
const llm = { base_url: "https://fixture.invalid", api_key: "fixture", model_name: "fixture", temperature: 0 }
const createdIds: string[] = []
after(() => { for (const id of createdIds) store.deleteMeeting(id) })
function meeting() {
  const m = store.createMeeting({ title: "Reference fixture" })
  createdIds.push(m.id)
  return m
}
function docx(text: string): Buffer {
  const zip = new AdmZip()
  zip.addFile("[Content_Types].xml", Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
  zip.addFile("_rels/.rels", Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
  zip.addFile("word/document.xml", Buffer.from(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`))
  return zip.toBuffer()
}
const raw = "项目采用配森。负责人尚未确定。"
const notes = "项目技术选型为 Python。张三是材料整理人。"
function referencedOutput() {
  return {
    minutes_md: "### TL;DR\n项目采用 Python，负责人待确认。",
    corrections: [{ original: "配森", replacement: "Python", reference_excerpt: "项目技术选型为 Python。", reason: "参考笔记提供技术名词" }],
    reference_supplements: [{ reference_excerpt: "张三是材料整理人。", reason: "仅参考笔记记载，不能当作会议负责人" }],
    conflicts: [{ transcript_excerpt: "负责人尚未确定。", reference_excerpt: "张三是材料整理人。", reason: "材料整理人不等于会议行动负责人，待确认" }],
  }
}
const generateWithReferences = (params: Parameters<typeof generateMeetingMinutes>[0]) => generateMeetingMinutes({ ...params, extract: async () => JSON.stringify(referencedOutput()) })

test("#492 import_reference parses real TXT, Markdown and DOCX without changing meeting data", async () => {
  for (const [name, type, bytes] of [
    ["notes.txt", "text/plain", Buffer.from(notes)],
    ["notes.md", "text/markdown", Buffer.from(`# 技术笔记\n${notes}`)],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx(notes)],
  ] as const) {
    const response = await handleMeetingMessage({ type: "meeting.import_reference", v: 1, file: { name, type, content: bytes.toString("base64") } }, origin)
    assert.equal(response.type, "meeting.reference_imported", JSON.stringify(response))
    assert.equal(response.reference.name, name)
    assert.ok(response.reference.text.includes("Python"))
  }
})

test("#492 reference import rejects unsupported, corrupt, empty and oversize material", async () => {
  const files = [
    { name: "notes.pdf", type: "text/plain", content: Buffer.from(notes).toString("base64") },
    { name: "notes.docx", type: "text/plain", content: Buffer.from("not a Word archive").toString("base64") },
    { name: "notes.txt", type: "text/plain", content: "!!!!" },
    { name: "notes.txt", type: "text/plain", content: Buffer.from("   ").toString("base64") },
    { name: "notes.txt", type: "text/plain", content: Buffer.alloc(7 * 1024 * 1024 + 1, 65).toString("base64") },
    { name: "notes.txt", type: "text/plain", content: Buffer.from("x".repeat(100_001)).toString("base64") },
  ]
  for (const file of files) {
    const response = await handleMeetingMessage({ type: "meeting.import_reference", v: 1, file }, origin)
    assert.equal(response.type, "meeting.error", file.name)
    assert.equal(response.reference, undefined)
  }
  const atLimit = Buffer.alloc(7 * 1024 * 1024, 32)
  atLimit.write("Python")
  const accepted = await handleMeetingMessage({ type: "meeting.import_reference", v: 1, file: { name: "notes.txt", type: "text/plain", content: atLimit.toString("base64") } }, origin)
  assert.equal(accepted.type, "meeting.reference_imported", "7MiB binary stays within 10MiB WS envelope")
  assert.equal(accepted.reference.text, "Python")
  const oversized = await handleMeetingMessage({ type: "meeting.import_reference", v: 1, file: { name: "notes.txt", type: "text/plain", content: Buffer.concat([atLimit, Buffer.from(" ")]).toString("base64") } }, origin)
  assert.equal(oversized.code, "reference_file_too_large", "one byte beyond transport budget is refused before parsing")
})

test("#492 original STT archive survives edits and repeated utterances", async () => {
  const m = meeting()
  store.setTranscript(m.id, [{ text: "第一段配森", source: "stt" }])
  store.setTranscript(m.id, [{ text: "手动修改Python", source: "user_edit" }])
  store.appendTranscript(m.id, { text: "重复原话", source: "stt" })
  store.appendTranscript(m.id, { text: "重复原话", source: "stt" })
  store.setTranscript(m.id, [{ text: "整稿编辑", source: "user_edit" }])
  const response = await handleMeetingMessage({ type: "meeting.get", id: m.id }, origin)
  assert.deepEqual(response.meeting.original_transcript.map((line: store.TranscriptLine) => line.text), ["第一段配森", "重复原话", "重复原话"])
  assert.equal(response.meeting.transcript[0].text, "整稿编辑")
  const same = meeting()
  store.setTranscript(same.id, [{ text: raw, source: "stt" }])
  await handleMeetingMessage({ type: "meeting.generate_minutes", id: same.id, text: raw }, origin, { getLlmConfig: () => llm, generate: params => generateMeetingMinutes({ ...params, extract: async () => "### TL;DR\n原文" }) })
  assert.equal(store.loadMeeting(same.id)!.transcript[0].source, "stt", "unchanged explicit snapshot retains STT provenance")
})

test("#492 original STT archive cap cannot be bypassed by shortening editable text", async () => {
  const m = meeting()
  store.setTranscript(m.id, [{ text: "原".repeat(200_000), source: "stt" }])
  store.setTranscript(m.id, [{ text: "short edit", source: "user_edit" }])
  const result = await handleMeetingMessage({ type: "meeting.append_transcript", id: m.id, text: "new speech", source: "stt" }, origin)
  assert.equal(result.type, "meeting.error")
  assert.equal(result.code, "transcript_too_long")
  assert.equal(store.loadMeeting(m.id)!.transcript[0].text, "short edit")
})

test("#492 reference endpoints remain unavailable to unstamped tray clients", async () => {
  for (const type of ["meeting.import_reference", "meeting.set_reference"]) {
    const response = await handleMeetingMessage({ type, reference_notes: notes }, { origin: "cmspark-tray://local" })
    assert.equal(response.code, "origin_denied")
  }
})

test("#492 reference save/get/clear is independent of transcript", async () => {
  const m = meeting()
  store.setTranscript(m.id, [{ text: raw, source: "stt" }])
  const saved = await handleMeetingMessage({ type: "meeting.set_reference", meeting_id: m.id, id: "meeting-rpc-fixture", reference_notes: notes, reference_name: "notes.docx" }, origin)
  assert.equal(saved.type, "meeting.updated")
  assert.equal(saved.meeting.reference_notes, notes)
  assert.equal(saved.meeting.reference_name, "notes.docx")
  assert.equal(saved.meeting.transcript[0].text, raw)
  const read = await handleMeetingMessage({ type: "meeting.get", id: m.id }, origin)
  assert.equal(read.meeting.reference_notes, notes)
  const cleared = await handleMeetingMessage({ type: "meeting.set_reference", id: m.id, reference_notes: "", reference_name: "" }, origin)
  assert.equal(cleared.meeting.reference_notes, "")
  assert.equal(cleared.meeting.transcript[0].text, raw)
})

test("#492 reference generation validates evidence and preserves original transcript", async () => {
  const m = meeting()
  store.setTranscript(m.id, [{ text: "旧稿不能遮蔽新快照", source: "stt" }])
  const response = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw, reference_notes: notes, reference_name: "notes.md" }, origin, { getLlmConfig: () => llm, generate: generateWithReferences })
  assert.equal(response.type, "meeting.minutes_result", JSON.stringify(response))
  assert.equal(store.transcriptToText(response.meeting.transcript), raw)
  assert.equal(response.meeting.reference_notes, notes)
  assert.equal(response.minutes.source_transcript, raw)
  assert.equal(response.minutes.corrected_transcript, "项目采用Python。负责人尚未确定。")
  assert.deepEqual(response.minutes.corrections, referencedOutput().corrections)
  assert.deepEqual(response.minutes.reference_supplements, referencedOutput().reference_supplements)
  assert.deepEqual(response.minutes.conflicts, referencedOutput().conflicts)
  assert.equal(response.minutes.stale, false)
  assert.match(response.minutes.source_fingerprint, /^[0-9a-f]{64}$/)
})

test("#492 invalid correction evidence or ambiguous/overlapping originals fails explicitly", async () => {
  const invalid = [
    { ...referencedOutput(), corrections: [{ ...referencedOutput().corrections[0], reference_excerpt: "笔记里没有这句话" }] },
    { ...referencedOutput(), corrections: [{ ...referencedOutput().corrections[0], replacement: "Invented technology" }] },
    { ...referencedOutput(), corrections: [{ ...referencedOutput().corrections[0], original: "不存在的原文" }] },
    { ...referencedOutput(), corrections: [...referencedOutput().corrections, ...referencedOutput().corrections] },
    { ...referencedOutput(), reference_supplements: [{ reference_excerpt: "不存在的补充", reason: "假来源" }] },
    { ...referencedOutput(), conflicts: [{ transcript_excerpt: "不存在的发言", reference_excerpt: notes, reason: "假冲突" }] },
  ]
  for (const output of invalid) {
    const result = await generateMeetingMinutes({ transcriptText: raw, referenceNotes: notes, config: llm, extract: async () => JSON.stringify(output) })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, "invalid_reference_result")
  }
  const repeated = await generateMeetingMinutes({ transcriptText: "配森和配森", referenceNotes: notes, config: llm, extract: async () => JSON.stringify({ ...referencedOutput(), conflicts: [] }) })
  assert.equal(repeated.ok, false, "ambiguous occurrence must not be silently replaced")
})

test("#492 changing transcript/reference marks retained minutes stale, including in-flight changes", async () => {
  const m = meeting()
  const generated = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw, reference_notes: notes }, origin, { getLlmConfig: () => llm, generate: generateWithReferences })
  assert.equal(generated.minutes.stale, false)
  const changed = await handleMeetingMessage({ type: "meeting.set_reference", id: m.id, reference_notes: notes + "新笔记" }, origin)
  assert.equal(changed.meeting.minutes.stale, true)
  assert.equal(changed.meeting.status, "ready")
  assert.equal(changed.meeting.minutes.raw_md, generated.minutes.raw_md)
  store.setTranscript(m.id, [{ text: "修改后的原始转写", source: "user_edit" }])
  assert.equal(store.loadMeeting(m.id)!.minutes!.stale, true)

  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const inFlight = handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw, reference_notes: notes }, origin, {
    getLlmConfig: () => llm,
    generate: async params => { await pending; return generateWithReferences(params) },
  })
  await handleMeetingMessage({ type: "meeting.set_reference", id: m.id, reference_notes: notes + "再次修改" }, origin)
  release()
  const result = await inFlight
  assert.equal(result.minutes.stale, true)
  assert.equal(result.meeting.minutes.stale, true)
  assert.equal(result.meeting.status, "ready")
})

test("#492 no-reference generation keeps Markdown path and explicit empty text does not fall back", async () => {
  const m = meeting()
  store.setTranscript(m.id, [{ text: "old stored", source: "stt" }])
  const seen: string[] = []
  const deps = { getLlmConfig: () => llm, generate: async (params: Parameters<typeof generateMeetingMinutes>[0]) => {
    seen.push(params.transcriptText)
    return generateMeetingMinutes({ ...params, extract: async () => "### TL;DR\nCurrent material" })
  } }
  const current = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: "current snapshot", reference_notes: "" }, origin, deps)
  assert.equal(current.type, "meeting.minutes_result")
  assert.deepEqual(seen, ["current snapshot"])
  assert.equal(current.minutes.corrected_transcript, undefined)
  const empty = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: "" }, origin, deps)
  assert.equal(empty.code, "empty_transcript")
  assert.equal(seen.length, 1)
})

test("#492 failed snapshot persistence cannot invoke generation or return success", async () => {
  const m = meeting()
  const transcriptPath = path.join(DATA_DIR, "meetings", m.id, "transcript.json")
  fs.unlinkSync(transcriptPath)
  fs.mkdirSync(transcriptPath)
  let invoked = false
  const result = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw }, origin, { getLlmConfig: () => llm, generate: async () => { invoked = true; throw new Error("must not run") } })
  assert.equal(result.type, "meeting.error")
  assert.equal(invoked, false)
  assert.equal(result.minutes, undefined)
})

test("#492 one active generation per meeting, lock releases after failure", async () => {
  const m = meeting()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let calls = 0
  const deps = { getLlmConfig: () => llm, generate: async () => {
    calls += 1
    await pending
    return { ok: false as const, code: "fixture_failed", message: "fixture failure" }
  } }
  const first = handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw }, origin, deps)
  const second = handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: "another draft" }, origin, deps)
  release()
  assert.equal((await second).code, "generation_busy")
  await first
  assert.equal(calls, 1)
  const retried = await handleMeetingMessage({ type: "meeting.generate_minutes", id: m.id, text: raw }, origin, deps)
  assert.equal(retried.code, "fixture_failed")
  assert.equal(calls, 2)
})

test("#492 insufficient context refuses complete reference input without truncation", async () => {
  let called = false
  const result = await generateMeetingMinutes({ transcriptText: raw, referenceNotes: notes, config: { ...llm, context_window: 128 }, extract: async () => { called = true; return JSON.stringify(referencedOutput()) } })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, "context_too_small")
  assert.equal(called, false)
})
