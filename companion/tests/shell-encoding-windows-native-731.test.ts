/** #731 remote-only real Windows shell pipes. No application imports before admission. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"

function ownedPreloadRoot() {
  assert.equal(process.platform, "win32")
  assert.equal(process.env.GITHUB_ACTIONS, "true", "remote-only Windows acceptance")
  assert.equal(process.env.RUNNER_OS, "Windows", "remote-only Windows acceptance")
  const run = process.env.CMSPARK_TEST_RUN_DIR, data = process.env.CMSPARK_DATA_DIR
  assert.ok(run && data && path.isAbsolute(run) && path.isAbsolute(data), "canonical owned preload required")
  const runReal = fs.realpathSync(run), dataReal = fs.realpathSync(data)
  const a = fs.lstatSync(run, { bigint: true }), b = fs.lstatSync(data, { bigint: true })
  assert.ok(a.isDirectory() && !a.isSymbolicLink() && b.isDirectory() && !b.isSymbolicLink())
  const physicalRun = fs.statSync(runReal, { bigint: true }), physicalData = fs.statSync(dataReal, { bigint: true })
  assert.equal(a.dev, physicalRun.dev); assert.equal(a.ino, physicalRun.ino)
  assert.equal(b.dev, physicalData.dev); assert.equal(b.ino, physicalData.ino)
  const relative = path.relative(runReal, dataReal)
  assert.ok(relative && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), "data must be inside this canonical run")
  const current = () => {
    assert.equal(fs.realpathSync(run), runReal); assert.equal(fs.realpathSync(data), dataReal)
    for (const [file, original] of [[run, a], [data, b]] as const) {
      const now = fs.lstatSync(file, { bigint: true })
      assert.ok(now.isDirectory() && !now.isSymbolicLink()); assert.equal(now.dev, original.dev); assert.equal(now.ino, original.ino)
    }
  }
  current()
  return { data: dataReal, current }
}

// Only non-Windows skips. A local Windows/manual invocation without the exact
// canonical hosted ownership precondition fails before imports or child spawn.
test("731 remote Windows shell_exec has faithful UTF8 or explicit undecidable pipe output", { skip: process.platform !== "win32" }, async () => {
  const owner = ownedPreloadRoot()
  const configFile = path.join(owner.data, "config.json"), existed = fs.existsSync(configFile)
  let before: Buffer | null = null
  if (existed) {
    const s = fs.lstatSync(configFile); assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1)
    before = fs.readFileSync(configFile)
  }
  const config = await import("../src/config")
  assert.equal(fs.realpathSync(config.getConfigDir()), owner.data)
  config.clearConfigCache()
  const scratch = fs.mkdtempSync(path.join(owner.data, "shell731-")), keys: string[] = []
  let shell: typeof import("../src/capability/shell") | undefined
  let installed: { bytes: Buffer; dev: bigint; ino: bigint } | undefined
  let inFlight: Promise<any> | undefined
  try {
    owner.current()
    config.saveConfig({ capability_profile: "enterprise", modules: { shell: { available: true, enabled: true, policy: "confirm_per_command" } } } as any)
    const s = fs.lstatSync(configFile, { bigint: true }); assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n)
    installed = { bytes: fs.readFileSync(configFile), dev: s.dev, ino: s.ino }
    config.clearConfigCache()
    shell = await import("../src/capability/shell")
    const text = "中文\r\n", file = path.join(scratch, "owned-utf8.txt")
    fs.writeFileSync(file, text, { encoding: "utf8", flag: "wx" })
    const fileHash = createHash("sha256").update(fs.readFileSync(file)).digest("hex")
    fs.writeFileSync(path.join(scratch, "emit-cp936.cjs"), "const b=Buffer.from([0xd6,0xd0,0xce,0xc4]);process.stdout.write(b);process.stderr.write(b);", { encoding: "ascii", flag: "wx" })
    const run = async (name: string, command: string) => {
      owner.current()
      const progress: import("../src/capability/shell").ShellProgress[] = [], key = "731-native-" + name
      keys.push(key)
      inFlight = shell!.shellExec({ command, cwd: scratch, runKey: key, onProgress: p => progress.push(p) })
      const result = await inFlight; inFlight = undefined
      assert.equal(result.success, true); assert.equal(result.data.exit_code, 0)
      assert.equal(result.data.timed_out, false); assert.equal(result.data.aborted, false); assert.equal(result.data.truncated, false)
      assert.equal(shell!.listActiveShellRunIds().includes(key), false)
      for (const p of progress) { assert.ok(p.stdout_tail.length <= shell!.PROGRESS_TAIL_CHARS); assert.ok(p.stderr_tail.length <= shell!.PROGRESS_TAIL_CHARS) }
      owner.current()
      return { result, progress }
    }
    const echo = await run("echo", "echo 中文")
    assert.equal(echo.result.data.spawn_mode, "shell")
    if (echo.result.data.stdout === text) {
      assert.equal(echo.result.data.note.includes("OUTPUT_ENCODING_UNDETERMINED"), false)
    } else {
      assert.match(echo.result.data.note, /OUTPUT_ENCODING_UNDETERMINED.*stdout/)
      assert.ok(echo.progress.some(p => p.stdout_tail.startsWith("[OUTPUT_ENCODING_UNDETERMINED] ")))
    }
    const typed = await run("type", "type owned-utf8.txt")
    assert.equal(typed.result.data.spawn_mode, "shell")
    assert.equal(typed.result.data.stdout, text)
    assert.equal(typed.result.data.note.includes("OUTPUT_ENCODING_UNDETERMINED"), false)
    assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), fileHash)
    const legacy = await run("cp936", `"${process.execPath}" emit-cp936.cjs`)
    assert.equal(legacy.result.data.spawn_mode, "argv")
    assert.match(legacy.result.data.note, /OUTPUT_ENCODING_UNDETERMINED.*stdout.*stderr/)
    assert.ok(legacy.progress.some(p => p.stdout_tail.startsWith("[OUTPUT_ENCODING_UNDETERMINED] ")))
    assert.ok(legacy.progress.some(p => p.stderr_tail.startsWith("[OUTPUT_ENCODING_UNDETERMINED] ")))
    assert.notEqual(legacy.result.data.stdout, "中文"); assert.notEqual(legacy.result.data.stderr, "中文")
  } finally {
    try {
      if (shell) for (const key of keys) shell.abortShellRunById(key)
      if (inFlight) await inFlight
    } finally {
      owner.current()
      try {
        if (installed) {
          const now = fs.lstatSync(configFile, { bigint: true })
          assert.ok(now.isFile() && !now.isSymbolicLink() && now.nlink === 1n)
          assert.equal(now.dev, installed.dev); assert.equal(now.ino, installed.ino)
          assert.ok(fs.readFileSync(configFile).equals(installed.bytes), "do not overwrite a concurrent owned config change")
          if (existed) fs.writeFileSync(configFile, before!)
          else fs.unlinkSync(configFile)
        }
      } finally {
        config.clearConfigCache()
        fs.rmSync(scratch, { recursive: true, force: true })
      }
    }
  }
})
