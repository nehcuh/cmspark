import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, it } from "node:test"
import { CLI_VERSION_FALLBACK, resolveCliVersion } from "../src/cli-version"

function companionRoot(): string {
  const candidates = [
    path.join(__dirname, ".."),
    path.join(__dirname, "..", ".."),
  ]
  for (const dir of candidates) {
    const pkgPath = path.join(dir, "package.json")
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string }
        if (pkg.name === "cmspark-agent") return dir
      } catch {
        /* next */
      }
    }
  }
  return path.join(__dirname, "..")
}

const ROOT = companionRoot()
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }

describe("cli version", () => {
  it("resolveCliVersion matches package.json", () => {
    assert.equal(pkg.version, "0.6.7")
    assert.equal(resolveCliVersion(), pkg.version)
    assert.equal(CLI_VERSION_FALLBACK, pkg.version)
  })

  it("--version prints one line and exits 0", () => {
    const cli = path.join(__dirname, "..", "src", "index.js")
    assert.equal(fs.existsSync(cli), true, cli)
    const r = spawnSync(process.execPath, [cli, "--version"], {
      encoding: "utf8",
      env: { ...process.env, CMSPARK_DATA_DIR: path.join(ROOT, ".test-dist", "cli-version") },
    })
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /^cmspark-agent v0\.6\.7\r?\n$/)
    assert.doesNotMatch(r.stdout, /Unknown command/)
  })
})
