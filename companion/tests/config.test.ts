// Tests for companion/src/config.ts API-key resolution and persistence logic.

import test, { before, after, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-config-"))

let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let isMaskedApiKey: typeof import("../src/config").isMaskedApiKey
let initDataDir: typeof import("../src/config").initDataDir
let clearConfigCache: typeof import("../src/config").clearConfigCache

async function resetConfigFile() {
  clearConfigCache()
  // Clean config.json plus any .corrupt-<ts> backups / .tmp- files left by prior tests so
  // each H3/H4 assertion starts from a known-clean slate.
  for (const f of fs.readdirSync(tempHome)) {
    if (f === "config.json" || f.startsWith("config.json.corrupt-") || f.includes(".tmp-")) {
      try { fs.rmSync(path.join(tempHome, f)) } catch { /* ignore */ }
    }
  }
  await initDataDir()
  clearConfigCache()
}

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = tempHome
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.CMSPARK_API_KEY

  const cfg = await import("../src/config")
  getConfig = cfg.getConfig
  saveConfig = cfg.saveConfig
  isMaskedApiKey = cfg.isMaskedApiKey
  initDataDir = cfg.initDataDir
  clearConfigCache = cfg.clearConfigCache

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function readSavedConfig(): any {
  const configPath = path.join(tempHome, "config.json")
  return JSON.parse(fs.readFileSync(configPath, "utf-8"))
}

describe("isMaskedApiKey", { concurrency: 1 }, () => {
  test("empty/undefined values are not masked", () => {
    assert.equal(isMaskedApiKey(""), false)
    assert.equal(isMaskedApiKey(undefined), false)
    assert.equal(isMaskedApiKey(null), false)
  })

  test("simple *** is masked", () => {
    assert.equal(isMaskedApiKey("***"), true)
  })

  test("maskApiKey output format is masked", () => {
    // maskApiKey: key.slice(0, 4) + "****" + key.slice(-4)
    assert.equal(isMaskedApiKey("sk-1****abcd"), true)
    assert.equal(isMaskedApiKey("long****tail"), true)
  })

  test("dot masking is masked", () => {
    assert.equal(isMaskedApiKey("sk-....xyz"), true)
  })

  test("real keys without masking characters are not masked", () => {
    assert.equal(isMaskedApiKey("sk-real-key-no-stars"), false)
    assert.equal(isMaskedApiKey("ollama"), false)
  })

  test("scattered asterisks are not masked", () => {
    assert.equal(isMaskedApiKey("a*b*c*d*e"), false)
  })

  test("short masked form with **** is still masked", () => {
    // Some UIs produce shorter masks like "sk-****xyz"; treat them as masked
    // even though they are shorter than the standard maskApiKey() output.
    assert.equal(isMaskedApiKey("sk-****xyz"), true)
    assert.equal(isMaskedApiKey("abc****def"), true)
  })
})

describe("saveConfig API key priority", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DEEPSEEK_API_KEY
    await resetConfigFile()
    // Reset to a known, clean config state for this suite.
    saveConfig({
      port: 23401,
      llm: {
        base_url: "https://api.deepseek.com/v1",
        api_key: "user-key",
        model_name: "deepseek-v4-flash",
        temperature: 0.7,
        context_window: 1000000,
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

  test("persists user-provided key to disk when no env var is set", () => {
    saveConfig({ llm: { api_key: "sk-user-provided" } as any })

    assert.equal(getConfig().llm.api_key, "sk-user-provided")
    assert.equal(readSavedConfig().llm.api_key, "sk-user-provided")
  })

  test("masked key does not overwrite existing user key", () => {
    saveConfig({ llm: { api_key: "sk-****xyz" } as any })

    assert.equal(getConfig().llm.api_key, "sk-user-provided")
  })

  test("new user-provided key takes priority over current user key", () => {
    saveConfig({ llm: { api_key: "sk-new-key" } as any })

    assert.equal(getConfig().llm.api_key, "sk-new-key")
    assert.equal(readSavedConfig().llm.api_key, "sk-new-key")
  })
})

describe("saveConfig with DEEPSEEK_API_KEY env var", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DEEPSEEK_API_KEY
    await resetConfigFile()
    process.env.DEEPSEEK_API_KEY = "sk-env-key"
    // Start from a state where the file has no user key.
    saveConfig({
      port: 23401,
      llm: {
        base_url: "https://api.deepseek.com/v1",
        api_key: "",
        model_name: "deepseek-v4-flash",
        temperature: 0.7,
        context_window: 1000000,
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
    delete process.env.DEEPSEEK_API_KEY
  })

  test("uses env var when no user key exists", () => {
    assert.equal(getConfig().llm.api_key, "sk-env-key")
  })

  test("does not persist env var to disk", () => {
    assert.equal(readSavedConfig().llm.api_key, "")
  })

  test("user-provided key different from env var is persisted", () => {
    saveConfig({ llm: { api_key: "sk-user-different" } as any })

    assert.equal(getConfig().llm.api_key, "sk-user-different")
    assert.equal(readSavedConfig().llm.api_key, "sk-user-different")
  })

  test("getConfig respects user-provided key over env var", () => {
    // getConfig should load the saved user key and not overwrite it with env var.
    assert.equal(getConfig().llm.api_key, "sk-user-different")
  })

  test("masked caller key keeps current user-provided key when env var is set", () => {
    saveConfig({ llm: { api_key: "sk-****xyz" } as any })

    assert.equal(getConfig().llm.api_key, "sk-user-different")
    assert.equal(readSavedConfig().llm.api_key, "sk-user-different")
  })
})

describe("saveConfig vision API key", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DEEPSEEK_API_KEY
    await resetConfigFile()
    saveConfig({
      port: 23401,
      llm: {
        base_url: "https://api.deepseek.com/v1",
        api_key: "user-key",
        model_name: "deepseek-v4-flash",
        temperature: 0.7,
        context_window: 1000000,
      },
      vision: {
        enabled: true,
        base_url: "http://localhost:11434/v1",
        api_key: "vision-real-key",
        model_name: "llava:7b",
        timeout_ms: 30000,
        max_tokens: 1024,
        fallback: "metadata",
        cache_ttl_seconds: 300,
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

  test("persists user-provided vision key", () => {
    saveConfig({ vision: { api_key: "vision-user-key" } as any })

    assert.equal(getConfig().vision?.api_key, "vision-user-key")
    assert.equal(readSavedConfig().vision.api_key, "vision-user-key")
  })

  test("masked vision key does not overwrite current vision key", () => {
    saveConfig({ vision: { api_key: "vis-****xyz" } as any })

    assert.equal(getConfig().vision?.api_key, "vision-user-key")
    assert.equal(readSavedConfig().vision.api_key, "vision-user-key")
  })

  // --- audit H4: corrupt config must be preserved + logged, not silently reset ---

  test("H4: truncated config.json is preserved as .corrupt-<ts>, defaults used (not silent wipe)", async () => {
    await resetConfigFile()
    const configPath = path.join(tempHome, "config.json")
    // Simulates a crash mid-write (pre-H3 atomic writes): truncated, unparseable JSON.
    fs.writeFileSync(configPath, '{ "llm": { "api_key": "sk-corrupt', "utf-8")
    clearConfigCache()

    const cfg = getConfig()
    // Companion still starts with defaults...
    assert.equal(cfg.security.auto_approve_dangerous, false, "must fall back to default config")
    // ...but the corrupt file is preserved for inspection, not silently overwritten/lost.
    const backups = fs.readdirSync(tempHome).filter(f => f.startsWith("config.json.corrupt-"))
    assert.equal(backups.length, 1, "corrupt config must be backed up to config.json.corrupt-<ts>")
  })

  test("H4: non-object config root (e.g. a JSON array) is treated as corrupt + preserved", async () => {
    await resetConfigFile()
    fs.writeFileSync(path.join(tempHome, "config.json"), "[1, 2, 3]", "utf-8")
    clearConfigCache()
    const cfg = getConfig()
    assert.equal(cfg.security.auto_approve_dangerous, false, "must fall back to default config")
    const backups = fs.readdirSync(tempHome).filter(f => f.startsWith("config.json.corrupt-"))
    assert.equal(backups.length, 1, "non-object config root must be backed up, not silently merged")
  })

  // --- audit H3: atomic writes ---

  test("H3: saveConfig writes atomically — no leftover .tmp, file valid + 0o600", async () => {
    await resetConfigFile()
    saveConfig({ trusted_domains: ["atomic.example.com"] })
    const tmpFiles = fs.readdirSync(tempHome).filter(f => f.includes(".tmp-"))
    assert.equal(tmpFiles.length, 0, "atomic write must not leave a .tmp file behind")
    clearConfigCache()
    assert.ok(
      getConfig().trusted_domains.includes("atomic.example.com"),
      "saved value must persist + reload",
    )
    const mode = fs.statSync(path.join(tempHome, "config.json")).mode & 0o777
    assert.equal(mode, 0o600, "config.json must be owner-only (0o600)")
  })
})

// --- audit H5: saveConfig read-modify-write atomicity ---
//
// The audit proposed a promise-queue mutex to serialize saveConfig. Verified
// by inspection + execution: saveConfig is fully SYNCHRONOUS (getConfig →
// deepMerge → atomicWriteJSON, the last being writeFileSync+renameSync+chmodSync
// with no `await`). Under Node's single thread the whole body is atomic — two
// calls cannot interleave, so there is no yield point for a mutex to serialize
// and the proposed fix would be a no-op. These tests lock the ACTUAL invariant
// in place: saveConfig must stay synchronous, and the read-modify-write must
// merge against the latest cached state (not a stale caller snapshot), so
// sequential writes to disjoint keys never lose data. If a future refactor
// introduces an `await` here, the first test fails loudly.

describe("saveConfig H5 atomicity (synchronous read-modify-write)", { concurrency: 1 }, () => {
  before(async () => {
    delete process.env.DEEPSEEK_API_KEY
    await resetConfigFile()
  })

  test("H5: saveConfig is synchronous — returns a plain object, not a Promise", () => {
    // The whole point: with no yield point, read-modify-write cannot interleave.
    // If someone switches to fs.promises / an async atomicWriteJSON, saveConfig
    // would start returning a Promise and callers like server.ts's whitelist
    // append would race — this assertion fails first and points at the cause.
    const result = saveConfig({ trusted_domains: ["sync-check.example.com"] })
    assert.equal(
      typeof (result as any)?.then,
      "undefined",
      "saveConfig must return a plain object — an async refactor would break the atomicity invariant",
    )
    // The disk write must have already happened before saveConfig returned
    // (synchronous I/O), not be pending on a microtask.
    assert.ok(
      readSavedConfig().trusted_domains.includes("sync-check.example.com"),
      "saveConfig must complete the disk write before returning (synchronous I/O)",
    )
  })

  test("H5: two saveConfig calls writing disjoint keys both persist (atomic read-modify-write)", async () => {
    await resetConfigFile()
    // Each call deep-merges against the LATEST cached state, not a snapshot the
    // caller captured — so the second write does not clobber the first.
    saveConfig({ trusted_domains: ["a.example.com"] })
    saveConfig({ auto_approved_domains: ["b.example.com"] })
    clearConfigCache()
    const onDisk = readSavedConfig()
    assert.ok(onDisk.trusted_domains.includes("a.example.com"), "first write must survive the second")
    assert.ok(onDisk.auto_approved_domains.includes("b.example.com"), "second write must persist too")
  })

  test("H5: whitelist-append pattern (read array → write full array) does not lose data across sequential appends", async () => {
    // Mirrors server.ts:644 — getConfig().auto_approved_domains is read, new
    // patterns are appended, and the FULL array is written back via saveConfig.
    // deepMerge REPLACES arrays (no union), so this is only safe because each
    // append reads the latest state and writes immediately with no `await`
    // between read and write. This test pins that property.
    await resetConfigFile()
    saveConfig({ auto_approved_domains: ["seed.example.com"] })
    // First append
    const cur1 = getConfig().auto_approved_domains || []
    saveConfig({ auto_approved_domains: [...cur1, "add-1.example.com"] })
    // Second append (simulating a second confirmation response arriving right after)
    const cur2 = getConfig().auto_approved_domains || []
    saveConfig({ auto_approved_domains: [...cur2, "add-2.example.com"] })
    clearConfigCache()
    const final = getConfig().auto_approved_domains
    assert.ok(final.includes("seed.example.com"), "seed must survive both appends")
    assert.ok(final.includes("add-1.example.com"), "first append must survive the second")
    assert.ok(final.includes("add-2.example.com"), "second append must persist")
    assert.equal(final.length, 3, "no append lost, no duplicate introduced")
  })
})
