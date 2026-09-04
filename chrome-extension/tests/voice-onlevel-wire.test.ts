import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = join(process.cwd(), "src")

test("onLevel is wired from adapters into capture (source pin)", () => {
  const local = readFileSync(join(SRC, "sidepanel/voice/local-stt-adapter.ts"), "utf8")
  assert.ok(local.includes("onLevel: handlers.onLevel"), "local adapter must pass handlers.onLevel")
  const hook = readFileSync(join(SRC, "sidepanel/hooks/useVoiceInput.ts"), "utf8")
  assert.ok(hook.includes("onLevel:"), "useVoiceInput must consume onLevel")
})
