import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { cyclicEdges, inspectDependencies } from "../architecture-dependencies.mjs"

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
  const before = cyclicEdges(report)
  writeFileSync(path.join(root, "companion/src/lazy.ts"), 'export function get() { return require("./a") }; export function extra() { return import("./b") }')
  const after = await inspectDependencies(root)
  assert.deepEqual(after.runtimeCycles, report.runtimeCycles)
  assert.deepEqual([...cyclicEdges(after)].filter(edge => !before.has(edge)), [
    "companion/src/lazy.ts --dynamic-import--> companion/src/b.ts",
  ])
  writeFileSync(path.join(root, "companion/src/lazy.ts"), 'export const value = 1')
  const reduced = cyclicEdges(await inspectDependencies(root))
  assert.ok(reduced.size < before.size)
  assert.deepEqual([...reduced].filter(edge => !before.has(edge)), [])

  writeFileSync(path.join(root, "companion/src/new.ts"), 'export function load() { return import("./new") }')
  const expanded = cyclicEdges(await inspectDependencies(root))
  assert.deepEqual([...expanded].filter(edge => !before.has(edge)), [
    "companion/src/new.ts --dynamic-import--> companion/src/new.ts",
  ])
  assert.deepEqual(report.modules["companion/src/a.ts"], [{ path: "companion/src/b.ts", kind: "import-statement" }])
})
