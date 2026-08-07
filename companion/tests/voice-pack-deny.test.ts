// Path B M0 Task 5 — pack deny-list for voice risk keys (ADR-023 L15)
//
// Install/apply/save must never write config.voice.sttEngine (or other voice keys).
// Strip: stripVoiceForbiddenKeys / stripVoiceKeysFromPackYaml
// Reject: scanForbidden via isVoiceForbiddenPackKey in validator

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-voice-pack-deny-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfig: typeof import("../src/config").getConfig
let getConfigDir: typeof import("../src/config").getConfigDir
let saveConfig: typeof import("../src/config").saveConfig
let clearConfigCache: typeof import("../src/config").clearConfigCache
let setVoiceFields: typeof import("../src/config").setVoiceFields
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let packEngine: typeof import("../src/packs/pack-engine")
let validatePackDir: typeof import("../src/packs/validator").validatePackDir
let stripVoiceForbiddenKeys: typeof import("../src/packs/types").stripVoiceForbiddenKeys
let isVoiceForbiddenPackKey: typeof import("../src/packs/types").isVoiceForbiddenPackKey

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfig = configMod.getConfig
  getConfigDir = configMod.getConfigDir
  saveConfig = configMod.saveConfig
  clearConfigCache = configMod.clearConfigCache
  setVoiceFields = configMod.setVoiceFields
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  packEngine = await import("../src/packs/pack-engine")
  validatePackDir = (await import("../src/packs/validator")).validatePackDir
  const types = await import("../src/packs/types")
  stripVoiceForbiddenKeys = types.stripVoiceForbiddenKeys
  isVoiceForbiddenPackKey = types.isVoiceForbiddenPackKey
  await initDataDir()
  clearConfigCache()
  saveConfig({
    modules: {
      appsec: {
        available: true,
        enabled: true,
        enabled_at: new Date().toISOString(),
        enabled_by: "test",
      },
    },
  } as any)
  clearConfigCache()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function basePackYaml(extra: string, id = "voice-mal-pack"): string {
  return `
schema_version: 1
id: ${id}
name: VoiceMal
version: 0.1.0
channel: community
min_capability: L1
requires_modules: [appsec]
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [list_tabs]
  deny: []
system_prompt_append: "ignore voice"
${extra}
`
}

function writePack(dir: string, yamlBody: string) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "pack.yaml"), yamlBody)
}

function forceBrowserEngine() {
  setVoiceFields({ sttEngine: "browser", localModelId: "medium" })
  clearConfigCache()
  assert.equal(getConfig().voice?.sttEngine, "browser")
}

test("isVoiceForbiddenPackKey matches planned prefixes (case-insensitive)", () => {
  assert.equal(isVoiceForbiddenPackKey("voice"), true)
  assert.equal(isVoiceForbiddenPackKey("VoiceConfig"), true)
  assert.equal(isVoiceForbiddenPackKey("sttEngine"), true)
  assert.equal(isVoiceForbiddenPackKey("localModelId"), true)
  assert.equal(isVoiceForbiddenPackKey("voiceStt"), true)
  assert.equal(isVoiceForbiddenPackKey("voice_privacy_ack_v2"), true)
  assert.equal(isVoiceForbiddenPackKey("voiceAutoSend"), true)
  assert.equal(isVoiceForbiddenPackKey("skills"), false)
  assert.equal(isVoiceForbiddenPackKey("tools"), false)
})

test("stripVoiceForbiddenKeys removes nested voice/sttEngine", () => {
  const doc: Record<string, unknown> = {
    id: "x",
    voice: { sttEngine: "local" },
    config: { voice: { sttEngine: "local", localModelId: "small" } },
    thread_defaults: { sttEngine: "local", skill_selection_mode: "manual" },
    trust: { auto_approve_dangerous: true, voiceAutoSend: true },
  }
  assert.equal(stripVoiceForbiddenKeys(doc), true)
  assert.equal("voice" in doc, false)
  assert.deepEqual(doc.config, {})
  assert.deepEqual(doc.thread_defaults, { skill_selection_mode: "manual" })
  assert.deepEqual(doc.trust, { auto_approve_dangerous: true })
})

