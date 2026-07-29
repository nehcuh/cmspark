// ADR-019 user-env secrets — load/save, denylist, redact, shell merge, MCP inject

import test, { after, before, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-user-env-"))
process.env.CMSPARK_DATA_DIR = tempHome
process.env.HOME = tempHome

let userEnv: typeof import("../src/user-env")
let shell: typeof import("../src/capability/shell")
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const cfg = await import("../src/config")
  initDataDir = cfg.initDataDir
  await initDataDir()
  userEnv = await import("../src/user-env")
  shell = await import("../src/capability/shell")
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetFile() {
  userEnv.clearUserEnvCache()
  const p = userEnv.userEnvFilePath()
  try {
    fs.rmSync(p)
  } catch {
    /* ignore */
  }
  for (const f of fs.readdirSync(tempHome)) {
    if (f.startsWith("user-env.json")) {
      try {
        fs.rmSync(path.join(tempHome, f))
      } catch {
        /* ignore */
      }
    }
  }
  userEnv.clearUserEnvCache()
}

describe("user-env key validation", { concurrency: 1 }, () => {
  test("accepts POSIX-style keys", () => {
    resetFile()
    const r = userEnv.setUserEnvVars({ DATAYES_TOKEN: "tok-1", _PRIVATE: "x" })
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.public.count, 2)
    assert.deepEqual(
      r.public.keys.map((k) => k.name).sort(),
      ["DATAYES_TOKEN", "_PRIVATE"].sort(),
    )
    assert.ok(r.public.keys.every((k) => k.masked === "***"))
  })

  test("rejects invalid keys", () => {
    resetFile()
    for (const bad of ["1ABC", "has-dash", "has.dot", "has space", ""]) {
      const r = userEnv.setUserEnvVars({ [bad]: "v" })
      assert.equal(r.ok, false)
      if (r.ok) continue
      assert.equal(r.error_code, "INVALID_KEY")
    }
  })

  test("rejects denylist keys (PATH, LD_PRELOAD, HOME)", () => {
    resetFile()
    for (const key of ["PATH", "LD_PRELOAD", "HOME", "NODE_OPTIONS", "PYTHONPATH"]) {
      const r = userEnv.setUserEnvVars({ [key]: "evil" })
      assert.equal(r.ok, false, key)
      if (r.ok) continue
      assert.equal(r.error_code, "RESERVED_KEY", key)
    }
  })

  test("rejects all CMSPARK_* prefix keys", () => {
    resetFile()
    for (const key of ["CMSPARK_SHELL", "CMSPARK_DATA_DIR", "CMSPARK_SECURITY_SECRET", "CMSPARK_FOO"]) {
      const r = userEnv.setUserEnvVars({ [key]: "x" })
      assert.equal(r.ok, false, key)
      if (r.ok) continue
      assert.equal(r.error_code, "RESERVED_KEY", key)
    }
  })

  test("rejects value longer than 16KiB", () => {
    resetFile()
    const big = "x".repeat(userEnv.USER_ENV_VALUE_MAX + 1)
    const r = userEnv.setUserEnvVars({ BIG: big })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error_code, "VALUE_TOO_LONG")
  })

  test("rejects more than 64 keys", () => {
    resetFile()
    const many: Record<string, string> = {}
    for (let i = 0; i < userEnv.USER_ENV_MAX_KEYS + 1; i++) {
      many[`K${i}`] = "v"
    }
    const r = userEnv.setUserEnvVars(many)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.error_code, "TOO_MANY_KEYS")
  })
})

