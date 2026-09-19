/**
 * #X4: kicked worker chatCreate must join the abort map so Glance/stop_all work.
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-kick-abort-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let installKickAbortController: typeof import("../src/message-router").installKickAbortController
let releaseKickAbortController: typeof import("../src/message-router").releaseKickAbortController
let abortThreadChat: typeof import("../src/message-router").abortThreadChat
let listLlmActiveThreadIds: typeof import("../src/message-router").listLlmActiveThreadIds

before(async () => {
  const config = await import("../src/config")
  await config.initDataDir()
  const router = await import("../src/message-router")
  installKickAbortController = router.installKickAbortController
  releaseKickAbortController = router.releaseKickAbortController
  abortThreadChat = router.abortThreadChat
  listLlmActiveThreadIds = router.listLlmActiveThreadIds
})

test("#X4 installKickAbortController is visible to listLlmActiveThreadIds and abortThreadChat", () => {
  const tid = `kick-abort-${Date.now()}`
  const controller = installKickAbortController(tid)
  assert.equal(listLlmActiveThreadIds().includes(tid), true)
  const r = abortThreadChat(tid)
  assert.equal(r.stopped, true)
  assert.equal(controller.signal.aborted, true)
  assert.equal(listLlmActiveThreadIds().includes(tid), false)
})

test("#X4 releaseKickAbortController CAS-deletes only its own controller", () => {
  const tid = `kick-release-${Date.now()}`
  const controller = installKickAbortController(tid)
  releaseKickAbortController(tid, controller)
  assert.equal(listLlmActiveThreadIds().includes(tid), false)
  const r = abortThreadChat(tid)
  assert.equal(r.stopped, false)
})
