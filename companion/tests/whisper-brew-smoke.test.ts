import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import * as ts from "typescript"

// Exercise the production installer with inert process and filesystem boundaries.
function installWithSmokeOutcome(outcome: Error | null) {
  const source = readFileSync(path.join(process.cwd(), "src/voice/whisper-binary-download.ts"), "utf8")
  const file = ts.createSourceFile("installer.ts", source, ts.ScriptTarget.Latest, true)
  const fn = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === "installWhisperFromBrewDarwin")
  assert.ok(fn)
  const script = ts.transpileModule(fn.getText(file).replace(/^export\s+/, "") + "\ninstallWhisperFromBrewDarwin", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  let manifests = 0
  class InstallError extends Error { constructor(public code: string, message: string) { super(message) } }
  const install = runInNewContext(script, {
    path, Buffer, Error, process: { env: { CMSPARK_WHISPER_SRC: "/source/whisper-cli" } },
    WhisperBinaryDownloadError: InstallError,
    existsSync: (p: string) => p === "/source/whisper-cli",
    statSync: () => ({ isFile: () => true }), realpathSync: (p: string) => p,
    readFileSync: () => Buffer.from("fixture"), writeFileSync: () => {}, mkdirSync: () => {},
    readdirSync: () => [], writeUserWhisperInstallManifest: () => { manifests++ },
    execFileSync: (command: string) => {
      if (command.includes("cmspark-whisper")) { if (outcome) throw outcome; return Buffer.alloc(0) }
      if (command === "brew") return ""
      if (command === "otool") return "header\n"
      return ""
    },
  }) as (opts: { arch: string; destDir: string }) => unknown
  return { run: () => install({ arch: "darwin-arm64", destDir: "/destination" }), count: () => manifests }
}

for (const [label, fields] of [
  ["timeout", { code: "ETIMEDOUT" }],
  ["spawn failure", { code: "ENOENT" }],
  ["signal", { status: null, signal: "SIGTERM" }],
  ["dyld stderr", { status: 1, signal: null, stderr: Buffer.from("Library not loaded") }],
] as const) {
  test(`brew smoke rejects ${label} without recording success`, () => {
    const fixture = installWithSmokeOutcome(Object.assign(new Error("smoke failed"), fields))
    assert.throws(fixture.run, /brew 组件/)
    assert.equal(fixture.count(), 0)
  })
}

test("brew smoke accepts a normal nonzero help exit", () => {
  const fixture = installWithSmokeOutcome(Object.assign(new Error("help exit"), { status: 1, signal: null }))
  fixture.run()
  assert.equal(fixture.count(), 1)
})

test("brew smoke records a successful launch", () => {
  const fixture = installWithSmokeOutcome(null)
  fixture.run()
  assert.equal(fixture.count(), 1)
})
