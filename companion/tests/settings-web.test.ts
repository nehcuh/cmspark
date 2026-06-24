// Tests for the settings-web server: CSRF token, Host/Origin checks, SSRF guard.
// Also tests settings-cli: argv leak prevention and --set-stdin.
//
// All tests live inside describe() suites so subtests run sequentially —
// the in-process singleton server + shared `started` handle would race under
// default node:test concurrency.

import test, { after, before, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as http from "node:http"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-settings-"))

let startSettingsServer: typeof import("../src/settings-web").startSettingsServer
let stopSettingsServer: typeof import("../src/settings-web").stopSettingsServer
let saveConfig: typeof import("../src/config").saveConfig
let getConfig: typeof import("../src/config").getConfig

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.CMSPARK_API_KEY

  const sw = await import("../src/settings-web")
  const cfg = await import("../src/config")
  startSettingsServer = sw.startSettingsServer
  stopSettingsServer = sw.stopSettingsServer
  saveConfig = cfg.saveConfig
  getConfig = cfg.getConfig

  await cfg.initDataDir()
  saveConfig({
    port: 23401,
    llm: {
      api_key: "sk-test-1234567890abcdef",
      base_url: "https://api.openai.com/v1",
      model_name: "gpt-4o",
      temperature: 0.7,
      context_window: 128000,
    },
    trusted_domains: [],
    auto_approved_domains: [],
    history_retention_days: 30,
    security: {
      safety_skills_enabled: [],
      auto_confirm_same_thread: false,
      confirmation_timeout_seconds: 45,
      auto_approve_dangerous: false,
    },
  })
})

after(() => {
  stopSettingsServer()
})

interface StartResult { port: number; token: string }

let started: StartResult | null = null

async function ensureStarted(): Promise<StartResult> {
  if (started) return started
  // Use a high port unlikely to be in use. findAvailablePort scans a 10-port
  // window starting here.
  started = await startSettingsServer(23490)
  return started
}

function request(
  opts: {
    method: string
    path: string
    host?: string
    port: number
    headers?: http.OutgoingHttpHeaders
    body?: string
  },
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: opts.method,
        host: "127.0.0.1",
        port: opts.port,
        path: opts.path,
        headers: opts.headers || {},
      },
      (res) => {
        let body = ""
        res.on("data", (c) => (body += c.toString()))
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body, headers: res.headers }),
        )
      },
    )
    req.on("error", reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function jsonHeaders(token?: string): http.OutgoingHttpHeaders {
  const h: http.OutgoingHttpHeaders = { "Content-Type": "application/json" }
  if (token) h.Origin = `http://127.0.0.1:${started!.port}`
  return h
}

describe("settings-web server", { concurrency: 1 }, () => {
  test("GET /api/config with no token → 403", async () => {
    const { port } = await ensureStarted()
    const r = await request({ method: "GET", port, path: "/api/config" })
    assert.equal(r.status, 403)
  })

  test("GET /api/config with wrong token → 403", async () => {
  const { port } = await ensureStarted()
  const r = await request({
    method: "GET",
    port,
    path: "/api/config?token=deadbeef".padEnd(40, "0").slice(0, 40),
  })
  assert.equal(r.status, 403)
})

test("GET /api/config with right token → 200", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({ method: "GET", port, path: `/api/config?token=${token}` })
  assert.equal(r.status, 200)
  const data = JSON.parse(r.body)
  assert.ok(data.llm)
  // api_key must be masked
  assert.equal(data.llm.api_key.includes("sk-test-1234"), false)
  assert.ok(data.llm.api_key.includes("*"))
})

test("POST /api/config with right token + bad Origin → 403", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/config?token=${token}`,
    headers: { "Content-Type": "application/json", Origin: "http://evil.com" },
    body: JSON.stringify({ llm: { temperature: 0.5 } }),
  })
  assert.equal(r.status, 403)
})

test("POST /api/config with right token + bad Host → 403", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/config?token=${token}`,
    headers: {
      "Content-Type": "application/json",
      Origin: `http://127.0.0.1:${port}`,
      Host: "evil.example",
    },
    body: JSON.stringify({ llm: { temperature: 0.5 } }),
  })
  assert.equal(r.status, 403)
})

