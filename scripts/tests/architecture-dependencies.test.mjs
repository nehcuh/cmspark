import test from "node:test"
import assert from "node:assert/strict"
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
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

test("CLI rejects a purely deferred cycle in a checkout without Git history", t => {
  const root = mkdtempSync(path.join(tmpdir(), "cmspark-architecture-cli-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const dir of ["scripts", "companion/src", "chrome-extension/src"]) {
    mkdirSync(path.join(root, dir), { recursive: true })
  }
  const cli = path.join(root, "scripts/architecture-dependencies.mjs")
  copyFileSync(new URL("../architecture-dependencies.mjs", import.meta.url), cli)
  const env = { ...process.env, NODE_PATH: fileURLToPath(new URL("../../companion/node_modules", import.meta.url)) }
  const run = (...args) => spawnSync(process.execPath, [cli, "--json", ...args], { cwd: root, env, encoding: "utf8" })
  const a = path.join(root, "companion/src/a.ts"), b = path.join(root, "companion/src/b.ts")
  writeFileSync(a, 'export const load = () => import("./b")')
  writeFileSync(b, 'export const read = () => require("./a")')
  const rejected = run()
  assert.equal(rejected.status, 1, rejected.stderr)
  const { staticCycles, runtimeCycles } = JSON.parse(rejected.stdout)
  assert.deepEqual(staticCycles, [])
  assert.deepEqual(runtimeCycles, [["companion/src/a.ts", "companion/src/b.ts"]])
  const compared = run("--base-dir", root)
  assert.equal(compared.status, 0, compared.stderr)
  assert.deepEqual(JSON.parse(compared.stdout).addedCyclicEdges, [])
  writeFileSync(b, "export const value = 1")
  const accepted = run()
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.deepEqual(JSON.parse(accepted.stdout).runtimeCycles, [])
})
