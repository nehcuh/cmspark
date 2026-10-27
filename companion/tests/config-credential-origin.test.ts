import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import type { CompanionConfig, LlmConfig, VisionConfig } from "../src/config"

type Config = typeof import("../src/config")
const ENV_A = "owned-origin-env-a"
const ENV_B = "owned-origin-env-b"
const USER = "owned-origin-user"
const VISION_USER = "owned-origin-vision-user"

// Each file runs in the test runner's isolated process. Never capture a real
// environment key: delete it before importing config and use only sentinels.
async function owned(run: (config: Config, disk: () => CompanionConfig) => void): Promise<void> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-credential-origin-")))
  const identity = fs.lstatSync(root)
  process.env.CMSPARK_DATA_DIR = root
  process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.CMSPARK_API_KEY
  let config: Config | undefined
  try {
    config = await import("../src/config")
    config.clearConfigCache()
    const disk = () => JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8")) as CompanionConfig
    run(config, disk)
  } finally {
    config?.clearConfigCache()
    delete process.env.DEEPSEEK_API_KEY
    delete process.env.CMSPARK_API_KEY
    delete process.env.CMSPARK_DATA_DIR
    const current = fs.lstatSync(root)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(current.dev, identity.dev)
    assert.equal(current.ino, identity.ino)
    fs.rmSync(root, { recursive: true })
  }
}

function llm(config: Config, api_key: string): LlmConfig {
  return { ...config.getConfig().llm, api_key }
}

function inheritVision(config: Config): void {
  const current = config.getConfig()
  config.saveConfig({
    llm: { ...current.llm, base_url: "https://owned-origin.invalid/v1", model_name: "owned-model", protocol: "openai", api_key: "" },
    vision: { ...current.vision!, enabled: true, base_url: "https://owned-origin.invalid/v1", model_name: "owned-model", api_key: "ollama" },
  }, { visionKey: true })
  assert.equal(config.getConfig().llm.api_key, ENV_A)
  assert.equal(config.getConfig().vision!.api_key, ENV_A)
}

test("credential origin preserves explicit LLM and vision keys over a different environment", { concurrency: false }, async () => {
  await owned((config, disk) => {
    config.saveConfig({ llm: llm(config, USER), vision: { ...config.getConfig().vision!, api_key: VISION_USER } }, { llmKey: true, visionKey: true })
    process.env.DEEPSEEK_API_KEY = ENV_A
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, USER)
    assert.equal(config.getConfig().vision!.api_key, VISION_USER)
    config.saveConfig({ port: 23402 })
    assert.equal(disk().llm.api_key, USER)
    assert.equal(disk().vision!.api_key, VISION_USER)
  })
})

test("credential origin does not promote an unchanged runtime snapshot to a stored user key", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    const runtime = config.getConfig()
    assert.equal(runtime.llm.api_key, ENV_A)
    config.saveConfig(runtime)
    assert.equal(disk().llm.api_key, "")
    delete process.env.DEEPSEEK_API_KEY
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "")
  })
})

test("credential origin refreshes a cached environment key after rotation", { concurrency: false }, async () => {
  await owned(config => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    assert.equal(config.getConfig().llm.api_key, ENV_A)
    process.env.DEEPSEEK_API_KEY = ENV_B
    assert.equal(config.getConfig().llm.api_key, ENV_B)
  })
})

test("credential origin clears an environment fallback when the environment is removed", { concurrency: false }, async () => {
  await owned(config => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    assert.equal(config.getConfig().llm.api_key, ENV_A)
    delete process.env.DEEPSEEK_API_KEY
    assert.equal(config.getConfig().llm.api_key, "")
  })
})

test("credential origin never persists a formerly injected key on an unrelated save", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    assert.equal(config.getConfig().llm.api_key, ENV_A)
    delete process.env.DEEPSEEK_API_KEY
    config.saveConfig({ port: 23402 })
    assert.equal(disk().llm.api_key, "")
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "")
  })
})

test("credential origin preserves a stored user key that equals the environment value", { concurrency: false }, async () => {
  await owned((config, disk) => {
    config.saveConfig({ llm: llm(config, USER) }, { llmKey: true })
    process.env.DEEPSEEK_API_KEY = USER
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, USER)
    config.saveConfig({ port: 23402 })
    assert.equal(disk().llm.api_key, USER)
    delete process.env.DEEPSEEK_API_KEY
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, USER)
  })
})

