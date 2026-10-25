import test from "node:test"
import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import { promises as fs } from "node:fs"
import { discoverLcu, lcuCommandIdentity, probeLcu, type LcuStatusExecution } from "../src/computer/lcu/discovery"
import { upstreamStatus } from "./fixtures/lcu-v0.13.0/producer"

test("passive command identity records only an owned executable target and rejects writable/non-executable targets", async t => {
  if (process.platform === "win32") { t.skip("LCU has no Windows executable contract"); return }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmspark-lcu-owned-")), command = path.join(root, "lcu")
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(command, "owned inert fixture; never executed\n", { mode: 0o700 })
  const identity = await lcuCommandIdentity(command)
  assert.ok(identity)
  assert.equal(identity.command, command)
  assert.equal(identity.realPath, await fs.realpath(command))
  assert.ok(identity.size > 0)
  await fs.chmod(command, 0o777)
  assert.equal(await lcuCommandIdentity(command), undefined)
  await fs.chmod(command, 0o600)
  assert.equal(await lcuCommandIdentity(command), undefined)
  assert.equal(await lcuCommandIdentity(path.join(root, "absent", "lcu")), undefined)
})

test("retargeted current symlink invalidates an otherwise valid actual-producer status receipt", async t => {
  if (process.platform === "win32") { t.skip("LCU has no Windows executable contract"); return }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cmspark-lcu-owned-link-")), command = path.join(root, "lcu")
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const first = path.join(root, "release-a"), second = path.join(root, "release-b")
  await fs.writeFile(first, "first inert fixture\n", { mode: 0o700 })
  await fs.writeFile(second, "second inert fixture\n", { mode: 0o700 })
  await fs.symlink(first, command)
  const identity = await lcuCommandIdentity(command)
  assert.ok(identity)
  const raw = JSON.stringify(await upstreamStatus())
  const result = await probeLcu(identity, undefined, {
    run: async selected => {
      assert.equal(selected, identity.realPath)
      await fs.unlink(command); await fs.symlink(second, command)
      return { ok: true, stdout: raw }
    },
  })
  assert.deepEqual(result, { status: "refused", refusal: "LCU_INSTALLATION_CHANGED_OR_CANCELLED" })
  assert.equal((await lcuCommandIdentity(command))?.realPath, await fs.realpath(second))
})

test("Linux discovery visits only documented candidates and does not treat PATH Codex as LCU", async () => {
  const visited: string[] = []
  assert.deepEqual(await discoverLcu(undefined, { platform: "linux", arch: "x64", home: "/owned/home", identity: async command => { visited.push(command); return undefined } }), { status: "missing_lcu" })
  assert.deepEqual(visited, ["/opt/lcu/current/bin/lcu", "/owned/home/.local/share/lcu/current/bin/lcu"])
  visited.length = 0
  assert.deepEqual(await discoverLcu("/usr/bin/codex", { platform: "linux", arch: "x64", identity: async command => { visited.push(command); return undefined } }), { status: "invalid_command" })
  assert.deepEqual(visited, [])
})

test("each finite status execution failure remains a refusal and cannot leak raw output", async () => {
  const identity = { command: "/owned/lcu", realPath: "/owned/lcu", dev: 1, ino: 2, size: 3, mtimeMs: 4 }
  const reasons = ["aborted", "timeout", "invalid_output", "process_failed", "teardown_unknown"] as const
  for (const reason of reasons) {
    const result = await probeLcu(identity, undefined, { identity: async () => identity, run: async (): Promise<LcuStatusExecution> => ({ ok: false, reason }) })
    assert.deepEqual(result, { status: "refused", refusal: `LCU_PROBE_${reason.toUpperCase()}` })
  }
  const malformed = await probeLcu(identity, undefined, { identity: async () => identity, run: async () => ({ ok: true, stdout: JSON.stringify({ error: "PRIVATE_APPLICATION_PATH_SENTINEL" }) }) })
  assert.deepEqual(malformed, { status: "refused", refusal: "LCU_STATUS_INVALID" })
})