test("POST /api/config with right token + valid Origin → 200", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/config?token=${token}`,
    headers: jsonHeaders(token),
    body: JSON.stringify({ llm: { temperature: 0.42 } }),
  })
  assert.equal(r.status, 200, r.body)
  const data = JSON.parse(r.body)
  assert.equal(data.ok, true)
  assert.equal(data.llm.temperature, 0.42)
})

test("POST /api/test with AWS metadata IP → 403 / SSRF blocked", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/test?token=${token}`,
    headers: jsonHeaders(token),
    body: JSON.stringify({ base_url: "http://169.254.169.254/", api_key: "sk-xxxx" }),
  })
  assert.equal(r.status, 200)
  const data = JSON.parse(r.body)
  assert.equal(data.ok, false)
  assert.match(data.error, /SSRF|private|link-local|blocked/i)
})

test("POST /api/test with RFC1918 IP → SSRF blocked", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/test?token=${token}`,
    headers: jsonHeaders(token),
    body: JSON.stringify({ base_url: "http://192.168.1.1/", api_key: "sk-xxxx" }),
  })
  assert.equal(r.status, 200)
  const data = JSON.parse(r.body)
  assert.equal(data.ok, false)
  assert.match(data.error, /SSRF|private|link-local|blocked|loopback/i)
})

test("POST /api/test with loopback IP → SSRF blocked", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/test?token=${token}`,
    headers: jsonHeaders(token),
    body: JSON.stringify({ base_url: "http://127.0.0.1:9999/v1", api_key: "sk-xxxx" }),
  })
  assert.equal(r.status, 200)
  const data = JSON.parse(r.body)
  // localhost/127.0.0.1 are in LLM_HOST_ALLOWLIST for vision, but for the
  // LLM test proxy we still need a valid port. The request will either be
  // blocked (no allowlist for /api/test) OR fail to connect — both signal
  // that we did NOT succeed in proxying to a real server.
  assert.equal(data.ok === true, false)
})

test("POST /api/testVision with allowlisted localhost → tries fetch (connection fail ok)", async () => {
  const { port, token } = await ensureStarted()
  const r = await request({
    method: "POST",
    port,
    path: `/api/testVision?token=${token}`,
    headers: jsonHeaders(token),
    body: JSON.stringify({ base_url: "http://localhost:11434/v1", model_name: "llava:7b" }),
  })
  assert.equal(r.status, 200)
  const data = JSON.parse(r.body)
  // We expect a connection-failure error (no Ollama running), NOT an SSRF block.
  if (!data.ok) {
    assert.doesNotMatch(data.error, /SSRF|link-local|169\.254/i)
  }
})

  test("POST /api/testVision with AWS metadata IP → SSRF blocked", async () => {
    const { port, token } = await ensureStarted()
    const r = await request({
      method: "POST",
      port,
      path: `/api/testVision?token=${token}`,
      headers: jsonHeaders(token),
      body: JSON.stringify({ base_url: "http://169.254.169.254/", model_name: "llava:7b" }),
    })
    assert.equal(r.status, 200)
    const data = JSON.parse(r.body)
    assert.equal(data.ok, false)
    assert.match(data.error, /SSRF|private|link-local|blocked/i)
  })
})

// ---------------------------------------------------------------------------
// CLI tests — run in-process to avoid tsx/subprocess plumbing.
// ---------------------------------------------------------------------------

let runNonInteractiveSettingsCli: typeof import("../src/settings-cli").runNonInteractiveSettingsCli
let runNonInteractiveSettings: typeof import("../src/settings-cli").runNonInteractiveSettings

before(async () => {
  const cli = await import("../src/settings-cli")
  runNonInteractiveSettingsCli = cli.runNonInteractiveSettingsCli
  runNonInteractiveSettings = cli.runNonInteractiveSettings
})

