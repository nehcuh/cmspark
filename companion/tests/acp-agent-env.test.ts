// Unit tests: ACP agent env = terminal parity (API keys not stripped).

import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  buildAcpAgentEnv,
  parseEnvNullSeparated,
  getLoginShellEnv,
  clearLoginShellEnvCache,
} from "../src/acp/agent-env"

describe("parseEnvNullSeparated", () => {
  it("parses KEY=VALUE entries separated by NUL", () => {
    const raw = "FOO=bar\0BAZ=qux=extra\0\0EMPTY=\0"
    const o = parseEnvNullSeparated(raw)
    assert.equal(o.FOO, "bar")
    assert.equal(o.BAZ, "qux=extra")
    assert.equal(o.EMPTY, "")
  })

  it("skips malformed entries", () => {
    const o = parseEnvNullSeparated("NOEQ\0=novalue\0OK=1")
    assert.equal(o.OK, "1")
    assert.equal(o.NOEQ, undefined)
  })
})

describe("buildAcpAgentEnv", () => {
  beforeEach(() => {
    clearLoginShellEnvCache()
  })

  it("inherits API keys from process env (not PATH/HOME whitelist)", () => {
    const env = buildAcpAgentEnv({
      sessionId: "s1",
      mode: "propose_diff",
      processEnv: {
        PATH: "/usr/bin:/bin",
        HOME: "/Users/me",
        ANTHROPIC_API_KEY: "sk-ant-test",
        OPENAI_API_KEY: "sk-oai-test",
        UNRELATED: "keep-me",
      },
      userEnv: {},
      loginShellEnv: {},
      skipLoginShell: true,
    })
    assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-test")
    assert.equal(env.OPENAI_API_KEY, "sk-oai-test")
    assert.equal(env.UNRELATED, "keep-me")
    assert.equal(env.CMSPARK_ACP_SESSION, "s1")
    assert.equal(env.CMSPARK_ACP_MODE, "propose_diff")
    assert.ok(env.PATH && env.PATH.includes("/usr/bin"))
  })

  it("merge order: loginShell < userEnv < serverEnv < markers", () => {
    const env = buildAcpAgentEnv({
      sessionId: "s2",
      mode: "review_readonly",
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/h",
        ANTHROPIC_API_KEY: "from-process",
        X: "p",
      },
      loginShellEnv: {
        ANTHROPIC_API_KEY: "from-login",
        Y: "login",
      },
      userEnv: {
        ANTHROPIC_API_KEY: "from-user-env",
        Z: "user",
      },
      serverEnv: {
        ANTHROPIC_API_KEY: "from-server",
      },
      skipLoginShell: true,
    })
    assert.equal(env.ANTHROPIC_API_KEY, "from-server")
    assert.equal(env.X, "p")
    assert.equal(env.Y, "login")
    assert.equal(env.Z, "user")
    assert.equal(env.CMSPARK_ACP_SESSION, "s2")
  })

  it("login-shell keys win over sparse process env (GUI tray case)", () => {
    const env = buildAcpAgentEnv({
      sessionId: "s3",
      mode: "review_readonly",
      processEnv: {
        PATH: "/usr/bin",
        HOME: "/h",
        // no API key in companion process
      },
      loginShellEnv: {
        ANTHROPIC_API_KEY: "sk-from-zshrc",
        PATH: "/opt/homebrew/bin:/usr/bin",
      },
      userEnv: {},
      skipLoginShell: true,
    })
    assert.equal(env.ANTHROPIC_API_KEY, "sk-from-zshrc")
  })
})

describe("getLoginShellEnv", () => {
  beforeEach(() => {
    clearLoginShellEnvCache()
  })

  it("parses mocked shell output and caches", () => {
    let calls = 0
    const fakeExec = (() => {
      calls++
      return Buffer.from("ANTHROPIC_API_KEY=sk-mock\0PATH=/bin\0")
    }) as unknown as typeof import("child_process").execFileSync

    const a = getLoginShellEnv({ force: true, execFile: fakeExec, shell: "/bin/zsh" })
    assert.equal(a.ANTHROPIC_API_KEY, "sk-mock")
    const b = getLoginShellEnv({ execFile: fakeExec })
    assert.equal(b.ANTHROPIC_API_KEY, "sk-mock")
    assert.equal(calls, 1, "second call should use cache")
  })

  it("returns {} when shell probe fails", () => {
    const boom = (() => {
      throw new Error("timeout")
    }) as unknown as typeof import("child_process").execFileSync
    const o = getLoginShellEnv({ force: true, execFile: boom, shell: "/bin/false" })
    assert.deepEqual(o, {})
  })
})
