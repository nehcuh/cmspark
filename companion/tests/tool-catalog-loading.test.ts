import test from "node:test"
import assert from "node:assert/strict"
import { getAllToolDefinitions } from "../src/bridge/tool-definitions"

test("listing tools exposes the skill installer without loading its executable implementation", () => {
  const definitions = getAllToolDefinitions().filter(tool => tool.function.name === "skill_install")
  assert.equal(definitions.length, 1)
  assert.equal(require.cache[require.resolve("../src/skills/skill-install")], undefined)
  assert.equal(require.cache[require.resolve("../src/threads/thread-manager")], undefined)
})
