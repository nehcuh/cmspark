// Path B M0 Task 2 — config.voice defaults, load validation, setVoiceFields

import test, { before, after, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-voice-config-"))

let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let setVoiceFields: typeof import("../src/config").setVoiceFields
let initDataDir: typeof import("../src/config").initDataDir
let clearConfigCache: typeof import("../src/config").clearConfigCache
let configEvents: typeof import("../src/config").configEvents
let CONFIG_CHANGE_EVENT: typeof import("../src/config").CONFIG_CHANGE_EVENT

async function resetConfigFile() {
  clearConfigCache()
  for (const f of fs.readdirSync(tempHome)) {
    if (f === "config.json" || f.startsWith("config.json.corrupt-") || f.includes(".tmp-")) {
      try {
        fs.rmSync(path.join(tempHome, f))
      } catch {
        /* ignore */
      }
    }
  }
  await initDataDir()
  clearConfigCache()
}

function readSavedConfig(): any {
  return JSON.parse(fs.readFileSync(path.join(tempHome, "config.json"), "utf-8"))
}

/** Write a partial on-disk config and force cache miss so getConfig reloads + validates. */
function writeDiskConfig(partial: Record<string, unknown>) {
  clearConfigCache()
  const full = {
    port: 23401,
    llm: {
      base_url: "https://api.deepseek.com/v1",
      api_key: "",
      model_name: "deepseek-v4-flash",
      temperature: 0.7,
      context_window: 128000,
    },
    trusted_domains: [],
    auto_approved_domains: [],
    history_retention_days: 30,
    log_retention_days: 14,
    log_max_file_mb: 10,
    security: {
      safety_skills_enabled: [],
      auto_confirm_same_thread: false,
      confirmation_timeout_seconds: 45,
      auto_approve_dangerous: false,
      allow_all_schemes: false,
      companion_ui_exe_basenames: [],
    },
    ...partial,
  }
  fs.writeFileSync(path.join(tempHome, "config.json"), JSON.stringify(full, null, 2), { mode: 0o600 })
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
  setVoiceFields = cfg.setVoiceFields
  initDataDir = cfg.initDataDir
  clearConfigCache = cfg.clearConfigCache
  configEvents = cfg.configEvents
  CONFIG_CHANGE_EVENT = cfg.CONFIG_CHANGE_EVENT

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

describe("config.voice defaults (deepMerge path)", { concurrency: 1 }, () => {
  test("fresh initDataDir / missing voice key → browser + medium + 4096", async () => {
    await resetConfigFile()
    // initDataDir wrote full defaultConfig including voice
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "browser")
    assert.equal(cfg.voice?.localModelId, "medium")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 4096)
    assert.equal(cfg.voice?.modelRootDir, undefined)
  })

  test("legacy config.json without voice → deepMerge fills defaults", async () => {
    await resetConfigFile()
    // Simulate pre-M0 disk: no voice key at all
    writeDiskConfig({})
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "browser")
    assert.equal(cfg.voice?.localModelId, "medium")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 4096)
  })

  test("partial voice on disk merges with defaults", async () => {
    await resetConfigFile()
    writeDiskConfig({ voice: { sttEngine: "local" } })
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "local")
    assert.equal(cfg.voice?.localModelId, "medium")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 4096)
  })
})

