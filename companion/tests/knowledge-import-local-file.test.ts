/**
 * #285: companion native single-file picker (no base64 WS).
 */
import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { PARSE_FILE_MAX_BYTES } from "../src/file-parser"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-local-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let handleMessage: typeof import("../src/message-router").handleMessage
let __testSetPickFileNative: typeof import("../src/message-router").__testSetPickFileNative
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let validateWsMessage: typeof import("../src/ws/validate").validateWsMessage
let initDataDir: () => Promise<void>

before(async () => {
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  __testSetPickFileNative = mr.__testSetPickFileNative
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  const cfg = await import("../src/config")
  initDataDir = cfg.initDataDir
  await initDataDir()
})

after(() => {
  __testSetPickFileNative()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("validate: knowledge.import_local_file requires user_gesture", () => {
  assert.equal(validateWsMessage({ type: "knowledge.import_local_file" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.import_local_file", user_gesture: true }).valid, true)
})

test("#285 native pick of a markdown file returns preview with import_content (stripped path)", async () => {
  const file = path.join(tempHome, "note.md")
  fs.writeFileSync(file, "---\ntitle: Local Note\n---\n\nHello from disk.\n")
  __testSetPickFileNative(async () => ({ path: file }))
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_local_file", user_gesture: true, id: "kp-285" },
    { skillEngine: se } as never,
  )
  __testSetPickFileNative()
  assert.equal(resp.type, "knowledge.preview", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.id, "kp-285")
  assert.ok(typeof resp.title === "string" && resp.title.length > 0)
  assert.match(String(resp.import_content), /Hello from disk/)
  assert.equal(String(resp.import_content).includes("data:image"), false)
})

test("#285 native pick cancelled does not open a fake preview", async () => {
  __testSetPickFileNative(async () => ({ error: "cancelled" }))
  const resp = await handleMessage(
    { type: "knowledge.import_local_file", user_gesture: true, id: "kp-cancel" },
    { skillEngine: new SkillEngine() } as never,
  )
  __testSetPickFileNative()
  assert.equal(resp.type, "knowledge.import_local_file_result")
  assert.equal(resp.error, "cancelled")
})

test("#285 native pick oversize is honest (10MB parse cap)", async () => {
  const file = path.join(tempHome, "huge.docx")
  fs.writeFileSync(file, Buffer.alloc(PARSE_FILE_MAX_BYTES + 1))
  __testSetPickFileNative(async () => ({ path: file }))
  const resp = await handleMessage(
    { type: "knowledge.import_local_file", user_gesture: true, id: "kp-huge" },
    { skillEngine: new SkillEngine() } as never,
  )
  __testSetPickFileNative()
  assert.equal(resp.type, "knowledge.preview")
  assert.match(String(resp.preview), /预览失败：/)
  assert.match(String(resp.preview), /过大/)
  assert.match(String(resp.preview), /10MB/)
})

test("#285 import_local_file without gesture is rejected", async () => {
  const resp = await handleMessage(
    { type: "knowledge.import_local_file" },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(resp.type, "error")
  assert.match(String(resp.error), /user_gesture/)
})

test("#285 directory walk cap matches parseFile 10MB (source pin)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "message-router.ts"), "utf8")
  const start = src.indexOf('case "knowledge.import_directory"')
  assert.ok(start >= 0)
  const body = src.slice(start, start + 2500)
  assert.match(body, /PARSE_FILE_MAX_BYTES/)
  assert.equal(body.includes("6 * 1024 * 1024"), false)
})
