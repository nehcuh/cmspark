import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// #293: the single-doc knowledge.import path must run the #281 exact-dup
// gate server-side — a duplicate body without force:true is rejected (never
// lands on disk) and the frame carries the existing doc's id/title;
// force:true (确认面板「仍导入」) writes the suffixed duplicate.

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-dupgate-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let handleMessage: typeof import("../src/message-router").handleMessage

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfigDir = configMod.getConfigDir
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  handleMessage = (await import("../src/message-router")).handleMessage
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetKnowledgeDirs() {
  fs.rmSync(path.join(getConfigDir(), "knowledge"), { recursive: true, force: true })
}

function globalMdFiles(): string[] {
  const dir = path.join(getConfigDir(), "knowledge", "global")
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
}

const DUP_BODY = "# Dup Gate Notes\n\nUNIQUE_DUP_GATE_BODY_293 alpha bravo charlie delta"

test("exact-dup import without force is rejected; nothing lands on disk", async () => {
  resetKnowledgeDirs()
  const se = new SkillEngine()
  const first = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY, user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(first.type, "knowledge.list")
  assert.ok(first.imported?.id, "first import succeeds")
  assert.equal(globalMdFiles().length, 1)

  const rejected = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY, user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(rejected.type, "knowledge.import_rejected", "duplicate import is rejected server-side")
  assert.equal(rejected.duplicate_of?.id, first.imported.id, "frame carries the existing doc id")
  assert.equal(typeof rejected.duplicate_of?.title, "string")
  assert.ok(rejected.duplicate_of.title.length > 0)
  assert.equal(globalMdFiles().length, 1, "no-force duplicate must not land on disk")
  assert.equal(se.listKnowledge().length, 1)
})

test("preview flags the duplicate, then the matching import without force is rejected", async () => {
  resetKnowledgeDirs()
  const se = new SkillEngine()
  const first = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY + " echo", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.ok(first.imported?.id)

  const pv = await handleMessage(
    { type: "knowledge.preview", content: DUP_BODY + " echo", id: "kp-dupgate-1" },
    { skillEngine: se } as never,
  )
  assert.equal(pv.type, "knowledge.preview")
  assert.equal(pv.duplicate_of?.id, first.imported.id, "preview flags exact-dup")

  const rejected = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY + " echo", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(rejected.type, "knowledge.import_rejected")
  assert.equal(globalMdFiles().length, 1)
})

test("exact-dup import with force:true writes the suffixed duplicate", async () => {
  resetKnowledgeDirs()
  const se = new SkillEngine()
  const first = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY + " forcecase", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.ok(first.imported?.id)

  const forced = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY + " forcecase", user_gesture: true, force: true },
    { skillEngine: se } as never,
  )
  assert.equal(forced.type, "knowledge.list", "force:true writes through")
  assert.ok(forced.imported?.id)
  assert.notEqual(forced.imported.id, first.imported.id, "suffix-allocated, never overwrite")
  assert.equal(globalMdFiles().length, 2, "forced duplicate lands as notes-2 style suffix")
  assert.equal(se.listKnowledge().length, 2)
})

test("distinct body still imports without force (gate does not over-block)", async () => {
  resetKnowledgeDirs()
  const se = new SkillEngine()
  const first = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY, user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.ok(first.imported?.id)
  const second = await handleMessage(
    { type: "knowledge.import", content: DUP_BODY + "\n\nextra unique tail", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(second.type, "knowledge.list")
  assert.equal(globalMdFiles().length, 2)
})
