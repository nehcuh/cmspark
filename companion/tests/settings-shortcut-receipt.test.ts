import "./_config-router-setup"
import test from "node:test"
import assert from "node:assert/strict"

test("shortcut settings are persisted with a revision receipt and reject invalid input", async () => {
  const config = await import("../src/config")
  const { handleConfigFamily } = await import("../src/message-router/handlers/config")
  await config.initDataDir()
  const revision = config.getConfigSnapshot().revision
  const reply = await handleConfigFamily("config.set", {
    id: "settings-save:shortcut-test", config_revision: revision,
    config: { summoner: { send_shortcut: "Ctrl+Enter" } },
  }) as any
  assert.equal(reply.type, "config.updated")
  assert.equal(reply.config_applied_revision, reply.config_revision)
  assert.equal(reply.config.summoner.send_shortcut, "Ctrl+Enter")
  assert.equal(config.getConfig().summoner?.send_shortcut, "Ctrl+Enter")
  const invalid = await handleConfigFamily("config.set", { config: { summoner: { send_shortcut: "bad" } } }) as any
  assert.equal(invalid.type, "error")
  assert.equal(config.getConfig().summoner?.send_shortcut, "Ctrl+Enter")
})