test("credential origin persists a new explicit LLM key even when it equals the environment", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    config.saveConfig({ llm: { api_key: ENV_A } as LlmConfig }, { llmKey: true })
    assert.equal(disk().llm.api_key, ENV_A)
    delete process.env.DEEPSEEK_API_KEY
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, ENV_A)
  })
})

test("credential origin persists an independent explicit vision key equal to the environment", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    config.saveConfig({ vision: { api_key: ENV_A } as VisionConfig }, { visionKey: true })
    assert.equal(disk().vision!.api_key, ENV_A)
    assert.equal(disk().llm.api_key, "")
  })
})

test("credential origin refreshes and clears same-endpoint inherited vision without persisting it", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    inheritVision(config)
    assert.equal(disk().vision!.api_key, "")
    process.env.DEEPSEEK_API_KEY = ENV_B
    assert.equal(config.getConfig().llm.api_key, ENV_B)
    assert.equal(config.getConfig().vision!.api_key, ENV_B)
    delete process.env.DEEPSEEK_API_KEY
    assert.equal(config.getConfig().llm.api_key, "")
    assert.equal(config.getConfig().vision!.api_key, "")
    config.saveConfig({ port: 23402 })
    assert.equal(disk().llm.api_key, "")
    assert.equal(disk().vision!.api_key, "")
  })
})

const writers: ReadonlyArray<readonly [string, (config: Config) => void]> = [
  ["replaceMcpServers", config => { config.replaceMcpServers({}) }],
  ["replaceAppsEntries", config => { config.replaceAppsEntries({}) }],
  ["setComputerCoordinateEnabled", config => { config.setComputerCoordinateEnabled(false) }],
  ["setComputerLcuFields", config => { config.setComputerLcuFields({ enabled: false }) }],
  ["setComputerModelFields", config => { config.setComputerModelFields({ modelEnabled: false }) }],
  ["setVoiceFields", config => { config.setVoiceFields({ sttEngine: "browser" }) }],
]

for (const [name, write] of writers) {
  test(`credential origin ${name} keeps environment and inherited vision credentials off disk`, { concurrency: false }, async () => {
    await owned((config, disk) => {
      process.env.DEEPSEEK_API_KEY = ENV_A
      inheritVision(config)
      assert.equal(disk().llm.api_key, "")
      assert.equal(disk().vision!.api_key, "")
      write(config)
      assert.equal(disk().llm.api_key, "")
      assert.equal(disk().vision!.api_key, "")
      assert.equal(config.getConfig().llm.api_key, ENV_A)
      assert.equal(config.getConfig().vision!.api_key, ENV_A)
    })
  })
}

for (const [name, write] of writers) {
  test(`credential origin ${name} preserves explicit keys equal to the environment`, { concurrency: false }, async () => {
    await owned((config, disk) => {
      config.saveConfig({ llm: llm(config, USER), vision: { ...config.getConfig().vision!, api_key: USER } }, { llmKey: true, visionKey: true })
      process.env.DEEPSEEK_API_KEY = USER
      config.clearConfigCache()
      assert.equal(config.getConfig().llm.api_key, USER)
      assert.equal(config.getConfig().vision!.api_key, USER)
      write(config)
      assert.equal(disk().llm.api_key, USER)
      assert.equal(disk().vision!.api_key, USER)
      delete process.env.DEEPSEEK_API_KEY
      config.clearConfigCache()
      assert.equal(config.getConfig().llm.api_key, USER)
      assert.equal(config.getConfig().vision!.api_key, USER)
    })
  })
}

test("credential origin MCP replacement preserves deletion and the enabled flag", { concurrency: false }, async () => {
  await owned((config, disk) => {
    config.saveConfig({ llm: llm(config, USER) }, { llmKey: true })
    const template = structuredClone(config.getConfig().mcp!.servers.filesystem)
    assert.ok(template)
    config.replaceMcpServers({ owned_keep: template, owned_remove: structuredClone(template) }, { enabled: false })
    config.replaceMcpServers({ owned_keep: template })
    config.clearConfigCache()
    assert.deepEqual(Object.keys(config.getConfig().mcp!.servers), ["owned_keep"])
    assert.equal(config.getConfig().mcp!.enabled, false)
    config.replaceMcpServers({})
    config.clearConfigCache()
    assert.deepEqual(config.getConfig().mcp!.servers, {})
    assert.deepEqual(disk().mcp!.servers, {})
    assert.equal(disk().llm.api_key, USER)
  })
})

