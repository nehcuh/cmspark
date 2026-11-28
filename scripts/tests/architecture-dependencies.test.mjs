import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { inspectDependencies } from "../architecture-dependencies.mjs"

test("emitted dependencies distinguish type, eager, deferred and self imports", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "cmspark-architecture-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, "companion/src"), { recursive: true })
  mkdirSync(path.join(root, "chrome-extension/src"), { recursive: true })
  const files = {
    "a.ts": 'import "./b"; import type { Unused } from "./types"; export const a = 1',
    "b.ts": 'export { a } from "./a"; export async function later() { return import("./lazy") }',
    "lazy.ts": 'export function get() { return require("./a") }',
    "self.ts": 'import "./self"',
    "types.ts": "export type Unused = string",
  }
  for (const [name, code] of Object.entries(files)) writeFileSync(path.join(root, "companion/src", name), code)
  const report = await inspectDependencies(root)
  const names = groups => groups.map(group => group.map(name => path.posix.basename(name)))
  assert.deepEqual(names(report.staticCycles), [["a.ts", "b.ts"], ["self.ts"]])
  assert.deepEqual(names(report.runtimeCycles), [["a.ts", "b.ts", "lazy.ts"], ["self.ts"]])
  assert.deepEqual(report.modules["companion/src/a.ts"], [{ path: "companion/src/b.ts", kind: "import-statement" }])
})
