import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import * as ts from "typescript"
import { whisperPinResolveOpts } from "../src/voice/whisper-binary-pins"

// Exercise the production installer with inert process and filesystem boundaries.
function installWithSmokeOutcome(outcome: Error | null, arch = "darwin-arm64", unpinned = false, aborted = false) {
  const source = readFileSync(path.join(process.cwd(), "src/voice/whisper-binary-download.ts"), "utf8")
  const file = ts.createSourceFile("installer.ts", source, ts.ScriptTarget.Latest, true)
  const fn = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "installWhisperFromBrewDarwin")
  const errorClass = file.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === "WhisperBinaryDownloadError")
  assert.ok(fn)
  assert.ok(errorClass)
  const script = ts.transpileModule(errorClass.getText(file).replace(/^export\s+/, "") + "\n" + fn.getText(file).replace(/^export\s+/, "") + "\ninstallWhisperFromBrewDarwin", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let manifests = 0, writes = 0
  const commands: string[] = []
  const install = runInNewContext(script, {
    path, Buffer, Error, process: { env: { CMSPARK_WHISPER_SRC: "/source/whisper-cli", ...(unpinned ? { CMSPARK_WHISPER_UNPINNED: "1" } : {}) } },
    whisperPinResolveOpts,
    existsSync: (p: string) => p === "/source/whisper-cli",
    statSync: () => ({ isFile: () => true }), realpathSync: (p: string) => p,
    readFileSync: () => Buffer.from("fixture"), writeFileSync: () => { writes++ }, mkdirSync: () => { writes++ },
    readdirSync: () => [], writeUserWhisperInstallManifest: () => { manifests++ },
    execFileSync: (command: string) => {
      commands.push(command)
      if (command.includes("cmspark-whisper")) { if (outcome) throw outcome; return Buffer.alloc(0) }
      if (command === "brew") return ""
      if (command === "otool") return "header\n"
      return ""
    },
  }) as (opts: { arch: string; destDir: string; signal?: { aborted: boolean } }) => unknown
  return { run: () => install({ arch, destDir: "/destination", ...(aborted ? { signal: { aborted: true } } : {}) }), count: () => manifests, writes: () => writes, commands }
}

test("brew x64 without a release pin refuses before writing or launching", () => {
  const fixture = installWithSmokeOutcome(null, "darwin-x64")
  assert.throws(fixture.run, (error: unknown) => {
    assert.equal((error as { reason?: unknown }).reason, "pin-mismatch")
    assert.match((error as Error).message, /macOS x64.*发行校验值/)
    return true
  })
  assert.equal(fixture.writes(), 0)
  assert.deepEqual(fixture.commands, [])
  assert.equal(fixture.count(), 0)
})

test("an already cancelled x64 install stays cancelled before any side effects", () => {
  const fixture = installWithSmokeOutcome(null, "darwin-x64", false, true)
  assert.throws(fixture.run, (error: unknown) => (error as { reason?: unknown }).reason === "aborted")
  assert.equal(fixture.writes(), 0)
  assert.deepEqual(fixture.commands, [])
  assert.equal(fixture.count(), 0)
})

test("explicit development opt-in preserves the existing x64 brew flow", () => {
  const fixture = installWithSmokeOutcome(null, "darwin-x64", true)
  fixture.run()
  assert.ok(fixture.writes() > 0)
  assert.ok(fixture.commands.some(command => command.includes("cmspark-whisper-darwin-x64")))
  assert.equal(fixture.count(), 1)
})

for (const [label, fields] of [
  ["timeout", { code: "ETIMEDOUT" }],
  ["spawn failure", { code: "ENOENT" }],
  ["signal", { status: null, signal: "SIGTERM" }],
  ["dyld stderr", { status: 1, signal: null, stderr: Buffer.from("Library not loaded") }],
] as const) {
  test(`brew smoke rejects ${label} without recording success`, () => {
    const fixture = installWithSmokeOutcome(Object.assign(new Error("smoke failed"), fields))
    assert.throws(fixture.run, (error: unknown) => {
      assert.equal((error as { reason?: unknown }).reason, "extract-failed")
      return true
    })
    assert.equal(fixture.count(), 0)
  })
}

test("brew smoke accepts a normal nonzero help exit", () => {
  let actualError: Error | null = null
  try {
    execFileSync(process.execPath, ["-e", "process.exit(1)"], { stdio: "pipe" })
  } catch (error) {
    assert.ok(error instanceof Error)
    actualError = error
  }
  assert.ok(actualError, "the Node child must exit nonzero")
  const fixture = installWithSmokeOutcome(actualError)
  fixture.run()
  assert.equal(fixture.count(), 1)
})

test("brew smoke records a successful launch", () => {
  const fixture = installWithSmokeOutcome(null)
  fixture.run()
  assert.equal(fixture.count(), 1)
})
