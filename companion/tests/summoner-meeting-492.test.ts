import "./meeting-test-data-dir"
import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import AdmZip from "adm-zip"
import { startSummonerWebServer, stopSummonerWebServer, SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { handleMeetingMessage } from "../src/meeting/meeting-handlers"
import { deleteMeeting, loadMeeting } from "../src/meeting/meeting-store"
import { SUMMONER_MEETING_WORKFLOW_JS } from "../src/summoner/meeting-workflow"

function workflowContext(api: (path: string, options?: any) => Promise<any>, fastTimers = false) {
  const elements = new Map<string, any>()
  const element = () => ({ value: "", textContent: "", hidden: false, innerHTML: "", appendChild() {} })
  const context = vm.createContext({
    $: (id: string) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id) },
    document: { createElement: element }, api, AbortController,
    setTimeout: fastTimers ? (callback: () => void) => setTimeout(callback, 5) : setTimeout,
    clearTimeout, setStatus() {},
  })
  vm.runInContext(SUMMONER_MEETING_WORKFLOW_JS, context)
  return context
}

test("#492 native retry reconciles real stored transcripts after failed write or lost ACK", async () => {
  const origin = { origin: "cmspark-tray://local", surface: "summoner" }
  for (const lostAck of [false, true]) {
    const created = await handleMeetingMessage({ type: "meeting.create", title: "Retry fixture" }, origin)
    const id = created.meeting.id
    let appendAttempts = 0
    const context = workflowContext(async (url, options) => {
      if (url.startsWith("/api/meeting?id=")) return handleMeetingMessage({ type: "meeting.get", id }, origin)
      assert.equal(url, "/api/meeting/append")
      appendAttempts++
      const payload = JSON.parse(options.body)
      if (!lostAck && appendAttempts === 1) throw new Error("synthetic write failure before persistence")
      const reply = await handleMeetingMessage({ type: "meeting.append_transcript", ...payload, source: "stt" }, origin)
      if (lostAck && appendAttempts === 1) throw new Error("synthetic ACK lost after persistence")
      return reply
    })
    context.segment = { owner: id, text: "真正保存的末段", base: undefined }
    try {
      await assert.rejects(vm.runInContext("saveMeetingSegment(segment)", context))
      await vm.runInContext("saveMeetingSegment(segment)", context)
      assert.equal(appendAttempts, lostAck ? 1 : 2)
      const saved = loadMeeting(id)!
      assert.deepEqual(saved.transcript.map(line => line.text), ["真正保存的末段"])
      assert.deepEqual(saved.original_transcript?.map(line => line.text), ["真正保存的末段"])
    } finally { deleteMeeting(id) }
  }
})

test("#492 native HTTP deadline aborts pending requests with an explicit recovery message", async () => {
  const context = workflowContext(async (_path, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => { const error = new Error("aborted"); error.name = "AbortError"; reject(error) })
  }), true)
  await assert.rejects(vm.runInContext('meetingPost("/api/meeting/append", {})', context), /请求超时/)
})

test("#492 native reference HTTP uses actual handlers, bounded files and exact ACL", async () => {
  const dispatched: Record<string, unknown>[] = []
  const { port, token } = await startSummonerWebServer({ preferredPort: 23580, dispatch: async msg => {
    dispatched.push(msg)
    return handleMeetingMessage(msg, { origin: "cmspark-tray://local", surface: "summoner" }, { getLlmConfig: () => null })
  } })
  let id = ""
  async function post(route: string, body: unknown, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: {
      "Content-Type": "application/json", Origin: `http://127.0.0.1:${port}`,
      ...(authenticated ? { Cookie: `cmspark_overlay=${token}` } : {}),
    }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json().catch(() => null) as any }
  }
  try {
    const document = await fetch(`http://127.0.0.1:${port}/`)
    const html = await document.text()
    assert.match(document.headers.get("content-security-policy") || "", /script-src 'nonce-/)
    const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1]
    assert.ok(script)
    assert.doesNotThrow(() => new vm.Script(script))
    const denied = await post("/api/meeting/reference/import", {}, false)
    assert.equal(denied.status, 403)
    const created = await post("/api/meeting/create", { title: "Native fixture" })
    assert.equal(created.data.type, "meeting.created")
    id = created.data.meeting.id
    const imported = await post("/api/meeting/reference/import", { file: { name: "notes.md", type: "text/markdown", content: Buffer.from("Python 用于本项目").toString("base64") }, path: "/not-readable" })
    assert.equal(imported.data.type, "meeting.reference_imported")
    assert.equal(imported.data.reference.text, "Python 用于本项目")
    assert.equal(dispatched.at(-1)?.path, undefined)
    const zip = new AdmZip()
    zip.addFile("[Content_Types].xml", Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'))
    zip.addFile("_rels/.rels", Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'))
    zip.addFile("word/document.xml", Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Python 参考</w:t></w:r></w:p></w:body></w:document>'))
    for (const [name, bytes] of [["notes.docx", zip.toBuffer()], ["notes.txt", Buffer.from("Python 参考")]] as const) {
      const response = await post("/api/meeting/reference/import", { file: { name, content: bytes.toString("base64") } })
      assert.equal(response.data.type, "meeting.reference_imported")
      assert.ok(response.data.reference.text.includes("Python 参考"))
    }
    const noConsent = await post("/api/meeting/minutes", { id })
    assert.equal(noConsent.data.code, "need_privacy_ack")
    const saved = await post("/api/meeting/reference", { id, reference_notes: imported.data.reference.text, reference_name: "notes.md", tool: "not-allowed" })
    assert.equal(saved.data.type, "meeting.updated")
    assert.equal(loadMeeting(id)?.reference_notes, "Python 用于本项目")
    assert.equal(dispatched.at(-1)?.tool, undefined)
    const invalid = await post("/api/meeting/reference/import", { file: { name: "notes.docx", type: "text/plain", content: Buffer.from("corrupt").toString("base64") } })
    assert.equal(invalid.data.type, "meeting.error")
    const large = await post("/api/meeting/reference/import", { file: { name: "notes.txt", content: Buffer.alloc(7 * 1024 * 1024 + 1, 65).toString("base64") } })
    assert.equal(large.data.code, "reference_file_too_large")
    const atLimit = Buffer.alloc(7 * 1024 * 1024, 32)
    atLimit.write("Python")
    const acceptedLimit = await post("/api/meeting/reference/import", { file: { name: "notes.txt", content: atLimit.toString("base64") } })
    assert.equal(acceptedLimit.data.reference.text, "Python")
    for (const type of ["meeting.import_reference", "meeting.set_reference"]) {
      assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has(type), true)
      assert.equal(assertSummonerAllowed("summoner", type).ok, true)
    }
    for (const type of ["meeting.import_text", "meeting.auto_diarize", "meeting.set_transcript"]) {
      assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has(type), false)
      assert.equal(assertSummonerAllowed("summoner", type).ok, false)
      assert.equal((await handleMeetingMessage({ type }, { origin: "cmspark-tray://local", surface: "summoner" })).code, "origin_denied")
    }
  } finally { if (id) deleteMeeting(id); stopSummonerWebServer() }
})