describe("config.voice load validation", { concurrency: 1 }, () => {
  test("bad modelDiskBudgetMB → 4096 + warn", async () => {
    await resetConfigFile()
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "4096", null, undefined]) {
      writeDiskConfig({
        voice: {
          sttEngine: "browser",
          localModelId: "medium",
          modelDiskBudgetMB: bad,
        },
      })
      const logs: string[] = []
      const orig = console.warn
      console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "))
      try {
        const cfg = getConfig()
        assert.equal(cfg.voice?.modelDiskBudgetMB, 4096, `budget=${String(bad)} should reset to 4096`)
      } finally {
        console.warn = orig
      }
      // undefined is filled by deepMerge to 4096 without a warn; only present-but-bad warn
      if (bad !== undefined) {
        assert.ok(
          logs.some((l) => l.includes("modelDiskBudgetMB")),
          `budget=${String(bad)} should warn`,
        )
      }
    }
  })

  test("bad sttEngine → browser + warn", async () => {
    await resetConfigFile()
    for (const bad of ["cloud", "BROWSER", "", 1, null, true]) {
      writeDiskConfig({
        voice: {
          sttEngine: bad,
          localModelId: "medium",
          modelDiskBudgetMB: 4096,
        },
      })
      const logs: string[] = []
      const orig = console.warn
      console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "))
      try {
        assert.equal(getConfig().voice?.sttEngine, "browser", `engine=${JSON.stringify(bad)}`)
      } finally {
        console.warn = orig
      }
      assert.ok(logs.some((l) => l.includes("sttEngine")), `engine=${JSON.stringify(bad)} should warn`)
    }
  })

  test("bad localModelId → medium + warn", async () => {
    await resetConfigFile()
    for (const bad of ["tiny", "large", "MEDIUM", "", 0, null]) {
      writeDiskConfig({
        voice: {
          sttEngine: "browser",
          localModelId: bad,
          modelDiskBudgetMB: 4096,
        },
      })
      const logs: string[] = []
      const orig = console.warn
      console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "))
      try {
        assert.equal(getConfig().voice?.localModelId, "medium", `id=${JSON.stringify(bad)}`)
      } finally {
        console.warn = orig
      }
      assert.ok(logs.some((l) => l.includes("localModelId")), `id=${JSON.stringify(bad)} should warn`)
    }
  })

  test("legal values retained", async () => {
    await resetConfigFile()
    writeDiskConfig({
      voice: {
        sttEngine: "local",
        localModelId: "large-v3-turbo",
        modelDiskBudgetMB: 8192,
        modelRootDir: "/tmp/whisper-custom",
      },
    })
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "local")
    assert.equal(cfg.voice?.localModelId, "large-v3-turbo")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 8192)
    assert.equal(cfg.voice?.modelRootDir, "/tmp/whisper-custom")
  })

  test("non-object voice block → full defaults", async () => {
    await resetConfigFile()
    writeDiskConfig({ voice: "not-an-object" })
    const logs: string[] = []
    // no warn required for wholesale replace; just ensure safe defaults
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "browser")
    assert.equal(cfg.voice?.localModelId, "medium")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 4096)
    void logs
  })

  test("empty modelRootDir stripped + warn", async () => {
    await resetConfigFile()
    writeDiskConfig({
      voice: {
        sttEngine: "browser",
        localModelId: "medium",
        modelDiskBudgetMB: 4096,
        modelRootDir: "   ",
      },
    })
    const logs: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => logs.push(args.map(String).join(" "))
    try {
      assert.equal(getConfig().voice?.modelRootDir, undefined)
    } finally {
      console.warn = orig
    }
    assert.ok(logs.some((l) => l.includes("modelRootDir")))
  })
})

describe("setVoiceFields", { concurrency: 1 }, () => {
  test("merges partial, persists atomically, updates cache", async () => {
    await resetConfigFile()
    const updated = setVoiceFields({ sttEngine: "local", localModelId: "small" })
    assert.equal(updated.voice?.sttEngine, "local")
    assert.equal(updated.voice?.localModelId, "small")
    assert.equal(updated.voice?.modelDiskBudgetMB, 4096)

    assert.equal(getConfig().voice?.sttEngine, "local")
    assert.equal(getConfig().voice?.localModelId, "small")

    const disk = readSavedConfig()
    assert.equal(disk.voice.sttEngine, "local")
    assert.equal(disk.voice.localModelId, "small")
    assert.equal(disk.voice.modelDiskBudgetMB, 4096)
  })

  test("second patch does not wipe prior voice fields", async () => {
    await resetConfigFile()
    setVoiceFields({ sttEngine: "local", localModelId: "small", modelDiskBudgetMB: 2048 })
    setVoiceFields({ localModelId: "large-v3-turbo" })
    const cfg = getConfig()
    assert.equal(cfg.voice?.sttEngine, "local")
    assert.equal(cfg.voice?.localModelId, "large-v3-turbo")
    assert.equal(cfg.voice?.modelDiskBudgetMB, 2048)
  })

  test("emits CONFIG_CHANGE_EVENT", async () => {
    await resetConfigFile()
    let seen: unknown = null
    const handler = (c: unknown) => {
      seen = c
    }
    configEvents.on(CONFIG_CHANGE_EVENT, handler)
    try {
      setVoiceFields({ modelRootDir: "/tmp/voice-models" })
      assert.ok(seen)
      assert.equal((seen as any).voice?.modelRootDir, "/tmp/voice-models")
    } finally {
      configEvents.off(CONFIG_CHANGE_EVENT, handler)
    }
  })

  test("does not clobber unrelated config via deepMerge saveConfig", async () => {
    await resetConfigFile()
    saveConfig({ trusted_domains: ["example.com"] } as any)
    setVoiceFields({ sttEngine: "local" })
    assert.deepEqual(getConfig().trusted_domains, ["example.com"])
    assert.equal(getConfig().voice?.sttEngine, "local")
  })
})
