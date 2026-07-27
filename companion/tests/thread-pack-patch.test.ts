import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-thread-pack-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let initDataDir: typeof import("../src/config").initDataDir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("applyPackPatch sets mission_pack_id and snapshot atomically", () => {
  const tm = new ThreadManager()
  const t = tm.create("patch-test")
  assert.equal(t.mission_pack_id ?? null, null)

  const updated = tm.applyPackPatch(t.id, {
    mission_pack_id: "appsec-prd-review",
    mission_pack_snapshot: {
      tool_whitelist: null,
      active_skill_ids: ["browse"],
      system_prompt_append: null,
    },
    tool_whitelist: ["list_tabs", "get_page_html"],
    active_skill_ids: ["pack--appsec-prd-review--threat-model"],
    skill_selection_mode: "manual",
    system_prompt_append: "--- Mission Pack ---\nBe careful",
  })

  assert.equal(updated.mission_pack_id, "appsec-prd-review")
  assert.deepEqual(updated.tool_whitelist, ["list_tabs", "get_page_html"])
  assert.equal(updated.config_override.system_prompt_append, "--- Mission Pack ---\nBe careful")
  assert.ok(updated.mission_pack_snapshot)
  assert.deepEqual(updated.mission_pack_snapshot?.tool_whitelist, null)
})

test("validateConfigOverride accepts system_prompt_append", () => {
  const tm = new ThreadManager()
  const t = tm.create("append-test", undefined, {
    system_prompt_append: "extra rules",
  })
  assert.equal(t.config_override.system_prompt_append, "extra rules")
})

test("applyPackPatch rejects invalid tool_whitelist shape without mutating", () => {
  const tm = new ThreadManager()
  const t = tm.create("bad-patch")
  assert.throws(() => {
    tm.applyPackPatch(t.id, {
      mission_pack_id: "x",
      mission_pack_snapshot: null,
      tool_whitelist: "nope" as any,
      active_skill_ids: ["browse"],
      system_prompt_append: null,
    })
  })
  const again = tm.get(t.id)!
  assert.equal(again.mission_pack_id ?? null, null)
})
