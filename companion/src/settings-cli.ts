// Interactive settings CLI for LLM configuration
// Usage: cmspark-agent settings                → interactive mode (web page)
//        cmspark-agent settings --set key=value → non-interactive mode
//        cmspark-agent settings --set-stdin key  → reads value from stdin (one line)
//
// Security: api_key (and other secret-like keys) cannot be set via --set
// because argv is world-readable via `ps`. Use --set-stdin or the
// CMSPARK_API_KEY env var (also CMSPARK_<UPPER_KEY> for other sensitive keys).

import * as readline from "readline"
import { getConfig, saveConfig, DATA_DIR } from "./config"

const VALID_KEYS = ["api_key", "base_url", "model_name", "temperature", "context_window"]

// Keys that must never appear in argv. They are world-readable via `ps -ef`
// and would leak for the entire process lifetime.
const SENSITIVE_KEYS = new Set(["api_key", "auth_token", "secret", "password", "token"])

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase()
  if (SENSITIVE_KEYS.has(lower)) return true
  return SENSITIVE_KEYS.has(lower) || lower.endsWith("_api_key") || lower.includes("secret") || lower.includes("password") || lower.includes("token")
}

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key ? "***" : ""
  return key.slice(0, 4) + "..." + key.slice(-4)
}

function validateValue(key: string, value: string): string | null {
  switch (key) {
    case "api_key":
      if (!value || value.length < 8) return "API Key 过短"
      if (!value.startsWith("sk-")) return "API Key 应以 sk- 开头"
      return null
    case "base_url":
      try {
        new URL(value)
      } catch {
        return "无效的 URL"
      }
      return null
    case "temperature":
      {
        const n = parseFloat(value)
        if (isNaN(n) || n < 0 || n > 2) return "temperature 应为 0.0 - 2.0 之间的数字"
      }
      return null
    case "context_window":
      {
        const n = parseInt(value, 10)
        if (isNaN(n) || n < 1000 || n > 10000000) return "context_window 应为 1000 - 10000000 之间的整数"
      }
      return null
    case "model_name":
      if (!value.trim()) return "model_name 不能为空"
      return null
    default:
      return null
  }
}

function applySetting(key: string, value: string): { ok: boolean; error?: string } {
  const validationError = validateValue(key, value)
  if (validationError) return { ok: false, error: validationError }

  const config = getConfig()
  if (key === "api_key") {
    config.llm.api_key = value
  } else if (key === "base_url") {
    config.llm.base_url = value
  } else if (key === "model_name") {
    config.llm.model_name = value
  } else if (key === "temperature") {
    config.llm.temperature = parseFloat(value)
  } else if (key === "context_window") {
    config.llm.context_window = parseInt(value, 10)
  }

  saveConfig(config)
  return { ok: true }
}

export async function runInteractiveSettings(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const config = getConfig()
  console.log("\n=== CMspark LLM 设置 ===\n")
  console.log(`  1. API Key      : ${maskApiKey(config.llm.api_key)}`)
  console.log(`  2. Base URL     : ${config.llm.base_url}`)
  console.log(`  3. Model Name   : ${config.llm.model_name}`)
  console.log(`  4. Temperature  : ${config.llm.temperature}`)
  console.log(`  5. Context Window: ${config.llm.context_window}`)
  console.log(`  0. 退出`)
  console.log("")

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  while (true) {
    const choice = await ask("请选择要修改的配置项 (0-5): ")
    const idx = parseInt(choice.trim(), 10)
    if (idx === 0) break
    if (idx < 1 || idx > 5) {
      console.log("无效选项，请重新输入")
      continue
    }

    const key = VALID_KEYS[idx - 1]
    const current =
      key === "api_key"
        ? maskApiKey(config.llm.api_key)
        : String((config.llm as any)[key])
    const value = await ask(`  当前值: ${current}\n  新值: `)
    const trimmed = value.trim()
    if (!trimmed) {
      console.log("未输入值，取消修改")
      continue
    }

    const result = applySetting(key, trimmed)
    if (result.ok) {
      console.log(`✅ ${key} 已更新`)
    } else {
      console.log(`❌ 更新失败: ${result.error}`)
    }
  }

  rl.close()
  console.log("\n设置已保存到:", DATA_DIR + "/config.json\n")
}