test("credential origin Apps replacement preserves deletion and the enabled flag", { concurrency: false }, async () => {
  const { sanitizeAppEntries } = await import("../src/apps/types")
  await owned((config, disk) => {
    config.saveConfig({ llm: llm(config, USER), apps: { enabled: false, entries: {} } }, { llmKey: true })
    // Raw user configuration is sent through the real validator/normalizer;
    // assertions below consume its actual output, not a fabricated wire DTO.
    const entries = sanitizeAppEntries(Object.fromEntries(["keep", "remove"].map(name => {
      const token = `mac.app.owned_${name}`
      return [token, { token, kind: "gui", display_name: `Owned ${name}`, source: "user", policy: "manual",
        enabled: false, added_at: "2026-10-27T00:00:00.000Z", bundleId: `org.example.owned.${name}` }]
    })))
    assert.equal(Object.keys(entries).length, 2)
    config.replaceAppsEntries(entries)
    config.replaceAppsEntries({ "mac.app.owned_keep": entries["mac.app.owned_keep"] })
    config.clearConfigCache()
    assert.deepEqual(Object.keys(config.getConfig().apps!.entries), ["mac.app.owned_keep"])
    assert.equal(config.getConfig().apps!.enabled, false)
    config.replaceAppsEntries({})
    config.clearConfigCache()
    assert.deepEqual(config.getConfig().apps!.entries, {})
    assert.deepEqual(disk().apps!.entries, {})
    assert.equal(disk().llm.api_key, USER)
  })
})

test("credential origin does not publish cache or key ownership when the atomic save fails", { concurrency: false }, async t => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    inheritVision(config)
    const file = path.join(config.getConfigDir(), "config.json")
    const beforeDisk = fs.readFileSync(file)
    const beforeRuntime = structuredClone(config.getConfig())
    assert.equal(disk().llm.api_key, "")
    assert.equal(disk().vision!.api_key, "")
    // This is atomicWriteJSON's actual fixed temporary pathname. Occupying it
    // with an owned directory makes the real writeFileSync fail before rename.
    const blocked = `${file}.tmp-${process.pid}`
    fs.mkdirSync(blocked, { mode: 0o700 })
    const identity = fs.lstatSync(blocked)
    let published = 0
    const changed = () => { published += 1 }
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, changed)
    try {
      let writeCode: string | undefined
      assert.throws(() => config.saveConfig({
        llm: { api_key: USER } as LlmConfig,
        vision: { api_key: VISION_USER } as VisionConfig,
      }, { llmKey: true, visionKey: true }), error => {
        writeCode = (error as NodeJS.ErrnoException).code
        return ["EISDIR", "EACCES", "EPERM"].includes(writeCode || "")
      })
      t.diagnostic(`CREDENTIAL_OWNED_ATOMIC_WRITE_FAILURE ${writeCode}`)
      assert.equal(published, 0)
      assert.deepEqual(fs.readFileSync(file), beforeDisk)
      assert.deepEqual(config.getConfig(), beforeRuntime)
      // A failed explicit write must not promote either formerly inherited key
      // to user-owned. The still-live environment must retain ownership.
      process.env.DEEPSEEK_API_KEY = ENV_B
      assert.equal(config.getConfig().llm.api_key, ENV_B)
      assert.equal(config.getConfig().vision!.api_key, ENV_B)
      assert.deepEqual(fs.readFileSync(file), beforeDisk)
    } finally {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, changed)
      const current = fs.lstatSync(blocked)
      assert.equal(current.isSymbolicLink(), false)
      assert.equal(current.dev, identity.dev)
      assert.equal(current.ino, identity.ino)
      fs.rmdirSync(blocked)
    }
  })
})

