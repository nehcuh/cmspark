import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertFreshTraySource } from "../swift-tray-source-freshness.mjs"

const require = createRequire(import.meta.url)
const typescript = require("typescript")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const fileName = path.join(root, "src/tray/swift-tray-bridge.ts")
const source = readFileSync(fileName, "utf8")
const config = typescript.readConfigFile(path.join(root, "tsconfig.json"), typescript.sys.readFile)
assert.equal(config.error, undefined)
const parsed = typescript.parseJsonConfigFileContent(config.config, typescript.sys, root)
assert.equal(parsed.errors.length, 0)
const compilerOptions = parsed.options
const emitted = typescript.transpileModule(source, { compilerOptions, fileName }).outputText
const verify = compiled => assertFreshTraySource({ typescript, source, compiled, compilerOptions, fileName })

test("actual tray source accepts its current emitted bytes", () => assert.doesNotThrow(() => verify(emitted)))
test("actual tray source agrees with TypeScript Program emit for this configuration", () => {
  const program = typescript.createProgram([fileName], { ...compilerOptions, noEmitOnError: false })
  const sourceFile = program.getSourceFile(fileName)
  assert.ok(sourceFile)
  let programOutput
  const result = program.emit(sourceFile, (name, data) => {
    if (name.endsWith("swift-tray-bridge.js")) {
      assert.equal(programOutput, undefined)
      programOutput = data
    }
  })
  assert.equal(result.emitSkipped, false)
  assert.equal(result.diagnostics.length, 0)
  assert.equal(programOutput, emitted)
  assert.doesNotThrow(() => verify(programOutput))
})
test("actual tray source rejects stale and modified emitted bytes", () => {
  assert.ok(emitted.includes("INVALID_PACKAGED_TRAY_PIN"))
  assert.throws(() => verify(emitted.replace("INVALID_PACKAGED_TRAY_PIN", "STALE_PIN")), /TRAY_COMPILED_SOURCE_STALE/)
  assert.throws(() => verify(emitted + "\n"), /TRAY_COMPILED_SOURCE_STALE/)
})