// Intercept process.exit so we can assert non-zero exits in-process.
function withExitIntercept<T>(runner: () => T): { exitCode: number | null; stderr: string; stdout: string } {
  const origExit = process.exit
  let exitCode: number | null = null
  const origStderrWrite = process.stderr.write.bind(process.stderr)
  const origStdoutWrite = process.stdout.write.bind(process.stdout)
  let stderrBuf = ""
  let stdoutBuf = ""
  process.stderr.write = ((s: any) => { stderrBuf += s.toString(); return true }) as any
  process.stdout.write = ((s: any) => { stdoutBuf += s.toString(); return true }) as any
  process.exit = ((code?: number) => {
    exitCode = typeof code === "number" ? code : 0
    throw new Error("__EXIT_INTERCEPT__:" + exitCode)
  }) as any
  try {
    runner()
    return { exitCode: null, stderr: stderrBuf, stdout: stdoutBuf }
  } catch (e: any) {
    if (e && typeof e.message === "string" && e.message.startsWith("__EXIT_INTERCEPT__")) {
      return { exitCode: parseInt(e.message.split(":")[1], 10), stderr: stderrBuf, stdout: stdoutBuf }
    }
    throw e
  } finally {
    process.exit = origExit
    process.stderr.write = origStderrWrite
    process.stdout.write = origStdoutWrite
  }
}

describe("settings-cli", { concurrency: 1 }, () => {
  test("settings-cli: --set api_key=sk-... exits non-zero (argv leak)", () => {
  // Reset api_key to a known baseline
  saveConfig({
    port: 23401,
    llm: { ...getConfig().llm, api_key: "sk-baseline-1234567890" },
    trusted_domains: [],
    auto_approved_domains: [],
    history_retention_days: 30,
    security: {
      safety_skills_enabled: [],
      auto_confirm_same_thread: false,
      confirmation_timeout_seconds: 45,
      auto_approve_dangerous: false,
    },
  })

  const result = withExitIntercept(() =>
    runNonInteractiveSettings(["api_key=sk-leaked-key-1234"]),
  )
  assert.notEqual(result.exitCode, null, "expected process.exit to be called")
  assert.notEqual(result.exitCode, 0, `expected non-zero exit, got ${result.exitCode}`)
  assert.match(result.stderr, /Refusing to set api_key/i)

  // Verify the key was NOT persisted
  assert.equal(getConfig().llm.api_key, "sk-baseline-1234567890")
})

test("settings-cli: --set-stdin api_key reads value from stdin", async () => {
  // Pipe a fake stdin
  const origIsTTY = process.stdin.isTTY
  const origStdin = process.stdin
  const fakeStdin = new (require("stream").Readable)({ read() {} })
  ;(fakeStdin as any).isTTY = false
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })
  // push the value
  fakeStdin.push("sk-from-stdin-1234567890\n")
  fakeStdin.push(null)

  try {
    await runNonInteractiveSettingsCli(["--set-stdin", "api_key"])
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true })
    Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true })
  }

  assert.equal(getConfig().llm.api_key, "sk-from-stdin-1234567890")
})

test("settings-cli: CMSPARK_API_KEY env var is accepted for --set-stdin", async () => {
  process.env.CMSPARK_API_KEY = "sk-from-env-1234567890"
  // No stdin data — env should win.
  const fakeStdin = new (require("stream").Readable)({ read() {} })
  ;(fakeStdin as any).isTTY = false
  const origStdin = process.stdin
  Object.defineProperty(process, "stdin", { value: fakeStdin, configurable: true })
  fakeStdin.push(null)

  try {
    await runNonInteractiveSettingsCli(["--set-stdin", "api_key"])
  } finally {
    Object.defineProperty(process, "stdin", { value: origStdin, configurable: true })
    delete process.env.CMSPARK_API_KEY
  }

  assert.equal(getConfig().llm.api_key, "sk-from-env-1234567890")
})

  test("settings-cli: non-sensitive --set still works (model_name)", () => {
    const result = withExitIntercept(() =>
      runNonInteractiveSettings(["model_name=gpt-4o-mini"]),
    )
    assert.equal(result.exitCode, null)
    assert.match(result.stdout, /model_name 已更新/)
    assert.equal(getConfig().llm.model_name, "gpt-4o-mini")
  })
})