test("credential origin reconstitutes inherited vision after reload and clears it on endpoint change", { concurrency: false }, async () => {
  await owned((config, disk) => {
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: USER, base_url: "https://owned-origin.invalid/v1", model_name: "owned-model" },
      vision: { ...config.getConfig().vision!, api_key: "ollama", base_url: "https://owned-origin.invalid/v1", model_name: "owned-model" } }, { llmKey: true, visionKey: true })
    assert.equal(disk().vision!.api_key, "")
    config.clearConfigCache()
    assert.equal(config.getConfig().vision!.api_key, USER)
    config.saveConfig({ vision: { base_url: "https://other-owned.invalid/v1" } as VisionConfig })
    assert.equal(config.getConfig().vision!.api_key, "")
    assert.equal(disk().vision!.api_key, "")
  })
})

test("credential origin enables matching vision inheritance when an environment key appears later", { concurrency: false }, async () => {
  await owned((config, disk) => {
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: "", base_url: "https://owned-origin.invalid/v1", model_name: "owned-model" },
      vision: { ...config.getConfig().vision!, api_key: "ollama", base_url: "https://owned-origin.invalid/v1", model_name: "owned-model" } }, { visionKey: true })
    assert.equal(config.getConfig().vision!.api_key, "")
    process.env.DEEPSEEK_API_KEY = ENV_A
    assert.equal(config.getConfig().vision!.api_key, ENV_A)
    config.saveConfig({ port: 23402 })
    assert.equal(disk().vision!.api_key, "")
  })
})

test("credential origin does not persist a cloned runtime snapshot", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    const snapshot = structuredClone(config.getConfig())
    config.saveConfig(snapshot)
    assert.equal(disk().llm.api_key, "")
  })
})

test("credential origin does not persist inherited vision from a cloned runtime snapshot", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    inheritVision(config)
    config.saveConfig(structuredClone(config.getConfig()))
    assert.equal(disk().llm.api_key, "")
    assert.equal(disk().vision!.api_key, "")
  })
})

test("credential origin rejects old detached snapshot after environment rotation", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    const oldSnapshot = structuredClone(config.getConfig())
    process.env.DEEPSEEK_API_KEY = ENV_B
    config.saveConfig(oldSnapshot)
    assert.equal(disk().llm.api_key, "")
  })
})

test("credential origin rejects old inherited vision snapshot after environment removal", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    inheritVision(config)
    const oldSnapshot = structuredClone(config.getConfig())
    delete process.env.DEEPSEEK_API_KEY
    config.saveConfig(oldSnapshot)
    assert.equal(disk().llm.api_key, "")
    assert.equal(disk().vision!.api_key, "")
  })
})

test("credential origin requires explicit intent for a detached singleton key", { concurrency: false }, async () => {
  await owned((config, disk) => {
    process.env.DEEPSEEK_API_KEY = ENV_A
    const oldKey = config.getConfig().llm.api_key
    process.env.DEEPSEEK_API_KEY = ENV_B
    config.saveConfig({ llm: { api_key: oldKey } as LlmConfig })
    assert.equal(disk().llm.api_key, "")
    assert.equal(config.getConfig().llm.api_key, ENV_B)
    config.saveConfig({ llm: { api_key: oldKey } as LlmConfig }, { llmKey: true })
    assert.equal(disk().llm.api_key, ENV_A)
  })
})

// Extract the actual CLI input functions without launching an interactive CLI,
// provider, socket or child process. The write still goes through real config.
test("credential origin CLI applies an explicitly entered key and retains it on ordinary settings", { concurrency: false }, async () => {
  await owned((config, disk) => {
    const file = path.resolve(process.cwd(), "src/settings-cli.ts")
    const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true)
    const functions = ["validateValue", "applySetting"].map(name => {
      const matches = src.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
      assert.equal(matches.length, 1)
      return matches[0].getText(src)
    }).join("\n")
    const emitted = ts.transpileModule(functions + "\nexports.apply = applySetting", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: { apply?: (key: string, value: string) => { ok: boolean } } = {}
    vm.runInNewContext(emitted, { exports, saveConfig: config.saveConfig, URL }, { timeout: 2000 })
    assert.ok(exports.apply)
    process.env.DEEPSEEK_API_KEY = "sk-owned-cli-env"
    assert.equal(exports.apply("api_key", "sk-owned-cli-env").ok, true)
    assert.equal(exports.apply("model_name", "owned-model").ok, true)
    assert.equal(disk().llm.api_key, "sk-owned-cli-env")
    delete process.env.DEEPSEEK_API_KEY
    config.clearConfigCache()
    assert.equal(config.getConfig().llm.api_key, "sk-owned-cli-env")
  })
})
