import test from "node:test"
import * as assert from "node:assert/strict"
import * as path from "node:path"
import * as os from "node:os"
import * as fs from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"

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
    "companion/src/summoner/meeting-continuous-generated.ts",
  ]
  const fixtures = [...canonical, "companion/scripts/generate-meeting-capture.mjs", "chrome-extension/tsconfig.json"]
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
  } finally { fs.rmSync(owned, { recursive: true, force: true }) }
})