// Resolve a value for a sensitive key, preferring env var over stdin-supplied.
// Lookup order: CMSPARK_<UPPER_KEY> env var, then provided stdin value.
function resolveSensitiveValue(key: string, stdinValue: string | undefined): { value: string; source: string } | { error: string } {
  const envName = `CMSPARK_${key.toUpperCase()}`
  const envVal = process.env[envName]
  if (typeof envVal === "string" && envVal.length > 0) {
    return { value: envVal, source: `env ${envName}` }
  }
  if (stdinValue !== undefined && stdinValue.length > 0) {
    return { value: stdinValue, source: "stdin" }
  }
  return {
    error: `Refusing to set ${key} from argv (visible in ps). Use --set-stdin ${key} or the ${envName} env var.`,
  }
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: undefined, terminal: false })
    let collected = ""
    rl.on("line", (line) => {
      collected = line
      rl.close()
    })
    rl.on("close", () => resolve(collected.trim()))
    rl.on("end", () => resolve(collected.trim()))
  })
}

// Public entrypoint invoked from index.ts. Recognized argv shapes:
//   --set key=value [...]
//   --set-stdin key [...]  (value read from stdin; multiple keys read consecutive lines)
// Returns whether stdin was needed (so the caller can await this before exit).
export async function runNonInteractiveSettingsCli(argv: string[]): Promise<void> {
  const setFlags: string[] = []
  const setStdinKeys: string[] = []
  for (const a of argv) {
    if (a.startsWith("--set=")) {
      setFlags.push(a.slice("--set=".length))
    } else if (a === "--set-stdin") {
      // skip — value is the next positional, captured separately below
    }
  }
  // Pull positional keys following --set-stdin
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--set-stdin") {
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) setStdinKeys.push(next)
    }
  }

  // Step 1: reject sensitive keys in --set
  for (const pair of setFlags) {
    const eq = pair.indexOf("=")
    const key = (eq < 0 ? pair : pair.slice(0, eq)).trim()
    if (isSensitiveKey(key)) {
      console.error(
        `Refusing to set ${key} from argv (visible in ps). Use --set-stdin ${key} or CMSPARK_${key.toUpperCase()} env var.`,
      )
      process.exit(2)
    }
  }

  // Step 2: process --set pairs (non-sensitive)
  const results: Array<{ key: string; ok: boolean; error?: string }> = []
  for (const pair of setFlags) {
    const eq = pair.indexOf("=")
    if (eq < 0) {
      results.push({ key: pair, ok: false, error: "格式错误，应为 key=value" })
      continue
    }
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()

    if (!VALID_KEYS.includes(key)) {
      results.push({ key, ok: false, error: `不支持的配置项，支持: ${VALID_KEYS.join(", ")}` })
      continue
    }

    if (isSensitiveKey(key)) {
      // already exited above; keep narrowing
      results.push({ key, ok: false, error: "sensitive key blocked from argv" })
      continue
    }

    results.push({ key, ...applySetting(key, value) })
  }

  // Step 3: process --set-stdin keys (may be sensitive — read from stdin or env)
  for (const key of setStdinKeys) {
    if (!VALID_KEYS.includes(key)) {
      results.push({ key, ok: false, error: `不支持的配置项，支持: ${VALID_KEYS.join(", ")}` })
      continue
    }
    let stdinValue: string | undefined
    if (process.stdin.isTTY === false || !process.stdin.isTTY) {
      stdinValue = await readStdinLine()
    }
    const resolved = resolveSensitiveValue(key, stdinValue)
    if ("error" in resolved) {
      results.push({ key, ok: false, error: resolved.error })
      continue
    }
    results.push({ key, ...applySetting(key, resolved.value) })
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`✅ ${r.key} 已更新`)
    } else {
      console.log(`❌ ${r.key}: ${r.error}`)
    }
  }
}

// Back-compat shim: callers that previously invoked the synchronous function
// with kvPairs now go through the argv-aware CLI; this signature remains for
// any tests or external users.
export function runNonInteractiveSettings(kvPairs: string[]): void {
  // Synchronous path: rejects sensitive keys but does NOT support stdin/env
  // resolution. Use runNonInteractiveSettingsCli() for the full feature set.
  for (const pair of kvPairs) {
    const eq = pair.indexOf("=")
    const key = (eq < 0 ? pair : pair.slice(0, eq)).trim()
    if (isSensitiveKey(key)) {
      console.error(
        `Refusing to set ${key} from argv (visible in ps). Use --set-stdin ${key} or CMSPARK_${key.toUpperCase()} env var.`,
      )
      process.exit(2)
    }
  }

  const results: Array<{ key: string; ok: boolean; error?: string }> = []

  for (const pair of kvPairs) {
    const eq = pair.indexOf("=")
    if (eq < 0) {
      results.push({ key: pair, ok: false, error: "格式错误，应为 key=value" })
      continue
    }
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()

    if (!VALID_KEYS.includes(key)) {
      results.push({ key, ok: false, error: `不支持的配置项，支持: ${VALID_KEYS.join(", ")}` })
      continue
    }

    results.push({ key, ...applySetting(key, value) })
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`✅ ${r.key} 已更新`)
    } else {
      console.log(`❌ ${r.key}: ${r.error}`)
    }
  }
}
