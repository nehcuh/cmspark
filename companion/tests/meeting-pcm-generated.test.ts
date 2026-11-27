import test from "node:test"
import * as assert from "node:assert/strict"
import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"

function removeOwnedDirectory(owned: string, remove: (target: string) => void, caught?: unknown) {
  let cleanup: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      remove(owned)
      cleanup = undefined
      break
    } catch (error) {
      cleanup = error
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined
      if (code !== "EBUSY") break
    }
  }
  if (caught !== undefined) throw caught
  if (cleanup !== undefined) throw cleanup
}

test("canonical meeting browser assets are byte-exact from both package and unrelated working directories", () => {
  const script = path.resolve("scripts/generate-meeting-capture.mjs")
  for (const cwd of [path.resolve("."), os.tmpdir()]) {
    assert.equal(execFileSync(process.execPath, [script, "--check"], { cwd, encoding: "utf8", timeout: 10_000 }), "")
  }
})

test("Windows-style Git checkout preserves canonical capture bytes and still rejects drift", () => {
  const repository = path.resolve("..")
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-meeting-generator-"))
  const seed = path.join(owned, "seed")
  const checkout = path.join(owned, "checkout")
  const emptyConfig = path.join(owned, "empty.gitconfig")
  const canonical = [
    "chrome-extension/src/sidepanel/voice/meeting-continuous-pcm.ts",
    "chrome-extension/src/sidepanel/voice/meeting-pcm-worklet.ts",
    "chrome-extension/src/sidepanel/voice/meeting-pcm-worklet-generated.ts",
    "chrome-extension/src/sidepanel/voice/meeting-continuous-capture.ts",
    "chrome-extension/src/sidepanel/voice/meeting-language.ts",
    "chrome-extension/src/sidepanel/voice/meeting-chapters.ts",
    "chrome-extension/src/sidepanel/voice/desktop-meeting-media.ts",
    "chrome-extension/src/sidepanel/voice/workbench-screen-capture.ts",
    "chrome-extension/src/sidepanel/voice/workbench-capture-owner.ts",
    "chrome-extension/src/sidepanel/voice/workbench-recording-store.ts",
    "chrome-extension/src/sidepanel/voice/meeting-frame-sampler.ts",
    "companion/src/summoner/meeting-continuous-generated.ts",
  ]
  const fixtures = [...canonical, "companion/scripts/generate-meeting-capture.mjs", "chrome-extension/tsconfig.json"]
  let caught: unknown
  try {
    fs.mkdirSync(seed)
    fs.writeFileSync(emptyConfig, "", { flag: "wx" })
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyConfig }
    const git = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env, encoding: "utf8", timeout: 10_000 })
    for (const name of fixtures) {
      const dest = path.join(seed, name)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(path.join(repository, name), dest)
    }
    if (fs.existsSync(path.join(repository, ".gitattributes"))) {
      fs.copyFileSync(path.join(repository, ".gitattributes"), path.join(seed, ".gitattributes"))
    }
    fs.writeFileSync(path.join(seed, "unrelated.ts"), "// Unpinned fixture\nexport const unrelated = true\n")
    git(seed, ["init", "--quiet"])
    git(seed, ["-c", "core.autocrlf=false", "add", "--", ...fixtures, "unrelated.ts",
      ...(fs.existsSync(path.join(seed, ".gitattributes")) ? [".gitattributes"] : [])])
    git(seed, ["-c", "user.name=Owned fixture", "-c", "user.email=fixture@invalid", "commit", "--quiet", "-m", "owned canonical generator fixture"])
    git(owned, ["-c", "core.autocrlf=true", "clone", "--quiet", "--no-local", seed, checkout])
    fs.symlinkSync(fs.realpathSync(path.resolve("node_modules")), path.join(checkout, "companion/node_modules"), process.platform === "win32" ? "junction" : "dir")
    const script = path.join(checkout, "companion/scripts/generate-meeting-capture.mjs")
    const check = () => spawnSync(process.execPath, [script, "--check"], { cwd: os.tmpdir(), env, encoding: "utf8", timeout: 10_000 })
    const initial = check()
    assert.equal(initial.status, 0, initial.stderr)
    for (const name of canonical) {
      assert.deepEqual(fs.readFileSync(path.join(checkout, name)), fs.readFileSync(path.join(repository, name)), name)
    }
    assert.ok(fs.readFileSync(path.join(checkout, "unrelated.ts"), "utf8").includes("\r\n"), "only the declared generator inputs/outputs are pinned")
    for (const name of [canonical[0], canonical[2]]) {
      const file = path.join(checkout, name)
      const original = fs.readFileSync(file)
      try {
        fs.appendFileSync(file, "\n// Intentional canonical drift\n")
        const changed = check()
        assert.equal(changed.status, 1)
        assert.match(changed.stderr, /Generated meeting capture differs:/)
      } finally { fs.writeFileSync(file, original) }
    }
    assert.equal(check().status, 0)
  } catch (error) { caught = error }
  removeOwnedDirectory(owned, (target) => fs.rmSync(target, { recursive: true, force: true }), caught)
})

function errno(code: string) {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

test("owned cleanup keeps the original assertion when both deletes are EBUSY", () => {
  const owned = path.join(os.tmpdir(), "cmspark-meeting-owned-assertion")
  const calls: string[] = []
  const failure = new assert.AssertionError({ message: "byte mismatch", actual: 0, expected: 1, operator: "strictEqual" })
  assert.throws(() => removeOwnedDirectory(owned, () => { calls.push(owned); throw errno("EBUSY") }, failure), (error) => error === failure)
  assert.deepEqual(calls, [owned, owned])
})

test("owned cleanup throws a non-EBUSY delete error on the first call", () => {
  const owned = path.join(os.tmpdir(), "cmspark-meeting-owned-other")
  const calls: string[] = []
  const failure = errno("EPERM")
  assert.throws(() => removeOwnedDirectory(owned, () => { calls.push(owned); throw failure }), (error) => error === failure)
  assert.deepEqual(calls, [owned])
})

test("owned cleanup fails with EBUSY after exactly two deletes", () => {
  const owned = path.join(os.tmpdir(), "cmspark-meeting-owned-busy")
  const calls: string[] = []
  assert.throws(() => removeOwnedDirectory(owned, () => { calls.push(owned); throw errno("EBUSY") }), (error: NodeJS.ErrnoException) => error.code === "EBUSY")
  assert.deepEqual(calls, [owned, owned])
})
