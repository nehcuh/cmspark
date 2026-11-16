/** Task 2 review: restore failures must surface through the real caller and keep a retry. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-shell-callers-")))
process.env.CMSPARK_DATA_DIR = root
process.env.HOME = root
delete process.env.DEEPSEEK_API_KEY

type Engine = typeof import("../src/packs/pack-engine")
type Api = {
  config: typeof import("../src/config")
  packs: Engine
  ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
  SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
}
let api: Api | undefined
async function load(): Promise<Api> {
  if (!api) {
    const config = await import("../src/config")
    await config.initDataDir()
    api = {
      config,
      packs: await import("../src/packs/pack-engine"),
      ThreadManager: (await import("../src/threads/thread-manager")).ThreadManager,
      SkillEngine: (await import("../src/skills/skill-engine")).SkillEngine,
    }
  }
  return api
}

function failingSnap(profile: "community" | "enterprise" = "enterprise") {
  return {
    capability_profile: profile,
    auto_approve_dangerous: false,
    auto_approve_enterprise_tools: false,
    allow_all_schemes: false,
    modules: {
      shell: { enabled: false },
      netsec: { enabled: true },
      appsec: { enabled: false },
    },
  }
}

test("unapply keeps the cookie and journal when netsec restore fails, then retries", async () => {
  const { config, packs, ThreadManager, SkillEngine } = await load()
  config.saveConfig({
    capability_profile: "community",
    security: { auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false },
    modules: { netsec: { available: false, enabled: false, target_allowlist: ["127.0.0.1"], require_task_auth: true } },
  } as any)
  const engine = new SkillEngine()
  const saved = packs.saveUserPack({
    name: "caller-unapply",
    system_prompt_append: "unapply must not hide a failed restore",
    skill_ids: [],
    tools: { mode: "allowlist", allow: ["list_tabs"], deny: [] },
    trust: { auto_approve_dangerous: true },
  }, engine)
  assert.equal(saved.ok, true, (saved as { error?: string }).error)
  if (!saved.ok) return
  const tm = new ThreadManager()
  const thread = tm.create("unapply-fail")
  const { SECURITY_ARM_CONFIRM_PHRASE } = await import("../src/security-arm")
  assert.equal(packs.applyPack(saved.id, thread.id, tm, engine, { allowTrust: true, confirmation_phrase: SECURITY_ARM_CONFIRM_PHRASE }).ok, true)
  const snap = failingSnap("community")
  tm.update(thread.id, { mission_pack_trust_snapshot: snap as any })
  const held = packs.readTrustJournal()
  assert.ok(held)
  packs.writeTrustJournal({ ...held!, snap })
  const result = packs.unapplyPack(thread.id, tm, engine)
  const gaps: string[] = []
  if (result.ok) gaps.push("unapply reported success")
  if (result.ok || !/enterprise_profile_required/.test(result.error || "")) gaps.push(`error=${result.ok ? "" : result.error}`)
  if (!packs.isPackTrustSnapshot(tm.get(thread.id)?.mission_pack_trust_snapshot)) gaps.push("cookie dropped")
  if (!packs.readTrustJournal()) gaps.push("journal dropped")
  if ((config.getConfig() as any).modules?.netsec?.enabled === true) gaps.push("netsec enabled despite failure")
  const retained = tm.get(thread.id)?.mission_pack_trust_snapshot as { capability_profile?: string } | null
  if (retained) {
    retained.capability_profile = "enterprise"
    tm.update(thread.id, { mission_pack_trust_snapshot: retained as any })
  }
  const retried = packs.unapplyPack(thread.id, tm, engine)
  if (!retried.ok) gaps.push(`retry=${(retried as { error?: string }).error}`)
  if (packs.isPackTrustSnapshot(tm.get(thread.id)?.mission_pack_trust_snapshot)) gaps.push("cookie survived success")
  if (packs.readTrustJournal()) gaps.push("journal survived success")
  if ((config.getConfig() as any).modules?.netsec?.enabled !== true) gaps.push("retry did not restore netsec")
  if ((config.getConfig() as any).modules?.netsec?.target_allowlist?.[0] !== "127.0.0.1") gaps.push("retry changed netsec allowlist")
  assert.deepEqual(gaps, [])
})

test("orphan release and thread deletion keep a journal retry without a dangling cookie", async () => {
  const { config, packs, ThreadManager } = await load()
  config.saveConfig({
    capability_profile: "community",
    modules: { netsec: { available: false, enabled: false, target_allowlist: ["10.0.0.2"], require_task_auth: true } },
  } as any)
  const tm = new ThreadManager()
  const orphan = tm.create("orphan-cookie")
  const snap = failingSnap("community")
  tm.update(orphan.id, { mission_pack_id: null as any, mission_pack_trust_snapshot: snap as any })
  packs.writeTrustJournal({ phase: "held", thread_id: orphan.id, pack_id: "orphan-pack", snap, at: new Date().toISOString() })
  const orphanResult = packs.releaseOrphanTrustCookie(orphan.id, tm, "pack.unapply:orphan_cookie")
  const gaps: string[] = []
  if (orphanResult !== false) gaps.push(`orphan returned ${orphanResult}`)
  if (!packs.isPackTrustSnapshot(tm.get(orphan.id)?.mission_pack_trust_snapshot)) gaps.push("orphan cookie dropped")
  if (!packs.readTrustJournal()) gaps.push("orphan journal dropped")
  if ((config.getConfig() as any).modules?.netsec?.enabled === true) gaps.push("orphan enabled netsec")

  const doomed = tm.create("thread-gone")
  tm.update(doomed.id, { mission_pack_trust_snapshot: snap as any })
  packs.writeTrustJournal({ phase: "held", thread_id: doomed.id, pack_id: "gone-pack", snap, at: new Date().toISOString() })
  const released = packs.releaseTrustBeforeThreadGone(tm.get(doomed.id)!, "thread.delete", tm)
  if (released !== false) gaps.push(`thread-gone returned ${released}`)
  if (packs.isPackTrustSnapshot(tm.get(doomed.id)?.mission_pack_trust_snapshot)) gaps.push("deleted thread kept the cookie")
  const handed = packs.readTrustJournal()
  if (!handed || handed.thread_id !== doomed.id) gaps.push("journal was not handed off")
  tm.delete(doomed.id)
  const first = packs.reconcilePackTrustOnBoot(tm)
  if (String(first.action) !== "restore_failed") gaps.push(`boot after delete=${first.action}`)
  if (!packs.readTrustJournal()) gaps.push("boot cleared the failed journal")
  const pending = packs.readTrustJournal()
  if (pending) packs.writeTrustJournal({ ...pending, snap: { ...pending.snap, capability_profile: "enterprise" } })
  const second = packs.reconcilePackTrustOnBoot(tm)
  if (second.action !== "restored_orphan_held") gaps.push(`boot retry=${second.action}`)
  if (packs.readTrustJournal()) gaps.push("successful boot left the journal")
  if ((config.getConfig() as any).modules?.netsec?.enabled !== true) gaps.push("boot retry did not restore netsec")
  const leftover = tm.get(orphan.id)?.mission_pack_trust_snapshot as { capability_profile?: string } | null
  if (leftover) {
    leftover.capability_profile = "enterprise"
    tm.update(orphan.id, { mission_pack_trust_snapshot: leftover as any })
    if (packs.releaseOrphanTrustCookie(orphan.id, tm) !== true) gaps.push("orphan retry did not finish")
  }
  assert.deepEqual(gaps, [])
})

test("boot reconcile does not report restored when the journal restore fails", async () => {
  const { config, packs, ThreadManager } = await load()
  config.saveConfig({
    capability_profile: "enterprise",
    security: { auto_approve_dangerous: true, auto_approve_enterprise_tools: false, allow_all_schemes: false },
    modules: { netsec: { available: false, enabled: false, target_allowlist: [], require_task_auth: true } },
  } as any)
  const snap = failingSnap("community")
  const tm = new ThreadManager()
  packs.writeTrustJournal({ phase: "applying", thread_id: "ghost", pack_id: "ghost", snap, at: new Date().toISOString() })
  const applying = packs.reconcilePackTrustOnBoot(tm)
  const gaps: string[] = []
  if (String(applying.action) !== "restore_failed") gaps.push(`applying=${applying.action}`)
  if (!packs.readTrustJournal()) gaps.push("applying journal cleared")
  if ((config.getConfig() as any).modules?.netsec?.enabled === true) gaps.push("applying enabled netsec")
  packs.writeTrustJournal({ phase: "held", thread_id: "missing", pack_id: "missing", snap, at: new Date().toISOString() })
  const held = packs.reconcilePackTrustOnBoot(tm)
  if (String(held.action) !== "restore_failed") gaps.push(`held=${held.action}`)
  if (!packs.readTrustJournal()) gaps.push("held journal cleared")
  assert.deepEqual(gaps, [])
})

test("apply reports a failed trust rollback and keeps the applying journal", async () => {
  const { config, packs, ThreadManager, SkillEngine } = await load()
  config.saveConfig({
    capability_profile: "community",
    security: { auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false },
    modules: {
      shell: { available: false, enabled: false, policy: "allowlist", allowlist_commands: ["echo"] },
      netsec: { available: true, enabled: true, target_allowlist: ["127.0.0.1"], require_task_auth: true },
    },
  } as any)
  const engine = new SkillEngine()
  const saved = packs.saveUserPack({
    name: "caller-rollback",
    system_prompt_append: "rollback failure must be visible",
    skill_ids: [],
    tools: { mode: "allowlist", allow: ["list_tabs"], deny: [] },
    trust: { enable_modules: ["shell"] },
  }, engine)
  assert.equal(saved.ok, true, (saved as { error?: string }).error)
  if (!saved.ok) return
  const installed = packs.listInstalledPacks().find((item) => item.id === saved.id)
  const yamlPath = path.join(installed!.installed_path, "pack.yaml")
  fs.writeFileSync(yamlPath, fs.readFileSync(yamlPath, "utf8").replace(/requires_modules:[\s\S]*?\n(?=\S)/, "requires_modules: []\n"))
  let flipped = false
  const onChange = () => {
    if (flipped) return
    flipped = true
    config.saveConfig({ modules: { netsec: { available: false, enabled: false, target_allowlist: ["127.0.0.1"], require_task_auth: true } } } as any)
  }
  config.configEvents.on(config.CONFIG_CHANGE_EVENT, onChange)
  try {
    const tm = new ThreadManager()
    const applied = packs.applyPack(saved.id, tm.create("rollback").id, tm, engine, { allowTrust: true })
    const gaps: string[] = []
    if (applied.ok) gaps.push("apply succeeded")
    const error = applied.ok ? "" : applied.error || ""
    if (!error.includes("module not available: shell")) gaps.push(`missing shell failure=${error}`)
    if (!error.includes("trust_rollback_failed")) gaps.push(`missing rollback=${error}`)
    if (/api_key|BEGIN |SECRET/.test(error)) gaps.push("rollback error leaked a secret")
    const journal = packs.readTrustJournal()
    if (!journal || journal.phase !== "applying") gaps.push(`journal=${journal?.phase || "missing"}`)
    if ((config.getConfig() as any).modules?.netsec?.enabled === true) gaps.push("rollback pretended netsec was restored")
    if ((config.getConfig() as any).modules?.shell?.allowlist_commands?.[0] !== "echo") gaps.push("shell allowlist changed")
    assert.deepEqual(gaps, [])
  } finally {
    config.configEvents.off(config.CONFIG_CHANGE_EVENT, onChange)
  }
})