describe("user-env set/delete semantics", { concurrency: 1 }, () => {
  test("empty string is a legal value, not delete (R6)", () => {
    resetFile()
    let r = userEnv.setUserEnvVars({ EMPTY: "" })
    assert.equal(r.ok, true)
    assert.equal(userEnv.getUserEnvVars().EMPTY, "")
    r = userEnv.deleteUserEnvKeys(["EMPTY"])
    assert.equal(r.ok, true)
    assert.equal(userEnv.getUserEnvVars().EMPTY, undefined)
  })

  test("value *** is ignored (unchanged)", () => {
    resetFile()
    userEnv.setUserEnvVars({ TOKEN: "real-secret" })
    const r = userEnv.setUserEnvVars({ TOKEN: "***", OTHER: "ok" })
    assert.equal(r.ok, true)
    const vars = userEnv.getUserEnvVars()
    assert.equal(vars.TOKEN, "real-secret")
    assert.equal(vars.OTHER, "ok")
  })

  test("buildUserEnvPublic never includes plaintext (S1/S8)", () => {
    resetFile()
    userEnv.setUserEnvVars({ SECRET: "super-secret-value" })
    const pub = userEnv.buildUserEnvPublic(userEnv.loadUserEnv())
    const json = JSON.stringify(pub)
    assert.equal(json.includes("super-secret-value"), false)
    assert.equal(pub.keys[0].masked, "***")
    assert.equal(pub.count, 1)
  })

  test("redactUserEnvVarsForLog masks all values (R1)", () => {
    const redacted = userEnv.redactUserEnvVarsForLog({ A: "secret", B: "other" })
    assert.deepEqual(redacted, { A: "***", B: "***" })
  })

  test("persists with 0o600 and atomic file under DATA_DIR", () => {
    resetFile()
    const r = userEnv.setUserEnvVars({ DATAYES_TOKEN: "persist-me" })
    assert.equal(r.ok, true)
    const p = userEnv.userEnvFilePath()
    assert.ok(fs.existsSync(p))
    const st = fs.statSync(p)
    // mode bits: on Windows may not support full chmod; check best-effort on posix
    if (process.platform !== "win32") {
      assert.equal(st.mode & 0o777, 0o600)
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf-8"))
    assert.equal(raw.version, 1)
    assert.equal(raw.vars.DATAYES_TOKEN, "persist-me")
    assert.ok(typeof raw.updated_at === "string")
  })

  test("survives reload via cache clear", () => {
    resetFile()
    userEnv.setUserEnvVars({ KEEP: "after-restart" })
    userEnv.clearUserEnvCache()
    assert.equal(userEnv.getUserEnvVars().KEEP, "after-restart")
  })
})

describe("user-env corrupt / S9", { concurrency: 1 }, () => {
  test("getUserEnvVars returns {} on corrupt JSON (S9)", () => {
    resetFile()
    const p = userEnv.userEnvFilePath()
    fs.writeFileSync(p, "{not-json!!!", { mode: 0o600 })
    userEnv.clearUserEnvCache()
    assert.deepEqual(userEnv.getUserEnvVars(), {})
  })

  test("getUserEnvVars returns {} on invalid schema", () => {
    resetFile()
    const p = userEnv.userEnvFilePath()
    fs.writeFileSync(p, JSON.stringify({ version: 1, vars: "nope" }), { mode: 0o600 })
    userEnv.clearUserEnvCache()
    assert.deepEqual(userEnv.getUserEnvVars(), {})
  })
})

describe("buildChildEnv merge order", { concurrency: 1 }, () => {
  test("user env overrides process.env; CMSPARK_SHELL forced last", () => {
    resetFile()
    const prev = process.env.DATAYES_TOKEN
    process.env.DATAYES_TOKEN = "from-os"
    try {
      const denied = userEnv.setUserEnvVars({ CMSPARK_SHELL: "nope" })
      assert.equal(denied.ok, false)
      const r = userEnv.setUserEnvVars({ DATAYES_TOKEN: "from-user" })
      assert.equal(r.ok, true)
      assert.equal(userEnv.getUserEnvVars().DATAYES_TOKEN, "from-user")

      const env = shell.buildChildEnv()
      assert.equal(env.DATAYES_TOKEN, "from-user", "user_env overrides process.env")
      assert.equal(env.CMSPARK_SHELL, "1", "forced after user_env merge")
    } finally {
      if (prev === undefined) delete process.env.DATAYES_TOKEN
      else process.env.DATAYES_TOKEN = prev
    }
  })

  test("user cannot override CMSPARK_SHELL via file tampering", () => {
    resetFile()
    // Simulate a hand-edited file that sneaks CMSPARK_SHELL (denylist is write-time only)
    const p = userEnv.userEnvFilePath()
    fs.writeFileSync(
      p,
      JSON.stringify({
        version: 1,
        vars: { CMSPARK_SHELL: "0", MY_TOKEN: "t" },
      }),
      { mode: 0o600 },
    )
    userEnv.clearUserEnvCache()
    const env = shell.buildChildEnv()
    assert.equal(env.MY_TOKEN, "t")
    assert.equal(env.CMSPARK_SHELL, "1", "forced after user_env merge")
  })
})

describe("shell_exec receives user env", { concurrency: 1 }, () => {
  test("printenv sees DATAYES_TOKEN from user-env", async () => {
    // Enable shell module via config
    const { saveConfig, clearConfigCache } = await import("../src/config")
    saveConfig({
      capability_profile: "enterprise",
      modules: {
        shell: { available: true, enabled: true, policy: "confirm_per_command" },
      },
    } as any)
    clearConfigCache()

    resetFile()
    userEnv.setUserEnvVars({ DATAYES_TOKEN: "shell-inject-probe-xyz" })

    const r = await shell.shellExec({ command: "printenv DATAYES_TOKEN" })
    assert.equal(r.success, true)
    assert.match(r.data?.stdout || "", /shell-inject-probe-xyz/)
  })
})

describe("MCP transport merges user env", { concurrency: 1 }, () => {
  test("stdio env includes user_env before config.env", () => {
    resetFile()
    userEnv.setUserEnvVars({ DATAYES_TOKEN: "mcp-user", SHARED: "from-user" })
    // Dynamic require after DATA_DIR pin (same pattern as mcp.test.ts)
    const { createTransport, buildSpawnPath } = require("../src/mcp/transport")
    const transport = createTransport({
      transport: "stdio",
      command: "echo",
      enabled: true,
      trust_level: "first-use",
      env: { SHARED: "from-server", EXTRA: "1" },
    })
    const params = (transport as any)._serverParams
    assert.equal(params.env.DATAYES_TOKEN, "mcp-user")
    assert.equal(params.env.SHARED, "from-server", "server.env wins over user_env")
    assert.equal(params.env.EXTRA, "1")
    assert.equal(params.env.PATH, buildSpawnPath())
  })
})
