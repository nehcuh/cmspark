import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

test("missing-tab throw keeps the TAB_NOT_FOUND prefix the extension catch extracts", () => {
  const candidates = [
    path.resolve(__dirname, "../../chrome-extension/src/background/browser-bridge.ts"),
    path.resolve(__dirname, "../../../chrome-extension/src/background/browser-bridge.ts"),
  ]
  const file = candidates.find((p) => existsSync(p))
  assert.ok(file, `browser-bridge.ts not found from ${__dirname}`)
  const src = readFileSync(file, "utf8")
  const throwLine = src.split("\n").find((line) => line.includes("No tab with given id"))
  assert.ok(throwLine, "ensureAttached must still throw the missing-tab error")
  assert.match(throwLine, /TAB_NOT_FOUND: No tab with given id/)
  const sample = "TAB_NOT_FOUND: No tab with given id 9."
  assert.equal(/^([A-Z][A-Z0-9_]+):/.exec(sample)?.[1], "TAB_NOT_FOUND")
  assert.match(src, /\/\^\(\[A-Z\]\[A-Z0-9_\]\+\):\//)
})
