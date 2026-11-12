import test, { before, after, afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import { DEFAULT_UPLOAD_MIMES, DOCUMENT_MIMES, LEGACY_UPLOAD_MIMES } from "../src/file-formats"
import type { FileParseResponse } from "../src/file-parser"
import { isWpsWithWordDocContent } from "../src/wps-doc"

const siblingFixtures = path.join(__dirname, "fixtures", "office-611")
const fixtureRoot = fs.existsSync(siblingFixtures)
  ? siblingFixtures
  : path.resolve(__dirname, "../../tests/fixtures/office-611")
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-office-entry-"))
process.env.HOME = testHome
process.env.CMSPARK_DATA_DIR = path.join(testHome, "data")
delete process.env.DEEPSEEK_API_KEY

let router: typeof import("../src/message-router")
let cfg: typeof import("../src/config")
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let completionsProto: any
let originalCreate: any
let completionImpl: (params: any) => Promise<any>

before(async () => {
  router = await import("../src/message-router")
  cfg = await import("../src/config")
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  await cfg.initDataDir()
  const OpenAI = createRequire(__filename)("openai")
  completionsProto = Object.getPrototypeOf(new OpenAI({ apiKey: "sk-test" }).chat.completions)
  originalCreate = completionsProto.create
  completionsProto.create = async (params: any) => completionImpl(params)
})

afterEach(() => {
  router.__testSetFileParseImpl()
  router.__testSetPickFileNative()
  router.__testSetPickFolderNative()
})

after(() => {
  completionsProto.create = originalCreate
  fs.rmSync(testHome, { recursive: true, force: true })
})

function services() {
  const tm = new ThreadManager()
  const thread = tm.create("", "office-entry")
  return { thread, threadManager: tm, skillEngine: new SkillEngine(), historyStore: { record: () => 0 } as any }
}

function upload(threadId: string, name = "report.DOC", type = "application/octet-stream") {
  return { type: "file.upload", thread_id: threadId, message: "读取这份文档", files: [{ name, type, content: Buffer.from("test bytes").toString("base64") }] }
}

function session() {
  return { sendToExtension: () => {}, executeTool: async () => ({ success: true, data: {} }) } as any
}

function saveUploadConfig(types: readonly string[], vision = false) {
  cfg.saveConfig({
    file_upload: { allowed_types: [...types], enable_vision_analysis: vision },
    llm: { base_url: "http://127.0.0.1:9", api_key: "sk-test", model_name: "deepseek-chat" },
    vision: { enabled: vision, base_url: "http://127.0.0.1:9", api_key: "sk-test", model_name: "entry-vision", fallback: "metadata" },
  } as any, { llmKey: true, visionKey: true })
}

test("new installations include the five additional Office MIME types", () => {
  for (const ext of ["doc", "xls", "ppt", "ods", "odp"]) assert.ok(cfg.getConfig().file_upload!.allowed_types.includes(DOCUMENT_MIMES[ext]))
})

test("chat infers generic MIME and adapts only the historical default without changing config", async () => {
  const legacy = [...LEGACY_UPLOAD_MIMES].reverse().map(mime => ` ${mime.toUpperCase()} `)
  saveUploadConfig(legacy)
  const beforeConfig = fs.readFileSync(path.join(cfg.getConfigDir(), "config.json"), "utf8")
  const seen: string[] = []
  router.__testSetFileParseImpl(async (_bytes, name, mime, options) => {
    assert.equal(options?.signal?.aborted, false)
    seen.push(mime)
    return { success: false, filename: name, mimeType: mime, error: "entry parser reached" }
  })
  for (const ext of ["doc", "xls", "ppt", "ods", "odp"]) {
    const svc = services()
    const result = await router.handleMessage(upload(svc.thread.id, `report.${ext.toUpperCase()}`), svc, session())
    assert.equal(result.type, "file.upload_error")
    assert.equal(result.error, "entry parser reached")
  }
  assert.deepEqual(seen, [DOCUMENT_MIMES.doc, DOCUMENT_MIMES.xls, DOCUMENT_MIMES.ppt, DOCUMENT_MIMES.ods, DOCUMENT_MIMES.odp])
  assert.deepEqual(cfg.getConfig().file_upload!.allowed_types, legacy)
  assert.equal(fs.readFileSync(path.join(cfg.getConfigDir(), "config.json"), "utf8"), beforeConfig)
})

test("chat preserves custom subset/superset restrictions and explicit unknown MIME", async () => {
  let parses = 0
  router.__testSetFileParseImpl(async (_bytes, name, mime) => {
    parses++
    return { success: false, filename: name, mimeType: mime, error: "unexpected parser" }
  })
  for (const types of [[DOCUMENT_MIMES.pdf], [...LEGACY_UPLOAD_MIMES, "application/custom"]]) {
    saveUploadConfig(types)
    const svc = services()
    const result = await router.handleMessage(upload(svc.thread.id), svc, session())
    assert.match(String(result.error), /不支持的文件类型/)
  }
  saveUploadConfig(DEFAULT_UPLOAD_MIMES)
  const svc = services()
  const result = await router.handleMessage(upload(svc.thread.id, "report.doc", "application/unknown"), svc, session())
  assert.match(String(result.error), /application\/unknown/)
  assert.equal(parses, 0)
})

test("generic upload MIME infers a format but generic allowlist entries are not wildcards", async () => {
  let parses = 0
  router.__testSetFileParseImpl(async (_bytes, name, mime) => {
    parses++
    return { success: false, filename: name, mimeType: mime, error: "permitted parser reached" }
  })
  for (const generic of ["application/octet-stream", "binary/octet-stream"]) {
    const beforeParses = parses
    saveUploadConfig([generic])
    for (const ext of ["pdf", "docx", "doc", "ods"]) {
      const svc = services()
      const result = await router.handleMessage(upload(svc.thread.id, `report.${ext}`, generic), svc, session())
      assert.equal(result.type, "file.upload_error")
      assert.match(String(result.error), /不支持的文件类型/)
    }
    assert.equal(parses, beforeParses, "generic allowlist item must not authorize inferred document MIME")
    saveUploadConfig([DOCUMENT_MIMES.docx, generic])
    const docx = services()
    const allowed = await router.handleMessage(upload(docx.thread.id, "report.docx", generic), docx, session())
    assert.equal(allowed.error, "permitted parser reached")
    const pdf = services()
    const denied = await router.handleMessage(upload(pdf.thread.id, "report.pdf", generic), pdf, session())
    assert.match(String(denied.error), /不支持的文件类型/)
  }
  assert.equal(parses, 2)
})

test("chat canonicalizes the WPS PDF alias before admission and keeps custom restrictions", async () => {
  let reached = 0
  router.__testSetFileParseImpl(async (_bytes, name, mime) => {
    reached++
    assert.equal(mime, DOCUMENT_MIMES.pdf)
    return { success: false, filename: name, mimeType: mime, error: "PDF parser reached" }
  })
  for (const types of [LEGACY_UPLOAD_MIMES, [DOCUMENT_MIMES.pdf], ["application/wps-office.pdf"]]) {
    saveUploadConfig(types)
    const svc = services()
    const result = await router.handleMessage(upload(svc.thread.id, "report.pdf", " Application/WPS-Office.PDF; charset=binary "), svc, session())
    assert.equal(result.error, "PDF parser reached")
    assert.deepEqual(cfg.getConfig().file_upload!.allowed_types, [...types])
  }
  saveUploadConfig([DOCUMENT_MIMES.docx])
  const denied = services()
  const deniedResult = await router.handleMessage(upload(denied.thread.id, "report.pdf", "application/wps-office.pdf"), denied, session())
  assert.match(String(deniedResult.error), /不支持的文件类型/)
  saveUploadConfig(DEFAULT_UPLOAD_MIMES)
  for (const mime of ["application/wps-office.unknown", "application/custom"]) {
    const unknown = services()
    const result = await router.handleMessage(upload(unknown.thread.id, "report.pdf", mime), unknown, session())
    assert.match(String(result.error), /不支持的文件类型/)
  }
  assert.equal(reached, 3)
})

test("Linux WPS Office aliases use the standard MIME upload policy", async () => {
  const seen: string[] = []
  router.__testSetFileParseImpl(async (_bytes, name, mime) => {
    seen.push(mime)
    return { success: false, filename: name, mimeType: mime, error: "Office parser reached" }
  })
  for (const ext of ["doc", "docx", "xls", "xlsx", "ppt", "pptx"]) {
    const canonical = DOCUMENT_MIMES[ext]
    const alias = `application/wps-office.${ext}`
    for (const types of [[canonical], [alias]]) {
      saveUploadConfig(types)
      const svc = services()
      const result = await router.handleMessage(upload(svc.thread.id, `report.${ext}`, ` ${alias.toUpperCase()}; charset=binary `), svc, session())
      assert.equal(result.error, "Office parser reached")
      assert.equal(seen.at(-1), canonical)
      assert.deepEqual(cfg.getConfig().file_upload!.allowed_types, types)
    }
    const count = seen.length
    saveUploadConfig([DOCUMENT_MIMES.pdf])
    const svc = services()
    const result = await router.handleMessage(upload(svc.thread.id, `report.${ext}`, alias), svc, session())
    assert.match(String(result.error), /不支持的文件类型/)
    assert.equal(seen.length, count)
  }
})

test("chat keeps unrestricted empty allowlist and rejects ET/DPS with save-as guidance", async () => {
  saveUploadConfig([])
  let parses = 0
  router.__testSetFileParseImpl(async (_bytes, name, mime) => {
    parses++
    return { success: false, filename: name, mimeType: mime, error: "entry parser reached" }
  })
  const svc = services()
  const result = await router.handleMessage(upload(svc.thread.id), svc, session())
  assert.equal(result.error, "entry parser reached")
  for (const ext of ["et", "dps"]) {
    const other = services()
    const refused = await router.handleMessage(upload(other.thread.id, `report.${ext}`, "application/msword"), other, session())
    assert.match(String(refused.error), /WPS.*另存为/)
  }
  assert.equal(parses, 1)
})

async function uploadWps(bytes: Buffer, name = "报告.WPS", mime = "application/wps-office.wps") {
  const svc = services()
  const request = upload(svc.thread.id, name, mime)
  request.files[0].content = bytes.toString("base64")
  const result = await router.handleMessage(request, svc, session())
  const user = svc.threadManager.getMessages(svc.thread.id).find(message => message.role === "user")
  return { result, user }
}

function stubDocumentChat() {
  completionImpl = async () => (async function* () {
    yield { choices: [{ delta: { content: "已读取文档" }, finish_reason: "stop" }] }
  })()
}

const wordImportSampleDir = process.env.CMSPARK_WORD_IMPORT_SAMPLE_DIR
test("local four-file Word regression reaches chat with real parsing and an isolated LLM", {
  skip: !wordImportSampleDir,
}, async () => {
  saveUploadConfig(LEGACY_UPLOAD_MIMES)
  stubDocumentChat()
  const files = ["sample-1.doc", "sample-2.docx", "sample-3.docx", "sample-4.docx"].map(name => ({
    name,
    type: name.endsWith(".doc") ? DOCUMENT_MIMES.doc : DOCUMENT_MIMES.docx,
    content: fs.readFileSync(path.join(wordImportSampleDir!, name)).toString("base64"),
  }))
  const svc = services()
  const result = await router.handleMessage({ type: "file.upload", thread_id: svc.thread.id, message: "读取四份文档", files }, svc, session())
  assert.equal(result.type, "file.uploaded", JSON.stringify(result))
  assert.deepEqual(result.files, files.map(file => file.name))
  const user = svc.threadManager.getMessages(svc.thread.id).find(message => message.role === "user")
  assert.ok(user)
  const content = typeof user.content === "string" ? user.content : JSON.stringify(user.content)
  for (const file of files) assert.ok(content.includes(file.name))
  assert.ok(content.length > 28_000, "all four document bodies must reach the saved chat turn")
})

test("chat accepts Word bytes in a .wps only under the DOC upload policy", async () => {
  const bytes = fs.readFileSync(path.join(fixtureRoot, "one-page.doc"))
  stubDocumentChat()
  for (const types of [[DOCUMENT_MIMES.docx], [DOCUMENT_MIMES.pdf], ["application/octet-stream"], ["application/wps-office.wps"]]) {
    saveUploadConfig(types)
    const { result, user } = await uploadWps(bytes, "报告.WPS", "image/png")
    assert.equal(result.type, "file.upload_error")
    assert.match(String(result.error), /不支持的文件类型: application\/msword/)
    assert.equal(user, undefined)
  }

  saveUploadConfig([DOCUMENT_MIMES.doc])
  const { result, user } = await uploadWps(bytes)
  assert.equal(result.type, "file.uploaded", JSON.stringify(result))
  assert.deepEqual(result.files, ["报告.WPS"])
  assert.match(String(user?.content), /Office preview 中文文档/)
})

test("chat refuses fake, encrypted, malformed, and non-Word .wps without sending a document turn", async () => {
  saveUploadConfig([DOCUMENT_MIMES.doc])
  const word = fs.readFileSync(path.join(fixtureRoot, "one-page.doc"))
  const encrypted = Buffer.from(word)
  const fib = word.indexOf(Buffer.from("eca50101", "hex"))
  assert.ok(fib > 0)
  encrypted.writeUInt16LE(word.readUInt16LE(fib + 10) | 0x0100, fib + 10)
  const ignoredObfuscationFlag = Buffer.from(word)
  ignoredObfuscationFlag.writeUInt16LE(word.readUInt16LE(fib + 10) | 0x8000, fib + 10)
  assert.ok(isWpsWithWordDocContent(ignoredObfuscationFlag), "MS-DOC ignores fObfuscated when fEncrypted is clear")
  const wrongTable = Buffer.from(word)
  wrongTable.writeUInt16LE(word.readUInt16LE(fib + 10) ^ 0x0200, fib + 10)
  const invalidClx = Buffer.from(word)
  invalidClx.writeUInt32LE(0xffffffff, fib + 418)
  const cyclicDirectory = Buffer.from(word)
  const directorySector = word.readUInt32LE(48)
  const fatSector = word.readUInt32LE(76)
  cyclicDirectory.writeUInt32LE(directorySector, (fatSector + 1) * 512 + directorySector * 4)
  for (const bytes of [
    Buffer.from("{\\rtf1 wrong format}"),
    fs.readFileSync(path.join(fixtureRoot, "one-sheet.xls")),
    word.subarray(0, word.length - 1),
    encrypted, wrongTable, invalidClx, cyclicDirectory,
  ]) {
    const { result, user } = await uploadWps(bytes, "报告.wps", DOCUMENT_MIMES.doc)
    assert.equal(result.type, "file.upload_error")
    assert.match(String(result.error), /WPS.*另存为.*docx/)
    assert.equal(user, undefined)
  }
})

const wpsSampleDir = process.env.CMSPARK_WPS_SAMPLE_DIR
test("four hash-pinned WPS Office originals preserve the expected content through chat (#829)", {
  skip: !wpsSampleDir,
  timeout: 120_000,
}, async t => {
  saveUploadConfig(LEGACY_UPLOAD_MIMES)
  stubDocumentChat()
  const samples = [
    {
      id: "528971", hash: "8542ea1f2c981d313c5c99cc70b44986985702da063d87df649fc3c7ea3eef47",
      expected: [/企业信息采集表填写须知/, /不超过100位/, /39：参加的活动名称/], table: false,
    },
    {
      id: "528972", hash: "217e83ba6aeac92f706efbe9e0dfb88660799f3e5dbb64b6e2d9716ea0c99e73",
      expected: [/企业报名承诺函/, /2025年中山市/, /不少于1种宣传物料/], table: false,
    },
    {
      id: "572127", hash: "18eb9cca9ae16bceeae547762ba1c9813ad55ef33474559d99ec50a3ff4382bd",
      expected: [/技能提升培训基本情况表/, /<td[^>]*><p>师资情况/, /<p>2.（教师总数/, /M<sup>2/], table: true,
    },
    {
      id: "572129", hash: "175a0ae911b83bce2db6760bfa5b8d85ff47c458edc7d591deb0482d91f04e13",
      expected: [/附件3/, /培训教学计划/, /<p>培训内容及要求/, /<p>总计<\/p><\/td>\s*<td><p><\/p>/], table: true,
    },
  ]
  for (const { id, hash, expected, table } of samples) {
    await t.test(id, async () => {
      const bytes = fs.readFileSync(path.join(wpsSampleDir!, `${id}.wps`))
      assert.equal(createHash("sha256").update(bytes).digest("hex"), hash)
      const { result, user } = await uploadWps(bytes, `${id}.wps`)
      assert.equal(result.type, "file.uploaded", JSON.stringify(result))
      assert.deepEqual(result.files, [`${id}.wps`])
      const content = String(user?.content)
      for (const marker of expected) assert.match(content, marker)
      assert.equal(content.includes("<table>"), table)
    })
  }
})

test("chat abort cancels its active parser and does not persist unread file content", async () => {
  saveUploadConfig(DEFAULT_UPLOAD_MIMES)
  let entered!: () => void
  const parsing = new Promise<void>(resolve => { entered = resolve })
  let parseSignal: AbortSignal | undefined
  router.__testSetFileParseImpl(async (_bytes, name, mime, options) => {
    parseSignal = options?.signal
    entered()
    return new Promise(resolve => {
      parseSignal!.addEventListener("abort", () => resolve({ success: false, filename: name, mimeType: mime, error: "cancelled" }), { once: true })
    })
  })
  const svc = services()
  const uploadResult = router.handleMessage(upload(svc.thread.id), svc, session())
  await parsing
  await router.handleMessage({ type: "chat.abort", thread_id: svc.thread.id }, svc, session())
  const result = await uploadResult
  assert.equal(parseSignal?.aborted, true)
  assert.equal(result.type, "file.upload_error")
  assert.match(String(result.error), /取消/)
  assert.equal(svc.threadManager.getMessages(svc.thread.id).filter(message => message.role === "user").length, 0)
  assert.equal(router.listLlmActiveThreadIds().includes(svc.thread.id), false)
})

function rendered(name: string, mime: string): FileParseResponse {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return { success: true, filename: name, mimeType: mime, fileSize: 10, text: "等待视觉分析", requiresVision: true, pageCount: 12, warning: "仅渲染前 2 页", embeddedImages: [1, 2].map(page => ({ base64: Buffer.concat([pngHeader, Buffer.from(`render-entry-page-${page}`)]).toString("base64"), title: `第 ${page} 页`, width: 10, height: 10, format: "png" })) }
}

test("render-only knowledge preview/import/native/directory all refuse to persist placeholders", async () => {
  router.__testSetFileParseImpl(async (_bytes, name, mime) => rendered(name, mime))
  const svc = services()
  const knowledgeBefore = svc.skillEngine.listKnowledge()
  const file = { name: "scan.pdf", content: Buffer.from("test bytes").toString("base64") }
  for (const type of ["knowledge.preview", "knowledge.import"]) {
    const result = await router.handleMessage({ type, file, id: "kp-render-only" }, svc, session())
    assert.equal(result.type, "error")
    assert.match(String(result.error), /知识库需要可提取的文字/)
  }
  const dir = path.join(testHome, "scan-folder")
  fs.mkdirSync(dir)
  const diskFile = path.join(dir, "scan.pdf")
  fs.writeFileSync(diskFile, "test bytes")
  router.__testSetPickFileNative(async () => ({ path: diskFile }))
  const preview = await router.handleMessage({ type: "knowledge.import_local_file", user_gesture: true }, svc, session())
  assert.match(String(preview.preview), /知识库需要可提取的文字/)
  assert.equal(preview.import_content, undefined)
  router.__testSetPickFolderNative(async () => ({ path: dir }))
  const imported = await router.handleMessage({ type: "knowledge.import_directory", user_gesture: true }, svc, session())
  assert.equal(imported.imported, 0)
  assert.equal(imported.failed, 1)
  assert.match(JSON.stringify(imported.errors), /知识库需要可提取的文字/)
  assert.deepEqual(svc.skillEngine.listKnowledge(), knowledgeBefore)
})

test("render-only chat refuses disabled vision and metadata-only fallback", async () => {
  router.__testSetFileParseImpl(async (_bytes, name, mime) => rendered(name, mime))
  saveUploadConfig(DEFAULT_UPLOAD_MIMES, false)
  let svc = services()
  let result = await router.handleMessage(upload(svc.thread.id, "scan.pdf"), svc, session())
  assert.match(String(result.error), /需要视觉分析/)
  assert.equal(svc.threadManager.getMessages(svc.thread.id).filter(message => message.role === "user").length, 0)
  saveUploadConfig(DEFAULT_UPLOAD_MIMES, true)
  completionImpl = async () => { throw new Error("vision backend unavailable") }
  svc = services()
  result = await router.handleMessage(upload(svc.thread.id, "scan.pdf"), svc, session())
  assert.equal(result.type, "file.upload_error")
  assert.match(String(result.error), /页面视觉分析未成功/)
  assert.equal(svc.threadManager.getMessages(svc.thread.id).filter(message => message.role === "user").length, 0)
})

test("render-only chat accepts an actual vision success and records partial-page warning", async () => {
  router.__testSetFileParseImpl(async (_bytes, name, mime) => rendered(name, mime))
  saveUploadConfig(DEFAULT_UPLOAD_MIMES, true)
  let visions = 0
  completionImpl = async params => {
    if (params.model === "entry-vision") {
      visions++
      if (visions === 2) throw new Error("second page unavailable")
      return { choices: [{ message: { content: "页面实际正文：收入 12345" } }] }
    }
    if (params.stream) return (async function* () {
      yield { choices: [{ index: 0, delta: { content: "已读取" }, finish_reason: null }] }
      yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
    })()
    return { choices: [{ message: { content: "文档" } }] }
  }
  const svc = services()
  const result = await router.handleMessage(upload(svc.thread.id, "scan.pdf"), svc, session())
  assert.equal(result.type, "file.uploaded", JSON.stringify(result))
  const user = svc.threadManager.getMessages(svc.thread.id).find(message => message.role === "user")
  assert.ok(user)
  const text = typeof user.content === "string" ? user.content : JSON.stringify(user.content)
  assert.match(text, /页面实际正文：收入 12345/)
  assert.match(text, /成功 1\/2 页，文档共 12 页/)
  assert.match(text, /仅渲染前 2 页/)
  assert.equal((user as any).files, undefined, "render-only coverage does not masquerade as an ordinary conversion notice")
})

test("real legacy DOC reaches chat and regression ODP reaches native knowledge preview", async () => {
  router.__testSetFileParseImpl()
  saveUploadConfig(DEFAULT_UPLOAD_MIMES, false)
  completionImpl = async params => params.stream
    ? (async function* () {
      yield { choices: [{ index: 0, delta: { content: "已读取 Office 文档" }, finish_reason: null }] }
      yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
    })()
    : { choices: [{ message: { content: "Office 文档" } }] }
  const svc = services()
  const doc = fs.readFileSync(path.join(fixtureRoot, "one-page.doc"))
  const result = await router.handleMessage({ type: "file.upload", thread_id: svc.thread.id, message: "读取旧版 Word", files: [{ name: "legacy.doc", type: "application/octet-stream", content: doc.toString("base64") }] }, svc, session())
  assert.equal(result.type, "file.uploaded", JSON.stringify(result))
  const user = svc.threadManager.getMessages(svc.thread.id).find(message => message.role === "user")
  assert.ok(user)
  assert.match(typeof user.content === "string" ? user.content : JSON.stringify(user.content), /Office preview 中文文档/)

  let pickedFilter = ""
  router.__testSetPickFileNative(async options => {
    pickedFilter = options?.windowsFilter || ""
    return { path: path.join(fixtureRoot, "one-slide.odp") }
  })
  const preview = await router.handleMessage({ type: "knowledge.import_local_file", user_gesture: true, id: "kp-real-odp" }, svc, session())
  assert.equal(preview.type, "knowledge.preview")
  assert.match(String(preview.import_content), /Office preview 中文文档/)
  for (const ext of ["doc", "xls", "ppt", "ods", "odp"]) assert.ok(pickedFilter.includes(`*.${ext};`))
})

test("font warnings survive real chat/knowledge producer responses as metadata, never document or model text", async () => {
  const warning = "文档转换时缺少部分字体，布局可能与原文不同。"
  const body = "FONT_WARNING_DOCUMENT_BODY"
  router.__testSetFileParseImpl(async (_bytes, name, mime) => ({ success: true, filename: name, mimeType: mime, fileSize: 10, text: body, warning }))
  saveUploadConfig(DEFAULT_UPLOAD_MIMES, false)
  const modelInputs: string[] = []
  completionImpl = async params => {
    modelInputs.push(JSON.stringify(params.messages))
    return params.stream ? (async function* () {
      yield { choices: [{ index: 0, delta: { content: "已读取" }, finish_reason: null }] }
      yield { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
    })() : { choices: [{ message: { content: "文档" } }] }
  }
  const svc = services(), frames: any[] = []
  const sess = { ...session(), sendToExtension: (frame: unknown) => frames.push(frame) }
  const chatResult = await router.handleMessage(upload(svc.thread.id), svc, sess)
  assert.equal(chatResult.type, "file.uploaded")
  const chat = frames.find(frame => frame.type === "chat.user")
  assert.equal(chat.files?.[0]?.warning, warning)
  const reloaded = new ThreadManager().getMessages(svc.thread.id).find(message => message.id === chat.message_id) as any
  assert.equal(reloaded.files?.[0]?.warning, warning)
  assert.ok(!chat.content.includes(warning))
  await router.handleMessage({ type: "chat.create", thread_id: svc.thread.id, message: "继续讨论正文" }, svc, sess)
  const previewUpload = await router.handleMessage({ type: "knowledge.preview", id: "kp-font-upload", file: upload(svc.thread.id).files[0] }, svc, sess)
  assert.equal(previewUpload.warning, warning)
  const disk = path.join(testHome, "font-warning.doc")
  fs.writeFileSync(disk, "test document bytes")
  router.__testSetPickFileNative(async () => ({ path: disk }))
  const previewNative = await router.handleMessage({ type: "knowledge.import_local_file", id: "kp-font-native", user_gesture: true }, svc, sess)
  assert.equal(previewNative.warning, warning)
  assert.equal(previewNative.import_content, body)
  for (const preview of [previewUpload, previewNative]) assert.ok(!preview.preview.includes(warning))
  await router.handleMessage({ type: "knowledge.import", content: previewNative.import_content, title: "Font warning document", user_gesture: true }, svc, sess)
  const imported = svc.skillEngine.listKnowledge().find(item => item.title === "Font warning document")
  assert.ok(imported)
  assert.ok(!svc.skillEngine.getKnowledge(imported.id || imported.name)?.body.includes(warning))
  assert.ok(!modelInputs.join("\n").includes(warning))
  router.__testSetFileParseImpl(async (_bytes, name, mime) => ({ success: true, filename: name, mimeType: mime, fileSize: 10, text: body }))
  const clean = services(), cleanFrames: any[] = []
  await router.handleMessage(upload(clean.thread.id), clean, { ...session(), sendToExtension: (frame: any) => cleanFrames.push(frame) })
  assert.equal(Object.hasOwn(cleanFrames.find(frame => frame.type === "chat.user"), "files"), false)
  const cleanPreview = await router.handleMessage({ type: "knowledge.preview", id: "kp-clean", file: upload(clean.thread.id).files[0] }, clean, session())
  assert.equal(Object.hasOwn(cleanPreview, "warning"), false)
  router.__testSetFileParseImpl(async (_bytes, name, mime) => ({ success: true, filename: name, mimeType: mime, fileSize: 10, text: body, warning: warning.repeat(200) }))
  const boundedPreview = await router.handleMessage({ type: "knowledge.preview", id: "kp-bounded", file: upload(clean.thread.id).files[0] }, clean, session())
  assert.equal(boundedPreview.warning.length, 512)
  if (process.env.CMSPARK_RECORD_WARNING_FIXTURE) {
    const recorded = JSON.parse(JSON.stringify({ chat, previewUpload, previewNative }))
    fs.writeFileSync(process.env.CMSPARK_RECORD_WARNING_FIXTURE, JSON.stringify(recorded, null, 2) + "\n")
  }
})
