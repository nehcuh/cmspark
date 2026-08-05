// PATH harden + OSASCRIPT_BIN — regression for spawn ENOTDIR (thread 7ae7da).
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  OSASCRIPT_BIN,
  splitPathEnv,
  keepOnlyDirectories,
  hardenPath,
  applyHardenedProcessPath,
  essentialPathCandidates,
} from "../src/process-path"

const execFileAsync = promisify(execFile)

describe("process-path harden", () => {
  test("keepOnlyDirectories drops file segments that cause spawn ENOTDIR", () => {
    const isDirectory = (p: string) => p === "/usr/bin" || p === "/bin"
    const kept = keepOnlyDirectories(
      ["/Applications/CMspark.app/Contents/Resources/cmspark-agent.js", "/usr/bin", "/bin"],
      isDirectory,
    )
    assert.deepEqual(kept, ["/usr/bin", "/bin"])
  })

  test("splitPathEnv ignores empty segments", () => {
    assert.deepEqual(splitPathEnv("/usr/bin::/bin:", ":"), ["/usr/bin", "/bin"])
  })

  test("hardenPath drops file-in-PATH and restores system bins (unix)", () => {
    const isDirectory = (p: string) =>
      p === "/usr/bin" ||
      p === "/bin" ||
      p === "/usr/sbin" ||
      p === "/sbin" ||
      p === "/usr/local/bin" ||
      p === "/opt/homebrew/bin" ||
      p.endsWith("/node-bin")
    const out = hardenPath({
      pathEnv: "/Applications/CMspark.app/Contents/Resources/cmspark-agent.js",
      platform: "darwin",
      execPath: "/fake/node-bin/node",
      homedir: () => "/Users/test",
      isDirectory,
      delimiter: ":",
    })
    const segs = out.split(":")
    assert.ok(segs.includes("/usr/bin"), `expected /usr/bin in ${out}`)
    assert.ok(segs.includes("/bin"), `expected /bin in ${out}`)
    assert.ok(
      !segs.some((s) => s.endsWith("cmspark-agent.js")),
      `file segment must be dropped: ${out}`,
    )
  })

  test("hardenPath preserves user-first order; appends missing essentials only", () => {
    const isDirectory = (p: string) =>
      [
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/custom/tools",
        "/opt/homebrew/bin",
      ].includes(p)
    const out = hardenPath({
      pathEnv: "/custom/tools:/opt/homebrew/bin:/usr/bin",
      platform: "linux",
      execPath: "/usr/bin/node",
      isDirectory,
      delimiter: ":",
    })
    const segs = out.split(":")
    assert.equal(segs[0], "/custom/tools", "user dirs keep first-wins order")
    assert.ok(segs.indexOf("/opt/homebrew/bin") < segs.indexOf("/usr/bin"))
    assert.ok(segs.includes("/bin"), "missing essentials appended")
  })

  test("essentialPathCandidates includes /usr/bin on unix", () => {
    const c = essentialPathCandidates("darwin", { execPath: "/x/node", homedir: () => "/h" })
    assert.ok(c.includes("/usr/bin"))
    assert.ok(c.includes("/bin"))
  })

  test("applyHardenedProcessPath rewrites corrupted process PATH", () => {
    const saved = process.env.PATH
    try {
      process.env.PATH = __filename // this file is NOT a dir
      const r = applyHardenedProcessPath()
      assert.ok(r.changed, "corrupted file PATH should be rewritten")
      assert.notEqual(process.env.PATH, __filename)
      const segs = (process.env.PATH || "").split(path.delimiter)
      for (const s of segs) {
        if (!s) continue
        try {
          const st = require("fs").statSync(s)
          assert.ok(st.isDirectory(), `segment should be dir: ${s}`)
        } catch {
          // missing path should have been dropped by default isDirectory
        }
      }
    } finally {
      process.env.PATH = saved
    }
  })
})

describe("OSASCRIPT_BIN", () => {
  test("constant is absolute unix path", () => {
    assert.equal(OSASCRIPT_BIN, "/usr/bin/osascript")
    assert.ok(path.isAbsolute(OSASCRIPT_BIN))
  })

  test(
    "absolute osascript works even when PATH is a file (ENOTDIR repro)",
    { skip: process.platform !== "darwin" ? "macOS only" : false },
    async () => {
      // Use this test file as a *file* PATH entry (must exist → ENOTDIR, not ENOENT).
      const fileAsPath = __filename
      // Bare name → ENOTDIR (repro of production .app PATH corruption)
      let bareCode: string | undefined
      try {
        await execFileAsync("osascript", ["-e", "return 1"], {
          env: { ...process.env, PATH: fileAsPath },
          timeout: 5000,
        })
      } catch (err: any) {
        bareCode = err?.code || String(err?.message || err)
      }
      assert.ok(
        bareCode === "ENOTDIR" || /ENOTDIR/.test(String(bareCode)),
        `expected bare osascript to fail ENOTDIR, got ${bareCode}`,
      )
      // Absolute → ok even with corrupted PATH
      const r = await execFileAsync(OSASCRIPT_BIN, ["-e", "return 1"], {
        env: { ...process.env, PATH: fileAsPath },
        timeout: 5000,
      })
      assert.match(String(r.stdout), /1/)
    },
  )
})

describe("buildSpawnPath file-in-PATH", () => {
  test("MCP buildSpawnPath drops file PATH segments", async () => {
    const { buildSpawnPath } = await import("../src/mcp/transport")
    const saved = process.env.PATH
    try {
      process.env.PATH = __filename
      const p = buildSpawnPath()
      assert.ok(!p.split(path.delimiter).includes(__filename), `file segment leaked into PATH: ${p}`)
      assert.ok(p.includes("/usr/bin") || p.includes("\\") || p.length > 0)
    } finally {
      process.env.PATH = saved
    }
  })
})

describe("buildChildEnv PATH harden", () => {
  test("shell child env drops file-in-PATH and can resolve /bin/echo via PATH", async () => {
    const shell = await import("../src/capability/shell")
    const saved = process.env.PATH
    try {
      process.env.PATH = __filename
      const env = shell.buildChildEnv()
      assert.ok(env.PATH)
      assert.ok(!env.PATH!.split(path.delimiter).includes(__filename), "file PATH segment must be dropped")
      const segs = env.PATH!.split(path.delimiter)
      assert.ok(
        segs.some((s) => s === "/usr/bin" || s === "/bin" || s.endsWith("\\System32")),
        `hardened PATH should include system bins: ${env.PATH}`,
      )
    } finally {
      process.env.PATH = saved
    }
  })
})
