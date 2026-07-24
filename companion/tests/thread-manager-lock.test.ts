import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-thread-lock-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  process.env.HOME = tempHome
  const config = await import("../src/config")
  initDataDir = config.initDataDir
  await initDataDir()
  const mod = await import("../src/threads/thread-manager")
  ThreadManager = mod.ThreadManager
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("C-P0-1: withThreadLock serializes concurrent ops on the same thread", async () => {
  // Two callers each append N messages with an await between read and write.
  // WITHOUT the lock, the second caller's read can happen before the first's
  // write completes → lost writes. WITH the lock, ops serialize.
  const manager = new ThreadManager()
  const thread = manager.create("race-probe")

  let inFlight = 0
  let maxConcurrent = 0

  const worker = async (n: number) => {
    await manager.withThreadLock(thread.id, async () => {
      inFlight++
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      const msgs = manager.getMessages(thread.id)
      // Simulate async work between read and write (the dangerous window).
      await new Promise((r) => setTimeout(r, 5))
      manager.addMessage(thread.id, {
        thread_id: thread.id,
        role: "user",
        content: `worker-${n} msg-${msgs.length}`,
      })
      inFlight--
    })
  }

  await Promise.all([worker(1), worker(2), worker(3), worker(4)])

  // Lock guarantees mutual exclusion:
  assert.equal(maxConcurrent, 1, "concurrent callers entered the critical section")
  // And no lost writes:
  const final = manager.getMessages(thread.id)
  assert.equal(final.length, 4, "all 4 messages persisted")
})

test("C-P0-1: withThreadLock is per-thread (independent threads run in parallel)", async () => {
  const manager = new ThreadManager()
  const t1 = manager.create("t1")
  const t2 = manager.create("t2")

  let inFlight = 0
  let maxConcurrent = 0

  const probe = async (id: string) => {
    await manager.withThreadLock(id, async () => {
      inFlight++
      maxConcurrent = Math.max(maxConcurrent, inFlight)
      // Yield to let the other thread enter its lock too.
      await new Promise((r) => setTimeout(r, 20))
      inFlight--
    })
  }

  await Promise.all([probe(t1.id), probe(t2.id)])

  // Different threads → locks don't block each other → both should be inside
  // their critical sections simultaneously.
  assert.equal(maxConcurrent, 2, "different-thread ops should run in parallel")
})

test("C-P0-1: withThreadLock propagates rejections without poisoning the chain", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("rejection-probe")

  const first = manager.withThreadLock(thread.id, async () => {
    throw new Error("first-op-failed")
  })
  await assert.rejects(first, /first-op-failed/)

  // Subsequent ops on the same thread should still work (chain not poisoned).
  await manager.withThreadLock(thread.id, async () => {
    manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "after-fail" })
  })

  const msgs = manager.getMessages(thread.id)
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].content, "after-fail")
})
