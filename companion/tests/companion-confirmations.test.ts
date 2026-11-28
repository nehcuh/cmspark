import assert from "node:assert/strict"
import test from "node:test"
import { securityConfirmations } from "../src/security/companion-confirmations"

test("a pending confirmation survives server initialization and closes once on the current tray", async t => {
  const serverPath = require.resolve("../src/server")
  assert.equal(require.cache[serverPath], undefined)
  assert.equal(require.cache[require.resolve("../src/menu-bar-agent")], undefined)

  const id = "confirmation-owner"
  const decision = securityConfirmations.request(
    () => {}, { code: "", toolName: "test", dangerousApis: [], workerId: "worker" }, undefined, id,
  )
  const server = await import("../src/server")
  assert.equal(server.securityConfirmations, securityConfirmations)
  assert.equal(server.securityConfirmations.isPending(id), true)

  const tray = require("../src/menu-bar-agent") as typeof import("../src/menu-bar-agent")
  const events: string[][] = []
  t.mock.method(tray, "getTrayInstance", () => ({
    cancelConfirm: (key: string) => events.push(["tray", key]),
    cancelHudConfirm: (key: string) => events.push(["hud", key]),
    notifyHudConfirmResolved: (key: string, reason: string) => events.push(["resolved", key, reason]),
  }))
  assert.equal(securityConfirmations.rejectForWorker("worker", "disconnect"), 1)
  assert.equal((await decision).reason, "disconnect")
  assert.equal(server.securityConfirmations.rejectForWorker("worker", "disconnect"), 0)
  assert.deepEqual(events, [["tray", id], ["hud", id], ["resolved", id, "disconnect"]])
})