test("validatePackDir rejects top-level voice key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-pack-val-"))
  writePack(
    dir,
    basePackYaml(`
voice:
  sttEngine: local
  localModelId: small
`),
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /forbidden voice key/i)
})

test("validatePackDir rejects nested config.voice and trust.sttEngine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-pack-val2-"))
  writePack(
    dir,
    basePackYaml(`
origin: user
config:
  voice:
    sttEngine: local
`),
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /forbidden voice key/i)

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "voice-pack-val3-"))
  writePack(
    dir2,
    basePackYaml(`
origin: user
trust:
  auto_approve_dangerous: true
  sttEngine: local
`),
  )
  const r2 = validatePackDir(dir2)
  assert.equal(r2.ok, false)
  if (!r2.ok) assert.match(r2.error, /forbidden voice key|sttEngine/i)
})

test("install path strips voice keys and does not change getConfig().voice.sttEngine", () => {
  forceBrowserEngine()
  const skillEngine = new SkillEngine()
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "voice-pack-src-"))
  writePack(
    src,
    basePackYaml(
      `
voice:
  sttEngine: local
  localModelId: large-v3-turbo
sttEngine: local
localModelId: small
config:
  voice:
    sttEngine: local
`,
      "voice-strip-install",
    ),
  )

  const before = getConfig().voice?.sttEngine
  assert.equal(before, "browser")

  const inst = packEngine.installPackFromDirectory(src, skillEngine, { force: true })
  assert.equal(inst.ok, true, inst.ok ? "" : (inst as any).error)

  clearConfigCache()
  assert.equal(
    getConfig().voice?.sttEngine,
    "browser",
    "install must never flip voice.sttEngine",
  )

  // Installed pack.yaml must not retain voice keys
  const installedYaml = fs.readFileSync(
    path.join(getConfigDir(), "packs", "installed", "voice-strip-install", "pack.yaml"),
    "utf-8",
  )
  assert.doesNotMatch(installedYaml, /\bvoice\s*:/i)
  assert.doesNotMatch(installedYaml, /\bsttEngine\b/i)
  assert.doesNotMatch(installedYaml, /\blocalModelId\b/i)
})

test("apply path with stripped pack does not change getConfig().voice.sttEngine", () => {
  forceBrowserEngine()
  const skillEngine = new SkillEngine()
  const tm = new ThreadManager()
  const thread = tm.create("voice-pack-apply")

  const src = fs.mkdtempSync(path.join(os.tmpdir(), "voice-pack-apply-src-"))
  writePack(
    src,
    basePackYaml(
      `
voice:
  sttEngine: local
thread_defaults:
  skill_selection_mode: manual
  sttEngine: local
`,
      "voice-strip-apply",
    ),
  )

  const inst = packEngine.installPackFromDirectory(src, skillEngine, { force: true })
  assert.equal(inst.ok, true, inst.ok ? "" : (inst as any).error)

  const applied = packEngine.applyPack("voice-strip-apply", thread.id, tm, skillEngine, {
    allowTrust: true,
  })
  assert.equal(applied.ok, true, applied.ok ? "" : (applied as any).error)

  clearConfigCache()
  assert.equal(getConfig().voice?.sttEngine, "browser")
  assert.equal(getConfig().voice?.localModelId, "medium")
})

test("saveUserPack trust cannot smuggle voice fields into on-disk pack", () => {
  forceBrowserEngine()
  const skillEngine = new SkillEngine()
  const saved = packEngine.saveUserPack(
    {
      name: "User Voice Smuggle",
      system_prompt_append: "user scene body",
      trust: {
        auto_approve_dangerous: false,
        sttEngine: "local",
        voice: { sttEngine: "local" },
      } as any,
    },
    skillEngine,
  )
  assert.equal(saved.ok, true, saved.ok ? "" : (saved as any).error)
  if (!saved.ok) return

  const yamlPath = path.join(getConfigDir(), "packs", "installed", saved.id, "pack.yaml")
  const body = fs.readFileSync(yamlPath, "utf-8")
  assert.doesNotMatch(body, /\bsttEngine\b/i)
  assert.doesNotMatch(body, /^\s*voice\s*:/m)

  clearConfigCache()
  assert.equal(getConfig().voice?.sttEngine, "browser")
})
